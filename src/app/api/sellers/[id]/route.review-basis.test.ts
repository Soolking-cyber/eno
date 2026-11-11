import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/sellers/[id] — the native apps' storefront — and a review of a seller-confirmed rental / lesson / service
 * (Review.basis, src/lib/service-deal.ts). ⛔ NO "VERIFIED" CLAIM (spec v3 A1): the shipped iOS storefront prints
 * "Verified" for `verified: true` and cannot read `basis` (apps/ios SellerStorefrontView — parked, not changed), so such a
 * review goes out with `verified: false`. A goods / offer review is untouched.
 */
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({ reviews: null as unknown }))

vi.mock('@/lib/edition-scope', () => ({
  isSellerHiddenHere: async () => false,
  scopedListingWhere: async (w: object) => w,
}))
vi.mock('@/lib/db', () => ({
  db: {
    seller: {
      findUnique: async () => ({
        id: 'shop-1', ownerId: 'p1', name: 'Landlord', avatarUrl: null, avatarColor: '#111', bio: null, location: null,
        officialPartner: false, owner: null, handle: null, reviewCount: 2, rating: 4.5, listings: [{ id: 'L1' }],
      }),
    },
    listing: { findFirst: async () => ({ id: 'L1' }) },
    conversation: { count: async () => 0 },
  },
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: (l: Row) => l }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (rows: Row[]) => rows }))
vi.mock('@/lib/business-verification', () => ({ isBusinessVerified: () => false }))
vi.mock('@/lib/seller-metrics', () => ({
  topSellerReviews: async () => h.reviews,
  sellerMetrics: () => ({
    trustScore: 100, trustTier: 'standard', rating: 4.5, reviewCount: 2, memberSinceYear: 2026,
    responseBucket: { key: null }, lastSeenDay: null,
  }),
}))

const { GET } = await import('./route')

const get = async () => {
  const res = await GET(new NextRequest('http://localhost/api/sellers/shop-1'), { params: Promise.resolve({ id: 'shop-1' }) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  h.reviews = {
    reviews: [
      { author: 'Lan', rating: 5, text: 'Great room', verified: true, basis: 'rental', createdAt: '2026-11-10T00:00:00.000Z' },
      { author: 'Minh', rating: 4, text: 'Fair price', verified: true, createdAt: '2026-11-09T00:00:00.000Z' },
      { author: 'Guest', rating: 3, text: '', verified: false, createdAt: '2026-11-08T00:00:00.000Z' },
    ],
    total: 3,
    avg: 4,
  }
})

describe('GET /api/sellers/[id] — reviews for the native storefront', () => {
  it('⛔ a basis review goes out with verified: false (its basis kept); a goods / offer review is byte-identical', async () => {
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.reviews).toEqual({
      reviews: [
        { author: 'Lan', rating: 5, text: 'Great room', verified: false, basis: 'rental', createdAt: '2026-11-10T00:00:00.000Z' },
        { author: 'Minh', rating: 4, text: 'Fair price', verified: true, createdAt: '2026-11-09T00:00:00.000Z' },
        { author: 'Guest', rating: 3, text: '', verified: false, createdAt: '2026-11-08T00:00:00.000Z' },
      ],
      total: 3,
      avg: 4,
    })
  })
})
