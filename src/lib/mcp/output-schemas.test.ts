import { describe, expect, it, vi } from 'vitest'

/**
 * Every tool's answer fits its own outputSchema (src/lib/mcp/tools.ts, 2026-11-13).
 *
 * tools/call sends each result as `structuredContent`, and MCP says it MUST conform to the tool's outputSchema; a client
 * that validates would reject a mismatch. The cores are mocked with the shapes their own types declare (createListingCore
 * `{ id, verified, held? }`, deleteListingCore's hold, syncListingsCore's counts …), so what this pins is each handler's
 * WRAPPING against its schema: a top-level key the schema does not know, or a required key a branch leaves out, fails here.
 */

type Row = Record<string, any>
const now = new Date('2026-11-13T00:00:00Z')

vi.mock('@/lib/api/auth', () => ({ listingOwnedBy: async () => true }))
vi.mock('@/lib/core/listings', () => ({
  setStatusCore: async (_id: string, status: string) => ({ ok: true, status }),
  createListingCore: async () => ({ id: 'l-new', verified: false, held: true }),
  updateListingCore: async () => ({ ok: true, held: true }),
  deleteListingCore: async () => ({ ok: true, deleted: false, hidden: true, reason: 'open_report' }),
  DELETE_HOLD_MESSAGE: { open_report: 'The listing was hidden, not deleted.' },
}))
vi.mock('@/lib/db', () => ({
  db: {
    seller: {
      findUnique: async () => ({ id: 's1', ownerId: 'p1', name: 'Shop', bio: null, location: null, phone: null, avatarUrl: null, trustScore: 50, trustTier: 'standard', responseRate: 100, memberSince: now, _count: { listings: 2 } }),
    },
    category: { findUnique: async () => ({ id: 'c1', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }) },
    listing: {
      findMany: async () => [{ id: 'l1' }, { id: 'l2' }],
      findUnique: async () => ({ id: 'l1' }),
      aggregate: async () => ({ _sum: { views: 10, contactCount: 2 }, _count: { _all: 2 } }),
      groupBy: async () => [{ status: 'active', _count: { _all: 2 } }],
      count: async () => 0,
    },
    webhookEndpoint: {
      findMany: async () => [{ id: 'w1', url: 'https://x.example/h', events: '*', enabled: true, failureCount: 0, lastError: null, lastDeliveryAt: null, createdAt: now }],
      count: async () => 0,
      create: async () => ({ id: 'w2', url: 'https://x.example/h', events: 'listing.created', enabled: true, createdAt: now }),
      findUnique: async () => ({ sellerId: 's1' }),
      delete: async () => ({}),
    },
  },
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: (l: Row) => ({ id: l.id, title: 't', price: 1 }) }))
vi.mock('@/lib/ssrf', () => ({ assertSafeUrl: async () => {} }))
vi.mock('@/lib/core/bulk', () => ({
  bulkImportCore: async () => ({ created: 1, failed: 1, results: [{ row: 1, id: 'l3', external_id: 'a' }, { row: 2, error: 'Invalid price' }] }),
  rehostListingImage: async (u: string) => u,
  claimRehostedImages: async () => {},
  discardRehostedImages: async () => {},
  BULK_MAX_ROWS: 200,
}))
vi.mock('@/lib/core/sync', () => ({
  syncListingsCore: async () => ({ created: 1, updated: 1, retired: 0, failed: 1, results: [{ external_id: 'a', id: 'l1', action: 'updated' }, { external_id: null, action: 'failed', error: 'externalId required' }], blocked: 'identity_unverified' }),
  SYNC_MAX_ROWS: 200,
}))
vi.mock('@/lib/core/seller', () => ({ updateSellerCore: async () => ({ ok: true }) }))
vi.mock('@/lib/enforcement', () => ({ postingGate: async () => null }))
vi.mock('@/lib/storefront-gone', () => ({ isStorefrontGone: async () => false }))
vi.mock('@/lib/listing-analytics', () => ({
  getListingAnalytics: async () => ({ range: { from: '2026-11-01', to: '2026-11-13' }, listings: [{ id: 'l1', external_id: null, title: 't', status: 'active', views_total: 3, leads_total: 1, daily: [{ day: '2026-11-12', views: 1, leads: 0 }] }], next_cursor: null }),
}))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEventsBatch: async () => {}, generateWebhookSecret: () => 'whsec_x' }))
vi.mock('@/lib/compliance/publish-block-response', () => ({ isIdentityBlockCode: () => false, publishBlockedBody: () => ({ message: { en: 'Verify your identity first.' } }) }))
vi.mock('next/server', () => ({ after: () => {} }))

const { TOOLS } = await import('./tools')
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:read', 'listings:write', 'analytics:read']) } as never

const ARGS: Record<string, Row> = {
  get_shop: {},
  update_shop: { bio: 'Hello' },
  list_listings: { limit: 1 },
  get_listing: { id: 'l1' },
  create_listing: { categorySlug: 'electronics', title: 'A phone', price: 100 },
  update_listing: { id: 'l1', title: 'A phone' },
  set_listing_status: { id: 'l1', status: 'sold' },
  delete_listing: { id: 'l1' },
  bulk_create_listings: { listings: [{ categorySlug: 'electronics', title: 'A phone', price: 100 }] },
  sync_catalogue: { listings: [{ categorySlug: 'electronics', title: 'A phone', price: 100, externalId: 'a' }] },
  analytics_summary: {},
  analytics_listings: {},
  list_webhooks: {},
  register_webhook: { url: 'https://x.example/h', events: ['listing.created'] },
  delete_webhook: { id: 'w1' },
}

describe('every MCP tool answers in the shape its outputSchema declares', () => {
  it('has a case for every tool', () => {
    expect(Object.keys(ARGS).sort()).toEqual(TOOLS.map((t) => t.name).sort())
  })

  for (const tool of TOOLS) {
    it(tool.name, async () => {
      const result = await tool.handler(AUTH, tool.input.parse(ARGS[tool.name]) as Record<string, unknown>)
      // The raw object, not a JSON round-trip: a handler must hand back dates as ISO strings itself (tools.ts `iso`), so
      // the result fits its schema for any client that validates before serializing too.
      const check = tool.output.safeParse(result)
      expect(check.success, JSON.stringify(check.error?.issues)).toBe(true)
      // structuredContent must be a JSON object.
      expect(result !== null && typeof result === 'object' && !Array.isArray(result)).toBe(true)
    })
  }

  it('sync_catalogue for an account that may not publish: the refusal rides along as code + message strings', async () => {
    const sync = TOOLS.find((t) => t.name === 'sync_catalogue')!
    const result = (await sync.handler(AUTH, sync.input.parse(ARGS.sync_catalogue) as Record<string, unknown>)) as Row
    expect(result.publish_blocked).toEqual({ code: 'identity_unverified', message: 'Verify your identity first.' })
    expect(sync.output.safeParse(result).success).toBe(true)
  })
})
