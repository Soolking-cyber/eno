import { describe, expect, it, vi } from 'vitest'

/**
 * "Good price" is a FILTER on the feed (`deal=good` → marketPosition 'low'), not a sort — so it must be a
 * clause in `where`, which is what the total, the facet counts and the histogram all share. And only the
 * literal 'good' turns it on: an unknown value is no filter, never an error or an empty feed.
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
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: any) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: any) => l }))

import { buildFeedFilters } from './feed-query'

const dealClause = (andFilters: any[]) => andFilters.find((f) => f.marketPosition !== undefined)

describe('buildFeedFilters — deal=good', () => {
  it('adds marketPosition = low to the shared where', async () => {
    const { andFilters, where } = await buildFeedFilters(new URLSearchParams('deal=good'))
    expect(dealClause(andFilters)).toEqual({ marketPosition: 'low' })
    expect((where as any).AND).toContainEqual({ marketPosition: 'low' })
  })

  it('combines with subcategory, brand and model — the owner\'s iPhone example', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('subcategory=phones-tablets&brand=apple&model=iPhone 17&deal=good'))
    expect(andFilters).toContainEqual({ marketPosition: 'low' })
    expect(andFilters).toContainEqual({ brandSlug: 'apple' })
    expect(andFilters).toContainEqual({ model: 'iPhone 17' })
    expect(andFilters).toContainEqual({ subcategorySlug: 'phones-tablets' })
  })

  it('is off without the param and for any other value', async () => {
    for (const qs of ['', 'deal=1', 'deal=GOOD', 'deal=all', 'sort=good-price']) {
      const { andFilters } = await buildFeedFilters(new URLSearchParams(qs))
      expect(dealClause(andFilters)).toBeUndefined()
    }
  })

  it('survives in the histogram request, whose price clause is the one it suppresses', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('histogram=1&deal=good&priceMin=1000'))
    expect(andFilters).toContainEqual({ marketPosition: 'low' })
  })
})
