import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
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
  categorySlug: z.string().describe('Category slug, e.g. "electronics"'),
  title: z.string().min(3).describe('Listing title (≥3 chars, no phone numbers)'),
  price: z.number().nonnegative().describe('Price in VND'),
  description: z.string().optional(),
  district: z.string().optional(),
  condition: z.string().optional().describe('e.g. "new", "used"'),
  images: z.array(z.string()).optional().describe('Public image URLs — auto re-hosted to first-party storage'),
  externalId: z.string().optional().describe('Your own id for this listing (for sync/upsert)'),
})

export type McpTool = {
  name: string
  description: string
  scope: 'listings:read' | 'listings:write' | 'analytics:read' | 'media:write'
  input: z.ZodType
  handler: (auth: ApiAuth, args: Record<string, unknown>) => Promise<unknown>
}

export const TOOLS: McpTool[] = [
  {
    name: 'get_shop',
    description: "Get the authenticated shop's storefront profile, trust score, and live listing count.",
    scope: 'listings:read',
    input: z.object({}),
    handler: async (auth) => {
      const s = await db.seller.findUnique({
        where: { id: auth.sellerId },
        select: { id: true, ownerId: true, name: true, bio: true, location: true, phone: true, avatarUrl: true, trustScore: true, trustTier: true, responseRate: true, memberSince: true, _count: { select: { listings: { where: { verified: true, status: 'active' } } } } },
      })
      // Same rule as GET /api/v1/shop: a GONE storefront (src/lib/storefront-gone.ts) is not found.
      if (!s || await isStorefrontGone(s, s._count.listings)) throw new ToolError('not_found', 'Shop not found.')
      return { shop: { id: s.id, name: s.name, bio: s.bio, location: s.location, phone: s.phone, avatar_url: s.avatarUrl, trust_score: s.trustScore, trust_tier: s.trustTier, response_rate: s.responseRate, member_since: s.memberSince, active_listings: s._count.listings } }
    },
  },
  {
    name: 'update_shop',
    description: 'Edit the storefront profile. Sparse — only the fields you send change.',
    scope: 'listings:write',
    input: z.object({ name: z.string().optional(), bio: z.string().optional(), location: z.string().optional(), avatarUrl: z.string().optional(), phone: z.string().optional() }),
    handler: async (auth, args) => {
      const res = await updateSellerCore(auth.sellerId, auth.profileId, args)
      if (!res.ok) throw new ToolError(res.error, res.error)
      return { ok: true }
    },
  },
  {
    name: 'list_listings',
    description: 'List the shop\'s listings (all statuses). Keyset-paginated — pass the returned next_cursor to page.',
    scope: 'listings:read',
    input: z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional(), status: z.enum(['active', 'sold', 'hidden']).optional() }),
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
      return { listings: items.map(serializeListing), next_cursor: nextCursor }
    },
  },
  {
    name: 'get_listing',
    description: 'Get one of the shop\'s listings by id (any status).',
    scope: 'listings:read',
    input: z.object({ id: z.string() }),
    handler: async (auth, args) => {
      await ownedListing(String(args.id), auth.sellerId)
      const l = await db.listing.findUnique({ where: { id: String(args.id) }, include: LISTING_INCLUDE })
      return { listing: l ? serializeListing(l) : null }
    },
  },
  {
    name: 'create_listing',
    description: 'Create a listing. Image URLs may be public — they are re-hosted to first-party storage automatically.',
    scope: 'listings:write',
    input: listingItem.omit({ externalId: true }).extend({
      // Optional HERE because a job needs none; every other listing still has to send one (checked below).
      price: z.number().nonnegative().optional().describe('Price in VND — required, except for a job (category "jobs"), whose pay is `salaryM`. A job sent with only a price has it read as the monthly salary in VND.'),
      negotiable: z.boolean().optional(), listingType: z.string().optional(), brand: z.string().optional(), model: z.string().optional(),
      salaryM: z.number().int().nonnegative().optional().describe('A job (category "jobs"): the monthly salary in million VND; omit it when the pay is agreed with the candidate. A job\'s stored price is derived from it, and a job takes no offers.'),
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
    // ⚠️ No aisle named here: tools/list is published to anonymous callers on both editions, and eno.vn's must carry no
    // visa vocabulary (src/app/api/mcp/discovery-auth.test.ts, the licensing pin).
    description: 'Edit one of the shop\'s listings (sparse). Image URLs may be public — re-hosted automatically. A job\'s pay is `salaryM`; a `price` sent for a job is read as its monthly salary in VND. An edit of a listing that is waiting for eno\'s licence check answers `held: true`: the listing stays unpublished until eno approves it (this tool cannot change a subcategory or the licence values).',
    scope: 'listings:write',
    input: z.object({
      id: z.string(), title: z.string().optional(), description: z.string().optional(), price: z.number().nonnegative().optional(), district: z.string().optional(), condition: z.string().optional(), images: z.array(z.string()).optional(),
      salaryM: z.number().int().nonnegative().nullable().optional().describe('A job: the monthly salary in million VND; null clears it (pay agreed with the candidate). Wins over `price`.'),
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
    description: 'Set a listing\'s availability: active | sold | hidden. Re-activating a listing that is waiting for eno\'s licence check is refused with `licence_check_required` until eno approves it.',
    scope: 'listings:write',
    input: z.object({ id: z.string(), status: z.enum(['active', 'sold', 'hidden']) }),
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
    description: 'Delete one of the shop\'s listings. While the shop or the listing is under investigation (an open report, or the account is held/suspended) it is hidden instead — the result then says `deleted: false, hidden: true` and why.',
    scope: 'listings:write',
    input: z.object({ id: z.string() }),
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
    description: `Create up to ${BULK_MAX_ROWS} listings in one call. Each is independent; image URLs are re-hosted.`,
    scope: 'listings:write',
    input: z.object({ listings: z.array(listingItem).min(1).max(BULK_MAX_ROWS) }),
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
    description: `Upsert the catalogue by your own externalId. mode "partial" only touches sent rows; "full" also retires listings absent from the payload. Up to ${SYNC_MAX_ROWS} rows.`,
    scope: 'listings:write',
    input: z.object({ mode: z.enum(['partial', 'full']).optional(), listings: z.array(listingItem.extend({ externalId: z.string(), status: z.enum(['active', 'sold', 'hidden']).optional() })).min(1).max(SYNC_MAX_ROWS) }),
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
    description: 'Shop-level totals: views, leads, and listing counts by status.',
    scope: 'analytics:read',
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
    description: 'Per-listing daily views + leads (deltas) over a date range, plus totals. Keyset-paginated.',
    scope: 'analytics:read',
    input: z.object({ from: z.string().optional().describe('YYYY-MM-DD'), to: z.string().optional().describe('YYYY-MM-DD'), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional() }),
    handler: async (auth, args) => {
      const out = await getListingAnalytics(auth.sellerId, { from: args.from as string, to: args.to as string, limit: args.limit as number, cursor: args.cursor as string })
      if ('error' in out) throw new ToolError(out.error.code, out.error.message)
      return out
    },
  },
  {
    name: 'list_webhooks',
    description: 'List the shop\'s registered webhook endpoints (secrets are never returned) with delivery health.',
    scope: 'listings:read',
    input: z.object({}),
    handler: async (auth) => {
      const hooks = await db.webhookEndpoint.findMany({ where: { sellerId: auth.sellerId }, orderBy: { createdAt: 'desc' }, select: { id: true, url: true, events: true, enabled: true, failureCount: true, lastError: true, lastDeliveryAt: true, createdAt: true } })
      return { webhooks: hooks.map((h) => ({ id: h.id, url: h.url, events: h.events === '*' ? ['*'] : h.events.split(/\s+/).filter(Boolean), enabled: h.enabled, failure_count: h.failureCount, last_error: h.lastError, last_delivery_at: h.lastDeliveryAt, created_at: h.createdAt })) }
    },
  },
  {
    name: 'register_webhook',
    description: 'Register an HTTPS endpoint for signed listing events. The signing secret is returned ONCE — store it.',
    scope: 'listings:write',
    input: z.object({ url: z.string().describe('Public HTTPS endpoint'), events: z.array(z.enum(['listing.created', 'listing.updated', 'listing.status_changed', 'listing.deleted'])).optional().describe('Omit for all events') }),
    handler: async (auth, args) => {
      const url = String(args.url || '').trim()
      try { await assertSafeUrl(url) } catch { throw new ToolError('invalid_input', 'url must be a public HTTPS endpoint.') }
      const count = await db.webhookEndpoint.count({ where: { sellerId: auth.sellerId } })
      if (count >= 10) throw new ToolError('limit_reached', 'A shop may register at most 10 webhooks.')
      const events = Array.isArray(args.events) && args.events.length ? (args.events as string[]).join(' ') : '*'
      const secret = generateWebhookSecret()
      const hook = await db.webhookEndpoint.create({ data: { sellerId: auth.sellerId, url, events, secret }, select: { id: true, url: true, events: true, enabled: true, createdAt: true } })
      return { webhook: { id: hook.id, url: hook.url, events: hook.events === '*' ? ['*'] : hook.events.split(/\s+/).filter(Boolean), enabled: hook.enabled, created_at: hook.createdAt, secret } }
    },
  },
  {
    name: 'delete_webhook',
    description: 'Unregister a webhook endpoint by id.',
    scope: 'listings:write',
    input: z.object({ id: z.string() }),
    handler: async (auth, args) => {
      const hook = await db.webhookEndpoint.findUnique({ where: { id: String(args.id) }, select: { sellerId: true } })
      if (!hook || hook.sellerId !== auth.sellerId) throw new ToolError('not_found', 'Webhook not found.')
      await db.webhookEndpoint.delete({ where: { id: String(args.id) } })
      return { ok: true }
    },
  },
]

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

// JSON-Schema list for tools/list (zod v4 → JSON Schema).
export function toolDescriptors() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.input) }))
}
