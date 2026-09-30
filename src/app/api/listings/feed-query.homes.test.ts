import { describe, expect, it, vi } from 'vitest'

/**
 * `homes=1` — the scope a rentals district page lists while it has homes (SEO wave B, D1): its sort
 * and Show-more send it, so page 2 is apartments, houses and rooms like page 1, never offices.
 */
vi.mock('@/lib/db', () => ({
  db: {
    listing: { groupBy: vi.fn(async () => []), findFirst: vi.fn(async () => ({ id: 'x' })) },
    category: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: unknown) => w,
  marketplaceListingScope: async () => ({}),
  teacherExclusion: async () => null,
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: unknown) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: unknown) => l }))

import { buildFeedFilters } from './feed-query'
import { HOME_RENTAL_SUBCATS, HOMES_ONLY_PARAM } from '@/lib/rental-homes'

const homesClause = async (qs: string) => {
  const { andFilters } = await buildFeedFilters(new URLSearchParams(qs))
  return andFilters.find((f) => JSON.stringify(f) === JSON.stringify({ subcategorySlug: { in: [...HOME_RENTAL_SUBCATS] } }))
}

describe('homes=1 — the rentals district pages\' homes-only scope', () => {
  it('narrows rentals to apartments, houses and rooms', async () => {
    expect(await homesClause(`category=rentals&district=d7&kind=places&${HOMES_ONLY_PARAM.key}=${HOMES_ONLY_PARAM.value}`)).toBeDefined()
  })

  it('is ignored outside rentals, without the param, and under a chosen subcategory', async () => {
    expect(await homesClause('category=electronics&homes=1')).toBeUndefined()
    expect(await homesClause('category=rentals&district=d7')).toBeUndefined()
    expect(await homesClause('category=rentals&homes=0')).toBeUndefined()
    // "Office" picked from the strip answers offices, not an empty AND of two disjoint sets.
    const { andFilters } = await buildFeedFilters(new URLSearchParams('category=rentals&homes=1&subcategory=office-rental'))
    expect(andFilters).toContainEqual({ subcategorySlug: 'office-rental' })
    expect(await homesClause('category=rentals&homes=1&subcategory=office-rental')).toBeUndefined()
  })
})
