import { describe, expect, it, vi } from 'vitest'

/**
 * The bulk core (CSV upload, /api/v1 bulk, the MCP bulk tool, a partner sync's creates) runs the photo pass after the
 * response, for every row it created, after that row's moderation and provenance checks — on the SWEEP lane (A7), and a
 * row never fails on a photo (the pass strips it). Dependency wall: bulk.contact-screen.test.ts.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ afters: [] as Array<() => unknown>, ran: [] as string[], n: 0 }))

vi.mock('@/lib/review-seat-listings', () => ({ ownerIsReviewSeat: async () => false, reviewSeatListingIds: async () => [] }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { h.afters.push(fn) } }))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findMany: async () => [{ id: 'c-electronics', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }] },
    listing: { findMany: async () => [], create: async () => ({ id: `new${++h.n}` }) },
  },
}))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: null }) }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true, isListingVideoUrl: () => false }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: async () => new Response(new Uint8Array([1])) }))
vi.mock('@/lib/core/media', () => ({ storeListingImage: async () => 'https://cdn.eno.test/bulk/1.webp', IMG_MAX_BYTES: 1_000_000 }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async (id: string) => { h.ran.push(`moderation:${id}`) } }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async (id: string) => { h.ran.push(`provenance:${id}`) } }))
vi.mock('@/lib/listing-photo-pass', () => ({ photoPassById: async (id: string, lane: string) => { h.ran.push(`pass:${id}:${lane}`) } }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0 }))

const { bulkImportCore } = await import('@/lib/core/bulk')

const row = (over: Row = {}) => ({
  category_slug: 'electronics', title: 'iPhone 15 Pro 256GB', description: 'Pin 92%, máy đẹp, đủ hộp.', price: 18_000_000,
  image_urls: 'https://cdn.eno.test/a.jpg|https://cdn.eno.test/b.jpg|https://cdn.eno.test/c.jpg', district: 'Quận 1', ...over,
})

describe('bulkImportCore — the photo pass', () => {
  it('each created row: moderation, provenance, then the pass on the sweep lane; a refused row gets none', async () => {
    const r = await bulkImportCore({ id: 's1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 70 }, [row(), row({ district: 'gọi 0901 234 567' })])
    expect(r.results.map((x) => x.id ?? x.error)).toEqual(['new1', expect.any(String)])
    for (const fn of h.afters) await fn()
    expect(h.ran).toEqual(['moderation:new1', 'provenance:new1', 'pass:new1:sweep'])
  })
})
