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
    profile: { findUnique: async () => ({ email: 'buyer@example.com' }) },
    conversation: { findMany: async () => [{ id: 'cv1', buyerProfileId: 'p1', sellerId: 's2', listing: { listingType: 'sell', price: 5_000_000, negotiable: true } }], findFirst: async () => null },
    listing: {
      findMany: async () => [{ id: 'l1' }, { id: 'l2' }],
      findUnique: async () => ({ id: 'l1' }),
      findFirst: async () => ({ price: 5_000_000, listingType: 'sell', negotiable: true, sellerId: 's2', seller: { ownerId: 'p2' } }),
      aggregate: async () => ({ _sum: { views: 10, contactCount: 2 }, _count: { _all: 2 } }),
      groupBy: async () => [{ status: 'active', _count: { _all: 2 } }],
      count: async () => 0,
    },
    webhookEndpoint: {
      findMany: async () => [{ id: 'w1', url: 'https://x.example/h', events: '*', enabled: true, failureCount: 0, lastError: null, lastDeliveryAt: null, createdAt: now }],
      count: async () => 0,
      create: async () => ({ id: 'w2', url: 'https://x.example/h', events: 'listing.created', enabled: true, failureCount: 0, lastError: null, lastDeliveryAt: null, createdAt: now }),
      findUnique: async () => ({ sellerId: 's1' }),
      delete: async () => ({}),
    },
  },
}))
// Every key LISTING_OUT requires (the real serializer's own fit is output-schemas.real-serializer.test.ts).
vi.mock('@/lib/serialize', () => ({
  serializeListing: (l: Row) => ({
    id: l.id, title: 't', description: '', price: 1, priceUnit: 'VND', negotiable: true, status: 'active', verified: true, listingType: 'sell',
    condition: null, location: 'Thảo Điền', district: null, city: 'Hồ Chí Minh', images: [], video: null, category: { slug: 'electronics', name: 'Electronics' },
    subcategorySlug: null, postedAt: '2026-11-13T00:00:00.000Z', views: 0, contactCount: 0,
  }),
}))
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
// The chat tools (messaging-tools.ts) call the chat routes in process: each route answers what the real one sends.
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, limit: 1, remaining: 1, resetSec: 60 }) }))
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
const THREAD = {
  id: 'cv1', kind: 'listing', iAmSeller: false, teacher: null,
  listing: { id: 'l1', title: 'A phone', price: 5_000_000, priceUnit: null, negotiable: true },
  counterpart: { name: 'Shop' },
  messages: [
    { id: 'm1', mine: false, body: 'Still available', createdAt: '2026-11-13T00:00:00.000Z', kind: 'text', offerAmount: null, offerStatus: null },
    { id: 'm2', mine: false, body: '', createdAt: '2026-11-13T00:01:00.000Z', kind: 'offer', offerAmount: 4_500_000, offerStatus: 'pending' },
  ],
}
vi.mock('@/app/api/conversations/route', () => ({
  GET: async () => json({ conversations: [{ id: 'cv1', listingId: 'l1', listingTitle: 'A phone', kind: 'listing', unread: 1, lastMessageText: 'Hi', lastMessageAt: '2026-11-13T00:00:00.000Z', lastOffer: { mine: false, amount: 4_500_000, status: 'pending' }, counterpart: { name: 'Shop' } }] }),
  POST: async () => json({ id: 'cv1', created: true, message: { id: 'm3' } }),
  // (contact_seller with an offer also posts through the thread's send route, mocked below)
}))
vi.mock('@/app/api/conversations/[id]/route', () => ({ GET: async () => json(THREAD) }))
vi.mock('@/app/api/conversations/[id]/messages/route', () => ({ POST: async () => json({ id: 'm3', kind: 'offer' }) }))
vi.mock('@/app/api/conversations/[id]/offer/route', () => ({ POST: async () => json({ ok: true }) }))

