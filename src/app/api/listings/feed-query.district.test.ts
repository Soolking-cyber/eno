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
  // Any shape — a numbered district's scope is an AND of a guard and the bounded match.
  return andFilters.find((f: any) => JSON.stringify(f).includes('"district":'))
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
 * ⛔ "still cant search by district" (owner, 2026-09-24). A district typed into the search box was
 * reduced to the token `quan` — the digit dropped as too short — so "Quận 7" returned every HCMC
 * rental. It must now be the SAME scope `?district=` applies, with only the remaining words left for
 * the text filter.
 */
describe('a district typed into the query', () => {
  const build = (qs: string) => buildFeedFilters(new URLSearchParams(qs))
  const tokens = (f: any) => (f ? (f.AND ?? f.OR ?? [f]).map((c: any) => c.searchText.contains) : null)

  it('"Quận 7" narrows to exactly the d7 scope, with no text filter left', async () => {
    const r = await build(`q=${encodeURIComponent('Quận 7')}`)
    expect(r.andFilters).toContainEqual(await districtScopeForSlug('d7'))
    expect(r.pgTextFilter).toBeNull()
    expect(r.inferredDistrict).toBe('d7')
    // Nothing left to rank on, so no paid semantic call is made for a bare district.
    expect(r.q).toBeUndefined()
  })

  it('"căn hộ quận 7" keeps "can ho" as text AND applies d7', async () => {
    const r = await build(`q=${encodeURIComponent('căn hộ quận 7')}`)
    expect(r.andFilters).toContainEqual(await districtScopeForSlug('d7'))
    expect(tokens(r.pgTextFilter)).toEqual(['can', 'ho'])
    expect(r.q).toBe('căn hộ')
  })

  it('"2pn quận 2" → the thu-duc scope plus the text "2pn"', async () => {
    const r = await build(`q=${encodeURIComponent('2pn quận 2')}`)
    expect(r.andFilters).toContainEqual(await districtScopeForSlug('thu-duc'))
    expect(tokens(r.pgTextFilter)).toEqual(['2pn'])
    expect(r.inferredDistrict).toBe('thu-duc')
  })

  it.each(['iphone 7', '7 triệu'])('%j infers no district and is searched as typed', async (q) => {
    const r = await build(`q=${encodeURIComponent(q)}`)
    expect(r.inferredDistrict).toBeNull()
    expect(await districtClause(`all&q=${encodeURIComponent(q)}`)).toBeUndefined()
    expect(r.q).toBe(q)
  })

  it('an explicit ?district=d1 wins over "quận 7" in the query, which stays text', async () => {
    const r = await build(`district=d1&q=${encodeURIComponent('quận 7')}`)
    expect(r.andFilters).toContainEqual(await districtScopeForSlug('d1'))
    expect(r.andFilters).not.toContainEqual(await districtScopeForSlug('d7'))
    expect(r.inferredDistrict).toBeNull()
    expect(r.q).toBe('quận 7')
  })

  it('a shorthand is a district only beside a place word — a bare "D5" stays a product search', async () => {
    expect((await build(`q=${encodeURIComponent('căn hộ Q7')}`)).inferredDistrict).toBe('d7')
    expect((await build('category=rentals&q=D5')).inferredDistrict).toBeNull()
    expect((await build('q=D5')).q).toBe('D5')
  })

  it('?district=all is "no district", not a pick — the query still infers', async () => {
    const r = await build(`district=all&q=${encodeURIComponent('Quận 7')}`)
    expect(r.inferredDistrict).toBe('d7')
  })

  /**
   * ⛔ d1 MATCHED QUẬN 10, 11 AND 12. `contains 'Quận 1'` is a substring test: production returned
   * 2,794 rentals for a district holding 1,373, and inferring "Quận 1" onto that scope would have
   * shipped the same lie through the search box.
   */
  it('the d1 scope is number-bounded: every clause for "Quận 1" ends at a delimiter or the field end', async () => {
    const outer: any = await districtScopeForSlug('d1')
    // AND[0] is the number-bounded match, AND[1] the canonical-column exclusion of Quận 10–12
    // (district-slug.ts). Inside the match, AND[0] is the cheap bare-substring guard and AND[1] is
    // what decides (district-match.ts).
    const scope = outer.AND[0]
    expect(JSON.stringify(outer.AND[1])).toContain('Quận 12')
    const needles = scope.AND[1].OR.map((c: any) => (c.district ?? c.location))
    expect(needles).not.toContainEqual({ contains: 'Quận 1' })
    expect(needles).toContainEqual({ endsWith: 'Quận 1' })
    expect(needles).toContainEqual({ contains: 'Quận 1 ' })
    expect(needles).toContainEqual({ contains: 'Quận 1,' })
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
