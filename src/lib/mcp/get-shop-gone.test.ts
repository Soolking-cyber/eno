import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The key-scoped shop endpoints — MCP `get_shop` and GET /api/v1/shop — answer "Shop not found" for a
 * GONE storefront (src/lib/storefront-gone.ts: ownerless, had listings, none public; owner 2026-10-02),
 * as the web does. An owned shop is never affected, an ownerless one that never had a listing (a desk)
 * is not gone, and a shop with active stock costs no extra query.
 */
type Row = Record<string, any>
const h = vi.hoisted(() => ({ shop: null as Row | null, publicListing: null as Row | null, anyListing: null as Row | null, probes: 0 }))

vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => h.shop },
    // The public probe asks `verified`; the any-listing probe (an emptied catalogue vs a desk) does not.
    listing: { findFirst: async ({ where }: { where: Row }) => { h.probes += 1; return 'verified' in where ? h.publicListing : h.anyListing } },
  },
}))
vi.mock('@/lib/api/auth', () => ({
  listingOwnedBy: async () => true,
  resolveApiKey: async () => ({ ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:read']) }, rate: null }),
}))
vi.mock('@/lib/api/respond', () => ({
  apiOk: (body: unknown) => Response.json(body),
  apiError: (status: number, code: string) => Response.json({ error: code }, { status }),
  apiAuthError: () => Response.json({ error: 'unauthorized' }, { status: 401 }),
}))
vi.mock('@/lib/core/listings', () => ({
  setStatusCore: async () => ({}), createListingCore: async () => ({}), updateListingCore: async () => ({}),
  deleteListingCore: async () => ({}), DELETE_HOLD_MESSAGE: {},
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: () => ({}) }))
vi.mock('@/lib/ssrf', () => ({ assertSafeUrl: async () => {} }))
vi.mock('@/lib/core/bulk', () => ({ bulkImportCore: async () => ({}), rehostListingImage: async () => null, BULK_MAX_ROWS: 200 }))
vi.mock('@/lib/core/sync', () => ({ syncListingsCore: async () => ({}), SYNC_MAX_ROWS: 200 }))
vi.mock('@/lib/core/seller', () => ({ updateSellerCore: async () => ({ ok: true }) }))
vi.mock('@/lib/enforcement', () => ({ postingGate: async () => null }))
vi.mock('@/lib/listing-analytics', () => ({ getListingAnalytics: async () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEventsBatch: async () => {}, generateWebhookSecret: () => 'x' }))

const { TOOLS } = await import('./tools')
const { GET } = await import('@/app/api/v1/shop/route')
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:read']) }
const getShop = () => TOOLS.find((t) => t.name === 'get_shop')!.handler(AUTH as never, {})
const v1 = async () => (await GET(new NextRequest('http://localhost/api/v1/shop'))).status

const shop = (over: Row = {}): Row => ({
  id: 's1', ownerId: null, name: 'SuperSports', bio: null, location: null, phone: null, avatarUrl: null,
  trustScore: 100, trustTier: 'standard', responseRate: 100, memberSince: new Date('2026-01-01'),
  _count: { listings: 0 }, ...over,
})

beforeEach(() => {
  h.shop = shop()
  h.publicListing = null
  h.anyListing = null
  h.probes = 0
})

describe('get_shop / GET /api/v1/shop — gone storefronts', () => {
  it('ownerless + emptied (rows, none public) → not found on both, after both probes each', async () => {
    h.anyListing = { id: 'hidden-1' }
    await expect(getShop()).rejects.toMatchObject({ code: 'not_found' })
    expect(await v1()).toBe(404)
    expect(h.probes).toBe(4)
  })

  it('ownerless + NEVER had a listing (a desk) → found on both', async () => {
    h.shop = shop({ id: 'eno-support-desk', name: 'eno Support' })
    await expect(getShop()).resolves.toMatchObject({ shop: { id: 'eno-support-desk', active_listings: 0 } })
    expect(await v1()).toBe(200)
  })

  it('ownerless with a sold listing → found, and the any-listing probe never runs', async () => {
    h.publicListing = { id: 'sold-1' }
    h.anyListing = { id: 'sold-1' }
    await expect(getShop()).resolves.toMatchObject({ shop: { name: 'SuperSports' } })
    expect(await v1()).toBe(200)
    expect(h.probes).toBe(2)
  })

  it('owned + empty → found, never probed', async () => {
    h.shop = shop({ ownerId: 'p1' })
    await expect(getShop()).resolves.toMatchObject({ shop: { id: 's1' } })
    expect(await v1()).toBe(200)
    expect(h.probes).toBe(0)
  })

  it('active stock → found without a probe', async () => {
    h.shop = shop({ _count: { listings: 4 } })
    expect(await v1()).toBe(200)
    expect(h.probes).toBe(0)
  })
})
