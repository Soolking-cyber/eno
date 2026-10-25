import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MIN_INDEXABLE_LISTINGS } from '@/lib/index-floor'
import { RENTAL_PLACES } from '@/lib/rental-places'

/**
 * rental-district-floor.ts: a page that links `/c/rentals/<slug>` asks the data which of those pages are under the
 * indexing floor — a 404 when empty ([district]/page.tsx) — and renders them as text. The database, the edition scope
 * and the district scope are stand-ins that record what they were asked (the guide-side cases: district-links.test.ts).
 */
const h = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  counted: [] as { where: unknown }[],
  down: false,
}))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => (h.down ? Promise.reject(new Error('connection refused')) : { id: 'cat-rentals', slug: 'rentals' }) },
    listing: {
      count: async (args: { where: { AND: [unknown, { district: string }] } }) => {
        h.counted.push(args)
        return h.counts[args.where.AND[1].district] ?? 0
      },
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (where: unknown) => ({ scoped: where }) }))
vi.mock('@/lib/district-slug', () => ({ districtScopeForSlug: async (slug: string) => (slug === 'nowhere' ? null : { district: slug }) }))

const { rentalDistrictsBelowFloor } = await import('./rental-district-floor')

beforeEach(() => {
  // The housing landing's five areas, as measured on 2026-10-22: District 2 held no place to rent.
  h.counts = { d1: 1373, d2: 0, d3: MIN_INDEXABLE_LISTINGS - 1, d7: MIN_INDEXABLE_LISTINGS, 'binh-thanh': 412 }
  h.counted = []
  h.down = false
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('rentalDistrictsBelowFloor', () => {
  it('returns the slugs under the floor, counting each with the district page’s own predicate', async () => {
    const below = await rentalDistrictsBelowFloor(['d2', 'd7', 'd1', 'd3', 'binh-thanh'], 'housing-vietnam-expats')
    expect([...below].sort()).toEqual(['d2', 'd3'])
    expect(h.counted.map((c) => c.where)).toEqual(
      ['d2', 'd7', 'd1', 'd3', 'binh-thanh'].map((district) => ({
        AND: [{ scoped: { AND: [{ categoryId: 'cat-rentals', verified: true, status: 'active' }, RENTAL_PLACES] } }, { district }],
      })),
    )
  })

  it('a slug with no scope is under the floor and is not counted; nothing asked reads nothing', async () => {
    expect([...(await rentalDistrictsBelowFloor(['nowhere'], 'x'))]).toEqual(['nowhere'])
    expect(h.counted).toEqual([])
    expect([...(await rentalDistrictsBelowFloor([], 'x'))]).toEqual([])
  })

  it('a failed read fails closed and says who asked', async () => {
    h.down = true
    expect([...(await rentalDistrictsBelowFloor(['d1', 'd7'], 'housing-vietnam-expats'))]).toEqual(['d1', 'd7'])
    expect(console.warn).toHaveBeenCalledOnce()
    expect(vi.mocked(console.warn).mock.calls[0][0]).toContain('[housing-vietnam-expats]')
  })
})
