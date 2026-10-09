import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ SAVED-SEARCH ALERTS MUST FIRE FOR THE LISTINGS THE SEARCH SHOWED. The alert cron kept its own
 * copy of the district filter, which knew only the curated keys: a search saved from a
 * /c/<category>/<district> page (`district=quan-7`) resolved to NO filter and alerted on the whole
 * category, and a query "căn hộ quận 7" was matched as the literal phrase while the feed now reads
 * the district out of it.
 */

const h = vi.hoisted(() => ({
  rows: [] as { district: string | null }[],
  /** The existence probe behind the plain-words safety net. Default: the district reading has rows. */
  firstRow: (_where: unknown): { id: string } | null => ({ id: 'x' }),
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: { groupBy: vi.fn(async () => h.rows), findFirst: vi.fn(async (a: { where: unknown }) => h.firstRow(a.where)) },
    category: { findUnique: vi.fn(async () => null) },
  },
}))
// The feed's own builder is imported below (the attribute-filter parity block), so its scope helpers are stubbed too:
// both sides then differ only in what each one builds itself.
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: any) => w,
  marketplaceListingScope: async () => ({}),
  teacherExclusion: async () => null,
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: any) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: any) => l }))

import { describeParams, normalizeParams, paramsFromUrl, toUrlParams, type SavedSearchParams } from './saved-search'
import { buildListingWhere } from './saved-search-where'
import { districtScopeForSlug, resetDistrictNameCache } from './district-slug'
import { attrRowMatches } from './attr-match'
import { RANGE_COLUMNS } from './taxonomy'
import { applyFilterParams, readExplorerUrl } from './explorer-url'
import { buildFeedFilters } from '@/app/api/listings/feed-query'

beforeEach(() => {
  resetDistrictNameCache()
  h.rows = [{ district: 'Quận 7' }, { district: 'Quận 1' }]
  h.firstRow = () => ({ id: 'x' })
})

