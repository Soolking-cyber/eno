import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/listings/[id] — the native PDP payload — and a review of a seller-confirmed rental / lesson / service
 * (Review.basis, src/lib/service-deal.ts). ⛔ NO "VERIFIED" CLAIM (spec v3 A1): the shipped iOS PDP prints "Verified
 * buyer" for `verified: true` and cannot read `basis` (apps/ios ListingDetailView — parked, not changed), so such a review
 * goes out with `verified: false`. A goods / offer review is untouched. (The web PDP is SSR and never calls this.)
 */
type Row = Record<string, any>
const h = vi.hoisted(() => ({ reviews: null as unknown }))

vi.mock('@/lib/listing-owner', () => ({ checkListingOwner: async () => ({ ok: false }) }))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => null }))
vi.mock('@/lib/core/listings', () => ({ deleteListingCore: async () => ({}), updateListingCore: async () => ({}) }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findFirst: async () => ({
        id: 'L1', verified: true, status: 'active', sellerId: 'shop-1', brandSlug: null, model: null, subcategorySlug: null,
        listingType: 'rent', condition: null, year: null, category: { slug: 'rentals' }, seller: { reviewCount: 2, rating: 4.5 },
      }),
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => w }))
vi.mock('@/lib/phone', () => ({ normalizePhone: () => null }))
vi.mock('@/lib/phone-unique', () => ({ phoneTakenByOther: async () => false }))
vi.mock('@/lib/serialize', () => ({ serializeListing: (l: Row) => ({ id: l.id }) }))
vi.mock('@/lib/price-stat', () => ({ getPriceBand: async () => null }))
vi.mock('@/lib/seller-metrics', () => ({ topSellerReviews: async () => h.reviews, sameSellerListings: async () => [] }))

const { GET } = await import('./route')

beforeEach(() => {
  h.reviews = {
    reviews: [
      { author: 'Lan', rating: 5, text: 'Great lesson', verified: true, basis: 'lesson', createdAt: '2026-11-10T00:00:00.000Z' },
      { author: 'Minh', rating: 4, text: 'Fair price', verified: true, createdAt: '2026-11-09T00:00:00.000Z' },
    ],
    total: 2,
    avg: 4.5,
  }
})

describe('GET /api/listings/[id] — the reviews preview for the native PDP', () => {
  it('⛔ a basis review goes out with verified: false (its basis kept); a goods / offer review is byte-identical', async () => {
    const res = await GET(new Request('https://eno.vn/api/listings/L1') as never, { params: Promise.resolve({ id: 'L1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reviews).toEqual({
      reviews: [
        { author: 'Lan', rating: 5, text: 'Great lesson', verified: false, basis: 'lesson', createdAt: '2026-11-10T00:00:00.000Z' },
        { author: 'Minh', rating: 4, text: 'Fair price', verified: true, createdAt: '2026-11-09T00:00:00.000Z' },
      ],
      total: 2,
      avg: 4.5,
    })
  })
})
