import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { containsPhoneNumber } from '@/lib/phone'
import { assertSafeUrl } from '@/lib/ssrf'
import type { ApiAuth } from '@/lib/api/auth'
import { listingOwnedBy } from '@/lib/api/auth'
import { parsePageParams, pageQuery, buildPage } from '@/lib/api/pagination'
import { createListingCore, updateListingCore, setStatusCore, deleteListingCore, DELETE_HOLD_MESSAGE } from '@/lib/core/listings'
import { bulkImportCore, claimRehostedImages, discardRehostedImages, rehostListingImage, BULK_MAX_ROWS, type BulkRow, type BulkRowResult } from '@/lib/core/bulk'
import { syncListingsCore, SYNC_MAX_ROWS, type SyncRow, type SyncRowResult } from '@/lib/core/sync'
import { updateSellerCore } from '@/lib/core/seller'
import { postingGate } from '@/lib/enforcement'
import { paysSalary, resolveListingType } from '@/lib/taxonomy'
import { getListingAnalytics } from '@/lib/listing-analytics'
import { dispatchListingEventsBatch, generateWebhookSecret } from '@/lib/webhooks'
import { after } from 'next/server'
import { isIdentityBlockCode, publishBlockedBody } from '@/lib/compliance/publish-block-response'
import { isJobTextBlockCode, PublishBlockedError } from '@/lib/publish-guard'
import { JOB_TEXT_REFUSAL } from '@/lib/job-listing'
import { RELEASED_CHARGE_CAP_MESSAGE } from '@/lib/released-charge-copy'
import { LICENCE_CHECK_REQUIRED_COPY, LISTING_CHANGED_COPY } from '@/lib/licence-check-copy'
import { REVIEW_SEAT_LISTING_COPY } from '@/lib/review-seat-accounts'
import { NOT_REMOVED } from '@/lib/listing-removed'
import { isStorefrontGone } from '@/lib/storefront-gone'
import { cutText } from '@/lib/feed-text'

// ── Partner MCP tools ─────────────────────────────────────────────────────────────
// Each tool is a thin, shop-scoped wrapper over the SAME cores the /api/v1 routes use.
// The handler receives the resolved auth (sellerId/profileId/scopes) — the partner's API
// key lives only in the MCP client's connection config and is NEVER a tool argument, so it
// never reaches the model. Throwing ToolError yields an isError tool result the agent sees.

/** `detail`: a pointer the agent can act on, sent beside the message when the refusal has one — the job-text screen's
 *  '<field>:<snippet>' (2026-10-18), the field and the words to take out. */
export class ToolError extends Error {
  constructor(public code: string, message: string, public detail?: string) { super(message) }
}

const LISTING_INCLUDE = { category: true, seller: { include: { owner: { select: { accountType: true } } } } } as const

/** A date as the ISO string it becomes on the wire anyway, so a result already matches its outputSchema (`z.string()`)
 *  before JSON — for any client or check that validates the object itself. */
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

async function ownedListing(id: string, sellerId: string) {
  if (!(await listingOwnedBy(id, sellerId))) throw new ToolError('not_found', 'Listing not found.')
}

// Charged against the SELLER's hourly re-host budget (bulk.ts REHOST_IMAGES_PER_HOUR — security review item 13).
// `fresh` = the images THIS call stored (a URL that comes back unchanged was already ours and is never one): the caller
// claims them once the listing holds them, or discards them when the write is refused (bulk.ts — review item 13).
async function rehostAll(urls: string[] | undefined, sellerId: string): Promise<{ images: string[]; fresh: string[] }> {
  const images: string[] = []
  const fresh: string[] = []
  for (const u of (urls ?? []).slice(0, 8)) {
    const src = String(u)
    const h = await rehostListingImage(src, sellerId)
    if (!h) continue
    images.push(h)
    if (h !== src) fresh.push(h)
  }
  return { images, fresh }
}

// One partner-supplied listing item → BulkRow (shared by bulk + sync mapping).
const listingItem = z.object({
  categorySlug: z.string().describe('The category to file the listing under, by its slug, e.g. "electronics", "vehicles" or "rentals"'),
  title: z.string().min(3).describe('The headline buyers see in search and on the listing page: name the item and what sets it apart. Buyers reach the seller through eno, so it carries no phone number').meta({ examples: ['Honda Vision 2022, 8,000 km'] }),
  price: z.number().nonnegative().describe('The asking price in Vietnamese đồng (VND)'),
  description: z.string().optional().describe('The text shown on the listing page; contact details (phone, e-mail, links) are not allowed in it'),
  district: z.string().optional().describe('Where the item is: the district or area as free text, e.g. "Thảo Điền, Thủ Đức". A new listing needs it: without it the post is refused with `location_required`'),
  condition: z.string().optional().describe('The item\'s condition in words, e.g. "new", "like new" or "used"; ignored for a job'),
  images: z.array(z.string()).optional().describe('Photos as public image URLs, in display order; eno copies each one to its own storage. A new listing needs at least 3 photos of different angles in most categories, 1 for services and none for jobs; fewer is refused with `photos_min` or `photo_required`'),
  externalId: z.string().optional().describe('Your own id for this listing, echoed back in the results so you can match them'),
})

/** MCP tool annotations (spec 2025-06-18): hints a client uses to tell a read from a write before calling, e.g. to ask
 *  the user first. `destructiveHint` true = may overwrite or remove what is there (false = only adds); `idempotentHint`
 *  true = repeating the same call changes nothing more — claimed by delete_webhook alone, whose repeat finds nothing; every
 *  listing or shop write may notify the shop's webhooks or re-stamp dates again on a repeat; `openWorldHint` true = the call
 *  reaches beyond eno's own records: it changes what the public sees (the shop page, a listing on the site), posts events
 *  to the shop's webhook endpoints, or takes a URL eno will fetch or post to. So every write but delete_webhook (which
 *  only forgets an endpoint) — OpenAI's scan flagged update_shop and set_listing_status as false-but-open (2026-11-14).
 *  Hints only — the scopes are what enforce. */
