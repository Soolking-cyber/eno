import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@/generated/prisma/client'
import { CATEGORY_BY_SLUG, rangeFacetsFor, typesFor } from '@/lib/taxonomy'

/**
 * Live chip counts.
 *
 * ⚠️ WHAT THIS FILE IS ACTUALLY PROTECTING is one property: THE NUMBER ON A CHIP EQUALS WHAT
 * TAPPING IT RETURNS. Every assertion below is a way that property can break —
 *   · a dimension that constrains its own options (release semantics),
 *   · a hand-written classifier drifting from the Prisma predicate it mirrors (condition, district),
 *   · a count taken without the marketplace scope, which would put e-Visa SKUs in a chip total on
 *     the licensed sàn TMĐT,
 *   · an `all` that is not what clearing the chip returns.
 * A test that only checked "returns some numbers" would pass through all four.
 */

const h = vi.hoisted(() => ({
  scope: { sellerId: { notIn: ['desk-1'] } } as { sellerId?: { notIn: string[] } },
  calls: [] as { by: string[]; where: Prisma.ListingWhereInput }[],
  groups: {} as Record<string, unknown[]>,
  throwOn: null as string | null,
  categoryCalls: 0,
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      groupBy: async (args: { by: string[]; where: Prisma.ListingWhereInput }) => {
        h.calls.push({ by: args.by, where: args.where })
        const key = args.by.join('+')
        if (h.throwOn === key) throw new Error('groupBy exploded')
        return h.groups[key] ?? []
      },
    },
    category: {
      findMany: async () => {
        h.categoryCalls++
        return [
          { id: 'c-veh', slug: 'vehicles' },
          { id: 'c-ele', slug: 'electronics' },
          { id: 'c-fas', slug: 'fashion-beauty' },
          // A row the taxonomy does not know about — the shape the seeding rule is about.
          { id: 'c-ghost', slug: 'ghost-category' },
        ]
      },
    },
  },
}))

// The real module pulls in `server-only`, the visa-shop + trip-desk address lists and a db read.
// The unit under test only needs two things from it: the scope value it must AND into every base,
// and the error class it must NOT swallow.
vi.mock('@/lib/edition-scope', () => {
  class DeskResolutionError extends Error {}
  return {
    DeskResolutionError,
    marketplaceListingScope: async () => h.scope,
    // The real one AND-composes rather than spreading, because spread would let a caller's own
    // `sellerId` silently overwrite the exclusion. The fake keeps that shape so the assertions
    // below are about the real wire format.
    scopedListingWhere: async (where: Prisma.ListingWhereInput) =>
      h.scope.sellerId ? { AND: [where, { sellerId: h.scope.sellerId }] } : where,
  }
})

const { DeskResolutionError } = await import('@/lib/edition-scope')
const {
  computeFacetCounts,
  conditionBucket,
  defaultDimensions,
  districtSlugsFor,
  matchesProvince,
  releasedParams,
  yearBands,
  YEAR_BAND_MIN,
  __clearFacetCountCache,
} = await import('./facet-counts')

/**
 * Records what the builder was asked, and produces a filter array shaped like the real feed's.
 *
 * ⚠️ IT IGNORES PARAMS IT DOES NOT KNOW, exactly as `buildFeedFilters` does. An earlier version
 * turned every key into a filter, which quietly made unknown params look load-bearing and would
 * have hidden the cache-key finding this file now pins.
 */
const FILTER_PARAMS = ['category', 'subcategory', 'district', 'province', 'ward', 'condition', 'featured', 'priceMin', 'priceMax', 'type', 'brand', 'model', 'hasVideo']
const seen: URLSearchParams[] = []
const buildFilters = async (params: URLSearchParams) => {
  seen.push(new URLSearchParams(params))
  const andFilters: Prisma.ListingWhereInput[] = [{ verified: true }, { status: 'active' }]
  for (const [k, v] of params) {
    if (!FILTER_PARAMS.includes(k) && !k.startsWith('attr_') && !k.startsWith('range_')) continue
    andFilters.push({ [k]: v } as Prisma.ListingWhereInput)
  }
  let pgTextFilter: Prisma.ListingWhereInput | null = null
  const q = params.get('q')
  if (q) {
    pgTextFilter = { searchText: { contains: q } }
    andFilters.push(pgTextFilter)
  }
  return { andFilters, pgTextFilter }
}

