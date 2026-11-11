import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * topSellerReviews — Review.basis on the preview (src/lib/service-deal.ts, 2026-11-11). Present only on a verified review
 * that carries one, so a goods review's preview — also served by /api/listings/[id] and /api/sellers/[id] — is byte-for-byte
 * what it was; and a database without the column (scripts/deal-confirmation-ddl.mjs not run) falls back a step, not to
 * the legacy no-badge set.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ rows: [] as Row[], basisMissing: false, provenanceMissing: false, transient: false, selects: [] as Row[] }))

vi.mock('@/lib/app-review-gates', () => ({ appReviewGate: () => false }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => ({ reviewCount: h.rows.length, rating: 4.5 }) },
    review: {
      findMany: async ({ select }: Row) => {
        h.selects.push(select)
        if (select.basis && h.basisMissing) throw Object.assign(new Error('column Review.basis does not exist'), { code: 'P2022' })
        if (select.basis && h.transient) { h.transient = false; throw new Error('Connection terminated unexpectedly') }
        if (select.conversationId && h.provenanceMissing) throw Object.assign(new Error('column does not exist'), { code: 'P2022' })
        return h.rows.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k] ?? null])))
      },
    },
  },
}))

const { topSellerReviews } = await import('./seller-metrics')

const at = new Date('2026-11-01T00:00:00.000Z')
beforeEach(() => {
  h.basisMissing = false; h.provenanceMissing = false; h.transient = false; h.selects = []
  h.rows = [
    { id: 'r1', author: 'An', rating: 5, text: 'Great room', createdAt: at, conversationId: 'c1', authorProfileId: 'p1', basis: 'rental' },
    { id: 'r2', author: 'Dung', rating: 4, text: 'Good bike', createdAt: at, conversationId: 'c2', authorProfileId: 'p2', basis: null },
    { id: 'r3', author: 'Seed', rating: 3, text: 'Seeded', createdAt: at, conversationId: null, authorProfileId: null, basis: 'lesson' },
  ]
})

describe('topSellerReviews and basis', () => {
  it('basis on a verified service review only; a goods review and an unverified row carry no key at all', async () => {
    const { reviews } = await topSellerReviews('s1', 3)
    expect(reviews[0]).toEqual({ author: 'An', rating: 5, text: 'Great room', verified: true, basis: 'rental', createdAt: at.toISOString() })
    expect(reviews[1]).toEqual({ author: 'Dung', rating: 4, text: 'Good bike', verified: true, createdAt: at.toISOString() })
    expect(reviews[2]).not.toHaveProperty('basis')
  })

  it('⛔ no Review.basis column yet: the provenance-only select — the badges still say "Verified buyer"', async () => {
    h.basisMissing = true
    const { reviews } = await topSellerReviews('s1', 3)
    expect(reviews.slice(0, 2).map((r) => [r.verified, 'basis' in r])).toEqual([[true, false], [true, false]])
    expect(h.selects).toHaveLength(2)
  })

  it('…and before the provenance columns, the legacy set (no badge) as before', async () => {
    h.basisMissing = true; h.provenanceMissing = true
    const { reviews } = await topSellerReviews('s1', 3)
    expect(reviews.every((r) => !r.verified && !('basis' in r))).toBe(true)
  })

  it('⛔ any OTHER failure of the basis read drops provenance (no badge) — never "Verified buyer" on a confirmed rental', async () => {
    h.transient = true
    const { reviews } = await topSellerReviews('s1', 3)
    expect(reviews.every((r) => r.verified === false && !('basis' in r))).toBe(true)
  })
})
