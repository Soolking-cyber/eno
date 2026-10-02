import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/sellers/[id] — the native apps' storefront. A GONE storefront (src/lib/storefront-gone.ts:
 * ownerless, had listings, none public — owner 2026-10-02, the emptied SuperSports shop) answers the same
 * 404 as a seller that does not exist, so the app cannot render its header over an empty grid. An
 * ownerless seller that never had a listing — the support / rental desk the thread header opens — is not.
 */
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ seller: null as Row | null, publicListing: null as Row | null, anyListing: null as Row | null, probes: 0 }))

vi.mock('@/lib/edition-scope', () => ({
  isSellerHiddenHere: async () => false,
  scopedListingWhere: async (w: object) => w,
}))
vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => h.seller },
    // The public probe asks `verified`; the any-listing probe (an emptied catalogue vs a desk) does not.
    listing: { findFirst: async ({ where }: { where: Row }) => { h.probes += 1; return 'verified' in where ? h.publicListing : h.anyListing } },
    conversation: { count: async () => 0 },
  },
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: (l: Row) => l }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (rows: Row[]) => rows }))
vi.mock('@/lib/business-verification', () => ({ isBusinessVerified: () => false }))
vi.mock('@/lib/seller-metrics', () => ({
  topSellerReviews: async () => [],
  sellerMetrics: () => ({
    trustScore: 100, trustTier: 'standard', rating: 0, reviewCount: 0, memberSinceYear: 2026,
    responseBucket: { key: null }, lastSeenDay: null,
  }),
}))

const { GET } = await import('./route')

const shop = (over: Row = {}): Row => ({
  id: 'cmu52jkld0000czq443snv0jh', ownerId: null, name: 'SuperSports', avatarUrl: null, avatarColor: '#111', bio: null,
  location: null, officialPartner: false, owner: null, handle: null, reviewCount: 0, rating: 5,
  listings: [], ...over,
})
const get = async (id = 'cmu52jkld0000czq443snv0jh') => {
  const res = await GET(new NextRequest(`http://localhost/api/sellers/${id}`), { params: Promise.resolve({ id }) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.seller = shop()
  h.publicListing = null
  h.anyListing = null
  h.probes = 0
})

describe('GET /api/sellers/[id] — gone storefronts', () => {
  it('ownerless + emptied (rows, none public) → the missing-seller 404, byte for byte, after both probes', async () => {
    h.anyListing = { id: 'hidden-1' }
    const { status, body } = await get()
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Not found' })
    expect(h.probes).toBe(2)
  })

  it.each(['eno-support-desk', 'eno-support-desk-forum', 'eno-rental-desk'])(
    'ownerless + NEVER had a listing (%s) → 200: the desk the thread header opens is not gone',
    async (id) => {
      h.seller = shop({ id, name: 'eno Support' })
      const { status, body } = await get(id)
      expect(status).toBe(200)
      expect(body.seller.name).toBe('eno Support')
      expect(h.probes).toBe(2)
    },
  )

  it('ownerless with a SOLD listing only → 200, and the any-listing probe never runs', async () => {
    h.publicListing = { id: 'sold-1' }
    h.anyListing = { id: 'sold-1' }
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.seller.name).toBe('SuperSports')
    expect(h.probes).toBe(1)
  })

  it('ownerless with active stock → 200, without a probe (the loaded rows prove it)', async () => {
    h.seller = shop({ listings: [{ id: 'L1' }] })
    const { status } = await get()
    expect(status).toBe(200)
    expect(h.probes).toBe(0)
  })

  it('owned + empty → 200, never probed', async () => {
    h.seller = shop({ ownerId: 'p1', name: 'Anna' })
    const { status } = await get()
    expect(status).toBe(200)
    expect(h.probes).toBe(0)
  })
})
