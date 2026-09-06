import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE DISTRICT SCOPE MUST SURVIVE THE TRIP FROM AN SEO LANDING PAGE INTO THE FULL SEARCH.
 *
 * `/c/<category>/<district>` links into the explorer with its own slug space (`thao-dien`, the
 * slugified free-text district), not the curated DISTRICTS keys (`d1`, `binh-thanh`). Before this,
 * `buildDistrictFilter` returned `undefined` for anything it did not recognise — and an undefined
 * filter is no filter, so a reader who had chosen a district landed in the whole category.
 *
 * ⚠️ THE OTHER HALF OF THAT BUG IS `?district=junk` RETURNING EVERYTHING. A scope the server cannot
 * honour is an empty result, never an unscoped one.
 */

const h = vi.hoisted(() => ({ districts: [] as { district: string | null }[] }))

vi.mock('@/lib/db', () => ({
  db: {
    listing: { groupBy: vi.fn(async () => h.districts) },
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
import { resetDistrictNameCache, districtScopeForSlug } from '@/lib/district-slug'

/** The district clause `buildFeedFilters` produced, whatever shape it took. */
async function districtClause(param: string) {
  const { andFilters } = await buildFeedFilters(new URLSearchParams(`district=${param}`))
  return andFilters.find((f: any) => f.district !== undefined || (f.OR && f.OR.some((o: any) => o.district !== undefined)))
}

beforeEach(() => {
  resetDistrictNameCache()
  h.districts = [{ district: 'Thao Dien' }, { district: 'Thảo Điền' }, { district: 'District 1' }]
})

describe('the feed’s district filter', () => {
  it('still uses the curated match list for a DISTRICTS key', async () => {
    const clause: any = await districtClause('binh-thanh')
    // Both spellings, against both columns — the long-standing behaviour, unchanged.
    expect(clause.OR).toEqual(
      expect.arrayContaining([{ district: { contains: 'Binh Thanh' } }, { location: { contains: 'Bình Thạnh' } }]),
    )
  })

  it('resolves an SEO landing page’s slug to the district values listings carry', async () => {
    const clause: any = await districtClause('thao-dien')
    expect(clause).toEqual({ district: { in: ['Thao Dien', 'Thảo Điền'] } })
  })

  it('matches NOTHING for a slug that resolves to no district', async () => {
    // ⛔ The regression: this used to be `undefined`, i.e. the whole catalogue.
    const clause: any = await districtClause('not-a-place')
    expect(clause).toEqual({ district: { in: [] } })
  })

  it('applies no district filter at all for "all" — that is the unscoped request', async () => {
    expect(await districtClause('all')).toBeUndefined()
  })

  /**
   * ⛔ THE LANDING PAGE AND THE FEED MUST AGREE ON WHAT A SLUG MEANS, and for 12 of the 23 curated
   * slugs they did not: `binh-thanh` is both a curated key AND exactly what the stored name
   * "Bình Thạnh" slugifies to. The page counted exact names while the feed matched the curated
   * spellings across two columns, so the first sort on such a page changed the total and pulled in
   * listings the page had never counted. One resolver now answers both.
   */
  it('resolves a slug that is BOTH a curated key and a slugified stored name the same way for both callers', async () => {
    h.districts = [{ district: 'Bình Thạnh' }]
    const fromFeed: any = await districtClause('binh-thanh')
    const fromPage: any = await districtScopeForSlug('binh-thanh')
    expect(fromPage).toEqual(fromFeed)
    // And it is the curated match, which is what the explorer's chips have always meant.
    expect(fromFeed.OR).toBeDefined()
  })
})

/**
 * ⛔ PAGE ONE AND PAGE TWO MUST COME FROM ONE ORDERING, AND ONLY A TEST CAN KEEP THEM THERE.
 *
 * The district landing page server-renders its first 48 rows, and "Show more" then asks the feed
 * for `sort=newest` at offset 48; the storefront renders its first 60 by date and asks for
 * `sort=recent`. Both couplings were true when written and stated in a comment, which is exactly
 * the kind of agreement that rots: change `buildFeedOrderBy` and page two silently starts paging a
 * different sequence, where the id dedupe hides the duplicates but nothing hides the gaps.
 */
describe('the orders the paginating surfaces depend on', () => {
  it('"newest" IS the district page’s server-render order', async () => {
    const { buildFeedOrderBy } = await import('./feed-query')
    expect(buildFeedOrderBy('newest')).toEqual([{ rankScore: 'desc' }, { id: 'desc' }])
  })

  it('"recent" IS the storefront’s server-render order', async () => {
    const { buildFeedOrderBy } = await import('./feed-query')
    expect(buildFeedOrderBy('recent')).toEqual([{ postedAt: 'desc' }, { id: 'desc' }])
  })
})