/**
 * computeFacetCounts resolves its bases in this fixed order — see the Promise.all in the module.
 * A test that reads `seen` positionally must therefore request ALL of them.
 */
const ORDER = ['category', 'subcategory', 'brand', 'condition', 'type', 'year', 'area']
/** The params handed to the builder for one dimension, as a plain object. Requires ORDER. */
const paramsFor = (dimension: string) => Object.fromEntries(seen[ORDER.indexOf(dimension)]!)

/** The feed's own filter array out of the scoped `{ AND: [{ AND: base }, scope] }` wrapper. */
const baseOf = (where: Prisma.ListingWhereInput) => {
  const outer = (where as { AND: Prisma.ListingWhereInput[] }).AND
  return (outer[0] as { AND: Prisma.ListingWhereInput[] }).AND
}

beforeEach(() => {
  h.scope = { sellerId: { notIn: ['desk-1'] } }
  h.calls = []
  h.groups = {}
  h.throwOn = null
  h.categoryCalls = 0
  seen.length = 0
  __clearFacetCountCache()
})

describe('releasedParams', () => {
  it('releases the whole category cascade, because a category tap clears it', () => {
    const p = releasedParams(
      new URLSearchParams({
        category: 'vehicles', subcategory: 'motorbikes', brand: 'honda', model: 'Wave',
        attr_transmission: 'manual', range_year: '2015-2020',
        condition: 'used', type: 'sell', district: 'd1', priceMin: '1000', priceMax: '5000000',
      }),
      'category',
    )
    // ⛔ THE PRICE BAND IS RELEASED TOO, AND THE FIRST VERSION OF THIS TEST ASSERTED THE OPPOSITE.
    // A released dimension must mirror what the TAP actually clears, and `handleCategorySelect` in
    // listings-explorer.tsx also does `setPriceRange('all')` — "price brackets are
    // category-specific". Counting the category rail with the old band still applied produced the
    // exact lie this module exists to prevent, in the direction nobody notices: a buyer browsing
    // Electronics under 5,000,000 ₫ saw "Vehicles · 0", because almost no motorbike is under 5M —
    // yet tapping it would have reset the band and returned hundreds. Off by two orders of
    // magnitude, and it SUPPRESSES a tap that would have worked. Found by an external reviewer.
    // If that handler ever stops clearing the price, this expectation moves back with it.
    expect(Object.fromEntries(p)).toEqual({ condition: 'used', type: 'sell', district: 'd1' })
  })

  it('releases ONLY the subcategory for the subcategory rail — brand survives a subcategory tap', () => {
    const p = releasedParams(new URLSearchParams({ category: 'vehicles', subcategory: 'motorbikes', brand: 'honda' }), 'subcategory')
    expect(Object.fromEntries(p)).toEqual({ category: 'vehicles', brand: 'honda' })
  })

  it('releases brand AND model together, from either side', () => {
    const src = new URLSearchParams({ category: 'vehicles', brand: 'honda', model: 'Wave', condition: 'new' })
    expect(Object.fromEntries(releasedParams(src, 'brand'))).toEqual({ category: 'vehicles', condition: 'new' })
    expect(Object.fromEntries(releasedParams(src, 'model'))).toEqual({ category: 'vehicles', condition: 'new' })
  })

  it('releases every location param together — a place replaces a place', () => {
    const p = releasedParams(new URLSearchParams({ district: 'd1', province: 'Hanoi', ward: 'X', category: 'vehicles' }), 'area')
    expect(Object.fromEntries(p)).toEqual({ category: 'vehicles' })
  })

  it('releases only range_year for the year rail, leaving the other range facets applied', () => {
    const p = releasedParams(new URLSearchParams({ range_year: '2015-2020', range_mileageKm: '0-30000' }), 'year')
    expect(Object.fromEntries(p)).toEqual({ range_mileageKm: '0-30000' })
  })

  it('strips histogram — the landmine: it suppresses the price filter inside the builder', () => {
    // buildFeedFilters skips the price clause when histogram=1. Leaving it in would silently widen
    // every count by the whole price range the user had chosen.
    const p = releasedParams(new URLSearchParams({ histogram: '1', priceMin: '5000', offset: '48', limit: '24', lang: 'ko', sort: 'price-low' }), 'condition')
    expect(Object.fromEntries(p)).toEqual({ priceMin: '5000' })
  })

  it('does not mutate the caller’s params', () => {
    const src = new URLSearchParams({ category: 'vehicles', brand: 'honda' })
    releasedParams(src, 'category')
    expect(Object.fromEntries(src)).toEqual({ category: 'vehicles', brand: 'honda' })
  })
})