// The paid-ad tools (ad-tools.ts): the offer, the booking core and the x402 config, as their own types declare them.
const AD_ROW = { id: 'ad1', listingId: 'l1', creativeId: null, status: 'active', durationSec: 3600, startsAt: now, endsAt: now, txHash: '0x' + 'a'.repeat(64), network: 'eip155:8453', amount: '22381' }
vi.mock('@/lib/x402/config', () => ({
  x402Config: () => ({ network: 'eip155:8453', networkLabel: 'Base', payTo: '0x' + '1'.repeat(40), facilitatorUrl: 'https://x402.org/facilitator', cdp: null, adPriceAtomic: '3760000', asset: '0x' + '2'.repeat(40), extra: { name: 'USD Coin', version: '2' } }),
  usdcText: () => '3.76',
  AD_MAX_HOURS: 2160,
  adHours: (v: unknown) => (v === undefined ? 168 : (v as number)),
  adPriceAtomicFor: () => '22381',
}))
vi.mock('@/lib/ads/offer', () => ({
  adOffer: async () => ({ available: true, price: { usdc: '3.76', amount_atomic: '3760000', asset: '0x2', network: 'eip155:8453', network_name: 'Base', pay_to: '0x1' }, price_vnd_reference: 99000, duration_days: 7, placements: [{ id: 'search', text: 'first in matching search results' }], label: 'Ad', requires: '', how_to_buy: { http: '', mcp: '' }, audience: { public_listings: 10, by_category: [], running_ads: 1 },
    creative_ads: { placement: { text: 'The first card of the feed.', max_hours: 168 }, restrictions: { refused: [{ class: 'gambling', text: 'Gambling cannot be advertised.' }], claims_refused: [{ class: 'superlative', text: '"Best" needs proof.' }], permit_classes_allowed: [{ class: 'cosmetics', text: 'cosmetics' }], permit_ref: '' }, requires: '', flow: { http: [], mcp: '' }, charged: '', policy_url: 'https://eno.vn/advertising-policy' } }),
  adPaymentRequired: () => ({ x402Version: 2, accepts: [] }),
  AD_POLICY_URL: 'https://eno.vn/advertising-policy',
}))
const REVIEW = { status: 'approved', creative_id: 'cr1', reasons: [], permit_classes: ['cosmetics'], reused: false, reviewed_at: now.toISOString() }
vi.mock('@/lib/ads/creative-review', () => ({
  reviewCreative: async () => ({ kind: 'approved', creative: { id: 'cr1' }, view: REVIEW }),
  storedReview: async () => REVIEW,
}))
vi.mock('@/lib/ads/stats', () => ({
  shopAdFigures: async () => ({
    ad_id: 'ad1', listing_id: null, creative_id: 'cr1', status: 'active', starts_at: now.toISOString(), ends_at: now.toISOString(),
    totals: { impressions: 10, clicks: 1, invalid: 2, ctr: 0.1, reach: 8, frequency: 1.25, spend_usdc: '0.1', paid_usdc: '0.2', ecpm_usdc: '10', ecpc_usdc: '0.1' },
    hourly: [{ hour_utc: now.toISOString(), hour_ict: '2026-11-13 07:00 ICT', impressions: 10, clicks: 1, invalid: 2, reach_new: 8 }],
    updated_at: now.toISOString(),
  }),
}))
vi.mock('@/lib/ads/book', () => ({
  AD_CREATIVE_MAX_HOURS: 168,
  checkAdCreative: async () => ({ ok: true, creative: { id: 'cr1', contentHash: 'h' } }),
  checkAdListing: async () => ({ ok: true, listing: { id: 'l1', title: 't', categorySlug: 'electronics', subcategorySlug: null } }),
  bookAd: async () => ({ kind: 'booked', ad: AD_ROW, settlement: { success: true, transaction: AD_ROW.txHash, network: 'eip155:8453' }, replay: false }),
  shopAds: async () => [{ id: 'ad1', listing_id: 'l1', creative_id: null, status: 'active', hours: 1, starts_at: now.toISOString(), ends_at: now.toISOString(), impressions: 3, clicks: 1, listing_views: 5, listing_contacts: null, amount_usdc_atomic: '3760000', network: 'eip155:8453', tx_hash: AD_ROW.txHash }],
}))

const { TOOLS } = await import('./tools')
const { ToolResultWithMeta } = await import('./tool-types')
/** Only promote_listing reads the call's `_meta` (the x402 payment): it is passed one, so its PAID answer is what is checked. */
const CTX: Record<string, { meta: Record<string, unknown> }> = { promote_listing: { meta: { 'x402/payment': { x402Version: 2 } } }, create_ad: { meta: { 'x402/payment': { x402Version: 2 } } } }
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:read', 'listings:write', 'analytics:read', 'ads:write']) } as never

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
  list_conversations: {},
  get_conversation: { conversation_id: 'cv1' },
  contact_seller: { listing_id: 'l1', message: 'Is it still available?' },
  send_message: { conversation_id: 'cv1', message: 'Would you take 4.800.000 đ?', offer_amount: 4_800_000 },
  decline_offer: { conversation_id: 'cv1', message_id: 'm2' },
  get_ad_offer: { listingId: 'l1', hours: 24 },
  promote_listing: { listingId: 'l1', hours: 1 },
  create_ad: { creative: { advertiserName: 'Bean', legalName: 'Bean Co', taxCode: '0312345678', headline: 'Fresh coffee', imageUrl: 'https://cdn.example/a.jpg', clickUrl: 'https://bean.vn' }, hours: 24 },
  list_ads: {},
  get_ad_stats: { adId: 'ad1' },
}

describe('every MCP tool answers in the shape its outputSchema declares', () => {
  it('has a case for every tool', () => {
    expect(Object.keys(ARGS).sort()).toEqual(TOOLS.map((t) => t.name).sort())
  })

  for (const tool of TOOLS) {
    it(tool.name, async () => {
      const answer = await tool.handler(AUTH, tool.input.parse(ARGS[tool.name]) as Record<string, unknown>, CTX[tool.name])
      // A paid answer carries result `_meta` beside the object (tool-types.ts ToolResultWithMeta): the object is what is checked.
      const result = answer instanceof ToolResultWithMeta ? answer.result : answer
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
