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
import { bulkImportCore, claimRehostedImages, discardRehostedImages, rehostListingImage, BULK_MAX_ROWS, type BulkRow } from '@/lib/core/bulk'
import { syncListingsCore, SYNC_MAX_ROWS, type SyncRow } from '@/lib/core/sync'
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
  district: z.string().optional().describe('Where the item is: the district or area as free text, e.g. "Thảo Điền, Thủ Đức"'),
  condition: z.string().optional().describe('The item\'s condition in words, e.g. "new", "like new" or "used"; ignored for a job'),
  images: z.array(z.string()).optional().describe('Photos as public image URLs, in display order; eno copies each one to its own storage'),
  externalId: z.string().optional().describe('Your own id for this listing, echoed back in the results so you can match them'),
})

/** MCP tool annotations (spec 2025-06-18): hints a client uses to tell a read from a write before calling, e.g. to ask
 *  the user first. `destructiveHint` true = may overwrite or remove what is there (false = only adds); `idempotentHint`
 *  true = repeating the same call changes nothing more — claimed by delete_webhook alone, whose repeat finds nothing; every
 *  listing or shop write may notify the shop's webhooks or re-stamp dates again on a repeat; `openWorldHint` true = the call takes a URL
 *  from the caller that eno will reach (image URLs it fetches, a webhook endpoint it will post to). The webhooks every
 *  listing write already notifies do not count — those endpoints were named by register_webhook. Hints only — the
 *  scopes are what enforce. */
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
const PAGE_SIZE = z.number().int().min(1).max(100).optional().describe('Page size: how many listings to return in this call. Use a small page for a quick look and follow `next_cursor` for the rest').meta({ default: 50 })
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

