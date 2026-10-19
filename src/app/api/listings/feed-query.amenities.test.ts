import { describe, expect, it, vi } from 'vitest'

/**
 * GoPlus partnership (2026-10-19): two Filter-panel facets on apartment rentals.
 *  · `attr_amenities` is MULTI-SELECT (src/lib/multi-facet.ts) — one clause per pick, AND-ed, so "No live-in landlord"
 *    + "Car access" returns rooms with both.
 *  · `attr_hasVideo=yes` is the `video` COLUMN (src/lib/video-filter.ts) — and, like Posted, ONLY on a view whose Filter
 *    panel offers it, so a stray value can never narrow a feed invisibly.
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

const videoClause = (andFilters: any[]) => andFilters.find((f) => f.video !== undefined)
const tokenNeedles = (andFilters: any[]) => JSON.stringify(andFilters).match(/\|amenities:[a-z-]+\|/g) ?? []

describe('buildFeedFilters — attr_amenities (multi-select)', () => {
  it('AND-s one clause per pick', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('category=rentals&subcategory=apartment-rental&attr_amenities=car-alley,no-landlord'))
    const clause = andFilters.find((f: any) => Array.isArray(f.AND) && JSON.stringify(f).includes('amenities')) as any
    expect(clause?.AND).toHaveLength(2)
    expect(tokenNeedles(andFilters)).toEqual(['|amenities:no-landlord|', '|amenities:car-alley|'])
  })

  it('adds no clause at all for a list with nothing valid in it', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('category=rentals&subcategory=apartment-rental&attr_amenities=jacuzzi'))
    expect(JSON.stringify(andFilters)).not.toContain('amenities')
  })
})

describe('buildFeedFilters — attr_hasVideo', () => {
  it('adds video IS NOT NULL on the apartment view', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('category=rentals&subcategory=apartment-rental&attr_hasVideo=yes'))
    expect(videoClause(andFilters)).toEqual({ video: { not: null } })
  })

  it.each([
    'category=rentals&subcategory=house-rental&attr_hasVideo=yes',
    'category=rentals&attr_hasVideo=yes',
    'category=electronics&attr_hasVideo=yes',
    'attr_hasVideo=yes',
    'category=rentals&subcategory=apartment-rental&attr_hasVideo=maybe',
  ])('is ignored where it is not offered, or not "yes": %s', async (qs) => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams(qs))
    expect(videoClause(andFilters)).toBeUndefined()
  })
})
