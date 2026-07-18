import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { containsPhoneNumber } from '@/lib/phone'
import { assertSafeUrl } from '@/lib/ssrf'
import type { ApiAuth } from '@/lib/api/auth'
import { listingOwnedBy } from '@/lib/api/auth'
import { parsePageParams, pageQuery, buildPage } from '@/lib/api/pagination'
import { createListingCore, updateListingCore, setStatusCore, deleteListingCore } from '@/lib/core/listings'
import { bulkImportCore, rehostListingImage, BULK_MAX_ROWS, type BulkRow } from '@/lib/core/bulk'
import { syncListingsCore, SYNC_MAX_ROWS, type SyncRow } from '@/lib/core/sync'
import { updateSellerCore } from '@/lib/core/seller'
import { postingGate } from '@/lib/enforcement'
import { getListingAnalytics } from '@/lib/listing-analytics'
import { dispatchListingEventsBatch, generateWebhookSecret } from '@/lib/webhooks'
import { after } from 'next/server'

// ── Partner MCP tools ─────────────────────────────────────────────────────────────
// Each tool is a thin, shop-scoped wrapper over the SAME cores the /api/v1 routes use.
// The handler receives the resolved auth (sellerId/profileId/scopes) — the partner's API
// key lives only in the MCP client's connection config and is NEVER a tool argument, so it
// never reaches the model. Throwing ToolError yields an isError tool result the agent sees.

export class ToolError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

const LISTING_INCLUDE = { category: true, seller: { include: { owner: { select: { accountType: true } } } } } as const

async function ownedListing(id: string, sellerId: string) {
  if (!(await listingOwnedBy(id, sellerId))) throw new ToolError('not_found', 'Listing not found.')
}

async function rehostAll(urls: string[] | undefined): Promise<string[]> {
  const out: string[] = []
  for (const u of (urls ?? []).slice(0, 8)) { const h = await rehostListingImage(String(u)); if (h) out.push(h) }
  return out
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
        select: { id: true, name: true, bio: true, location: true, phone: true, avatarUrl: true, trustScore: true, trustTier: true, responseRate: true, memberSince: true, _count: { select: { listings: { where: { verified: true, status: 'active' } } } } },
      })
      if (!s) throw new ToolError('not_found', 'Shop not found.')
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
      const where = { sellerId: auth.sellerId, ...(args.status ? { status: String(args.status) } : {}) }
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
    input: listingItem.omit({ externalId: true }).extend({ negotiable: z.boolean().optional(), listingType: z.string().optional(), brand: z.string().optional(), model: z.string().optional() }),
    handler: async (auth, args) => {
      const title = String(args.title || '').trim().slice(0, 140)
      const price = Number(args.price)
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
      const images = await rehostAll(args.images as string[] | undefined)
      const body = { description: args.description, images, district: args.district, condition: args.condition, negotiable: args.negotiable, listingType: args.listingType, brand: args.brand, model: args.model }
      const created = await createListingCore({ seller, category, title, price, body, headers: new Headers() })
      return { listing: created }
    },
  },
  {
    name: 'update_listing',
    description: 'Edit one of the shop\'s listings (sparse). Image URLs may be public — re-hosted automatically.',
    scope: 'listings:write',
    input: z.object({ id: z.string(), title: z.string().optional(), description: z.string().optional(), price: z.number().nonnegative().optional(), district: z.string().optional(), condition: z.string().optional(), images: z.array(z.string()).optional() }),
    handler: async (auth, args) => {
      const id = String(args.id)
      await ownedListing(id, auth.sellerId)
      const body: Record<string, unknown> = {}
      for (const k of ['title', 'description', 'price', 'district', 'condition'] as const) if (args[k] !== undefined) body[k] = args[k]
      if (Array.isArray(args.images)) body.images = await rehostAll(args.images as string[])
      const res = await updateListingCore(id, body)
      if (!res.ok) throw new ToolError(res.error, res.error)
      return { ok: true }
    },
  },
  {
    name: 'set_listing_status',
    description: 'Set a listing\'s availability: active | sold | hidden.',
    scope: 'listings:write',
    input: z.object({ id: z.string(), status: z.enum(['active', 'sold', 'hidden']) }),
    handler: async (auth, args) => {
      const id = String(args.id)
      await ownedListing(id, auth.sellerId)
      const res = await setStatusCore(id, String(args.status))
      if (!res.ok) throw new ToolError(res.error, res.error)
      return { ok: true, status: res.status }
    },
  },
  {
    name: 'delete_listing',
    description: 'Delete one of the shop\'s listings.',
    scope: 'listings:write',
    input: z.object({ id: z.string() }),
    handler: async (auth, args) => {
      const id = String(args.id)
      await ownedListing(id, auth.sellerId)
      await deleteListingCore(id)
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
      return syncListingsCore(seller, args.listings as SyncRow[], mode)
    },
  },
  {
    name: 'analytics_summary',
    description: 'Shop-level totals: views, leads, and listing counts by status.',
    scope: 'analytics:read',
    input: z.object({}),
    handler: async (auth) => {
      const where = { sellerId: auth.sellerId }
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