// The fields of serializeListing a caller acts on. Only `id` is required: the rest are documented, not promised, so a
// field the serializer someday drops can never turn a successful call into a schema failure on the client.
const LISTING_OUT = z.looseObject({
  id: z.string().describe('The listing id, for get_listing, update_listing, set_listing_status and delete_listing'),
  title: z.string().nullish().describe('The headline buyers see'),
  description: z.string().nullish().describe('The text on the listing page'),
  price: z.number().nullish().describe('The asking price in VND (for a job: its monthly salary in VND)'),
  priceUnit: z.string().nullish().describe('What the price is for, e.g. "VND" or "VND/month"'),
  negotiable: z.boolean().nullish().describe('Whether buyers may send offers below the price'),
  status: z.string().nullish().describe('"active" (on sale), "sold" or "hidden"'),
  verified: z.boolean().nullish().describe('false while the listing waits for eno\'s check; a verified listing is public only while its status is active or sold'),
  listingType: z.string().nullish().describe('What it offers: "sell", "rent", "job" or "wanted"'),
  condition: z.string().nullish().describe('The item\'s condition in words'),
  location: z.string().nullish().describe('Where it is, as shown on the listing'),
  district: z.string().nullish().describe('Its district or area'),
  city: z.string().nullish().describe('Its city or province'),
  images: z.array(z.string()).nullish().describe('Photo URLs on eno\'s storage, in display order'),
  category: z.looseObject({ slug: z.string().nullish(), name: z.string().nullish() }).nullish().describe('The category it is filed under'),
  subcategorySlug: z.string().nullish().describe('Its subcategory, when it has one'),
  postedAt: z.string().nullish().describe('When it was listed (ISO 8601)'),
  views: z.number().nullish().describe('How many times its page was viewed'),
  contactCount: z.number().nullish().describe('Leads: how many times a buyer opened contact with the seller'),
}).describe('One of this shop\'s listings, with the fields of GET /api/v1/listings/{id}')
const WEBHOOK_OUT = z.looseObject({
  id: z.string().describe('The webhook id, for delete_webhook'),
  url: z.string().describe('The HTTPS address the events are posted to'),
  events: z.array(z.string()).describe('The events it receives; ["*"] means all of them'),
  enabled: z.boolean().describe('Whether events are being delivered; false once deliveries kept failing'),
  failure_count: z.number().nullish().describe('Failed deliveries in a row since the last success'),
  last_error: z.string().nullish().describe('Why the last delivery failed, if it did'),
  last_delivery_at: z.string().nullish().describe('When an event was last delivered (ISO 8601)'),
  created_at: z.string().nullish().describe('When it was registered (ISO 8601)'),
}).describe('A webhook endpoint registered for this shop')

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
    // Every key is always written (handler below) and only bio/location/phone/avatarUrl are nullable columns on Seller
    // (prisma/schema.prisma: name String, trustScore/responseRate Int, trustTier String, memberSince DateTime — all
    // non-null with defaults), so the rest are promised as present and non-null.
    output: z.looseObject({ shop: z.looseObject({
      id: z.string().describe('The shop id'),
      name: z.string().describe('The shop\'s public name'),
      bio: z.string().nullable().describe('About the shop, as shown on its page; null when it has none'),
      location: z.string().nullable().describe('Where the shop is, as shown on its page; null when not set'),
      phone: z.string().nullable().describe('The shop\'s contact phone number, which eno shares with a buyer only inside its chat, never on the public page; null when not set'),
      avatar_url: z.string().nullable().describe('The shop\'s logo image URL; null when it has none'),
      trust_score: z.number().describe('eno\'s trust score for the shop, from 0 to 150: higher is more trusted'),
      trust_tier: z.string().describe('The trust level that score falls in: restricted, standard, trusted or exceptional'),
      response_rate: z.number().describe('The share of buyers\' conversations the shop answers, in percent (0–100); it reads 100 until eno has measured enough conversations'),
      member_since: z.string().describe('When the shop joined eno (ISO 8601)'),
      active_listings: z.number().describe('How many of its listings buyers can see on the site now'),
    }).describe('The storefront this connection acts for; every field is always present') }).describe('The shop profile'),
    input: z.object({}),
    handler: async (auth) => {
      const s = await db.seller.findUnique({
        where: { id: auth.sellerId },
        select: { id: true, ownerId: true, name: true, bio: true, location: true, phone: true, avatarUrl: true, trustScore: true, trustTier: true, responseRate: true, memberSince: true, _count: { select: { listings: { where: { verified: true, status: 'active' } } } } },
      })
      // Same rule as GET /api/v1/shop: a GONE storefront (src/lib/storefront-gone.ts) is not found.
      if (!s || await isStorefrontGone(s, s._count.listings)) throw new ToolError('not_found', 'Shop not found.')
      return { shop: { id: s.id, name: s.name, bio: s.bio, location: s.location, phone: s.phone, avatar_url: absoluteAssetUrl(s.avatarUrl), trust_score: s.trustScore, trust_tier: s.trustTier, response_rate: s.responseRate, member_since: iso(s.memberSince), active_listings: s._count.listings } }
    },
  },
  {
    name: 'update_shop',
    title: 'Update shop profile',
    description: 'Change this shop\'s profile: the name, bio, location and logo buyers see on its page, and the contact phone eno shares with a buyer inside its chat. Send only the fields to change; the others stay as they are (get_shop shows the current values). Long text is shortened to fit: name 120 characters, bio 1,000, location 120; a name needs at least 2. A phone number another shop already uses is refused with `phone_taken`. Returns `ok: true` once the change is saved.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    output: z.looseObject({ ok: OK }).describe('Confirms the profile change'),
    input: z.object({
      name: z.string().optional().describe('The shop\'s public name, shown on its page and beside its listings'),
      bio: z.string().optional().describe('About the shop, shown on its page; send an empty string to clear it'),
      location: z.string().optional().describe('Where the shop is, shown on its page; send an empty string to clear it'),
      avatarUrl: z.string().optional().describe('The shop\'s logo: an image URL already on eno\'s storage, such as one from a listing\'s images; send an empty string to remove it'),
      phone: z.string().optional().describe('The shop\'s contact phone number, a Vietnamese mobile; eno shares it with a buyer only inside its chat, never on the public page').meta({ examples: ['0901 234 567', '+84 901 234 567'] }),
    }),
    handler: async (auth, args) => {
      const res = await updateSellerCore(auth.sellerId, auth.profileId, args)
      if (!res.ok) throw new ToolError(res.error, res.error)
      return { ok: true }
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
    description: 'Post one new listing for this shop: a category, a title and a price in VND (a job gives its monthly salary in `salaryM` instead), with optional text, location, condition and photos as public image URLs that eno copies to its own storage (the first 8 are used). Longer text is cut to fit: title 140 characters, description 5,000, district 80, condition 60. The listing goes live at once unless eno must check it first (`verified: false` in the result). Refused with a reason, and nothing created, when the text holds a phone number, the category is unknown or the account may not post right now. Returns the new listing\'s `id` (for update_listing and set_listing_status), `verified` (true when it is already public) and `held` (true while it waits for eno\'s licence check). Use it for a listing the seller has asked to post.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({ listing: z.looseObject({ id: z.string().describe('The new listing\'s id, for update_listing and set_listing_status'), verified: z.boolean().describe('true when the new listing was published on creation; false while it waits for eno\'s check and is not public yet'), held: z.boolean().nullish().describe('true while it waits for eno\'s licence check and is not public yet; absent otherwise') }).describe('The listing just created') }).describe('The new listing\'s id and whether it is public yet'),
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
    description: 'Change one of this shop\'s listings: only the fields you send change. Photos you send replace the current set (public URLs are copied to eno\'s storage; the first 8 are used), and text is cut to the same lengths as create_listing. A job\'s pay is `salaryM`; a `price` sent for a job is read as its monthly salary in VND. An edit of a listing waiting for eno\'s licence check is saved with the listing kept unpublished until eno approves it (the result says `held: true`); this tool cannot change a subcategory or the licence values.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({ ok: OK, held: z.boolean().nullish().describe('true when the listing stays unpublished until eno\'s licence check approves it; absent otherwise') }).describe('Confirms the edit'),
    input: z.object({
      id: z.string().describe('The listing to change, by the id list_listings or create_listing gave'),
      title: z.string().optional().describe('The new headline; phone numbers are not allowed in it'),
      description: z.string().optional().describe('The new text for the listing page; contact details are not allowed in it'),
      price: z.number().nonnegative().optional().describe('The new asking price in VND (for a job: its monthly salary in VND)'),
      district: z.string().optional().describe('Where the item is, as a district or area; send an empty string to clear it'),
      condition: z.string().optional().describe('The item\'s condition in words; send an empty string to clear it'),
      images: z.array(z.string()).optional().describe('The complete new set of photos as public image URLs, in display order; it replaces the current photos'),
      salaryM: z.number().int().nonnegative().nullable().optional().describe('A job\'s monthly salary in millions of VND; null removes it (pay agreed with the candidate); it wins over `price`'),
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
      return res.held ? { ok: true, held: true } : { ok: true }
    },
  },
  {
    name: 'set_listing_status',
    title: 'Set listing status',
    description: 'Put one of this shop\'s listings on sale (active), mark it sold, or hide it from the site without deleting it. Use sold when the item is gone and hidden to take it down for now; either can be undone by setting active again. Re-activating is refused with a reason when the account is held or suspended, or with `licence_check_required` while the listing waits for eno\'s licence check. Returns the status the listing now has.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    output: z.looseObject({ ok: OK, status: z.string().describe('The status the listing has now: active, sold or hidden') }).describe('Confirms the change and the listing\'s status now'),
    input: z.object({ id: z.string().describe('The listing to change: the `id` that list_listings, get_listing or create_listing gave'), status: z.enum(['active', 'sold', 'hidden']).describe('What happened to the listing: the item is gone (sold), it should come down for now, e.g. out of stock (hidden), or it is for sale again (active)') }),
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
    description: 'Permanently delete one of this shop\'s listings; it cannot be undone (use set_listing_status hidden to take it down instead). While the shop or the listing is under investigation (an open report, or the account is held or suspended) it is hidden instead of deleted: the result then says `deleted: false, hidden: true` and why.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    output: z.looseObject({ ok: OK, deleted: z.boolean().nullish().describe('false when the listing was hidden instead of deleted; absent when it was deleted'), hidden: z.boolean().nullish().describe('true when it was hidden because the shop or listing is under review; absent when it was deleted'), reason: z.string().nullish().describe('Present only when it was hidden instead: account_held, account_suspended or open_report'), message: z.string().nullish().describe('Present only when it was hidden instead: a sentence explaining why, to show the seller') }).describe('Whether the listing was deleted, or hidden instead and why'),
    input: z.object({ id: z.string().describe('The listing to delete for good: the `id` that list_listings or get_listing gave. Read it with get_listing first to be sure, since a deletion cannot be undone') }),
    handler: async (auth, args) => {
      const id = String(args.id)
      await ownedListing(id, auth.sellerId)
      const res = await deleteListingCore(id)
      if (res.ok && !res.deleted) return { ok: true, deleted: false, hidden: true, reason: res.reason, message: DELETE_HOLD_MESSAGE[res.reason] }
      // The held delete's hide was refused for a reason other than "already gone" — never a silent ok.
      if (!res.ok && res.code !== 404) throw new ToolError(res.error, 'The listing is under review and could not be hidden; it was not deleted.')
      return { ok: true }
    },
  },
  {
    name: 'bulk_create_listings',
    title: 'Create listings in bulk',
    description: `Post up to ${BULK_MAX_ROWS} new listings in one call, one row each (category, title, price in VND, optional text and photos as public image URLs). Rows are independent: a bad row fails alone and the others are created. Returns how many were created and failed, and a result per row with the new id or the reason it failed. To keep eno matched to your own system by your own ids, use sync_catalogue instead.`,
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({
      created: z.number().describe('How many listings were created'),
      failed: z.number().describe('How many rows failed'),
      results: z.array(z.looseObject({
        row: z.number().nullish().describe('The row\'s position in your list, from 1'),
        id: z.string().nullish().describe('The new listing\'s id, when the row succeeded'),
        external_id: z.string().nullish().describe('Your own id for the row, echoed back'),
        error: z.string().nullish().describe('Why the row failed; absent when it succeeded'),
      })).describe('One result per row, in the order sent'),
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
    description: `Make this shop's listings match your own catalogue, matched by your externalId: a new externalId creates a listing, a known one updates it in place, and a row's status can mark it sold or hidden. In mode "full", every active listing whose externalId is missing from this payload is also hidden (listings without an externalId, such as ones posted on the website, are never touched). Up to ${SYNC_MAX_ROWS} rows per call. Returns counts of created, updated, retired and failed rows and a result per row; when the account may not publish new listings, new rows are refused while edits still apply, and \`publish_blocked\` says why.`,
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.looseObject({
      created: z.number().describe('Rows that created a new listing'),
      updated: z.number().describe('Rows that updated an existing listing'),
      retired: z.number().describe('Listings hidden because a full sync did not include them; 0 in partial mode'),
      failed: z.number().describe('Rows that failed'),
      results: z.array(z.looseObject({
        external_id: z.string().nullish().describe('Your own id for the row'),
        id: z.string().nullish().describe('The listing it created or updated'),
        action: z.string().nullish().describe('created, updated or failed'),
        error: z.string().nullish().describe('Why the row failed; absent when it succeeded'),
        detail: z.string().nullish().describe('More about the failure, when there is more'),
      })).describe('One result per row, in the order sent'),
      publish_blocked: z.looseObject({ code: z.string().describe('Why new listings may not be published'), message: z.string().describe('A sentence to show the seller') }).nullish().describe('Present when the account may not publish new listings right now: new rows were refused, edits still applied'),
    }).describe('Counts of created, updated, retired and failed rows, and a result per row'),
    input: z.object({
      mode: z.enum(['partial', 'full']).optional().describe('How to treat your listings missing from this payload: partial (when left out) leaves them as they are, for sending only the rows that changed; full hides each active one whose externalId you did not send, so eno mirrors your whole catalogue. Listings without an externalId are never touched'),
      listings: z.array(listingItem.extend({
        externalId: z.string().describe('Your own id (SKU) for the row: how it finds its existing listing, unique within your shop'),
        status: z.enum(['active', 'sold', 'hidden']).optional().describe('Puts an existing listing on sale (active), marks it sold, or hides it'),
      })).min(1).max(SYNC_MAX_ROWS).describe('Your catalogue rows, each matched to its listing by externalId'),
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
    title: 'Listing analytics',
    description: 'Read views and leads (times a buyer opened contact) per listing per day over a date range, the last 30 days unless you choose one, with each listing\'s all-time totals. Answers a page of listings at a time with `next_cursor` for the next. Use analytics_summary for the shop\'s overall totals. Changes nothing.',
    scope: 'analytics:read',
    annotations: READ_ONLY,
    output: z.looseObject({
      range: z.looseObject({ from: z.string().describe('First day used (YYYY-MM-DD)'), to: z.string().describe('Last day used (YYYY-MM-DD)') }).describe('The date range actually used'),
      listings: z.array(z.looseObject({
        id: z.string().describe('The listing id'),
        external_id: z.string().nullish().describe('Your own id for it, when it has one'),
        title: z.string().nullish().describe('Its headline'),
        status: z.string().nullish().describe('active, sold or hidden'),
        views_total: z.number().nullish().describe('Views of its page since it was listed, not only in the range'),
        leads_total: z.number().nullish().describe('Leads since it was listed: times a buyer opened contact'),
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
    description: 'List the webhook endpoints registered for this shop: where events are sent, which events, whether delivery is on, and recent failures. Signing secrets are never returned. Changes nothing.',
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
      const hook = await db.webhookEndpoint.create({ data: { sellerId: auth.sellerId, url, events, secret }, select: { id: true, url: true, events: true, enabled: true, createdAt: true } })
      return { webhook: { id: hook.id, url: hook.url, events: hook.events === '*' ? ['*'] : hook.events.split(/\s+/).filter(Boolean), enabled: hook.enabled, created_at: iso(hook.createdAt), secret } }
    },
  },
  {
    name: 'delete_webhook',
    title: 'Delete webhook',
    description: 'Remove one of this shop\'s webhook endpoints; eno stops sending it events at once. It cannot be undone: registering the address again gives a new id and a new secret.',
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
 *  required, items, anyOf, const) mean the same in every draft, so dropping the URI changes nothing a client checks. */
function outputJsonSchema(schema: z.ZodType) {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  void _dialect
  return rest
}
