import { describe, expect, it, vi } from 'vitest'

/**
 * The "Posted" recency filter (src/lib/posted-filter.ts): `attr_posted=1d|3d|7d` becomes a
 * `postedAt >= cutoff` clause in the shared `where` — but ONLY on a view whose Filter panel offers
 * it. On vehicle hire, another category or the all-categories feed a stray value is ignored, so it
 * can never narrow a feed invisibly. An unknown window is no filter, never an error.
 */

vi.mock('@/lib/db', () => ({
  db: {
    listing: { groupBy: vi.fn(async () => []) },
    category: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: any) => w,
  marketplaceListingScope: async () => ({}),
  teacherExclusion: async () => null,
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: any) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: any) => l }))

import { buildFeedFilters } from './feed-query'

const postedClause = (andFilters: any[]) => andFilters.find((f) => f.postedAt !== undefined)

describe('buildFeedFilters — attr_posted', () => {
  it('adds postedAt >= cutoff on a property rental view', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('category=rentals&subcategory=apartment-rental&attr_posted=7d'))
    const after = Date.now()
    const c = postedClause(andFilters)
    expect(c.postedAt.gte).toBeInstanceOf(Date)
    // Never older than 7 days; at most one 5-minute step narrower.
    const ageH = (after - c.postedAt.gte.getTime()) / 3_600_000
    expect(ageH).toBeLessThanOrEqual(168 + 0.01)
    expect(ageH).toBeGreaterThan(168 - 5 / 60 - 0.01)
  })

  it('applies on the whole rentals view', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('category=rentals&attr_posted=1d'))
    expect(postedClause(andFilters)).toBeTruthy()
  })

  it.each([
    'category=rentals&subcategory=car-rental&attr_posted=7d',
    'category=rentals&subcategory=motorbike-rental&attr_posted=7d',
    'category=electronics&attr_posted=7d',
    'attr_posted=7d',
  ])('is ignored where the Posted filter is not offered: %s', async (qs) => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams(qs))
    expect(postedClause(andFilters)).toBeUndefined()
  })

  it('measures the window from the instant it is given (the route passes one per request)', async () => {
    const now = new Date('2026-10-02T07:37:21.500Z')
    const { andFilters } = await buildFeedFilters(new URLSearchParams('category=rentals&attr_posted=1d'), { now })
    expect(postedClause(andFilters).postedAt.gte.toISOString()).toBe('2026-10-01T07:40:00.000Z')
  })

  it('ignores an unknown window', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('category=rentals&attr_posted=yesterday'))
    expect(postedClause(andFilters)).toBeUndefined()
  })
})