describe('conditionBucket — mirrors the NEWISH predicate in buildFeedFilters', () => {
  it.each([['new', 'new'], ['New', 'new'], ['Like new', 'new'], ['Mới', 'new'], ['như mới', 'new']])(
    '%s is new-ish', (input, expected) => expect(conditionBucket(input)).toBe(expected),
  )

  it.each(['used', 'Used', 'Good', 'fair', ''])('%s counts as used (condition set, not new-ish)', (input) => {
    expect(conditionBucket(input)).toBe('used')
  })

  it('leaves an unset condition in NEITHER bucket — the filter requires condition NOT NULL for used', () => {
    expect(conditionBucket(null)).toBeNull()
    expect(conditionBucket(undefined)).toBeNull()
  })
})

describe('districtSlugsFor — mirrors buildDistrictFilter', () => {
  it('matches on the district column or the location column', () => {
    expect(districtSlugsFor({ district: 'Bình Thạnh', location: 'x' })).toContain('binh-thanh')
    expect(districtSlugsFor({ district: null, location: 'Phú Mỹ Hưng' })).toContain('d7')
  })

  it('is CASE-SENSITIVE, because Prisma `contains` without a mode compiles to LIKE', () => {
    expect(districtSlugsFor({ district: 'bình thạnh', location: '' })).toEqual([])
  })

  it('reproduces the District 1 / District 10 overlap rather than tidying it away', () => {
    // The filter itself returns District 10 rows for ?district=d1. A "cleaner" classifier here
    // would report a d1 count the tap does not deliver.
    expect(districtSlugsFor({ district: 'District 10', location: '' }).sort()).toEqual(['d1', 'd10'])
  })

  it('never emits the "all" slug — that is the released state, not an option', () => {
    expect(districtSlugsFor({ district: 'Toàn bộ HCMC', location: '' })).toEqual([])
  })
})

describe('matchesProvince', () => {
  it('matches city or location, case-sensitively', () => {
    expect(matchesProvince({ city: 'Ho Chi Minh City', location: 'x' }, 'Ho Chi Minh City')).toBe(true)
    expect(matchesProvince({ city: 'x', location: 'Hanoi, Ba Dinh' }, 'Hanoi')).toBe(true)
    expect(matchesProvince({ city: 'hanoi', location: '' }, 'Hanoi')).toBe(false)
  })
})

describe('yearBands', () => {
  it('emits keys that are valid range_year params, newest first', () => {
    expect(yearBands(new Date('2026-08-11T00:00:00Z')).map((b) => b.key)).toEqual(['2022-2027', '2017-2021', '2012-2016', '1990-2011'])
  })

  it('never reaches below the year facet’s own slider domain', () => {
    for (const b of yearBands(new Date('2026-01-01T00:00:00Z'))) expect(b.min).toBeGreaterThanOrEqual(YEAR_BAND_MIN)
  })

  it('agrees with the taxonomy’s declared year range — the drift this constant can suffer', () => {
    const facet = rangeFacetsFor('vehicles').find((f) => f.range.column === 'year')
    expect(facet?.range.min).toBe(YEAR_BAND_MIN)
  })
})

describe('defaultDimensions', () => {
  it('counts the category, condition, type and area rails with no category chosen', () => {
    expect(defaultDimensions(new URLSearchParams())).toEqual(['category', 'condition', 'type', 'area'])
  })

  it('adds brand + year inside a brand category with a year facet, and model only once a brand is picked', () => {
    expect(defaultDimensions(new URLSearchParams({ category: 'vehicles' }))).toContain('brand')
    expect(defaultDimensions(new URLSearchParams({ category: 'vehicles' }))).toContain('year')
    expect(defaultDimensions(new URLSearchParams({ category: 'vehicles' }))).not.toContain('model')
    expect(defaultDimensions(new URLSearchParams({ category: 'vehicles', brand: 'honda' }))).toContain('model')
  })

  it('offers no brand rail where the catalogue has no brands', () => {
    expect(defaultDimensions(new URLSearchParams({ category: 'services' }))).not.toContain('brand')
  })

  it('leaves subcategory to the feed route, which already has that groupBy', () => {
    expect(defaultDimensions(new URLSearchParams({ category: 'vehicles' }))).not.toContain('subcategory')
  })
})