describe('buildListingWhere — the feed’s district scope', () => {
  it('a landing-page slug scopes to that district instead of the whole category', async () => {
    const w: any = await buildListingWhere({ category: 'rentals', district: 'quan-7' })
    expect(w.AND).toContainEqual({ district: { in: ['Quận 7'] } })
  })

  it('a curated key uses the same (number-bounded) scope as the feed', async () => {
    const w: any = await buildListingWhere({ district: 'd1' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d1'))
  })

  it('a district typed into the saved query is read the way the feed reads it', async () => {
    const w: any = await buildListingWhere({ category: 'rentals', q: 'căn hộ quận 7' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d7'))
    expect(w.AND).toContainEqual({ searchText: { contains: 'can ho' } })
    expect(w.AND).not.toContainEqual({ searchText: { contains: 'can ho quan 7' } })
  })

  it('under an explicit district a product title keeps its words, as on the feed', async () => {
    const w: any = await buildListingWhere({ district: 'd1', q: 'Hồi ức Phú Nhuận' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d1'))
    expect(w.AND).toContainEqual({ searchText: { contains: 'hoi uc phu nhuan' } })
  })

  it('an explicit district wins, and the typed district is not left behind as text (as on the feed)', async () => {
    const w: any = await buildListingWhere({ district: 'd1', q: 'căn hộ quận 7' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d1'))
    expect(w.AND).not.toContainEqual(await districtScopeForSlug('d7'))
    expect(w.AND).toContainEqual({ searchText: { contains: 'can ho' } })
    expect(JSON.stringify(w)).not.toContain('quan 7')
  })

  /**
   * ⛔ THE FEED'S SAFETY NET, FOR THE ALERT TOO. A saved "Hồi ức Phú Nhuận" (a book) showed the plain
   * words on the feed, because the Phú Nhuận reading found nothing; an alert watching Phú Nhuận would
   * never fire for the book the search showed.
   */
  it('watches the plain words when the district reading matches no live listing and they match some', async () => {
    h.firstRow = (w) => (JSON.stringify(w).includes('Phu Nhuan') ? null : { id: 'book' })
    const w: any = await buildListingWhere({ q: 'Hồi ức Phú Nhuận' })
    expect(w.AND).toContainEqual({ searchText: { contains: 'hoi uc phu nhuan' } })
    expect(w.AND).not.toContainEqual(await districtScopeForSlug('phu-nhuan'))
  })

  it('decides without the price band, as the feed does', async () => {
    const probes: string[] = []
    h.firstRow = (w) => { probes.push(JSON.stringify(w)); return { id: 'x' } }
    const w: any = await buildListingWhere({ q: 'Hồi ức Phú Nhuận', priceMin: 1000, priceMax: 2000 })
    expect(probes).toHaveLength(1)
    expect(probes[0]).not.toContain('"price"')
    expect(JSON.stringify(w)).toContain('"price"') // the alert itself keeps the band
  })

  it('keeps the district reading when the plain words match nothing live either', async () => {
    h.firstRow = () => null
    const w: any = await buildListingWhere({ q: 'Hồi ức Phú Nhuận' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('phu-nhuan'))
  })

  it('a failed probe keeps the district reading — an alert must not error over its safety net', async () => {
    h.firstRow = () => { throw new Error('timeout') }
    const w: any = await buildListingWhere({ q: 'Hồi ức Phú Nhuận' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('phu-nhuan'))
  })

  it('keeps the district reading when it has live matches', async () => {
    const w: any = await buildListingWhere({ q: 'Hồi ức Phú Nhuận' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('phu-nhuan'))
  })

  it('keeps a housing search on its district even with no live match — the zero is honest', async () => {
    h.firstRow = (w) => (JSON.stringify(w).includes('Phu Nhuan') ? null : { id: 'elsewhere' })
    const w: any = await buildListingWhere({ category: 'rentals', q: 'phòng trọ Phú Nhuận' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('phu-nhuan'))
  })

  it('a stored district of "all" is no district — the query still infers, as it does on the feed', async () => {
    const w: any = await buildListingWhere({ district: 'all', q: 'căn hộ quận 7' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d7'))
    expect(w.AND).toContainEqual({ searchText: { contains: 'can ho' } })
  })

  it('a saved shorthand is read as the feed reads it — text alone, district beside a place word', async () => {
    const bare: any = await buildListingWhere({ category: 'rentals', q: 'Q7' })
    expect(bare.AND).toContainEqual({ searchText: { contains: 'q7' } })
    const placed: any = await buildListingWhere({ q: 'căn hộ Q7' })
    expect(placed.AND).toContainEqual(await districtScopeForSlug('d7'))
  })

  it('names a landing-slug district in the saved search’s label, localized when its words name a curated district', () => {
    expect(describeParams({ category: 'rentals', district: 'quan-7' }, 'vi')).toContain('Quận 7 (Phú Mỹ Hưng)')
    expect(describeParams({ category: 'rentals', district: 'quan-binh-thanh' }, 'en')).toContain('Binh Thanh District')
    expect(describeParams({ category: 'electronics', district: 'cau-giay' })).toContain('Cau Giay')
  })
})

describe('buildListingWhere — the Posted filter', () => {
  const clauses = (w: any) => JSON.stringify(w)

  it('matches postedAt, never the attributes text, so a "posted this week" alert can fire', async () => {
    const w = await buildListingWhere({ category: 'rentals', subcategory: 'apartment-rental', attrs: { posted: '7d', bedrooms: '2' } } as any)
    expect(clauses(w)).toContain('postedAt')
    expect(clauses(w)).not.toContain('\\"posted\\"')
    expect(clauses(w)).toContain('\\"bedrooms\\":\\"2\\"')
  })

  it('is dropped where the feed would drop it (vehicle hire)', async () => {
    const w = await buildListingWhere({ category: 'rentals', subcategory: 'car-rental', attrs: { posted: '7d' } } as any)
    expect(clauses(w)).not.toContain('postedAt')
    expect(clauses(w)).not.toContain('posted')
  })
})

/**
 * ⛔ AN ATTRIBUTE FILTER IN AN ALERT MATCHES WHAT IT MATCHES ON THE FEED (2026-10-09). The alert read every `attr_*` as the
 * plain text `"key":"value"` in `attributes`, while the feed reads it through attr-match.ts (attrWhere / attrNeedles): the
 * importer-only `facetTokens` column, the derived expansions (a city's "Can teach in" also finds its districts and
 * "anywhere", Thủ Đức covers District 2's cover area, "weekly" also means priced by the day), the open-ended "6+" bucket
 * and the "Fits" chips whose rows store a device name. A teacher row stores NO attributes at all, so a teacher search with
 * any filter matched nothing; an apartment's amenities live only in tokens, so "pool" never fired.
 */
describe('buildListingWhere — attribute filters, read by the feed’s own rule', () => {
  type Row = { attributes: string | null; facetTokens: string | null }
  /** The clauses that read the attribute columns — the part of the alert this block is about. */
  const attrClauses = (and: unknown[]) => and.filter((c) => /"(attributes|facetTokens)"/.test(JSON.stringify(c)))
  /** The Prisma predicate evaluated in JS: `contains` without `mode` is `includes` (attr-match.ts's header). */
  const holds = (w: any, r: Row): boolean => {
    if (w.AND) return w.AND.every((c: unknown) => holds(c, r))
    if (w.OR) return w.OR.some((c: unknown) => holds(c, r))
    if (w.attributes) return (r.attributes ?? '').includes(w.attributes.contains)
    if (w.facetTokens) return (r.facetTokens ?? '').includes(w.facetTokens.contains)
    throw new Error(`not an attribute clause: ${JSON.stringify(w)}`)
  }
  /** A teacher row as the teacher publish core writes it: `attributes: null`, every facet a token. */
  const teacher = (facetTokens: string): Row => ({ attributes: null, facetTokens })
  const CASES: [string, SavedSearchParams, Row, boolean][] = [
    ['a Ho Chi Minh City "Can teach in" alert finds a District 7 teacher', { category: 'teachers', attrs: { workIn: 'ho-chi-minh-city' } }, teacher('|workIn:d7|'), true],
    ['a Hanoi alert finds a teacher who will move anywhere', { category: 'teachers', attrs: { workIn: 'ha-noi' } }, teacher('|workIn:anywhere|'), true],
    ['a Hanoi alert finds a teacher who picked Hanoi itself — the old value, as a token', { category: 'teachers', attrs: { workIn: 'ha-noi' } }, teacher('|workIn:ha-noi|'), true],
    ['⛔ a District 1 alert never finds a District 7 teacher', { category: 'teachers', attrs: { workIn: 'd1' } }, teacher('|workIn:d7|'), false],
    ['a District 2 cover alert finds a teacher covering Thủ Đức, its umbrella', { category: 'teachers', attrs: { coverArea: 'd2' } }, teacher('|cover:open|coverArea:thu-duc|'), true],
    ['two filters both still apply', { category: 'teachers', attrs: { workIn: 'ha-noi', native: 'native' } }, teacher('|workIn:ha-noi|native:non-native|'), false],
    ['a pool alert finds an apartment whose amenities are tokens', { category: 'rentals', subcategory: 'apartment-rental', attrs: { amenities: 'pool' } }, { attributes: '{"bedrooms":"2"}', facetTokens: '|amenities:pool|' }, true],
    ['a weekly alert finds a car priced by the day', { category: 'rentals', subcategory: 'car-rental', attrs: { rentalPeriod: 'weekly' } }, { attributes: '{"rentalPeriod":"daily"}', facetTokens: null }, true],
    ['a "6+ bedrooms" alert finds a 7-bedroom home', { category: 'rentals', attrs: { bedrooms: '6' } }, { attributes: '{"bedrooms":"7"}', facetTokens: null }, true],
    ['a "Fits iPhone 14" alert finds a row that stores the device name', { category: 'electronics', attrs: { compatibleWith: 'iphone14' } }, { attributes: '{"compatibleWith":"iPhone 14 Pro Max"}', facetTokens: null }, true],
    ['a plain attribute matches as before', { category: 'rentals', attrs: { furnishing: 'fully' } }, { attributes: '{"furnishing":"fully"}', facetTokens: null }, true],
    ['…and only its own value', { category: 'rentals', attrs: { furnishing: 'fully' } }, { attributes: '{"furnishing":"partly"}', facetTokens: null }, false],
  ]

  it.each(CASES)('%s', async (_label, params, row, expected) => {
    const w: any = await buildListingWhere(params)
    expect(attrClauses(w.AND).every((c) => holds(c, row))).toBe(expected)
    // …which is the feed's own answer for that row (attr-match.ts), so the case table cannot drift from the filter.
    expect(Object.entries(params.attrs!).every(([k, v]) => attrRowMatches(row, k, v))).toBe(expected)
  })

  it('asks the database exactly what the feed asks behind the alert’s own link', async () => {
    for (const [, params] of CASES) {
      const alert: any = await buildListingWhere(params)
      // The cron's deep link is `/?${toUrlParams(params)}`; this is the feed that link opens.
      const feed = await buildFeedFilters(new URLSearchParams(toUrlParams(params)))
      expect(attrClauses(alert.AND), JSON.stringify(params.attrs)).toEqual(attrClauses(feed.andFilters))
    }
  })
})

/**
 * ⛔ A RANGE FACET IN AN ALERT IS THE FEED'S NUMERIC COLUMN RANGE (2026-10-09). The explorer keeps a range facet in
 * customFilters under its facet KEY (`year: "2018-2022"` — range-facet-control.tsx writes "min-max", either side open),
 * saveSearchParams stores it under `attrs`, and the explorer sends it to the feed as `range_<column>` (applyFilterParams).
 * The alert read it back as `attr_year` — an `attributes` text match no row has — so a range alert never fired, and its
 * deep link (toUrlParams) wrote the same `attr_year`, which the explorer drops: the opened feed lost the range too.
 * Now both go through the explorer's one mapping (taxonomy.ts facetParamName) and the feed's own range loop.
 */
describe('buildListingWhere — range facets, by the explorer’s own mapping', () => {
  const COLS = new Set<string>(RANGE_COLUMNS)
  /** The clauses that read a range column — `{ <column>: { gte?, lte? } }`, the feed's shape. */
  const rangeClauses = (and: object[]) => and.filter((c) => Object.keys(c).length === 1 && COLS.has(Object.keys(c)[0]))
  /** The explorer's own request for a filter state — its real writer (explorer-url.ts applyFilterParams). */
  const explorerRequest = (category: string, subcategory: string, customFilters: Record<string, string>) => {
    const p = new URLSearchParams({ category, ...(subcategory !== 'all' ? { subcategory } : {}) })
    applyFilterParams(p, customFilters, category, subcategory)
    return p
  }
  const RANGES: [string, string, string, Record<string, string>, object][] = [
    ['Vehicles · Year 2018–2022', 'vehicles', 'all', { year: '2018-2022' }, { year: { gte: 2018, lte: 2022 } }],
    ['Jobs · Salary 20–40 tr/tháng (key salary, column salaryM)', 'jobs', 'all', { salary: '20-40' }, { salaryM: { gte: 20, lte: 40 } }],
    ['Vehicles · Mileage up to 50,000 km — open below (key mileage, column mileageKm)', 'vehicles', 'all', { mileage: '-50000' }, { mileageKm: { lte: 50000 } }],
    ['Rentals › Apartment · Size from 30 m² — a subcategory-only facet, open above', 'rentals', 'apartment-rental', { areaM2: '30-' }, { areaM2: { gte: 30 } }],
  ]

  it.each(RANGES)('%s: the alert counts the column range the feed builds for the explorer’s request', async (_label, category, subcategory, customFilters, clause) => {
    // Exactly what a save stores: saveSearchParams (use-explorer.ts) keeps customFilters under `attrs`.
    const saved: SavedSearchParams = { category, subcategory: subcategory === 'all' ? undefined : subcategory, attrs: customFilters }
    const alert: any = await buildListingWhere(saved)
    expect(alert.AND).toContainEqual(clause)
    expect(JSON.stringify(alert)).not.toMatch(/"(attributes|facetTokens)"/) // never a text match on a range
    const feed = await buildFeedFilters(explorerRequest(category, subcategory, customFilters))
    expect(rangeClauses(feed.andFilters)).toEqual([clause])
    expect(rangeClauses(alert.AND)).toEqual(rangeClauses(feed.andFilters))
  })

  it.each(RANGES)('%s: the alert’s link is the explorer’s own request, and the explorer reads the range back', (_label, category, subcategory, customFilters) => {
    const saved: SavedSearchParams = { category, subcategory: subcategory === 'all' ? undefined : subcategory, attrs: customFilters }
    expect(toUrlParams(saved)).toBe(explorerRequest(category, subcategory, customFilters).toString())
    expect(readExplorerUrl(toUrlParams(saved)).customFilters).toEqual(customFilters)
    // …and /saved's label reader (paramsFromUrl) still inverts it, range included.
    expect(paramsFromUrl(`/?${toUrlParams(saved)}`)).toEqual(normalizeParams(saved))
  })

  it('a search saved BEFORE this fix (a range under `attrs` — how every save stored one) alerts on the column now, beside its chip', async () => {
    // A stored row exactly as the cron reads it (`JSON.parse(SavedSearch.params)`): Vehicles › Motorbike, 100–150 cc, scooters.
    const stored: SavedSearchParams = JSON.parse('{"category":"vehicles","subcategory":"motorbike","attrs":{"engineCc":"100-150","bikeType":"scooter"}}')
    const alert: any = await buildListingWhere(stored)
    expect(alert.AND).toContainEqual({ engineCc: { gte: 100, lte: 150 } })
    expect(JSON.stringify(alert)).not.toContain('engineCc\\"') // the old `"engineCc":"100-150"` text needle is gone
    expect(JSON.stringify(alert)).toContain('\\"bikeType\\":\\"scooter\\"') // the chip is still an attribute match
    // The notification's link opens the explorer on both filters.
    expect(toUrlParams(stored)).toBe('category=vehicles&subcategory=motorbike&range_engineCc=100-150&attr_bikeType=scooter')
    expect(readExplorerUrl(toUrlParams(stored)).customFilters).toEqual({ engineCc: '100-150', bikeType: 'scooter' })
    const feed = await buildFeedFilters(new URLSearchParams(toUrlParams(stored)))
    expect(rangeClauses(alert.AND)).toEqual(rangeClauses(feed.andFilters))
  })
})
