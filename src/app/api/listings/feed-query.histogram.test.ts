import { describe, expect, it, vi } from 'vitest'

/**
 * THE PRICE HISTOGRAM COUNTS EXACTLY THE FEED'S SET, MINUS THE PRICE RANGE.
 *
 * "{n} available" is presented as exact, so the histogram's `where` must be the feed's `where` with
 * the one price clause removed — nothing else dropped, nothing else added. Two halves:
 *
 *  · SERVER: `buildFeedFilters` returns `where = { AND: andFilters }`, and the free-text clause
 *    (`pgTextFilter`) and the subcategory clause (`subcategoryFilter`) are pushed INTO `andFilters`
 *    — they are returned separately only so the semantic path and the subcategory facet can drop
 *    them. The histogram branch's `groupBy({ where })` therefore already applies both.
 *  · CLIENT: the request itself must carry the feed's params. It used to be rebuilt by hand in
 *    listings-explorer.tsx and had drifted (no `subcategory` once a brand was picked, no
 *    `match=any`); it is now `histogramQueryFrom(<the feed's own params>)`.
 *
 * This runs the REAL builder on both requests and compares the clauses.
 */

vi.mock('@/lib/db', () => ({
  db: {
    listing: { groupBy: vi.fn(async () => []) },
    category: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: unknown) => w,
  // A real exclusion, so the test also shows the edition scope reaching the histogram.
  marketplaceListingScope: async () => ({ sellerId: { notIn: ['desk'] } }),
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: unknown) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: unknown) => l }))

import type { Prisma } from '@/generated/prisma/client'
import { buildFeedFilters } from './feed-query'
import { histogramQueryFrom } from '@/lib/price-histogram'

/** What the explorer's `baseParamsString` + live query send with every rail in use. */
const FEED = new URLSearchParams({
  seller: 'shop-1',
  subcategory: 'phone-cases',
  brand: 'apple',
  model: 'iPhone 16 Pro Max',
  category: 'electronics',
  district: 'd1',
  condition: 'used',
  deal: 'good',
  type: 'sell',
  q: 'op lung',
  match: 'any',
  sort: 'price-low',
  verified: 'all',
  priceMin: '100000',
  priceMax: '500000',
  attr_color: 'black',
  range_year: '2020-',
  building: 'vh-central-park',
  lang: 'ko',
  limit: '24',
  offset: '0',
  priorityCategory: 'electronics',
})

describe('histogram where === feed where minus the price clause', () => {
  it('through the real builder, with text, subcategory, brand, facets, area, deal and edition scope', async () => {
    const feed = await buildFeedFilters(FEED)
    const hist = await buildFeedFilters(new URLSearchParams(histogramQueryFrom(FEED)))

    expect(feed.histogram).toBe(false)
    expect(hist.histogram).toBe(true)
    const isPrice = (f: Prisma.ListingWhereInput) => 'price' in f
    expect(feed.andFilters.filter(isPrice)).toEqual([{ price: { gte: 100_000, lte: 500_000 } }])
    expect(hist.andFilters.filter(isPrice)).toEqual([])

    expect(hist.where).toEqual({ AND: feed.andFilters.filter((f) => !isPrice(f)) })

    // The two clauses the finding said the histogram ignores are IN the `where` it aggregates.
    const and = (hist.where as { AND: Prisma.ListingWhereInput[] }).AND
    expect(feed.pgTextFilter).not.toBeNull()
    expect(feed.subcategoryFilter).toEqual({ subcategorySlug: 'phone-cases' })
    expect(and).toContainEqual(feed.pgTextFilter)
    expect(and).toContainEqual(feed.subcategoryFilter)
    // `match=any` survives: the text clause is the OR form the feed uses, not the AND default.
    expect(hist.pgTextFilter).toEqual(feed.pgTextFilter)
    expect(Object.keys(hist.pgTextFilter ?? {})).toEqual(['OR'])
    expect(and).toContainEqual({ sellerId: { notIn: ['desk'] } })
    expect(and).toContainEqual({ buildingKey: 'vh-central-park' })
  })

  /**
   * The evidence for the client half: the params the explorer's old hand-built `histogramQuery`
   * produced for this same state (brand + model picked, so its brand branch ran: no subcategory, and
   * it never sent `match`). Through the same builder they describe a DIFFERENT set — wider for the
   * missing subcategory and building, narrower for words AND-matched where the feed OR-matches.
   */
  it('the hand-built query it replaces did not match the feed', async () => {
    const old = new URLSearchParams({
      seller: 'shop-1', histogram: '1', brand: 'apple', model: 'iPhone 16 Pro Max', category: 'electronics',
      district: 'd1', condition: 'used', deal: 'good', type: 'sell', q: 'op lung', attr_color: 'black', range_year: '2020-',
    })
    const feed = await buildFeedFilters(FEED)
    const was = await buildFeedFilters(old)
    const and = (was.where as { AND: Prisma.ListingWhereInput[] }).AND
    expect(and).not.toContainEqual({ subcategorySlug: 'phone-cases' })
    expect(was.pgTextFilter).not.toEqual(feed.pgTextFilter) // AND-of-tokens, not the feed's OR
    expect(and).not.toContainEqual({ buildingKey: 'vh-central-park' })
  })
})