describe('computeFacetCounts', () => {
  const run = (query: Record<string, string>, dimensions?: string[]) =>
    computeFacetCounts({
      searchParams: new URLSearchParams(query),
      buildFilters,
      dimensions: dimensions as Parameters<typeof computeFacetCounts>[0]['dimensions'],
      now: new Date('2026-08-11T00:00:00Z'),
    })

  it('counts each dimension with the OTHERS applied and its own released', async () => {
    await run({ category: 'vehicles', brand: 'honda', condition: 'used', district: 'd1' }, ORDER)
    // The brand base still carries condition + district, and no longer carries brand.
    expect(paramsFor('brand')).toEqual({ category: 'vehicles', condition: 'used', district: 'd1' })
    // The condition base still carries brand.
    expect(paramsFor('condition')).toEqual({ category: 'vehicles', brand: 'honda', district: 'd1' })
  })

  it('wraps EVERY read in the marketplace scope, even though the builder never added it', async () => {
    // The builder fake deliberately never adds the desk exclusion, so this proves the module's own
    // guard rather than one inherited from the feed. An unscoped count puts the visa desk's e-Visa
    // SKUs into a chip total on the licensed sàn TMĐT.
    await run({ category: 'vehicles' }, ['category', 'condition', 'type', 'area'])
    expect(h.calls).toHaveLength(4)
    for (const c of h.calls) {
      expect((c.where as { AND: Prisma.ListingWhereInput[] }).AND[1]).toEqual({ sellerId: { notIn: ['desk-1'] } })
    }
  })

  it('adds no scope operand on the services edition, where the desk is allowed', async () => {
    h.scope = {}
    await run({}, ['condition'])
    expect(JSON.stringify(h.calls[0]!.where)).not.toContain('sellerId')
  })

  it('drops the free-text clause from every base', async () => {
    await run({ q: 'honda', category: 'vehicles' }, ['condition'])
    expect(baseOf(h.calls[0]!.where)).not.toContainEqual({ searchText: { contains: 'honda' } })
    expect(baseOf(h.calls[0]!.where)).toContainEqual({ category: 'vehicles' })
  })

  it('strips a text clause even if a builder produces one from something other than ?q=', async () => {
    // The belt-and-braces half: deleting `q` is what keeps the memo key small, but the module also
    // drops whatever the builder reports as its text filter, so a future keyword param cannot
    // quietly re-enter the counts.
    const text = { searchText: { contains: 'sneaky' } }
    await computeFacetCounts({
      searchParams: new URLSearchParams({ category: 'vehicles' }),
      buildFilters: async () => ({ andFilters: [{ status: 'active' }, text], pgTextFilter: text }),
      dimensions: ['condition'],
    })
    expect(baseOf(h.calls[0]!.where)).toEqual([{ status: 'active' }])
  })

  it('does not let the search box split the memo — every keystroke would be a fresh 6 aggregates', async () => {
    // Instant search debounces at 150ms, so typing "macbook" fires several distinct `q` values
    // whose count payloads are byte-identical (the counts ignore `q`). If `q` reached the cache
    // key, each one would miss the memo and pay for the whole fan-out.
    h.groups.condition = [{ condition: 'used', _count: { _all: 4 } }]
    const a = await run({ category: 'vehicles', q: 'mac' }, ['condition'])
    const b = await run({ category: 'vehicles', q: 'macbook' }, ['condition'])
    const c = await run({ category: 'vehicles' }, ['condition'])
    expect(h.calls).toHaveLength(1)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('coalesces concurrent requests asking the identical question into one fan-out', async () => {
    // The window a results cache cannot cover: nothing is cached until the first one finishes, so
    // without single-flight N simultaneous first-page requests each run their own six aggregates.
    h.groups.condition = [{ condition: 'used', _count: { _all: 4 } }]
    const [a, b, c] = await Promise.all([
      run({ category: 'vehicles' }, ['condition']),
      run({ category: 'vehicles' }, ['condition']),
      run({ category: 'vehicles' }, ['condition']),
    ])
    expect(h.calls).toHaveLength(1)
    expect(b).toBe(a) // the same frozen object, not three copies
    expect(c).toBe(a)
  })

  it('sheds counts rather than the feed when too many DIFFERENT questions are in flight', async () => {
    // `?priceMin=1,2,3…` are params the feed HONOURS, so each is a real miss the memo cannot
    // absorb. Past the ceiling this returns {} — chips lose their numbers, the pool keeps its
    // connections for the rows the user actually came for.
    h.groups.condition = [{ condition: 'used', _count: { _all: 4 } }]
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => run({ category: 'vehicles', priceMin: String(n) }, ['condition'])),
    )
    expect(h.calls.length).toBeLessThanOrEqual(4)
    expect(results.filter((r) => r.condition).length).toBeLessThanOrEqual(4)
    expect(results.filter((r) => !r.condition).length).toBeGreaterThan(0) // the shed ones
  })

  it('hands out a frozen payload, so one consumer cannot rewrite the cached answer for everyone', async () => {
    // A memo hit returns the SAME object, nested records and all. Without the freeze, a caller
    // tidying its own rail would silently rewrite what every other request gets for 60s.
    h.groups.condition = [{ condition: 'used', _count: { _all: 4 } }]
    const first = await run({ category: 'vehicles' }, ['condition'])
    expect(() => { (first.condition!.values as Record<string, number>).used = 999 }).toThrow(TypeError)
    const second = await run({ category: 'vehicles' }, ['condition'])
    expect(second.condition!.values.used).toBe(4)
  })

  it('cannot have its memo busted by a param the feed does not filter on', async () => {
    // The key is the `where` clauses, not the query string, so `?nocache=…` / `?utm_source=…` /
    // any unknown key produces the identical predicates and therefore the identical key. Keying on
    // the query string would make a six-aggregate cache miss available to anyone with a URL bar.
    h.groups.condition = [{ condition: 'used', _count: { _all: 4 } }]
    await run({ category: 'vehicles' }, ['condition'])
    await run({ category: 'vehicles', nocache: '1' }, ['condition'])
    await run({ category: 'vehicles', utm_source: 'fb', ref: 'x' }, ['condition'])
    expect(h.calls).toHaveLength(1)
  })

  it('still splits the memo on the selected brand, which shapes the model rail but no base', async () => {
    // brand is RELEASED from every base, so two brands in one category share their predicates —
    // and would share a cache entry, and the second would be served the first one's model rail.
    h.groups['brandSlug+model'] = [
      { brandSlug: 'honda', model: 'Wave', _count: { _all: 2 } },
      { brandSlug: 'yamaha', model: 'Sirius', _count: { _all: 4 } },
    ]
    const honda = await run({ category: 'vehicles', brand: 'honda' }, ['brand', 'model'])
    const yamaha = await run({ category: 'vehicles', brand: 'yamaha' }, ['brand', 'model'])
    expect(honda.model).toEqual({ all: 2, values: { Wave: 2 } })
    expect(yamaha.model).toEqual({ all: 4, values: { Sirius: 4 } })
  })

  it('reports the category rail with an honest zero for an empty category', async () => {
    h.groups.categoryId = [
      { categoryId: 'c-veh', _count: { _all: 5 } },
      { categoryId: 'c-ele', _count: { _all: 3 } },
    ]
    const out = await run({ category: 'vehicles' }, ['category'])
    // Seeded from the TAXONOMY, so every real category is a chip whether or not it holds stock…
    expect(out.category!.all).toBe(8)
    expect(Object.keys(out.category!.values).sort()).toEqual(Object.keys(CATEGORY_BY_SLUG).sort())
    expect(out.category!.values.vehicles).toBe(5)
    expect(out.category!.values.electronics).toBe(3)
    expect(out.category!.values.pets).toBe(0)
  })

  it('never invents a chip for a category that exists only in the database', async () => {
    // …and a row the taxonomy has never heard of gets its real count reported without being seeded
    // as an option. The seed is the canonical, edition-reviewed list; the database is not.
    h.groups.categoryId = [{ categoryId: 'c-ghost', _count: { _all: 4 } }]
    const out = await run({}, ['category'])
    expect(out.category!.all).toBe(4)
    expect(out.category!.values['ghost-category']).toBe(4) // counted, because the rows are real
    expect(out.category!.values.pets).toBe(0)
  })

  it('serves brand AND model from one groupBy, with model narrowed to the chosen brand', async () => {
    h.groups['brandSlug+model'] = [
      { brandSlug: 'honda', model: 'Wave', _count: { _all: 2 } },
      { brandSlug: 'honda', model: null, _count: { _all: 1 } },
      { brandSlug: 'yamaha', model: 'Sirius', _count: { _all: 4 } },
      { brandSlug: null, model: null, _count: { _all: 3 } },
    ]
    const out = await run({ category: 'vehicles', brand: 'honda' }, ['brand', 'model'])
    expect(h.calls).toHaveLength(1)
    // brand.all is what clearing the brand chip returns — including the 3 rows with no brand.
    expect(out.brand).toEqual({ all: 10, values: { honda: 3, yamaha: 4 } })
    // model.all is what clearing the MODEL chip returns while Honda stays selected.
    expect(out.model).toEqual({ all: 3, values: { Wave: 2 } })
  })

  it('omits the model rail until a brand is chosen', async () => {
    h.groups['brandSlug+model'] = [{ brandSlug: 'honda', model: 'Wave', _count: { _all: 2 } }]
    const out = await run({ category: 'vehicles' }, ['brand', 'model'])
    expect(out.brand).toBeDefined()
    expect(out.model).toBeUndefined()
  })

  it('buckets raw condition strings the way the filter does, and keeps unset rows in `all` only', async () => {
    h.groups.condition = [
      { condition: null, _count: { _all: 5 } },
      { condition: 'Like New', _count: { _all: 2 } },
      { condition: 'Mới', _count: { _all: 1 } },
      { condition: 'used', _count: { _all: 4 } },
      { condition: '', _count: { _all: 1 } },
    ]
    const out = await run({}, ['condition'])
    expect(out.condition).toEqual({ all: 13, values: { new: 3, used: 5 } })
  })

  it('seeds the intent rail so an intent with no inventory still shows an honest 0', async () => {
    h.groups.listingType = [{ listingType: 'sell', _count: { _all: 7 } }]
    const out = await run({}, ['type'])
    expect(out.type!.all).toBe(7)
    expect(out.type!.values.sell).toBe(7)
    expect(out.type!.values.rent).toBe(0)
  })

  it('narrows the intent SEED to the category’s own types', async () => {
    h.groups.listingType = [{ listingType: 'sell', _count: { _all: 7 } }]
    const out = await run({ category: 'vehicles' }, ['type'])
    // ⚠️ ASSERTED AGAINST typesFor, NOT A HARDCODED LIST. This used to read `toEqual(['sell'])`,
    // which pinned the CONTENTS of Vehicles rather than the behaviour under test — so adding the
    // Wanted and Wholesale intents in 2026-08 failed it for the one reason it was never about.
    // Derived, it still fails the moment the seed stops following the category.
    expect(Object.keys(out.type!.values).sort()).toEqual([...typesFor('vehicles')].sort())
    // ⛔ AND THE INVARIANT THE OLD ASSERTION WAS REALLY PROTECTING, now stated outright: Vehicles
    // is BUY-SELL-ONLY since rentals became its own category, so `rent` must never be seeded here.
    expect(Object.keys(out.type!.values)).not.toContain('rent')
  })

  it('still reports a stray intent the category no longer offers, rather than hiding the rows', async () => {
    // A legacy `rent` row left in Vehicles. Suppressing it would hide real inventory from a count
    // whose whole job is to be true, so it is reported — which is exactly why the rail must be
    // rendered from typesFor(category) and not from Object.keys(values). Pinned here because the
    // previous version of this test asserted the opposite by accident, on a mock with no such row.
    h.groups.listingType = [
      { listingType: 'sell', _count: { _all: 7 } },
      { listingType: 'rent', _count: { _all: 2 } },
    ]
    const out = await run({ category: 'vehicles' }, ['type'])
    expect(out.type!.all).toBe(9)
    // The stray row is REPORTED, which is the whole point — asserted on the two keys that carry
    // the claim rather than on the whole object, so a new seeded intent (which lands at 0) cannot
    // fail a test about legacy rows.
    expect(out.type!.values.sell).toBe(7)
    expect(out.type!.values.rent).toBe(2)
  })

  it('buckets years into the chips and leaves year-less rows out of every band', async () => {
    h.groups.year = [
      { year: null, _count: { _all: 6 } },
      { year: 2026, _count: { _all: 2 } },
      { year: 2015, _count: { _all: 3 } },
    ]
    const out = await run({ category: 'vehicles' }, ['year'])
    expect(out.year!.all).toBe(11) // clearing the year chip returns the year-less rows too
    expect(out.year!.values['2022-2027']).toBe(2)
    expect(out.year!.values['2012-2016']).toBe(3)
    expect(out.year!.values['2017-2021']).toBe(0)
  })

  it('counts districts across the district AND location columns from one groupBy', async () => {
    h.groups['district+location+city'] = [
      { district: 'Bình Thạnh', location: 'Bình Thạnh', city: 'Hồ Chí Minh', _count: { _all: 4 } },
      { district: null, location: 'Phú Mỹ Hưng', city: 'Ho Chi Minh City', _count: { _all: 2 } },
      { district: 'An Khánh', location: 'An Khánh', city: 'Hồ Chí Minh', _count: { _all: 9 } },
    ]
    const out = await run({}, ['area'])
    expect(out.area!.all).toBe(15) // every row, matched or not — that is what clearing the rail returns
    expect(out.area!.values['binh-thanh']).toBe(4)
    expect(out.area!.values.d7).toBe(2)
    expect(out.area!.values.d1).toBe(0)
  })

  it('counts only the province values the caller renders, since /api/geo owns that list', async () => {
    h.groups['district+location+city'] = [
      { district: null, location: 'x', city: 'Ho Chi Minh City', _count: { _all: 3 } },
      { district: null, location: 'x', city: 'Hanoi', _count: { _all: 2 } },
    ]
    const withOut = await run({}, ['area'])
    expect(withOut.province).toBeUndefined()
    const out = await computeFacetCounts({
      searchParams: new URLSearchParams(),
      buildFilters,
      dimensions: ['area'],
      provinceValues: ['Ho Chi Minh City', 'Hanoi', 'Da Nang'],
    })
    expect(out.province).toEqual({ all: 5, values: { 'Ho Chi Minh City': 3, Hanoi: 2, 'Da Nang': 0 } })
  })

  it('runs ONE aggregate per shared base, not one per rail', async () => {
    await run({ category: 'vehicles', brand: 'honda' }, ['category', 'brand', 'model', 'condition', 'type', 'year', 'area'])
    // seven rails, six queries: brand+model share a base, and the area rail answers district and
    // province from the same grouping.
    expect(h.calls).toHaveLength(6)
    expect(h.calls.map((c) => c.by.join('+'))).toEqual([
      'categoryId', 'brandSlug+model', 'condition', 'listingType', 'year', 'district+location+city',
    ])
  })

  it('serves an identical repeat question from the memo without touching the database', async () => {
    h.groups.condition = [{ condition: 'used', _count: { _all: 4 } }]
    const first = await run({ category: 'vehicles' }, ['condition'])
    const before = h.calls.length
    const second = await run({ category: 'vehicles' }, ['condition'])
    expect(h.calls).toHaveLength(before)
    expect(second).toEqual(first)
  })

  it('keys the memo on the filters, so a different chip set is a different answer', async () => {
    h.groups.condition = [{ condition: 'used', _count: { _all: 4 } }]
    await run({ category: 'vehicles' }, ['condition'])
    await run({ category: 'electronics' }, ['condition'])
    expect(h.calls).toHaveLength(2)
  })

  it('reads the category id→slug map once and reuses it', async () => {
    h.groups.categoryId = [{ categoryId: 'c-veh', _count: { _all: 1 } }]
    await run({ category: 'vehicles' }, ['category'])
    await run({ category: 'electronics' }, ['category'])
    expect(h.categoryCalls).toBe(1)
  })

  it('fails SOFT on a database error — the feed must not 500 over a chip label', async () => {
    h.throwOn = 'condition'
    await expect(run({}, ['condition'])).resolves.toEqual({})
  })

  it('does not cache a failure', async () => {
    h.throwOn = 'condition'
    await run({}, ['condition'])
    h.throwOn = null
    h.groups.condition = [{ condition: 'used', _count: { _all: 4 } }]
    const out = await run({}, ['condition'])
    expect(out.condition!.all).toBe(4)
  })

  it('still fails LOUD when the visa/trip desk cannot be resolved', async () => {
    // The one error that must not be swallowed: it means the exclusion could not be applied, and a
    // silently unfiltered marketplace is a licensing breach nobody notices.
    const boom = new (DeskResolutionError as new (m: string) => Error)('no desk seller could be resolved')
    await expect(
      computeFacetCounts({
        searchParams: new URLSearchParams(),
        buildFilters: async () => { throw boom },
        dimensions: ['condition'],
      }),
    ).rejects.toBe(boom)
  })
})
