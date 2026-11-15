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
import { paysSalary, resolveListingType, TAXONOMY, isPostableCategory } from '@/lib/taxonomy'
import { getListingAnalytics } from '@/lib/listing-analytics'
import { dispatchListingEventsBatch, generateWebhookSecret } from '@/lib/webhooks'
import { after } from 'next/server'
import { isIdentityBlockCode, publishBlockedBody } from '@/lib/compliance/publish-block-response'
import { isJobTextBlockCode, PublishBlockedError } from '@/lib/publish-guard'
import { publishBlockedApiMessage } from '@/lib/api/publish-blocked-message'
import { JOB_TEXT_REFUSAL } from '@/lib/job-listing'
import { RELEASED_CHARGE_CAP_MESSAGE } from '@/lib/released-charge-copy'
import { LICENCE_CHECK_REQUIRED_COPY, LISTING_CHANGED_COPY } from '@/lib/licence-check-copy'
import { REVIEW_SEAT_LISTING_COPY } from '@/lib/review-seat-accounts'
import type { DeleteHoldReason } from '@/lib/delete-hold-copy'
import type { AnalyticsListingRow } from '@/lib/listing-analytics'
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

// The category slugs a listing can be filed under, from the taxonomy itself (no tool or endpoint lists them otherwise).
const POSTABLE_SLUGS = TAXONOMY.filter((c) => isPostableCategory(c.slug)).map((c) => c.slug).join(', ')