export type ToolAnnotations = { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
// All four on every tool: ChatGPT's review requires readOnlyHint, destructiveHint and openWorldHint as booleans even on a read.
const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

// ── Output schemas (MCP `Tool.outputSchema`) ──────────────────────────────────────────
// What each tool answers, so a client can read the fields without guessing. tools/call sends the same object as
// `structuredContent` beside the JSON text, and MCP says it MUST conform — so every object here is LOOSE (z.looseObject:
// extra keys pass, in zod AND in the published JSON Schema — a plain z.object publishes additionalProperties:false
// while zod's own parse merely strips, so a test could pass a result a strict client rejects) and `required` names only
// keys the handler always writes. A field added to a result never breaks a client;
// only removing a required key would, and the conformance test in src/lib/mcp/output-schemas.test.ts runs the handlers.
const OK = z.boolean().describe('Always true: a change eno refuses comes back as a tool error with the reason instead')
const CURSOR_OUT = z.string().nullable().describe('Pass it back as `cursor` to get the next page; null when this was the last page')
const PAGE_SIZE = z.number().int().min(1).max(100).optional().describe('How many listings to return in this call. Ask for a few for a quick look; to go through them all, call again with `next_cursor` until it comes back null').meta({ default: 50 })
/**
 * A photo, video or logo as an app can open it (2026-11-14): a seeded or older row can hold a site-relative path such as
 * "/listings/x.png", which ChatGPT, Claude or Muse cannot resolve, so MCP output names it in full on THIS edition's site
 * (OAUTH_ISSUER = NEXT_PUBLIC_APP_URL, trailing slash stripped); a protocol-relative "//host/…" gets https. Sent back in
 * an edit, the full URL is fetched and stored like any outside photo (rehostAll), where the bare path was dropped.
 */
export function absoluteAssetUrl<T extends string | null | undefined>(u: T): T {
  if (typeof u !== 'string') return u
  if (u.startsWith('//')) return `https:${u}` as T
  return (u.startsWith('/') ? `${OAUTH_ISSUER}${u}` : u) as T
}
const listingOut = (l: Parameters<typeof serializeListing>[0]) => {
  const out = serializeListing(l)
  return {
    ...out,
    ...(Array.isArray(out.images) ? { images: out.images.map(absoluteAssetUrl) } : {}),
    ...(out.video !== undefined ? { video: absoluteAssetUrl(out.video) } : {}),
    ...(out.seller ? { seller: { ...out.seller, avatarUrl: absoluteAssetUrl(out.seller.avatarUrl) } } : {}),
  }
}

// The fields of serializeListing a caller acts on (2026-11-15: required where serializeListing always writes the key, and
// nullable only where the Listing column is — prisma/schema.prisma). output-schemas.real-serializer.test.ts runs the real
// serializer against this, so a key it stops writing fails there before a client ever sees it.
const LISTING_OUT = z.looseObject({
  id: z.string().describe('The listing id: pass it to get_listing, update_listing, set_listing_status or delete_listing'),
  title: z.string().describe('The headline buyers see in search and on the listing page'),
  description: z.string().describe('The text on the listing page; empty when the seller wrote none'),
  price: z.number().describe('The asking price in VND; for a job, its monthly salary in VND'),
  priceUnit: z.string().describe('What the price is for, e.g. "VND" or "VND/month"; show it beside the price'),
  negotiable: z.boolean().describe('Whether buyers may send offers below the price; always false for a job or a wanted ad'),
  status: z.string().describe('"active" (on sale), "sold" or "hidden"; change it with set_listing_status'),
  verified: z.boolean().describe('false while the listing waits for eno\'s check; a verified listing is public while its status is active or sold'),
  listingType: z.string().describe('What it offers: "sell", "rent", "job" or "wanted"'),
  condition: z.string().nullable().describe('The item\'s condition in words; null when none was given'),
  location: z.string().describe('Where it is, as shown on the listing'),
  district: z.string().nullable().describe('Its district or area; null when none was given'),
  city: z.string().describe('Its city or province'),
  images: z.array(z.string()).describe('Photo URLs on eno\'s storage, in display order. To keep them through an edit, send this list back to update_listing with your changes'),
  category: z.looseObject({ slug: z.string().describe('The category slug, as create_listing takes it'), name: z.string().describe('The category\'s English name') }).describe('The category it is filed under'),
  subcategorySlug: z.string().nullable().describe('Its subcategory; null when it has none'),
  postedAt: z.string().describe('When it was listed (ISO 8601)'),
  views: z.number().describe('How many times its page has been viewed since it was listed'),
  contactCount: z.number().describe('Leads: how many signed-in buyers opened the seller\'s contact from it'),
}).describe('One of this shop\'s listings, with the fields of GET /api/v1/listings/{id}')
const WEBHOOK_OUT = z.looseObject({
  id: z.string().describe('The webhook id, for delete_webhook'),
  url: z.string().describe('The HTTPS address the events are posted to'),
  events: z.array(z.string()).describe('The events it receives; ["*"] means all of them'),
  enabled: z.boolean().describe('Whether events are being delivered; false once deliveries kept failing'),
  failure_count: z.number().describe('Failed deliveries in a row since the last success; 0 when the last one worked'),
  last_error: z.string().nullable().describe('Why the last delivery failed; null when it worked or none was sent yet'),
  last_delivery_at: z.string().nullable().describe('When an event was last delivered (ISO 8601); null before the first one'),
  created_at: z.string().describe('When it was registered (ISO 8601)'),
}).describe('A webhook endpoint registered for this shop')

// The storefront as get_shop reads it, and as update_shop answers after a change (readShop writes every key; only
// bio/location/phone/avatarUrl are nullable columns on Seller in prisma/schema.prisma, so the rest are non-null).
const SHOP_OUT = z.looseObject({
  id: z.string().describe('The shop id; every tool on this connection acts on this one shop'),
  name: z.string().describe('The shop\'s public name, shown on its page and beside each of its listings'),
  bio: z.string().nullable().describe('About the shop, as shown on its page; null when it has none'),
  location: z.string().nullable().describe('Where the shop is, as shown on its page; null when not set'),
  phone: z.string().nullable().describe('The shop\'s contact phone number, which eno shares with a buyer only inside its chat, never on the public page; null when not set'),
  avatar_url: z.string().nullable().describe('The shop\'s logo as a full image URL; null when it has none'),
  trust_score: z.number().describe('eno\'s trust score for the shop, from 0 to 150: higher is more trusted'),
  trust_tier: z.string().describe('The trust level that score falls in: restricted, standard, trusted or exceptional. A restricted shop cannot post new listings until its score recovers'),
  response_rate: z.number().describe('The share of buyers\' conversations the shop answers, in percent (0–100); it reads 100 until eno has measured enough conversations'),
  member_since: z.string().describe('When the shop joined eno (ISO 8601)'),
  active_listings: z.number().describe('How many of its listings buyers can see on the site now; analytics_summary counts every status'),
}).describe('The storefront this connection acts for; every field is always present')

/** get_shop's answer, and update_shop's after a change. Same rule as GET /api/v1/shop: a GONE storefront
 *  (src/lib/storefront-gone.ts) is not found. */
async function readShop(sellerId: string) {
  const s = await db.seller.findUnique({
    where: { id: sellerId },
    select: { id: true, ownerId: true, name: true, bio: true, location: true, phone: true, avatarUrl: true, trustScore: true, trustTier: true, responseRate: true, memberSince: true, _count: { select: { listings: { where: { verified: true, status: 'active' } } } } },
  })
  if (!s || await isStorefrontGone(s, s._count.listings)) throw new ToolError('not_found', 'Shop not found.')
  return { id: s.id, name: s.name, bio: s.bio, location: s.location, phone: s.phone, avatar_url: absoluteAssetUrl(s.avatarUrl), trust_score: s.trustScore, trust_tier: s.trustTier, response_rate: s.responseRate, member_since: s.memberSince.toISOString(), active_listings: s._count.listings }
}

const CREATED_OUT = z.looseObject({
  id: z.string().describe('The new listing\'s id, for update_listing and set_listing_status'),
  verified: z.boolean().describe('true when the new listing was published on creation; false while it waits for eno\'s check and is not public yet'),
  held: z.boolean().optional().describe('Present and true while it waits for eno\'s licence check and is not public yet; absent otherwise'),
}).describe('The listing just created')
const BULK_ROW_OUT = z.looseObject({
  row: z.number().describe('The row\'s position in your list, from 1'),
  id: z.string().optional().describe('The new listing\'s id when the row was created; absent when it failed'),
  external_id: z.string().optional().describe('Your own id for the row, echoed back when you sent one'),
  error: z.string().optional().describe('Why the row failed, in words to show the seller; absent when it was created'),
})
const SYNC_ROW_OUT = z.looseObject({
  external_id: z.string().nullable().describe('Your own id for the row; null when the row had none'),
  id: z.string().optional().describe('The listing the row created or updated; absent when a new row failed'),
  action: z.enum(['created', 'updated', 'failed']).describe('What happened to the row'),
  error: z.string().optional().describe('Why the row failed: a reason code or a sentence; absent when it succeeded'),
  detail: z.string().optional().describe('More about the failure when there is more, e.g. the words to take out of a job post'),
})

// ⛔ COMPILE-TIME PINS (2026-11-15): each producer's own TypeScript type must fit the schema published for it, so a core
// that starts writing null, or drops a key the schema requires, fails `tsc` HERE — not in a client that validates
// structuredContent after a write has already landed. (A conditional that resolves to `never` cannot hold `true`; the
// tuple wrap stops it distributing over a union, where one fitting member would otherwise let a bad one through.)
type Fits<T, S extends z.ZodType> = [T] extends [z.infer<S>] ? true : never
const SYNC_ROW_PIN: Fits<SyncRowResult, typeof SYNC_ROW_OUT> = true
const BULK_ROW_PIN: Fits<BulkRowResult, typeof BULK_ROW_OUT> = true
const LISTING_PIN: Fits<ReturnType<typeof listingOut>, typeof LISTING_OUT> = true
const SHOP_PIN: Fits<Awaited<ReturnType<typeof readShop>>, typeof SHOP_OUT> = true
const CREATED_PIN: Fits<Awaited<ReturnType<typeof createListingCore>>, typeof CREATED_OUT> = true
void [SYNC_ROW_PIN, BULK_ROW_PIN, LISTING_PIN, SHOP_PIN, CREATED_PIN]

export type McpTool = {
  name: string
  /** Short display label (MCP `Tool.title`): Claude's directory requires one on every tool. */
  title: string
  description: string
  scope: 'listings:read' | 'listings:write' | 'analytics:read' | 'media:write'
  annotations: ToolAnnotations
  input: z.ZodType
  /** The result object's shape (see OUTPUT SCHEMAS above). */
  output: z.ZodType
  handler: (auth: ApiAuth, args: Record<string, unknown>) => Promise<unknown>
}

export const TOOLS: McpTool[] = [
  {
    name: 'get_shop',
    title: 'Get shop profile',
    description: "Read the storefront this connection acts for: its id, name, bio, location, phone, logo, trust score and tier, response rate, member-since date and how many listings are live now. Use it to confirm which shop this connection acts for. Changes nothing.",
    scope: 'listings:read',
    annotations: READ_ONLY,
    output: z.looseObject({ shop: SHOP_OUT }).describe('The shop profile'),
    input: z.object({}),
    handler: async (auth) => ({ shop: await readShop(auth.sellerId) }),
  },
  {
    name: 'update_shop',
    title: 'Update shop profile',
    description: 'Change this shop\'s profile: the name, bio, location and logo buyers see on its page, and the contact phone eno shares with a buyer inside its chat. Use it when the seller asks to rename the shop, rewrite its bio, or change its location, logo or phone. Send only the fields to change; the others stay as they are (get_shop shows the current values). Long text is shortened to fit: name 120 characters, bio 1,000, location 120; a name needs at least 2. A phone number another shop already uses is refused with `phone_taken`. Returns `ok: true` and the profile as it now stands.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({ ok: OK, shop: SHOP_OUT.nullable().describe('The shop profile as it now stands, the same fields get_shop reads; null only if it could not be read back') }).describe('Confirms the change and shows the profile after it'),
    input: z.object({
      name: z.string().optional().describe('The shop\'s public name, shown on its page and beside its listings. Leave it out to keep the current name'),
      bio: z.string().optional().describe('About the shop, shown on its page. Send an empty string to clear it, or leave it out to keep it'),
      location: z.string().optional().describe('Where the shop is, shown on its page. Send an empty string to clear it, or leave it out to keep it'),
      avatarUrl: z.string().optional().describe('The shop\'s logo: an image URL already on eno\'s storage, such as one from a listing\'s images. Send an empty string to remove it, or leave it out to keep it'),
      phone: z.string().optional().describe('The shop\'s contact phone number, a Vietnamese mobile; eno shares it with a buyer only inside its chat, never on the public page. Leave it out to keep the current number').meta({ examples: ['0901 234 567', '+84 901 234 567'] }),
    }),
    handler: async (auth, args) => {
      const res = await updateSellerCore(auth.sellerId, auth.profileId, args)
      if (!res.ok) throw new ToolError(res.error, res.error)
      // The change is SAVED: a read-back that fails (or would not fit SHOP_OUT) answers null, never an error the agent
      // would retry.
      const shop = await readShop(auth.sellerId).then((x) => (SHOP_OUT.safeParse(x).success ? x : null)).catch(() => null)
      return { ok: true, shop }
    },
  },
  {
    name: 'list_listings',
    title: 'List listings',
    description: 'List this shop\'s own listings, newest first, in every status unless you ask for one: active (on sale), sold or hidden. Each page returns the listings with price, status, category and photos, plus `next_cursor` to fetch the next page. Use get_listing to read one listing by id. Changes nothing.',
    scope: 'listings:read',
    annotations: READ_ONLY,
    output: z.looseObject({ listings: z.array(LISTING_OUT).describe('This page of the shop\'s listings, newest first'), next_cursor: CURSOR_OUT }).describe('One page of the shop\'s listings'),
    input: z.object({ limit: PAGE_SIZE, cursor: z.string().optional().describe('Where to continue: the `next_cursor` of the previous page; leave it out for the first page'), status: z.enum(['active', 'sold', 'hidden']).optional().describe('Show only listings in one state, e.g. sold to review what has sold or hidden to find listings taken down; leave it out to see every listing') }),
    handler: async (auth, args) => {
      const sp = new URLSearchParams()
      if (args.limit != null) sp.set('limit', String(args.limit))
      if (args.cursor) sp.set('cursor', String(args.cursor))
      const { limit, cursorId } = parsePageParams(sp)
      // Never a tombstone (src/lib/listing-removed.ts); an explicit status (active|sold|hidden) narrows further.
      // ⛔ AND-ed, NOT spread: `{ ...NOT_REMOVED, status }` let a caller's `status` REPLACE the guard
      // (status:'removed' listed the tombstones). The zod enum refuses 'removed' today; the AND keeps the
      // guard standing even if the enum ever widens or a caller reaches the handler unvalidated.
      const where = { AND: [{ sellerId: auth.sellerId }, NOT_REMOVED, ...(args.status ? [{ status: String(args.status) }] : [])] }
      const rows = await db.listing.findMany({ where, orderBy: { id: 'desc' }, ...pageQuery(limit, cursorId), include: LISTING_INCLUDE })
      const { items, nextCursor } = buildPage(rows, limit)
      return { listings: items.map(listingOut), next_cursor: nextCursor }
    },
  },
  {
    name: 'get_listing',
    title: 'Get listing',
    description: 'Read one of this shop\'s listings by id, in any status, with all its fields: title, text, price, status, category, location, photos, views and leads. Use it to see the current values before update_listing. Fails with `not_found` when the id is not one of this shop\'s listings. Changes nothing.',
    scope: 'listings:read',
    annotations: READ_ONLY,
    output: z.looseObject({ listing: LISTING_OUT.nullable().describe('The listing, or null if it was removed a moment ago') }).describe('The listing asked for'),
    input: z.object({ id: z.string().describe('The listing to read, by the id list_listings or create_listing gave') }),
    handler: async (auth, args) => {
      await ownedListing(String(args.id), auth.sellerId)
      const l = await db.listing.findUnique({ where: { id: String(args.id) }, include: LISTING_INCLUDE })
      return { listing: l ? listingOut(l) : null }
    },
  },
  {
    name: 'create_listing',
    title: 'Create listing',
    description: 'Post one new listing for this shop when the seller asks to sell, rent out or advertise something, or to post a job. Give a category, a title, the price in VND (a job gives its monthly salary in `salaryM` instead) and the district where it is; text, condition, brand and model are optional. Photos are public image URLs that eno copies to its own storage (the first 8 are used): most categories need at least 3 photos of different angles, services need 1 and jobs none. Longer text is cut to fit: title 140 characters, description 5,000, district 80, condition 60. The listing goes live at once unless eno must check it first (`verified: false` in the result). Refused with a reason code, and nothing created, when photos or the district are missing (`photos_min`, `photo_required`, `location_required`), the text holds a phone number, the category is unknown or the account may not post right now. Returns the new listing\'s `id` (for update_listing and set_listing_status), `verified` (true when it is already public) and `held` (true while it waits for eno\'s licence check). To post many listings at once, use bulk_create_listings.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({ listing: CREATED_OUT }).describe('The new listing\'s id and whether it is public yet'),
    input: listingItem.omit({ externalId: true }).extend({
      // Optional HERE because a job needs none; every other listing still has to send one (checked below).
      price: z.number().nonnegative().optional().describe('The asking price in VND. Needed for everything except a job (category "jobs"), whose pay is `salaryM`; a job sent with only a price has it read as the monthly salary.'),
      negotiable: z.boolean().optional().describe('Whether buyers may send offers below the price (yes unless you say no); services and jobs never take offers'),
      listingType: z.string().optional().describe('What the listing offers: "sell" or "rent" where the category allows it ("job" or "wanted" in jobs); otherwise the category\'s usual one is used'),
      brand: z.string().optional().describe('The brand, matched to eno\'s brand list even with typos; only used in categories that have brands'),
      model: z.string().optional().describe('The model within that brand; kept only when the brand was recognised'),
      salaryM: z.number().int().nonnegative().optional().describe('A job\'s monthly salary in millions of VND (category "jobs"); leave it out when the pay is agreed with the candidate'),
    }),
    handler: async (auth, args) => {
      const title = cutText(String(args.title || '').trim(), 140)
      // A job is paid a salary: its price is derived from `salaryM` in createListingCore (taxonomy.ts
      // paysSalary), so it needs no price — one it sends is passed on and read as the salary there.
      const price = paysSalary(resolveListingType(String(args.categorySlug || ''), args.listingType)) ? 0 : Number(args.price)
      if (title.length < 3 || !Number.isFinite(price) || price < 0 || price > 1e12) throw new ToolError('invalid_input', 'A title (≥3 chars) and a valid price are required.')
      if (containsPhoneNumber(title) || containsPhoneNumber(String(args.description || ''))) throw new ToolError('no_phone_in_listing', 'Phone numbers are not allowed in the title or description.')
      const category = await db.category.findUnique({ where: { slug: String(args.categorySlug || '') }, select: { id: true, slug: true, name: true, nameVi: true } })
      if (!category) throw new ToolError('unknown_category', `Unknown category "${args.categorySlug}".`)
      const seller = await db.seller.findUnique({ where: { id: auth.sellerId }, select: { id: true, ownerId: true, trustTier: true, trustScore: true, phone: true } })
      if (!seller) throw new ToolError('not_found', 'Shop not found.')
      // Enforcement ladder — same gate as POST /api/listings (audit P0 #3: the MCP
      // path called createListingCore ungated, so a held seller could post here).
      if (seller.ownerId) {
        const gate = await postingGate(seller.ownerId, seller.id)
        if (gate) throw new ToolError(gate.error, 'Posting is blocked for this account right now.')
      }
      const { images, fresh } = await rehostAll(args.images as string[] | undefined, auth.sellerId)
      const body = { description: args.description, images, district: args.district, condition: args.condition, negotiable: args.negotiable, listingType: args.listingType, brand: args.brand, model: args.model, salaryM: args.salaryM, price: args.price }
      // Never a guest (an API key authenticated this call) — an ownerless shop is a platform import,
      // as on /api/v1 and in bulk_import / sync_listings.
      try {
        const created = await createListingCore({ seller, guestCreate: false, category, title, price, body, headers: new Headers() })
        await claimRehostedImages(fresh)
        return { listing: created }
      } catch (e) {
        // Every refusal createListingCore throws comes before its insert, so nothing will hold these images. Any other
        // throw leaves them to the tombstone sweep, which keeps whatever a listing does hold.
        if (e instanceof PublishBlockedError) await discardRehostedImages(fresh)
        // The released-scam-charge cap is an ACCOUNT limit with its own code — surfaced as a tool error
        // the agent can explain. (The other content refusals keep the MCP route's existing mapping.)
        if (e instanceof PublishBlockedError && e.code === 'released_charge_listing_cap') throw new ToolError(e.code, RELEASED_CHARGE_CAP_MESSAGE)
        // ⛔ AN e-VISA OR LEGAL & PERMITS SERVICE (2026-10-14). Its title or description files it in a licence aisle (a
        // keyword guess counts as a pick — core/listings.ts), which needs the provider's registered name and licence
        // number — attributes this tool cannot send. A coded answer naming the way that can, not an internal_error.
        if (e instanceof PublishBlockedError && e.code === 'provider_licence_required') {
          throw new ToolError(e.code, 'This reads as an e-Visa or Legal & permits service, and those listings need the provider’s registered business name and licence number, which this tool cannot send. Create it with POST /api/v1/listings (attributes.providerLegalName and attributes.providerLicenceNo) or from the website; it then stays unpublished until eno has checked the licence.')
        }
        // ⛔ A HIRING POST THE JOB-TEXT SCREEN REFUSED (job-listing.ts jobTextProblem, 2026-10-18): an answer the agent can act
        // on — the code, its rule's sentence and `detail` '<field>:<snippet>' (the words to take out) — never the route's
        // internal_error, which told it nothing and logged a crash.
        if (e instanceof PublishBlockedError && isJobTextBlockCode(e.code)) throw new ToolError(e.code, JOB_TEXT_REFUSAL[e.code].en, e.detail)
        throw e
      }
    },
  },
  {
    name: 'update_listing',
    title: 'Update listing',
    // ⚠️ No aisle named here: tools/list is published to anonymous callers on both editions, and eno.vn's must carry no
    // visa vocabulary (src/app/api/mcp/discovery-auth.test.ts, the licensing pin).
    description: 'Change one of this shop\'s listings when the seller asks for a new price, better text, another district or new photos. Send the listing\'s id and only the fields to change; the rest stay as they are (get_listing shows the current values). Photos you send replace the whole set (public URLs are copied to eno\'s storage; the first 8 are used), and text is cut to the same lengths as create_listing. A job\'s pay is `salaryM`; a `price` sent for a job is read as its monthly salary in VND. Returns `ok: true` and the listing as it now stands. An edit of a listing waiting for eno\'s licence check is saved with the listing kept unpublished until eno approves it (`held: true`). This tool cannot change a subcategory or the licence values, nor the category or the status (use set_listing_status for that).',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({
      ok: OK,
      held: z.boolean().optional().describe('Present and true when the edit is saved but the listing stays unpublished until eno\'s licence check approves it; absent otherwise'),
      unpublished: z.boolean().optional().describe('Present and true when the listing belongs to an account whose listings are not shown publicly; absent otherwise'),
      listing: LISTING_OUT.nullable().describe('The listing as it now stands, the same fields get_listing reads; null only if it could not be read back'),
    }).describe('Confirms the edit and shows the listing after it'),
    input: z.object({
      id: z.string().describe('The listing to change, by the id list_listings or create_listing gave'),
      title: z.string().optional().describe('The new headline; phone numbers are not allowed in it. Leave it out to keep the current one'),
      description: z.string().optional().describe('The new text for the listing page; contact details are not allowed in it. Leave it out to keep the current text'),
      price: z.number().nonnegative().optional().describe('The new asking price in VND (for a job: its monthly salary in VND). Leave it out to keep the current price'),
      district: z.string().optional().describe('Where the item is, as a district or area. Send an empty string to clear it, or leave it out to keep it'),
      condition: z.string().optional().describe('The item\'s condition in words. Send an empty string to clear it, or leave it out to keep it'),
      images: z.array(z.string()).optional().describe('The complete new set of photos as public image URLs, in display order; it replaces the current photos. To add a photo, send the current `images` from get_listing plus the new URL. Leave it out to keep the photos as they are'),
      salaryM: z.number().int().nonnegative().nullable().optional().describe('A job\'s monthly salary in millions of VND; it wins over `price`. Send null to remove it (pay agreed with the candidate), or leave it out to keep the current salary'),
    }),
    handler: async (auth, args) => {
      const id = String(args.id)
      await ownedListing(id, auth.sellerId)
      const body: Record<string, unknown> = {}
      for (const k of ['title', 'description', 'price', 'district', 'condition', 'salaryM'] as const) if (args[k] !== undefined) body[k] = args[k]
      let fresh: string[] = []
      if (Array.isArray(args.images)) { const r = await rehostAll(args.images as string[], auth.sellerId); body.images = r.images; fresh = r.fresh }
      const res = await updateListingCore(id, body)
      // A refused edit wrote nothing (updateListingCore's every `ok: false`), so nothing holds the images it stored.
      if (res.ok) await claimRehostedImages(fresh); else await discardRehostedImages(fresh)
      // `listing_changed` (2026-10-14): eno's licence check changed the listing mid-edit — a sentence, since retrying is right.
      // A hiring post's edit the job-text screen refused (2026-10-18): its rule's sentence, and `detail` '<field>:<snippet>'.
      if (!res.ok) {
        if (isJobTextBlockCode(res.error)) throw new ToolError(res.error, JOB_TEXT_REFUSAL[res.error].en, res.detail)
        throw new ToolError(res.error, res.error === 'listing_changed' ? LISTING_CHANGED_COPY.en : res.error)
      }
      // `held`: an e-Visa / Legal & permits listing still waiting for eno's licence check — unpublished, as on /api/v1.
      // `unpublished`: a store-review seat's listing that is not public (round 5 — review-seat-accounts.ts), as on /api/v1.
      // `listing`: the row as it now stands (2026-11-15), so the agent can confirm the change without a second call.
      // The edit is SAVED: a read-back that fails (the query, the serializer, or LISTING_OUT) answers null, never an error
      // the agent would retry.
      const listing = await db.listing.findUnique({ where: { id }, include: LISTING_INCLUDE })
        .then((row) => { const out = row ? listingOut(row) : null; return out && LISTING_OUT.safeParse(out).success ? out : null })
        .catch(() => null)
      return res.held ? { ok: true, held: true, listing } : res.unpublished ? { ok: true, unpublished: true, listing } : { ok: true, listing }
    },
  },
  {
    name: 'set_listing_status',
    title: 'Set listing status',
    description: 'Put one of this shop\'s listings on sale (active), mark it sold, or hide it from the site without deleting it. Use sold when the item is gone and hidden to take it down for now; either can be undone by setting active again. Re-activating is refused with a reason when the account is held or suspended, or with `licence_check_required` while the listing waits for eno\'s licence check. Returns the status the listing now has.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({ ok: OK, status: z.enum(['active', 'sold', 'hidden']).describe('The status the listing has now: on sale (active), sold or hidden') }).describe('Confirms the change and the listing\'s status now'),
    input: z.object({ id: z.string().describe('The listing to change: the `id` that list_listings, get_listing or create_listing gave'), status: z.enum(['active', 'sold', 'hidden']).describe('The state to move the listing to: sold once the item has gone to a buyer, hidden to take it off the site for now (for example while it is out of stock), active to put it back on sale') }),
    handler: async (auth, args) => {
      const id = String(args.id)
      await ownedListing(id, auth.sellerId)
      const res = await setStatusCore(id, String(args.status))
      if (!res.ok) {
        // A relist refused because the account is held or suspended (the hold leak) gets a sentence,
        // like postingGate's refusal in create_listing, rather than the bare code.
        const message = isIdentityBlockCode(res.error) ? publishBlockedBody(res.error).message.en
          : res.error === 'account_held' || res.error === 'account_suspended' ? 'This account is held or suspended, so its listings cannot be put back on sale right now.'
            : res.error === 'released_charge_listing_cap' ? RELEASED_CHARGE_CAP_MESSAGE
              // An e-Visa / Legal & permits listing eno has not checked (2026-10-14).
              : res.error === 'licence_check_required' ? LICENCE_CHECK_REQUIRED_COPY.en
                // A store-review seat's listing, any type (round 5 — review-seat-accounts.ts).
                : res.error === 'review_seat_listing' ? REVIEW_SEAT_LISTING_COPY.en
                // A hiring post whose stored text the job-text screen refuses (2026-10-19): its rule's sentence, and `detail`.
                : isJobTextBlockCode(res.error) ? JOB_TEXT_REFUSAL[res.error].en
                  : res.error
        throw new ToolError(res.error, message, res.detail)
      }
      return { ok: true, status: res.status }
    },
  },
  {
    name: 'delete_listing',
    title: 'Delete listing',
    description: 'Permanently delete one of this shop\'s listings; it cannot be undone (use set_listing_status hidden to take it down instead). Returns `deleted: true` once the listing is gone. While the shop or the listing is under review (an open report, or the account is held or suspended) it is hidden instead of deleted: the result then says `deleted: false` and `hidden: true`, with the `reason` code and a `message` to show the seller.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({
      ok: OK,
      deleted: z.boolean().describe('true when the listing was deleted; false when it was hidden instead because the shop or listing is under review'),
      hidden: z.boolean().optional().describe('Present and true when it was hidden instead of deleted; absent when it was deleted'),
      reason: z.string().optional().describe('Why it was hidden instead of deleted: account_held, account_suspended or open_report; absent when it was deleted'),
      message: z.string().optional().describe('A sentence to show the seller, saying why it was hidden and when it can be deleted; absent when it was deleted'),
    }).describe('Whether the listing was deleted, or hidden instead and why'),
    input: z.object({ id: z.string().describe('The listing to delete for good: the `id` that list_listings or get_listing gave. Read it with get_listing first to be sure, since a deletion cannot be undone') }),
    handler: async (auth, args) => {
      const id = String(args.id)
      await ownedListing(id, auth.sellerId)
      const res = await deleteListingCore(id)
      if (res.ok && !res.deleted) return { ok: true, deleted: false, hidden: true, reason: res.reason, message: DELETE_HOLD_MESSAGE[res.reason] }
      // The held delete's hide was refused for a reason other than "already gone" — never a silent ok.
      if (!res.ok && res.code !== 404) throw new ToolError(res.error, 'The listing is under review and could not be hidden; it was not deleted.')
      // A 404 here = the row went between the ownership check and the delete: it is gone either way.
      return { ok: true, deleted: true }
    },
  },
  {
    name: 'bulk_create_listings',
    title: 'Create listings in bulk',
    description: `Post many new listings in one call, one row each (category, title, price in VND, optional text and photos as public image URLs), e.g. to move a stock list or spreadsheet onto eno. Rows are independent: a bad row fails alone and the others are created. Returns how many were created and failed, and a result per row with the new id or the reason it failed. To keep eno matched to your own system by your own ids, use sync_catalogue instead.`,
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({
      created: z.number().describe('How many listings were created'),
      failed: z.number().describe('How many rows failed'),
      results: z.array(BULK_ROW_OUT).describe('One result per row, in the order sent'),
    }).describe('Counts of created and failed rows, and a result per row'),
    input: z.object({ listings: z.array(listingItem).min(1).max(BULK_MAX_ROWS).describe('The new listings, one row each; every row succeeds or fails on its own') }),
    handler: async (auth, args) => {
      const seller = await db.seller.findUnique({ where: { id: auth.sellerId }, select: { id: true, ownerId: true, trustTier: true, trustScore: true } })
      if (!seller) throw new ToolError('not_found', 'Shop not found.')
      const rows: BulkRow[] = (args.listings as z.infer<typeof listingItem>[]).map((x) => ({
        category_slug: x.categorySlug, title: x.title, description: x.description, price: x.price, district: x.district, condition: x.condition,
        image_urls: x.images?.length ? x.images.join('|') : undefined, external_id: x.externalId,
      }))
      const result = await bulkImportCore(seller, rows)
      // The identity gate refused the whole batch (nothing was created) — a tool ERROR carrying the
      // code, not a "success" whose every row failed, so the agent can tell the seller what to do.
      if (result.blocked) throw new ToolError(result.blocked, publishBlockedBody(result.blocked).message.en)
      const createdIds = result.results.filter((r) => r.id).map((r) => r.id!)
      if (createdIds.length) after(() => dispatchListingEventsBatch('listing.created', createdIds, seller.id))
      return { created: result.created, failed: result.failed, results: result.results }
    },
  },
  {
    name: 'sync_catalogue',
    title: 'Sync catalogue',
    description: `Make this shop's listings match your own catalogue, matched by your externalId: a new externalId creates a listing, a known one updates it in place, and a row's status can mark it sold or hidden. In mode "full", every active listing whose externalId is missing from this payload is also hidden (listings without an externalId, such as ones posted on the website, are never touched). Returns counts of created, updated, retired and failed rows and a result per row; when the account may not publish new listings, new rows are refused while edits still apply, and \`publish_blocked\` says why.`,
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({
      created: z.number().describe('Rows that created a new listing'),
      updated: z.number().describe('Rows that updated an existing listing'),
      retired: z.number().describe('Listings hidden because a full sync did not include them; 0 in partial mode'),
      failed: z.number().describe('Rows that failed'),
      results: z.array(SYNC_ROW_OUT).describe('One result per row, in the order sent'),
      publish_blocked: z.looseObject({ code: z.string().describe('Why new listings may not be published'), message: z.string().describe('A sentence to show the seller') }).optional().describe('Present when the account may not publish new listings right now: new rows were refused, edits still applied'),
    }).describe('Counts of created, updated, retired and failed rows, and a result per row'),
    input: z.object({
      mode: z.enum(['partial', 'full']).optional().describe(`How to treat your listings missing from this payload: partial leaves them as they are, for sending only the rows that changed; full hides each active one whose externalId you did not send, so eno mirrors your whole catalogue. Full compares against this one payload alone, so use it only when the whole catalogue fits in one call (${SYNC_MAX_ROWS} rows); a bigger catalogue syncs in partial mode, since full calls split across a catalogue each hide the rows the others carry. Listings without an externalId are never touched`).meta({ default: 'partial' }),
      listings: z.array(listingItem.extend({
        externalId: z.string().describe('Your own id (SKU) for the row: how it finds its existing listing, unique within your shop'),
        status: z.enum(['active', 'sold', 'hidden']).optional().describe('Puts an existing listing on sale (active), marks it sold, or hides it. Leave it out to keep an existing listing\'s status; on a new row it is ignored and the row is posted as a new listing'),
      })).min(1).max(SYNC_MAX_ROWS).describe('Your catalogue rows, each matched to its listing by externalId. For a known externalId, the fields you leave out keep their current values'),
    }),
    handler: async (auth, args) => {
      const seller = await db.seller.findUnique({ where: { id: auth.sellerId }, select: { id: true, ownerId: true, trustTier: true, trustScore: true } })
      if (!seller) throw new ToolError('not_found', 'Shop not found.')
      const mode = args.mode === 'full' ? 'full' : 'partial'
      const out = await syncListingsCore(seller, args.listings as SyncRow[], mode)
      // A partial success, not a tool error: edits and sold/hidden rows applied. But the identity
      // gate's refusal of the creates/revives is named once with its copy, the way /api/v1 does it
      // (`publish_blocked`), so the agent can tell the seller what to do instead of parsing codes.
      return out.blocked ? { ...out, publish_blocked: { code: out.blocked, message: publishBlockedBody(out.blocked).message.en } } : out
    },
  },
  {
    name: 'analytics_summary',
    title: 'Shop analytics summary',
    description: 'Read this shop\'s totals in one call: how many listings it has, how many are active, sold or hidden, how many still wait for eno\'s check, and the total views and leads (times a buyer opened contact) across all of them. For per-listing, per-day figures use analytics_listings. Changes nothing.',
    scope: 'analytics:read',
    annotations: READ_ONLY,
    output: z.looseObject({ summary: z.looseObject({
      total_listings: z.number().describe('All of the shop\'s listings, in any status'),
      total_views: z.number().describe('Views across all its listings'),
      total_leads: z.number().describe('Leads across all its listings: times a buyer opened contact'),
      active: z.number().describe('Listings on sale'),
      sold: z.number().describe('Listings marked sold'),
      hidden: z.number().describe('Listings hidden from the site'),
      held: z.number().describe('Active listings still waiting for eno\'s check'),
    }).describe('The shop\'s totals') }).describe('The shop\'s listing counts, views and leads'),
    input: z.object({}),
    handler: async (auth) => {
      const where = { sellerId: auth.sellerId, ...NOT_REMOVED } // tombstones are not the shop's listings
      const [agg, byStatus, held] = await Promise.all([
        db.listing.aggregate({ where, _sum: { views: true, contactCount: true }, _count: { _all: true } }),
        db.listing.groupBy({ by: ['status'], where, _count: { _all: true } }),
        db.listing.count({ where: { ...where, verified: false, status: 'active' } }),
      ])
      const sc = (s: string) => byStatus.find((g) => g.status === s)?._count._all ?? 0
      return { summary: { total_listings: agg._count._all, total_views: agg._sum.views ?? 0, total_leads: agg._sum.contactCount ?? 0, active: sc('active'), sold: sc('sold'), hidden: sc('hidden'), held } }
    },
  },
  {
    name: 'analytics_listings',
    title: 'Get listing analytics',
    description: 'Read views and leads (times a buyer opened contact) per listing per day over a date range, the last 30 days unless you choose one, with each listing\'s all-time totals. Answers a page of listings at a time with `next_cursor` for the next. Use analytics_summary for the shop\'s overall totals. Changes nothing.',
    scope: 'analytics:read',
    annotations: READ_ONLY,
    output: z.looseObject({
      range: z.looseObject({ from: z.string().describe('First day used (YYYY-MM-DD)'), to: z.string().describe('Last day used (YYYY-MM-DD)') }).describe('The date range actually used'),
      listings: z.array(z.looseObject({
        id: z.string().describe('The listing id, for get_listing or update_listing'),
        external_id: z.string().nullable().describe('Your own id for it; null when it has none'),
        title: z.string().describe('Its headline'),
        status: z.string().describe('active, sold or hidden'),
        views_total: z.number().describe('Views of its page since it was listed, not only in the range'),
        leads_total: z.number().describe('Leads since it was listed: times a buyer opened contact'),
        daily: z.array(z.looseObject({ day: z.string().describe('The day, a UTC date written YYYY-MM-DD'), views: z.number().describe('Views of its page that day'), leads: z.number().describe('Times a buyer opened contact that day') })).describe('One entry per day in the range'),
      })).describe('This page of listings with their daily figures'),
      next_cursor: CURSOR_OUT,
    }).describe('Views and leads per listing per day over the range actually used'),
    input: z.object({
      from: z.string().optional().describe('The first day of the period to report, a UTC date written YYYY-MM-DD; left out, the 30 days before `to`. A period longer than 92 days is shortened to its last 92').meta({ examples: ['2026-10-01'] }),
      to: z.string().optional().describe('The last day of the period to report, a UTC date written YYYY-MM-DD; left out, today').meta({ examples: ['2026-10-31'] }),
      limit: PAGE_SIZE,
      cursor: z.string().optional().describe('Where to continue: the `next_cursor` of the previous page; leave it out for the first page'),
    }),
    handler: async (auth, args) => {
      const out = await getListingAnalytics(auth.sellerId, { from: args.from as string, to: args.to as string, limit: args.limit as number, cursor: args.cursor as string })
      if ('error' in out) throw new ToolError(out.error.code, out.error.message)
      return out
    },
  },
  {
    name: 'list_webhooks',
    title: 'List webhooks',
    description: 'List the webhook endpoints registered for this shop: where events are sent, which events, whether delivery is on, and recent failures. Use it to find a webhook\'s id for delete_webhook, or to see why deliveries stopped (`enabled: false` with `last_error`). Signing secrets are never returned. Changes nothing.',
    scope: 'listings:read',
    annotations: READ_ONLY,
    output: z.looseObject({ webhooks: z.array(WEBHOOK_OUT).describe('Every webhook of this shop, newest first; secrets are never included') }).describe('The shop\'s webhooks'),
    input: z.object({}),
    handler: async (auth) => {
      const hooks = await db.webhookEndpoint.findMany({ where: { sellerId: auth.sellerId }, orderBy: { createdAt: 'desc' }, select: { id: true, url: true, events: true, enabled: true, failureCount: true, lastError: true, lastDeliveryAt: true, createdAt: true } })
      return { webhooks: hooks.map((h) => ({ id: h.id, url: h.url, events: h.events === '*' ? ['*'] : h.events.split(/\s+/).filter(Boolean), enabled: h.enabled, failure_count: h.failureCount, last_error: h.lastError, last_delivery_at: iso(h.lastDeliveryAt), created_at: iso(h.createdAt) })) }
    },
  },
  {
    name: 'register_webhook',
    title: 'Register webhook',
    description: 'Register an HTTPS endpoint of yours that eno will POST signed events to when this shop\'s listings are created, updated, change status or are deleted. Returns the webhook with its signing secret, shown only this once: store it to verify each event\'s signature. A shop can have up to 10 webhooks.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({ webhook: WEBHOOK_OUT.extend({ secret: z.string().describe('The signing secret, shown only this once: store it to verify each event\'s signature') }).describe('The webhook just registered') }).describe('The new webhook and its one-time signing secret'),
    input: z.object({ url: z.string().describe('Your public HTTPS address that will receive the events'), events: z.array(z.enum(['listing.created', 'listing.updated', 'listing.status_changed', 'listing.deleted'])).optional().describe('The changes to be told about, e.g. only listing.status_changed to hear when something sells; leave it out to receive every event') }),
    handler: async (auth, args) => {
      const url = String(args.url || '').trim()
      try { await assertSafeUrl(url) } catch { throw new ToolError('invalid_input', 'url must be a public HTTPS endpoint.') }
      const count = await db.webhookEndpoint.count({ where: { sellerId: auth.sellerId } })
      if (count >= 10) throw new ToolError('limit_reached', 'A shop may register at most 10 webhooks.')
      const events = Array.isArray(args.events) && args.events.length ? (args.events as string[]).join(' ') : '*'
      const secret = generateWebhookSecret()
      const hook = await db.webhookEndpoint.create({ data: { sellerId: auth.sellerId, url, events, secret }, select: { id: true, url: true, events: true, enabled: true, failureCount: true, lastError: true, lastDeliveryAt: true, createdAt: true } })
      return { webhook: { id: hook.id, url: hook.url, events: hook.events === '*' ? ['*'] : hook.events.split(/\s+/).filter(Boolean), enabled: hook.enabled, failure_count: hook.failureCount, last_error: hook.lastError, last_delivery_at: iso(hook.lastDeliveryAt), created_at: iso(hook.createdAt), secret } }
    },
  },
  {
    name: 'delete_webhook',
    title: 'Delete webhook',
    description: 'Remove one of this shop\'s webhook endpoints, e.g. one you no longer run or whose secret may have leaked; eno stops sending it events at once. To change which events an endpoint gets, register it again with the new list, then delete the old one. It cannot be undone: registering the address again gives a new id and a new secret. Returns `ok: true` once it is gone.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    output: z.looseObject({ ok: OK }).describe('Confirms the webhook is gone'),
    input: z.object({ id: z.string().describe('The webhook to remove, by the id list_webhooks or register_webhook gave') }),
    handler: async (auth, args) => {
      const hook = await db.webhookEndpoint.findUnique({ where: { id: String(args.id) }, select: { sellerId: true } })
      if (!hook || hook.sellerId !== auth.sellerId) throw new ToolError('not_found', 'Webhook not found.')
      await db.webhookEndpoint.delete({ where: { id: String(args.id) } })
      return { ok: true }
    },
  },
]

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

// JSON-Schema list for tools/list (zod v4 → JSON Schema), with each tool's read/write hints.
export function toolDescriptors() {
  // `annotations.title` repeats the title for clients that only read the older spot (MCP 2025-03-26).
  return TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: z.toJSONSchema(t.input), outputSchema: outputJsonSchema(t.output), annotations: { title: t.title, ...t.annotations } }))
}

/** An outputSchema WITHOUT `$schema`: MCP client SDKs COMPILE output schemas to validate structuredContent, and a validator
 *  built for the default draft throws on the 2020-12 meta-schema URI zod writes. The keywords used here (type, properties,
 *  required, items, anyOf, const, enum) mean the same in every draft, so dropping the URI changes nothing a client checks. */
function outputJsonSchema(schema: z.ZodType) {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  void _dialect
  return rest
}