// One partner-supplied listing item → BulkRow (shared by bulk + sync mapping).
const listingItem = z.object({
  categorySlug: z.string().describe(`Where the listing is filed, by category slug: ${POSTABLE_SLUGS}. A job goes in jobs, a room or flat to let in rentals`),
  // Its minimum length is the server's (create_listing's handler, bulk.ts per row): a short title in a bulk call fails its row, not the batch.
  title: z.string().describe('The headline buyers see in search and on the listing page: name the item and what sets it apart. Buyers reach the seller through eno, so it carries no phone number; longer than 140 characters is cut. E.g. "Honda Vision 2022, 8,000 km"'),
  // A negative price is refused per row by bulk.ts ("Invalid price") and by updateListingCore (invalid_price): no schema bound.
  price: z.number().describe('The asking price in Vietnamese đồng (VND); for a job, its monthly salary in VND'),
  description: z.string().optional().describe('The text shown on the listing page: what it is, its state and what comes with it. Contact details (phone, e-mail, links) are not allowed in it, and it is cut at 5,000 characters. Leave it out for a listing with no text'),
  district: z.string().optional().describe('Where the item is: the district or area as free text (cut at 80 characters), e.g. "Thảo Điền, Thủ Đức". A new listing needs it: without it the post is refused with `location_required`'),
  condition: z.string().optional().describe('The item\'s condition in words (cut at 60 characters), e.g. "new", "like new" or "used"; ignored for a job. Leave it out when it does not apply'),
  images: z.array(z.string()).optional().describe('Photos as public image URLs, in display order; eno copies each one to its own storage and uses the first 8. A new listing needs at least 3 photos of different angles in most categories, 1 for services and none for jobs; fewer is refused with `photos_min` or `photo_required`. On a new listing, leave it out only for a job'),
  externalId: z.string().optional().describe('Your own id for this listing, such as your SKU, echoed back in the results so you can match each row to your system; leave it out if you have none'),
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
// What each tool answers. tools/call sends the same object as `structuredContent`, and MCP says it MUST conform.
// ⛔ THE FORMAT (2026-11-15). Measured on Manufact's leaderboard: 4,283 output schemas from its top 150 servers, of which
// the 52 scoring 95+ share one shape, and the owner asked for it. Every key is REQUIRED (a value that does not apply is
// null, and its description says when). Objects are CLOSED (z.strictObject = additionalProperties:false). Closed sets are
// enums with each value explained. Each field says how to use it, e.g. which tool takes it.
// Closed is safe only because every answer is built KEY BY KEY by the projections below (never a spread of a core's
// object), each pinned at compile time to its schema. The conformance tests (output-schemas*.test.ts) also parse every
// handler's answer with these strict schemas, so an extra or a missing key fails there before any client sees it.
// No always-true `ok` flag in any answer (removed 2026-11-15): a change eno refuses comes back as a tool error with the reason,
// so a write answers with what it saved instead, as the best-scoring update tools on Manufact's board do.
const CURSOR_OUT = z.string().nullable().describe('Pass it back as `cursor` to get the next page; null when this was the last page')
// The bounds live on the server (pagination.ts parsePageParams parseInt()s and clamps to PAGE_MAX, PAGE_DEFAULT when left out;
// a plain number, so 25.5 or 1e21 still reach pageLimitArg's normalising rather than a schema refusal), not in the
// schema: Manufact's judge flags a bounded `limit` as "validation repeated" whatever its prose says (2026-11-15 data).
/** `limit` as the pager reads it: a whole number written out in digits. parseInt() reads 1e21 as "1e+21" → 1 and 1e-7 as
 *  "1e-7" → 1, so a number is truncated and bounded here first; parsePageParams then clamps it to 1..PAGE_MAX. */
export const pageLimitArg = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? String(Math.max(1, Math.min(n, 1000))) : undefined
}
const PAGE_SIZE = z.number().optional().describe('How many listings to return in this call. Leave it out for a normal-size answer; the server caps a very large number. To go through every listing, call again with `next_cursor` until it comes back null')
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
/** A listing's public page on THIS edition's site (src/lib/social/caption.ts listingUrl, without the campaign tags). */
const listingPageUrl = (id: string) => `${OAUTH_ISSUER}/listings/${id}`

// ⛔ A value READ FROM THE DATABASE is a described string, never a closed enum: a stored value the enum does not list would
// make a validating client reject the whole answer. Measured 2026-11-15 on all 151,351 live rows (read-only sweep): besides
// active/sold/hidden, 27,917 are 'expired' and 22,038 'stale' (Rever rentals, scripts/retire-rever-rentals.ts) — no tool
// writes either. Enums stay only where this code makes the value itself.
const LISTING_STATUS = ['active', 'sold', 'hidden'] as const
type ListingStatusOut = (typeof LISTING_STATUS)[number]
const LISTING_STATUS_SET = z.enum(LISTING_STATUS).describe('The status the listing has now. active: on sale (public once verified). sold: kept on the site, marked sold. hidden: off the site but not deleted')
const LISTING_STATUS_OUT = z.string().describe('active: on sale (public once verified). sold: kept on the site, marked sold. hidden: off the site but not deleted; set_listing_status moves a listing between these three. Any other value, such as expired or stale, means eno took the listing off the site')
const WEBHOOK_EVENTS = ['listing.created', 'listing.updated', 'listing.status_changed', 'listing.deleted'] as const

/** The listing as MCP answers it: the fields a seller's agent acts on, by name (serializeListing writes ~60, most for the
 *  web page), photos as full URLs, and the page link. list_listings and get_listing never reach a tombstone
 *  (NOT_REMOVED, listingOwnedBy), so the status is one of the three; update_listing's read-back is checked against
 *  LISTING_OUT before it is sent. */
export const listingOut = (l: Parameters<typeof serializeListing>[0]) => {
  const s = serializeListing(l)
  return {
    id: s.id, title: s.title, description: s.description, price: s.price, priceUnit: s.priceUnit, negotiable: s.negotiable,
    status: s.status, verified: s.verified, listingType: s.listingType, condition: s.condition,
    location: s.location, district: s.district, city: s.city, images: s.images.map((u) => absoluteAssetUrl(u)), video: absoluteAssetUrl(s.video),
    category: { slug: s.category.slug, name: s.category.name }, subcategorySlug: s.subcategorySlug, postedAt: s.postedAt,
    views: s.views, contactCount: s.contactCount, url: listingPageUrl(s.id),
  }
}
const LISTING_OUT = z.strictObject({
  id: z.string().describe('The listing id (such as `cmh0q2x8f0001...`); pass it to get_listing, update_listing, set_listing_status or delete_listing'),
  title: z.string().describe('The headline buyers see in search and on the listing page'),
  description: z.string().describe('The text on the listing page; an empty string when the seller wrote none'),
  price: z.number().describe('The asking price in Vietnamese đồng (VND); for a job, its monthly salary in VND. Show it with priceUnit, formatted as VND (e.g. 12.000.000 đ)'),
  priceUnit: z.string().describe('What the price is for, e.g. "VND" or "VND/month"; show it beside the price'),
  negotiable: z.boolean().describe('Whether buyers may send offers below the price; always false for a job or a wanted ad'),
  status: LISTING_STATUS_OUT,
  verified: z.boolean().describe('false while the listing waits for eno\'s check and is not public yet; true once eno has published it'),
  listingType: z.string().describe('What the listing offers, e.g. "sell", "rent", "job" or "wanted"'),
  condition: z.string().nullable().describe('The item\'s condition in words, e.g. "like new"; null when none was given'),
  location: z.string().describe('The place as shown on the listing page, for display; use district and city to compare or filter listings'),
  district: z.string().nullable().describe('Its district or area; null when none was given'),
  city: z.string().describe('Its city or province, e.g. "Hồ Chí Minh"'),
  images: z.array(z.string()).describe('Photo URLs in display order. To keep them through an edit, send this list back to update_listing'),
  video: z.string().nullable().describe('The listing\'s video as a full URL; null when it has none'),
  category: z.strictObject({
    slug: z.string().describe('The category slug, as create_listing takes it'),
    name: z.string().describe('The category\'s English name'),
  }).describe('The category it is filed under'),
  subcategorySlug: z.string().nullable().describe('Its subcategory; null when it has none'),
  postedAt: z.string().describe('When it was listed, as an ISO 8601 UTC timestamp'),
  views: z.number().describe('How many times its page has been viewed since it was listed, all time'),
  contactCount: z.number().describe('Leads, all time: how many different signed-in buyers opened the seller\'s contact from it'),
  url: z.string().describe('Its page on eno; share it with buyers once the listing is public'),
}).describe('One of this shop\'s listings')

/** list_listings' item: the summary an agent scans a page by (the best list outputs on Manufact's board answer a focused
 *  summary per item and leave the full record to the get tool). get_listing and update_listing answer the full LISTING_OUT. */
export const listingSummaryOut = (l: Parameters<typeof serializeListing>[0]) => {
  const f = listingOut(l)
  return {
    id: f.id, title: f.title, price: f.price, priceUnit: f.priceUnit, status: f.status, verified: f.verified,
    district: f.district, city: f.city, cover: (f.images[0] as string | undefined) ?? null, photos: f.images.length,
    categorySlug: f.category.slug, postedAt: f.postedAt, views: f.views, contactCount: f.contactCount, url: f.url,
  }
}
const LISTING_SUMMARY_OUT = z.strictObject({
  id: LISTING_OUT.shape.id,
  title: LISTING_OUT.shape.title,
  price: LISTING_OUT.shape.price,
  priceUnit: LISTING_OUT.shape.priceUnit,
  status: LISTING_OUT.shape.status,
  verified: LISTING_OUT.shape.verified,
  district: LISTING_OUT.shape.district,
  city: LISTING_OUT.shape.city,
  cover: z.string().nullable().describe('Its first photo as a full URL, the one shown on cards; null when it has none'),
  photos: z.number().describe('How many photos it has; get_listing returns them all'),
  categorySlug: z.string().describe('Its category slug, as create_listing takes it; get_listing gives the category\'s name too'),
  postedAt: LISTING_OUT.shape.postedAt,
  views: LISTING_OUT.shape.views,
  contactCount: LISTING_OUT.shape.contactCount,
  url: LISTING_OUT.shape.url,
}).describe('One of this shop\'s listings, in summary; get_listing returns all its fields')

/** A webhook as list_webhooks and register_webhook answer it. Events are stored as typed by register_webhook (the enum). */
type WebhookRow = { id: string; url: string; events: string; enabled: boolean; failureCount: number; lastError: string | null; lastDeliveryAt: Date | null; createdAt: Date }
const webhookOut = (h: WebhookRow) => ({
  id: h.id, url: h.url, events: h.events === '*' ? ['*'] : h.events.split(/\s+/).filter(Boolean),
  enabled: h.enabled, failure_count: h.failureCount, last_error: h.lastError, last_delivery_at: iso(h.lastDeliveryAt), created_at: h.createdAt.toISOString(),
})
const WEBHOOK_OUT = z.strictObject({
  id: z.string().describe('The webhook id; pass it to delete_webhook'),
  url: z.string().describe('The HTTPS address the events are posted to'),
  events: z.array(z.string()).describe('The events it receives: listing.created, listing.updated, listing.status_changed or listing.deleted; ["*"] means every event'),
  enabled: z.boolean().describe('Whether events are being delivered; false once deliveries kept failing'),
  failure_count: z.number().describe('Failed deliveries in a row since the last success; 0 when the last one worked'),
  last_error: z.string().nullable().describe('Why the last delivery failed; null when it worked or none was sent yet'),
  last_delivery_at: z.string().nullable().describe('When an event was last delivered (ISO 8601); null before the first one'),
  created_at: z.string().describe('When it was registered (ISO 8601)'),
}).describe('A webhook endpoint registered for this shop')
// register_webhook's answer: the same fields written for a webhook that was just made, plus its one-time secret (pinned below).
const REGISTERED_WEBHOOK_OUT = z.strictObject({
  id: z.string().describe('The new webhook\'s id; pass it to delete_webhook to stop the events'),
  url: z.string().describe('The address eno will POST each event to, as you gave it'),
  events: z.array(z.string()).describe('The events it will receive, as you chose them; ["*"] means every event'),
  enabled: z.boolean().describe('true: eno sends events from now on. It turns false by itself if deliveries keep failing'),
  failure_count: z.number().describe('0 for a new webhook; later, how many deliveries in a row have failed'),
  last_error: z.string().nullable().describe('null for a new webhook; later, why the last delivery failed'),
  last_delivery_at: z.string().nullable().describe('null until the first event is delivered; then when the last one was (ISO 8601)'),
  created_at: z.string().describe('When it was registered, which is now (ISO 8601)'),
  secret: z.string().describe('The signing secret, shown only this once: store it now to verify each event\'s signature; eno cannot show it again'),
}).describe('The webhook just registered')

// The storefront as get_shop reads it, and as update_shop answers after a change (only bio/location/phone/avatarUrl are
// nullable columns on Seller in prisma/schema.prisma; the tier is written by trust-math.ts tierFor alone).
const SHOP_OUT = z.strictObject({
  id: z.string().describe('The shop id; every tool on this connection reads and changes this one shop, so there is no shop id to pass anywhere'),
  name: z.string().describe('The shop\'s public name, shown on its page and beside each of its listings; change it with update_shop'),
  bio: z.string().nullable().describe('About the shop, as shown on its page; null when it has none, which update_shop can fill'),
  location: z.string().nullable().describe('Where the shop is, as shown on its page; null when not set, which update_shop can fill'),
  phone: z.string().nullable().describe('The shop\'s contact phone number, which eno shares with a buyer only inside its chat, never on the public page, so do not repeat it in anything public; null when not set'),
  avatar_url: z.string().nullable().describe('The shop\'s logo as a full image URL, ready to show; null when it has none'),
  trust_score: z.number().describe('eno\'s trust score for the shop, from 0 to 150: higher is more trusted'),
  trust_tier: z.string().describe('The trust level that score falls in. restricted: below 60 or under a scam hold, and it cannot post new listings until it recovers. standard, trusted and exceptional: posting as normal, higher tiers more trusted'),
  response_rate: z.number().describe('The share of buyers\' conversations the shop answers, in percent (0–100); it reads 100 until eno has measured enough conversations'),
  member_since: z.string().describe('When the shop joined eno, as an ISO 8601 UTC timestamp'),
  active_listings: z.number().describe('How many of its listings buyers can see on the site now; the rest are sold, hidden, expired or waiting for eno\'s check'),
}).describe('The storefront this connection acts for')

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

const createdOut = (c: Awaited<ReturnType<typeof createListingCore>>) => ({
  id: c.id, verified: c.verified, held: (c as { held?: boolean }).held === true, url: listingPageUrl(c.id),
})
const CREATED_OUT = z.strictObject({
  id: z.string().describe('The new listing\'s id; pass it to update_listing or set_listing_status'),
  verified: z.boolean().describe('true when the listing was published at once; false while it waits for eno\'s check and is not public yet'),
  held: z.boolean().describe('true while it waits for eno\'s licence check, and verified is then false; false otherwise. Tell the seller it goes live if eno approves the licence'),
  url: z.string().describe('Its page on eno; share it with buyers once the listing is public'),
}).describe('The listing just created')

const bulkRowOut = (r: BulkRowResult) => ({ row: r.row, id: r.id ?? null, external_id: r.external_id ?? null, error: r.error ?? null })
const BULK_ROW_OUT = z.strictObject({
  row: z.number().describe('The row\'s position in your list, from 1'),
  id: z.string().nullable().describe('The new listing\'s id; null when the row failed'),
  external_id: z.string().nullable().describe('Your own id for the row, echoed back; null when you sent none'),
  error: z.string().nullable().describe('Why the row failed, in words to show the seller; null when it was created'),
}).describe('What happened to one row')

const syncRowOut = (r: SyncRowResult) => ({ external_id: r.external_id, id: r.id ?? null, action: r.action, error: r.error ?? null, detail: r.detail ?? null })
const SYNC_ROW_OUT = z.strictObject({
  external_id: z.string().nullable().describe('Your own id for the row; null when the row had none'),
  id: z.string().nullable().describe('The listing the row created or updated; null when a new row failed'),
  action: z.enum(['created', 'updated', 'failed']).describe('created: a new listing was posted. updated: the existing listing was changed. failed: nothing was changed for this row, see error'),
  error: z.string().nullable().describe('Why the row failed, as a reason code or a sentence; null when it succeeded'),
  detail: z.string().nullable().describe('More about the failure when there is more, e.g. the words to take out of a job post; null otherwise'),
}).describe('What happened to one catalogue row')

const analyticsRowOut = (r: AnalyticsListingRow) => ({
  id: r.id, external_id: r.external_id, title: r.title, status: r.status, views_total: r.views_total, leads_total: r.leads_total,
  daily: r.daily.map((d) => ({ day: d.day, views: d.views, leads: d.leads })),
})
const ANALYTICS_ROW_OUT = z.strictObject({
  id: z.string().describe('The listing id; pass it to get_listing or update_listing'),
  external_id: z.string().nullable().describe('Your own id for it; null when it has none'),
  title: z.string().describe('Its headline'),
  status: LISTING_STATUS_OUT,
  views_total: z.number().describe('Views of its page since it was listed, all time, not only in the range'),
  leads_total: z.number().describe('Leads since it was listed, all time: how many different signed-in buyers opened the seller\'s contact'),
  daily: z.array(z.strictObject({
    day: z.string().describe('The day, a UTC date written YYYY-MM-DD'),
    views: z.number().describe('Views of its page during that UTC day; 0 on a day without views'),
    leads: z.number().describe('How many more signed-in buyers opened the seller\'s contact from it during that UTC day; 0 on a day without any'),
  }).describe('One day\'s figures')).describe('One entry per day in the range, oldest first'),
}).describe('One listing\'s figures')

const DELETE_HOLD_REASONS = ['account_held', 'account_suspended', 'open_report'] as const satisfies readonly DeleteHoldReason[]
const deletedOut = (hold: DeleteHoldReason | null) => hold
  ? { deleted: false, hidden: true, reason: hold, message: DELETE_HOLD_MESSAGE[hold] as string | null }
  : { deleted: true, hidden: false, reason: null, message: null }

// ⛔ COMPILE-TIME PINS (2026-11-15): each projection's type must EQUAL the type of the schema published for it, checked
// both ways, so a field that turns nullable, changes type, goes missing OR is added without the schema fails `tsc` HERE,
// not in a client validating structuredContent after a write has landed. (A conditional that resolves to `never` cannot
// hold `true`; the tuple wraps stop it distributing over a union.) Values read from the database are plain strings in
// both the projection and the schema (see LISTING_STATUS_OUT), so no cast can hide a stored value the schema refuses.
type Fits<T, S extends z.ZodType> = [T] extends [z.infer<S>] ? ([z.infer<S>] extends [T] ? true : never) : never
const PINS: [
  Fits<ReturnType<typeof listingOut>, typeof LISTING_OUT>,
  Fits<ReturnType<typeof listingSummaryOut>, typeof LISTING_SUMMARY_OUT>,
  Fits<Awaited<ReturnType<typeof readShop>>, typeof SHOP_OUT>,
  Fits<ReturnType<typeof webhookOut>, typeof WEBHOOK_OUT>,
  Fits<ReturnType<typeof webhookOut> & { secret: string }, typeof REGISTERED_WEBHOOK_OUT>,
  Fits<ReturnType<typeof createdOut>, typeof CREATED_OUT>,
  Fits<ReturnType<typeof bulkRowOut>, typeof BULK_ROW_OUT>,
  Fits<ReturnType<typeof syncRowOut>, typeof SYNC_ROW_OUT>,
  Fits<ReturnType<typeof analyticsRowOut>, typeof ANALYTICS_ROW_OUT>,
] = [true, true, true, true, true, true, true, true, true]
void PINS

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

// Titles: each round on the live server tests a form per tool and the best stays (owner: every title to 100; the 100s are
// left alone). The judge gives 100 at confidence >= 0.99: "Get shop", "Update shop", "Get shop analytics summary" and the
// webhook titles reach it; titles on a bare "listing" stall at 0.88-0.98. Round 4 pins the object down ("marketplace
// listing" to create or update one, "shop" for this shop's own: "Get shop listings", "Get shop listing details", "Delete shop listing",
// "Sync shop catalogue") and rewords the analytics title; "Fetch listings" (0.88) is gone.
export const TOOLS: McpTool[] = [
  {
    name: 'get_shop',
    title: 'Get shop',
    description: 'Read the storefront this connection acts for: its id, name, bio, location, phone, logo, trust score and tier, response rate, member-since date and how many of its listings are live.\n\nIt does not list the listings themselves (list_listings) or their views and leads (analytics_summary). Fails with `not_found` when the storefront has been closed.\n\nReturns `shop` with those fields. Use it first to confirm which shop this connection acts for, and before update_shop to see the current values.',
    scope: 'listings:read',
    annotations: READ_ONLY,
    output: z.strictObject({ shop: SHOP_OUT }).describe('The shop profile'),
    input: z.object({}),
    handler: async (auth) => ({ shop: await readShop(auth.sellerId) }),
  },
  {
    name: 'update_shop',
    title: 'Update shop',
    description: 'Update this shop\'s profile: the name, bio, location and logo buyers see on its page, and the contact phone eno shares with a buyer inside its chat.\n\nSend only the fields to change; the others stay as they are. Changes are saved immediately. Long text is shortened to fit: name 120 characters, bio 1,000, location 120, and a name needs at least 2. A phone number another shop already uses is refused with `phone_taken`, and nothing is changed.\n\nReturns `shop`, the saved profile, with the same fields as get_shop. Use it when the seller asks to rename the shop, rewrite its bio, or change its location, logo or phone.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.strictObject({ shop: SHOP_OUT.nullable().describe('The saved shop profile after the update, the same fields get_shop returns; null only if it could not be read back, and the change is saved either way') }).describe('The saved shop profile after the update'),
    input: z.object({
      name: z.string().optional().describe('The shop\'s public name, shown on its page and beside its listings. Leave it out to keep the current name'),
      bio: z.string().optional().describe('About the shop in a few sentences, shown on its page: what it sells and how it serves buyers. Send an empty string to clear it, or leave it out to keep it'),
      location: z.string().optional().describe('Where the shop is, as a district or area buyers recognise, e.g. "Thảo Điền, Thủ Đức", shown on its page. Send an empty string to clear it, or leave it out to keep it'),
      avatarUrl: z.string().optional().describe('The shop\'s logo: an image URL already on eno\'s storage, such as one from a listing\'s images. Send an empty string to remove it, or leave it out to keep it'),
      phone: z.string().optional().describe('The shop\'s contact phone number, a Vietnamese mobile such as 0901 234 567 or +84 901 234 567; eno shares it with a buyer only inside its chat, never on the public page. Leave it out to keep the current number'),
    }),
    handler: async (auth, args) => {
      const res = await updateSellerCore(auth.sellerId, auth.profileId, args)
      if (!res.ok) throw new ToolError(res.error, res.error)
      // The change is SAVED: a read-back that fails (or would not fit SHOP_OUT) answers null, never an error the agent
      // would retry.
      const shop = await readShop(auth.sellerId).then((x) => (SHOP_OUT.safeParse(x).success ? x : null)).catch(() => null)
      return { shop }
    },
  },
  {
    name: 'list_listings',
    title: 'Get shop listings',
    description: 'Get this shop\'s own listings, newest first, in every status unless you ask for one: active (on sale), sold or hidden.\n\nDeleted listings never appear. A page holds 50 listings unless you set `limit` (at most 100); pass `next_cursor` back as `cursor` until it comes back null to read them all.\n\nReturns `listings`, each in summary: its id, title, price and price unit, status, whether it is verified, district, city, cover photo and photo count, category, date posted, views, leads and page `url`; and `next_cursor`. get_listing returns a listing\'s text, condition and every photo. Use get_listing to read one listing by id, and analytics_listings for its views and leads by day.',
    scope: 'listings:read',
    annotations: READ_ONLY,
    output: z.strictObject({ listings: z.array(LISTING_SUMMARY_OUT).describe('This page of the shop\'s listings, newest first'), next_cursor: CURSOR_OUT }).describe('One page of the shop\'s listings'),
    input: z.object({ limit: PAGE_SIZE, cursor: z.string().optional().describe('Where to continue: the `next_cursor` of the previous page; leave it out for the first page'), status: z.enum(['active', 'sold', 'hidden']).optional().describe('Show only listings in one state, e.g. sold to review what has sold or hidden to find listings taken down; leave it out to see every listing') }),
    handler: async (auth, args) => {
      const sp = new URLSearchParams()
      const asked = pageLimitArg(args.limit)
      if (asked) sp.set('limit', asked)
      if (args.cursor) sp.set('cursor', String(args.cursor))
      const { limit, cursorId } = parsePageParams(sp)
      // Never a tombstone (src/lib/listing-removed.ts); an explicit status (active|sold|hidden) narrows further.
      // ⛔ AND-ed, NOT spread: `{ ...NOT_REMOVED, status }` let a caller's `status` REPLACE the guard
      // (status:'removed' listed the tombstones). The zod enum refuses 'removed' today; the AND keeps the
      // guard standing even if the enum ever widens or a caller reaches the handler unvalidated.
      const where = { AND: [{ sellerId: auth.sellerId }, NOT_REMOVED, ...(args.status ? [{ status: String(args.status) }] : [])] }
      const rows = await db.listing.findMany({ where, orderBy: { id: 'desc' }, ...pageQuery(limit, cursorId), include: LISTING_INCLUDE })
      const { items, nextCursor } = buildPage(rows, limit)
      return { listings: items.map(listingSummaryOut), next_cursor: nextCursor }
    },
  },
  {
    name: 'get_listing',
    title: 'Get shop listing details',
    description: 'Get one of this shop\'s listings by id, in any status: its title, text, price, photos, views, leads and page `url`. Fails with `not_found` for another shop\'s or a deleted listing. Returns `listing`; read it before update_listing to see the current values.',
    scope: 'listings:read',
    annotations: READ_ONLY,
    output: z.strictObject({ listing: LISTING_OUT.nullable().describe('The listing as it stands now, including the title, text, price, district, condition and photos update_listing can change; null only if it was removed a moment ago') }).describe('The listing asked for'),
    input: z.object({ id: z.string().describe('The listing to read: its id (such as `cmh0q2x8f0001...`), from list_listings or create_listing') }),
    handler: async (auth, args) => {
      await ownedListing(String(args.id), auth.sellerId)
      const l = await db.listing.findUnique({ where: { id: String(args.id) }, include: LISTING_INCLUDE })
      return { listing: l ? listingOut(l) : null }
    },
  },
  {
    name: 'create_listing',
    title: 'Create marketplace listing',
    description: 'Create one new listing for this shop: something to sell or rent out, a service, or a job.\n\nGive a category, a title, the price in VND (a job gives its monthly salary in `salaryM` instead) and the district where it is; text, condition, brand and model are optional. Photos are public image URLs that eno copies to its own storage (the first 8 are used): most categories need at least 3 photos of different angles, services need 1 and jobs none. Longer text is cut to fit: title 140 characters, description 5,000, district 80, condition 60.\n\nThe listing goes live at once unless eno must check it first. It is refused with a reason code, and nothing is created, when photos or the district are missing (`photos_min`, `photo_required`, `location_required`), the text holds a phone number, the category is unknown or the account may not post right now. Posting the same listing again while the first is still active (on sale, checked or not) is refused as `duplicate_listing`, with that listing\'s id.\n\nReturns `listing` with the new `id` (for update_listing and set_listing_status), `verified` (true when it is already public), `held` (true while it waits for eno\'s licence check) and its page `url`. Use it when the seller asks to post something; to post many listings at once, use bulk_create_listings.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    output: z.strictObject({ listing: CREATED_OUT }).describe('The new listing\'s id and whether it is public yet'),
    input: listingItem.omit({ externalId: true }).extend({
      // Optional HERE because a job needs none; every other listing still has to send one (checked below).
      price: z.number().optional().describe('The asking price in VND. Needed for everything except a job (category "jobs"), whose pay is `salaryM`; a job sent with only a price has it read as the monthly salary.'),
      negotiable: z.boolean().optional().describe('Whether buyers may send offers below the price (yes unless you say no); services and jobs never take offers'),
      listingType: z.string().optional().describe('What the listing offers: "sell" or "rent" where the category allows it ("job" or "wanted" in jobs); otherwise the category\'s usual one is used'),
      brand: z.string().optional().describe('The brand, matched to eno\'s brand list even with typos; only used in categories that have brands. Leave it out when the item has none'),
      model: z.string().optional().describe('The model within that brand; kept only when the brand was recognised. Leave it out when unknown'),
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
        return { listing: createdOut(created) }
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
    title: 'Update marketplace listing',
    // ⚠️ No aisle named here: tools/list is published to anonymous callers on both editions, and eno.vn's must carry no
    // visa vocabulary (src/app/api/mcp/discovery-auth.test.ts, the licensing pin).
    description: 'Update one of this shop\'s listings: its title, text, price, district, condition, photos or a job\'s salary.\n\nSend the listing\'s id and only the fields to change; the rest stay as they are. Changes are saved immediately. Photos you send replace the whole set (public URLs are copied to eno\'s storage; the first 8 are used), and text is cut to the same lengths as create_listing. A job\'s pay is `salaryM`; a `price` sent for a job is read as its monthly salary in VND. A refused edit changes nothing and comes back with its reason code, such as `title_too_short` or `invalid_price`.\n\nIt cannot change a subcategory or the licence values, nor the category or the status (use set_listing_status for that).\n\nReturns `listing` as it now stands, and `held` and `unpublished`, which say when the saved edit is not public yet: `held: true` while the listing waits for eno\'s licence check. Use it when the seller asks for a new price, better text, another district or new photos.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.strictObject({
      held: z.boolean().describe('true when the edit is saved but the listing stays unpublished until eno\'s licence check approves it; false otherwise'),
      unpublished: z.boolean().describe('true when the listing belongs to an account whose listings are not shown publicly; false otherwise'),
      listing: LISTING_OUT.nullable().describe('The listing as it now stands, the same fields get_listing returns; null only if it could not be read back'),
    }).describe('Confirms the edit and shows the listing after it'),
    input: z.object({
      id: z.string().describe('The listing to change: its id (such as `cmh0q2x8f0001...`), from list_listings or create_listing'),
      title: z.string().optional().describe('The new headline; phone numbers are not allowed in it, and it is cut at 140 characters. Leave it out to keep the current one'),
      description: z.string().optional().describe('The new text for the listing page; contact details are not allowed in it, and it is cut at 5,000 characters. Leave it out to keep the current text'),
      // A negative price is refused by updateListingCore (`invalid_price`), so the schema carries no bound to repeat.
      price: z.number().optional().describe('The new asking price in VND (for a job: its monthly salary in VND). Leave it out to keep the current price'),
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
        // A refused photo: the sentence, and `detail` '<rule>:<url> …' naming the images to drop.
        if (res.error === 'photo_not_allowed') throw new ToolError(res.error, publishBlockedApiMessage(res.error, res.detail), res.detail)
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
      return { held: res.held === true, unpublished: res.unpublished === true, listing }
    },
  },
  {
    name: 'set_listing_status',
    title: 'Set listing status',
    description: 'Set the status of one of this shop\'s listings: active (on sale), sold, or hidden from the site without deleting it. Setting active again undoes sold or hidden, unless it is refused (a held account, a pending licence check) with a reason code; an unknown status is refused too. Returns the listing\'s `id` and the `status` it now has.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.strictObject({ id: z.string().describe('The listing that was changed, as you passed it'), status: LISTING_STATUS_SET }).describe('The listing and the status it has now'),
    // `status` is checked by setStatusCore (invalid_status, worded below), not by an enum: an enum input is the one field the
    // reviewers flag as "validation repeated" whatever its prose says (2026-11-15).
    input: z.object({ id: z.string().describe('The listing to change: its id (such as `cmh0q2x8f0001...`), from list_listings, get_listing or create_listing'), status: z.string().describe('The state to move the listing to: sold once the item has gone to a buyer, hidden to take it off the site for now (for example while it is out of stock), or active to put it back on sale') }),
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
                // The input is a plain string (no enum): name the three states the core accepts, and its one other use of the
                // code (core/listings.ts: a teacher profile is never "sold").
                : res.error === 'invalid_status' ? 'status must be active, sold or hidden (a teacher profile can be active or hidden, not sold).'
                // A hiring post whose stored text the job-text screen refuses (2026-10-19): its rule's sentence, and `detail`.
                : isJobTextBlockCode(res.error) ? JOB_TEXT_REFUSAL[res.error].en
                  : res.error
        throw new ToolError(res.error, message, res.detail)
      }
      // The status echoed is the one asked for, which the input enum limits to the three (setStatusCore checks it too).
      return { id, status: res.status as ListingStatusOut }
    },
  },
  {
    name: 'delete_listing',
    title: 'Delete shop listing',
    description: 'Delete one of this shop\'s listings for good; ask the seller to confirm first, or use set_listing_status hidden to take it down for now. While the shop or listing is under review it is hidden instead. Returns `deleted`, `hidden`, `reason` and `message`; a second call for a deleted listing answers `not_found`.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.strictObject({
      deleted: z.boolean().describe('true when the listing was deleted; false when it was hidden instead'),
      hidden: z.boolean().describe('true when it was hidden instead of deleted because the shop or listing is under review; false when it was deleted'),
      reason: z.enum(DELETE_HOLD_REASONS).nullable().describe('Why it was hidden instead. account_held or account_suspended: the account is under review. open_report: a report about it or the shop is still open. null when it was deleted'),
      message: z.string().nullable().describe('A sentence to show the seller, saying why it was hidden and when it can be deleted; null when it was deleted'),
    }).describe('Whether the listing was deleted, or hidden instead and why'),
    input: z.object({ id: z.string().describe('The listing to delete for good: its id (such as `cmh0q2x8f0001...`), from list_listings or get_listing. Read it with get_listing first to be sure, since a deletion cannot be undone') }),
    handler: async (auth, args) => {
      const id = String(args.id)
      await ownedListing(id, auth.sellerId)
      const res = await deleteListingCore(id)
      if (res.ok && !res.deleted) return deletedOut(res.reason)
      // The held delete's hide was refused for a reason other than "already gone" — never a silent ok.
      if (!res.ok && res.code !== 404) throw new ToolError(res.error, 'The listing is under review and could not be hidden; it was not deleted.')
      // A 404 here = the row went between the ownership check and the delete: it is gone either way.
      return deletedOut(null)
    },
  },
  {
    name: 'bulk_create_listings',
    title: 'Create listings in bulk',
    description: `Create many new listings in one call, one row each (category, title, price in VND, the district, optional text, and photos as public image URLs where the category needs them), for example to move a stock list or spreadsheet onto eno.\n\nRows are independent: a bad row fails alone, with its reason, and the others are created. When the account may not publish at all, the whole call is refused with the reason and nothing is created. A row repeating one of this shop\'s active listings, or an earlier row of the same call, fails as a duplicate.\n\nReturns \`created\` and \`failed\` counts and \`results\`, one per row in the order sent, with the new \`id\` or the \`error\`. To keep eno matched to your own system by your own ids, use sync_catalogue instead.`,
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    output: z.strictObject({
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
      return { created: result.created, failed: result.failed, results: result.results.map(bulkRowOut) }
    },
  },
  {
    name: 'sync_catalogue',
    title: 'Sync shop catalogue',
    description: `Sync this shop's listings with your own catalogue, matched by your externalId: a new externalId creates a listing, a known one updates it in place, and a row's status can mark it sold or hidden.\n\nIn mode "full", every active listing whose externalId is missing from this payload is also hidden; listings without an externalId, such as ones posted on the website, are never touched. When the account may not publish new listings, new rows are refused while edits still apply.\n\nReturns counts of \`created\`, \`updated\`, \`retired\` and \`failed\` rows, \`results\` (one per row), and \`publish_blocked\` with the reason when new rows were refused (null otherwise). Not for a one-off post (use create_listing) or a batch of new listings without your own ids (use bulk_create_listings).`,
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    output: z.strictObject({
      created: z.number().describe('Rows that created a new listing'),
      updated: z.number().describe('Rows that updated an existing listing'),
      retired: z.number().describe('Listings hidden because a full sync did not include them; 0 in partial mode'),
      failed: z.number().describe('Rows that failed'),
      results: z.array(SYNC_ROW_OUT).describe('One result per row, in the order sent'),
      publish_blocked: z.strictObject({
        code: z.string().describe('Why new listings may not be published, as a reason code'),
        message: z.string().describe('A sentence to show the seller'),
      }).nullable().describe('Set when the account may not publish new listings right now: new rows were refused, edits still applied; null otherwise'),
    }).describe('Counts of created, updated, retired and failed rows, and a result per row'),
    input: z.object({
      mode: z.string().optional().describe(`How to treat your listings missing from this payload. Left out, partial: they stay as they are, for sending only the rows that changed; full hides each active one whose externalId you did not send, so eno mirrors your whole catalogue. Full compares against this one payload alone, so use it only when the whole catalogue fits in one call (${SYNC_MAX_ROWS} rows); a bigger catalogue syncs in partial mode, since full calls split across a catalogue each hide the rows the others carry. Listings without an externalId are never touched`),
      listings: z.array(listingItem.extend({
        externalId: z.string().describe('Your own id (SKU) for the row: how it finds its existing listing, unique within your shop'),
        status: z.enum(['active', 'sold', 'hidden']).optional().describe('Puts an existing listing on sale (active), marks it sold, or hides it. Leave it out to keep an existing listing\'s status; on a new row it is ignored and the row is posted as a new listing'),
      })).min(1).max(SYNC_MAX_ROWS).describe('Your catalogue rows, each matched to its listing by externalId. For a known externalId, the fields you leave out keep their current values'),
    }),
    handler: async (auth, args) => {
      const seller = await db.seller.findUnique({ where: { id: auth.sellerId }, select: { id: true, ownerId: true, trustTier: true, trustScore: true } })
      if (!seller) throw new ToolError('not_found', 'Shop not found.')
      // `mode` is a described string (an enum input is what the reviewers flag); anything but the two is refused here, before
      // any row is touched, so a typo can never fall through to a different sync.
      if (args.mode !== undefined && args.mode !== 'partial' && args.mode !== 'full') throw new ToolError('invalid_input', 'mode must be partial or full.')
      const mode = args.mode === 'full' ? 'full' : 'partial'
      const out = await syncListingsCore(seller, args.listings as SyncRow[], mode)
      // A partial success, not a tool error: edits and sold/hidden rows applied. But the identity
      // gate's refusal of the creates/revives is named once with its copy, the way /api/v1 does it
      // (`publish_blocked`), so the agent can tell the seller what to do instead of parsing codes.
      return {
        created: out.created, updated: out.updated, retired: out.retired, failed: out.failed, results: out.results.map(syncRowOut),
        publish_blocked: out.blocked ? { code: out.blocked, message: publishBlockedBody(out.blocked).message.en } : null,
      }
    },
  },
  {
    name: 'analytics_summary',
    title: 'Get shop analytics summary',
    description: 'Read this shop\'s totals in one call: how many listings it has, how many are active, sold or hidden, how many still wait for eno\'s check, and the total views and leads (times a buyer opened contact) across all of them.\n\nDeleted listings are not counted. The totals cover each listing\'s whole life, not a date range.\n\nReturns `summary` with those counts. For per-listing, per-day figures over a date range, use analytics_listings.',
    scope: 'analytics:read',
    annotations: READ_ONLY,
    output: z.strictObject({ summary: z.strictObject({
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
    title: 'Get listing analytics by day',
    description: 'Get the views and leads of each of this shop\'s listings, day by day (the last 30 days unless you set `from` and `to`), with their all-time totals. Returns `range`, `listings` with `daily` figures, and `next_cursor` for the next page. For the shop\'s overall totals, use analytics_summary.',
    scope: 'analytics:read',
    annotations: READ_ONLY,
    output: z.strictObject({
      range: z.strictObject({ from: z.string().describe('First day used (YYYY-MM-DD)'), to: z.string().describe('Last day used (YYYY-MM-DD)') }).describe('The date range actually used'),
      listings: z.array(ANALYTICS_ROW_OUT).describe('This page of listings with their daily figures'),
      next_cursor: CURSOR_OUT,
    }).describe('Views and leads per listing per day over the range actually used'),
    input: z.object({
      from: z.string().meta({ format: 'date' }).optional().describe('The first day of the period to report, in UTC. Left out, the 30 days before `to`; a period longer than 92 days is cut to its last 92'),
      to: z.string().meta({ format: 'date' }).optional().describe('The last day of the period to report, in UTC. Left out, today'),
      limit: PAGE_SIZE,
      cursor: z.string().optional().describe('Where to continue: the `next_cursor` of the previous page; leave it out for the first page'),
    }),
    handler: async (auth, args) => {
      const out = await getListingAnalytics(auth.sellerId, { from: args.from as string, to: args.to as string, limit: pageLimitArg(args.limit), cursor: args.cursor as string })
      if ('error' in out) throw new ToolError(out.error.code, out.error.message)
      return { range: { from: out.range.from, to: out.range.to }, listings: out.listings.map(analyticsRowOut), next_cursor: out.next_cursor }
    },
  },
  {
    name: 'list_webhooks',
    title: 'List webhooks',
    description: 'List the webhook endpoints registered for this shop: where events are sent, which events, whether delivery is on, and recent failures.\n\nSigning secrets are never returned; a lost secret means registering the endpoint again.\n\nReturns `webhooks`, newest first. Use it to find a webhook\'s id for delete_webhook, or to see why deliveries stopped (`enabled: false` with `last_error`).',
    scope: 'listings:read',
    annotations: READ_ONLY,
    output: z.strictObject({ webhooks: z.array(WEBHOOK_OUT).describe('Every webhook of this shop, newest first; secrets are never included') }).describe('The shop\'s webhooks'),
    input: z.object({}),
    handler: async (auth) => {
      const hooks = await db.webhookEndpoint.findMany({ where: { sellerId: auth.sellerId }, orderBy: { createdAt: 'desc' }, select: { id: true, url: true, events: true, enabled: true, failureCount: true, lastError: true, lastDeliveryAt: true, createdAt: true } })
      return { webhooks: hooks.map(webhookOut) }
    },
  },
  {
    name: 'register_webhook',
    title: 'Register webhook',
    description: 'Register an HTTPS endpoint of yours that eno will POST signed events to when this shop\'s listings are created, updated, change status or are deleted.\n\nThe address must be public: one reachable only inside your own network is refused with `invalid_input`. A shop can have up to 10 webhooks (`limit_reached` after that), and each call registers a new one, even for an address already registered.\n\nReturns `webhook` with its id, events and signing `secret`, shown only this once: store it to verify each event\'s signature. Use list_webhooks to see them all and delete_webhook to remove one.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    output: z.strictObject({ webhook: REGISTERED_WEBHOOK_OUT }).describe('The new webhook and its one-time signing secret'),
    input: z.object({ url: z.string().describe('Your public HTTPS address that will receive each event as a signed POST; an address reachable only inside your own network is refused'), events: z.array(z.string()).optional().describe('Which changes to be told about, by event name: listing.created, listing.updated, listing.status_changed (e.g. sold or hidden) or listing.deleted. Leave it out to receive every event') }),
    handler: async (auth, args) => {
      const url = String(args.url || '').trim()
      // `events` is a list of described strings (no enum input): an unknown name is refused here, as /api/v1/webhooks does.
      const unknown = Array.isArray(args.events) ? (args.events as unknown[]).find((e) => !(WEBHOOK_EVENTS as readonly unknown[]).includes(e)) : undefined
      if (unknown !== undefined) throw new ToolError('invalid_input', `Unknown event "${String(unknown).slice(0, 60)}". Valid: ${WEBHOOK_EVENTS.join(', ')}.`)
      try { await assertSafeUrl(url) } catch { throw new ToolError('invalid_input', 'url must be a public HTTPS endpoint.') }
      const count = await db.webhookEndpoint.count({ where: { sellerId: auth.sellerId } })
      if (count >= 10) throw new ToolError('limit_reached', 'A shop may register at most 10 webhooks.')
      const events = Array.isArray(args.events) && args.events.length ? (args.events as string[]).join(' ') : '*'
      const secret = generateWebhookSecret()
      const hook = await db.webhookEndpoint.create({ data: { sellerId: auth.sellerId, url, events, secret }, select: { id: true, url: true, events: true, enabled: true, failureCount: true, lastError: true, lastDeliveryAt: true, createdAt: true } })
      return { webhook: { ...webhookOut(hook), secret } }
    },
  },
  {
    name: 'delete_webhook',
    title: 'Delete webhook',
    description: 'Remove one of this shop\'s webhook endpoints, for example one you no longer run or whose secret may have leaked. eno stops sending it events at once.\n\nIt cannot be undone: registering the address again gives a new id and a new secret. To change which events an endpoint gets, register it again with the new list, then delete the old one. A second call for the same id changes nothing more and answers `not_found`.\n\nReturns the removed webhook\'s `id`.',
    scope: 'listings:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    output: z.strictObject({ id: z.string().describe('The webhook that was removed, as you passed it; eno sends it no more events') }).describe('The webhook that was removed'),
    input: z.object({ id: z.string().describe('The webhook to remove: its id (such as `cmh0q2x8f0001...`), from list_webhooks or register_webhook') }),
    handler: async (auth, args) => {
      const hook = await db.webhookEndpoint.findUnique({ where: { id: String(args.id) }, select: { sellerId: true } })
      if (!hook || hook.sellerId !== auth.sellerId) throw new ToolError('not_found', 'Webhook not found.')
      await db.webhookEndpoint.delete({ where: { id: String(args.id) } })
      return { id: String(args.id) }
    },
  },
]

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

// JSON-Schema list for tools/list (zod v4 → JSON Schema), with each tool's read/write hints.
/** zod's `.int()` publishes ±(2^53−1) as minimum/maximum: no real bound, and the one thing reviewers flag on a count. */
function stripSafeIntBounds<T>(node: T): T {
  if (Array.isArray(node)) return node.map(stripSafeIntBounds) as T
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if ((k === 'minimum' || k === 'maximum') && Math.abs(v as number) === Number.MAX_SAFE_INTEGER) continue
    out[k] = stripSafeIntBounds(v)
  }
  return out as T
}

export function toolDescriptors() {
  // `annotations.title` repeats the title for clients that only read the older spot (MCP 2025-03-26).
  return TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: stripSafeIntBounds(z.toJSONSchema(t.input)), outputSchema: outputJsonSchema(t.output), annotations: { title: t.title, ...t.annotations } }))
}

/** An outputSchema WITHOUT `$schema`: MCP client SDKs COMPILE output schemas to validate structuredContent, and a validator
 *  built for the default draft throws on the 2020-12 meta-schema URI zod writes. The keywords used here (type, properties,
 *  required, items, anyOf, const, enum) mean the same in every draft, so dropping the URI changes nothing a client checks. */
function outputJsonSchema(schema: z.ZodType) {
  const { $schema: _dialect, ...rest } = stripSafeIntBounds(z.toJSONSchema(schema) as Record<string, unknown>)
  void _dialect
  return rest
}
