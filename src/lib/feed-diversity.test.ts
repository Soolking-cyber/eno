import { describe, expect, it } from 'vitest'
import { mergeRoundRobin, diversifyBySeller, diversifyRail, diversityAppliesTo, DEFAULT_FEED_SORT, FEED_DIVERSITY_WINDOW, SHARED_SEAT_SELLERS, seatKey, sharedSeatsFor } from './feed-diversity'
import { JOB_SELLER_IDS } from './job-listing'
// The importer's own pinned storefront ids — the source of truth the feed's literal copy must equal.
import { VEHICLE_SELLER_IDS } from './vehicle-rental-listing'

/**
 * ⚠️ THE FIXTURE IS THE REAL PRODUCTION SHAPE, MEASURED 2026-08-13: 35 active listings, of which 14
 * were ONE partner's e-visa variants holding positions 0-13, and 21 were everything else. Every
 * assertion below is about that shape, so a future change that "passes the tests" has to keep
 * working for the case this was written for.
 */
const row = (id: string, sellerId: string | null) => ({ id, sellerId })

/** Fourteen from one seller first — exactly how rankScore ordered them on production. */
const PROD_SHAPE = [
  ...Array.from({ length: 14 }, (_, i) => row(`visa-${i}`, 'vietkite')),
  ...Array.from({ length: 21 }, (_, i) => row(`other-${i}`, `seller-${i}`)),
]

describe('the first screen stops being one catalogue', () => {
  it('breaks a 14-listing run so the first 12 are not all one seller', () => {
    const out = diversifyBySeller(PROD_SHAPE)
    const firstPage = out.slice(0, 12)
    const fromVietkite = firstPage.filter((r) => r.sellerId === 'vietkite').length
    // Before: 12 of 12. The round-robin gives that seller its best listing and then moves on.
    expect(fromVietkite).toBe(1)
    expect(new Set(firstPage.map((r) => r.sellerId)).size).toBe(12)
  })

  it('KEEPS every listing — this is an ordering, never a filter', () => {
    const out = diversifyBySeller(PROD_SHAPE)
    expect(out).toHaveLength(PROD_SHAPE.length)
    expect(new Set(out.map((r) => r.id))).toEqual(new Set(PROD_SHAPE.map((r) => r.id)))
  })

  it('leads with the seller whose BEST listing ranked highest — rank is not discarded', () => {
    // vietkite's best listing was rank 0, so it still leads the page.
    expect(diversifyBySeller(PROD_SHAPE)[0]!.id).toBe('visa-0')
  })

  it('preserves each seller relative order — a seller\'s own listings never reshuffle', () => {
    const mine = diversifyBySeller(PROD_SHAPE).filter((r) => r.sellerId === 'vietkite').map((r) => r.id)
    expect(mine).toEqual(Array.from({ length: 14 }, (_, i) => `visa-${i}`))
  })
})

describe('it is safe on the shapes that are not the problem', () => {
  it('returns a single-seller catalogue untouched — there is nothing to interleave', () => {
    const only = Array.from({ length: 8 }, (_, i) => row(`a-${i}`, 'solo'))
    expect(diversifyBySeller(only).map((r) => r.id)).toEqual(only.map((r) => r.id))
  })

  it('handles an already-diverse feed as a no-op', () => {
    const diverse = Array.from({ length: 10 }, (_, i) => row(`x-${i}`, `s-${i}`))
    expect(diversifyBySeller(diverse).map((r) => r.id)).toEqual(diverse.map((r) => r.id))
  })

  it('is a no-op below three rows', () => {
    expect(diversifyBySeller([row('a', 's'), row('b', 's')]).map((r) => r.id)).toEqual(['a', 'b'])
  })

  /**
   * ⚠️ Rows with no seller must NOT be pooled. Bucketing them together would invent exactly the
   * monopoly this function exists to break — a synthetic "no-seller" run taking consecutive slots.
   */
  it('treats seller-less rows as individuals, never as one group', () => {
    const mixed = [
      row('n-0', null), row('n-1', null), row('n-2', null),
      row('s-0', 'shop'), row('s-1', 'shop'),
    ]
    const out = diversifyBySeller(mixed)
    expect(out).toHaveLength(5)
    // The three unattributed rows keep their own slots; 'shop' contributes one per round.
    expect(out.slice(0, 4).filter((r) => r.sellerId === 'shop')).toHaveLength(1)
  })
})

describe('determinism — the SSR seed and the client feed must agree', () => {
  it('is a pure function: same input, same output, every time', () => {
    const a = diversifyBySeller(PROD_SHAPE).map((r) => r.id)
    const b = diversifyBySeller(PROD_SHAPE).map((r) => r.id)
    expect(a).toEqual(b)
  })

  it('does not mutate its input', () => {
    const input = [...PROD_SHAPE]
    const before = input.map((r) => r.id)
    diversifyBySeller(input)
    expect(input.map((r) => r.id)).toEqual(before)
  })

  /**
   * Pagination coherence: every page inside the window is a slice of ONE reordered sequence, so
   * consecutive pages neither repeat nor skip a listing. This is the property that lets the route
   * slice a reordered window instead of issuing skip/take.
   */
  it('paginates without duplicates or gaps inside the window', () => {
    const out = diversifyBySeller(PROD_SHAPE)
    const page1 = out.slice(0, 12).map((r) => r.id)
    const page2 = out.slice(12, 24).map((r) => r.id)
    const page3 = out.slice(24, 36).map((r) => r.id)
    const seen = [...page1, ...page2, ...page3]
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.length).toBe(PROD_SHAPE.length)
  })
})

describe('the window', () => {
  it('is five pages of twelve, so the reorder covers far more than anyone scrolls', () => {
    expect(FEED_DIVERSITY_WINDOW).toBe(60)
    expect(FEED_DIVERSITY_WINDOW % 12).toBe(0)
  })
})

/**
 * ⚠️ THE WINDOW EDGE — the case codex caught on review and the fixture above cannot reach.
 * The route slices a sequence of [diversified first WINDOW] ++ [natural tail]. A page straddling
 * the boundary must still come back FULL: a short page is read by the client as "feed exhausted",
 * and a client that advances by the requested limit instead skips the rows that were never sent.
 */
describe('pages that straddle the window edge', () => {
  const big = Array.from({ length: 90 }, (_, i) => row(`r-${i}`, i < 40 ? 'bulk' : `s-${i}`))
  /** Exactly what src/app/api/listings/route.ts builds. */
  const sequence = (rows: typeof big) => [
    ...diversifyBySeller(rows.slice(0, FEED_DIVERSITY_WINDOW)),
    ...rows.slice(FEED_DIVERSITY_WINDOW),
  ]

  it('returns a FULL page when the slice crosses the boundary', () => {
    const page = sequence(big).slice(55, 55 + 12)
    expect(page).toHaveLength(12)
  })

  it('covers every row exactly once across consecutive pages spanning the edge', () => {
    const seq = sequence(big)
    const seen: string[] = []
    for (let off = 0; off < big.length; off += 12) seen.push(...seq.slice(off, off + 12).map((r) => r.id))
    expect(seen).toHaveLength(big.length)
    expect(new Set(seen).size).toBe(big.length)
  })

  it('leaves the tail past the window in natural rank order', () => {
    const seq = sequence(big)
    expect(seq.slice(FEED_DIVERSITY_WINDOW).map((r) => r.id))
      .toEqual(big.slice(FEED_DIVERSITY_WINDOW).map((r) => r.id))
  })
})

describe('diversityAppliesTo', () => {
  // ⛔ THE REGRESSION. With a visa desk and a ticket partner in the catalogue, `sort=price-low`
  // returned 0, 30k, 790k, 50k, 1.24M, 60k, 1.32M, 100k on production (2026-08-24): two
  // individually-ascending lists zipped together by the seller round-robin. Every row was sorted
  // and the feed was not, so the cheapest listing sat in row 2.
  it('leaves an explicitly chosen order alone', () => {
    for (const sort of ['price-low', 'price-high', 'recent', 'popular']) {
      expect(diversityAppliesTo(sort)).toBe(false)
    }
  })

  it('still applies to the default blend, which is what it was built for', () => {
    expect(diversityAppliesTo(DEFAULT_FEED_SORT)).toBe(true)
    expect(DEFAULT_FEED_SORT).toBe('newest') // legacy name for the relevance blend, not "recent"
  })

  // An unknown string is what the route sees for a hand-typed or stale URL; the route resolves it
  // to the default, so anything that is not a known explicit sort must be treated as no preference.
  it('treats an unrecognised sort as no preference', () => {
    expect(diversityAppliesTo('')).toBe(false)
    expect(diversityAppliesTo('nonsense')).toBe(false)
  })
})

// A round-robin over rows a caller sorted by price is exactly the production failure, expressed
// as a unit: the mechanism is not wrong, applying it here is.
describe('the interaction the gate prevents', () => {
  it('demonstrates that diversifyBySeller destroys a price ordering', () => {
    const byPrice = [
      { id: 'a', sellerId: 's1', price: 30_000 },
      { id: 'b', sellerId: 's1', price: 50_000 },
      { id: 'c', sellerId: 's1', price: 60_000 },
      { id: 'd', sellerId: 's2', price: 790_000 },
      { id: 'e', sellerId: 's2', price: 1_240_000 },
      { id: 'f', sellerId: 's2', price: 1_320_000 },
    ]
    const out = diversifyBySeller(byPrice).map((r) => r.price)
    expect(out).toEqual([30_000, 790_000, 50_000, 1_240_000, 60_000, 1_320_000])
    // Sorted input, unsorted output — which is why the route must not call this on a price sort.
    expect(out).not.toEqual([...out].sort((x, y) => x - y))
  })
})

/**
 * ⛔ THE HALF `diversifyBySeller` CANNOT DO. It reorders a window it is HANDED, so when the top 60
 * by rankScore are all one seller it returns them untouched (`bySeller.size < 2`) and the front
 * page is one catalogue. Measured on production 2026-09-08: 10,215 listings, nine sellers, and all
 * 48 first-page cards from a single shop whose 152 imported rows shared an identical rankScore.
 * `mergeRoundRobin` is what turns per-seller fetches into an interleaved window.
 */
describe('mergeRoundRobin', () => {
  it('⛔ INTERLEAVES, so no seller can hold a run', () => {
    expect(mergeRoundRobin([['a1', 'a2', 'a3'], ['b1', 'b2'], ['c1']]))
      .toEqual(['a1', 'b1', 'c1', 'a2', 'b2', 'a3'])
  })

  // ⚠️ Group order is priority order: the strongest seller still leads the page.
  it('keeps the first group leading and preserves order within a group', () => {
    const out = mergeRoundRobin([['a1', 'a2'], ['b1', 'b2']])
    expect(out[0]).toBe('a1')
    expect(out.indexOf('a1')).toBeLessThan(out.indexOf('a2'))
    expect(out.indexOf('b1')).toBeLessThan(out.indexOf('b2'))
  })

  // A shallow seller stops appearing rather than leaving a hole in the feed.
  it('skips exhausted groups instead of leaving gaps', () => {
    expect(mergeRoundRobin([['a1'], ['b1', 'b2', 'b3']])).toEqual(['a1', 'b1', 'b2', 'b3'])
  })

  it('loses nothing and invents nothing', () => {
    const groups = [['a1', 'a2'], ['b1'], [], ['c1', 'c2', 'c3']]
    const out = mergeRoundRobin(groups)
    expect(out).toHaveLength(6)
    expect([...out].sort()).toEqual(['a1', 'a2', 'b1', 'c1', 'c2', 'c3'])
  })

  it('handles the empty and single-group cases', () => {
    expect(mergeRoundRobin([])).toEqual([])
    expect(mergeRoundRobin([[], []])).toEqual([])
    expect(mergeRoundRobin([['only']])).toEqual(['only'])
  })
})

/**
 * ⛔ SHARED SEATS — the shape measured on production 2026-09-25: nine carriers imported as nine
 * storefronts, 7 plans each, all tied at the top of the rank order, filling 18 of the first 24 cards.
 */
describe('a catalogue sold by many storefronts shares one seat', () => {
  const esim = (carrier: string, i: number) => ({ id: `${carrier}-${i}`, sellerId: carrier, subcategorySlug: 'esim' })
  const CARRIERS = ['fpt', 'local', 'vnsky', 'wintel', 'itel', 'vnm', 'mobi', 'vina', 'viettel']
  const SHAPE = [
    ...CARRIERS.flatMap((c) => Array.from({ length: 7 }, (_, i) => esim(c, i))),
    ...Array.from({ length: 20 }, (_, i) => ({ id: `other-${i}`, sellerId: `seller-${i}`, subcategorySlug: null })),
  ]

  it('WITHOUT the rule, nine carriers are nine seats — the flood', () => {
    const first = diversifyBySeller(SHAPE).slice(0, 24)
    expect(first.filter((r) => r.subcategorySlug === 'esim').length).toBeGreaterThanOrEqual(9)
  })

  it('WITH the rule, the catalogue takes one card per round', () => {
    const first = diversifyBySeller(SHAPE, { sharedSeats: true }).slice(0, 21)
    // 21 seats in round one: the catalogue's first row, then the twenty other sellers.
    expect(first.filter((r) => r.subcategorySlug === 'esim')).toHaveLength(1)
  })

  it('keeps every row — a reorder, never a cap', () => {
    const out = diversifyBySeller(SHAPE, { sharedSeats: true })
    expect(out).toHaveLength(SHAPE.length)
    expect(new Set(out.map((r) => r.id)).size).toBe(SHAPE.length)
  })

  it('is off inside the aisle itself, where the carriers ARE the variety', () => {
    expect(sharedSeatsFor('esim')).toBe(false)
    expect(sharedSeatsFor(null)).toBe(true)
    // Any other subcategory has no catalogue rows to collapse — the rule would only cost a query.
    expect(sharedSeatsFor('visa-legal')).toBe(false)
    expect(sharedSeatsFor(undefined)).toBe(true)
    const aisle = diversifyBySeller(SHAPE.filter((r) => r.subcategorySlug === 'esim'), { sharedSeats: sharedSeatsFor('esim') })
    expect(new Set(aisle.slice(0, 9).map((r) => r.sellerId)).size).toBe(9)
  })

  it('seats a row by its seller unless the rule is on AND the row is in a shared subcategory', () => {
    expect(seatKey({ id: 'a', sellerId: 's', subcategorySlug: 'esim' })).toBe('s')
    expect(seatKey({ id: 'a', sellerId: 's', subcategorySlug: 'esim' }, { sharedSeats: true })).toBe('__catalogue__esim')
    expect(seatKey({ id: 'a', sellerId: 's', subcategorySlug: 'visa-legal' }, { sharedSeats: true })).toBe('s')
    expect(seatKey({ id: 'a', sellerId: null }, { sharedSeats: true })).toBe('__no-seller__a')
  })
})

/**
 * ⛔ K-JOBS (2026-09-29): 7 of the first 12 home cards were linked jobs, one per board storefront.
 * The boards share ONE seat — keyed by SELLER, so a member's own job post keeps its own.
 */
describe('the job boards share one seat', () => {
  it('seats every board as one catalogue, only when the rule is on', () => {
    for (const id of JOB_SELLER_IDS) {
      expect(seatKey({ id: 'x', sellerId: id, subcategorySlug: 'teaching' }, { sharedSeats: true })).toBe('__catalogue__job-boards')
      expect(seatKey({ id: 'x', sellerId: id, subcategorySlug: 'teaching' })).toBe(id)
    }
    // A member's own teaching post is not a board: its seller is its seat.
    expect(seatKey({ id: 'x', sellerId: 'member-1', subcategorySlug: 'teaching' }, { sharedSeats: true })).toBe('member-1')
  })

  it('12 job rows from 6 boards plus 6 other sellers → at most one job in the first 7', () => {
    const boards = JOB_SELLER_IDS.slice(0, 6)
    const jobs = boards.flatMap((b) => [row(`${b}-0`, b), row(`${b}-1`, b)])
    const others = Array.from({ length: 6 }, (_, i) => row(`o${i}`, `seller-${i}`))
    const out = diversifyBySeller([...jobs, ...others], { sharedSeats: true })
    expect(out.slice(0, 7).filter((r) => JOB_SELLER_IDS.includes(r.sellerId!))).toHaveLength(1)
    expect(out).toHaveLength(18) // a round-robin, not a cap: every row is still in the feed
  })

  it('is off inside Jobs (the boards ARE the variety there) and inside any subcategory', () => {
    expect(sharedSeatsFor(null, 'jobs')).toBe(false)
    expect(sharedSeatsFor(null, null)).toBe(true)
    expect(sharedSeatsFor(null, 'services')).toBe(true)
    expect(sharedSeatsFor('esim', null)).toBe(false)
  })
})

/**
 * ⛔ home-01 (UX program 2, 2026-10-04): 0 of the first 12 home cards were used goods — the vehicle
 * import's seven storefronts took seven seats. They share ONE, keyed by SELLER (corrections: a member's
 * own car or motorbike for rent keeps its own seat).
 */
describe('the vehicle-rental storefronts share one seat', () => {
  it("seats exactly the importer's storefronts — the literal copy cannot drift from VEHICLE_SELLERS", () => {
    // feed-diversity.ts keeps the ids as a literal (importing the importer would load its tables into
    // every feed route); a storefront the importer adds must fail here until the copy has it too.
    expect([...SHARED_SEAT_SELLERS['vehicle-rentals']].sort()).toEqual([...VEHICLE_SELLER_IDS].sort())
    expect(VEHICLE_SELLER_IDS).toHaveLength(7)
    for (const id of VEHICLE_SELLER_IDS) expect(id).toMatch(/^vehicle-import-seller-/)
  })

  it('6 vehicle rentals from 6 storefronts take one seat', () => {
    const shops = VEHICLE_SELLER_IDS.slice(0, 6)
    const cars = shops.map((s, i) => ({ id: `v${i}`, sellerId: s, subcategorySlug: i % 2 ? 'motorbike-rental' : 'car-rental' }))
    const goods = Array.from({ length: 6 }, (_, i) => row(`g${i}`, `seller-${i}`))
    const out = diversifyBySeller([...cars, ...goods], { sharedSeats: true })
    // Round one is the vehicle seat's best card plus the six sellers: one vehicle in the first seven.
    expect(out.slice(0, 7).filter((r) => VEHICLE_SELLER_IDS.includes(r.sellerId!))).toHaveLength(1)
    expect(new Set(cars.map((r) => seatKey(r, { sharedSeats: true })))).toEqual(new Set(['__catalogue__vehicle-rentals']))
    expect(out).toHaveLength(12) // a round-robin, not a cap
  })

  it("a member's own car rental keeps its own seat, and the seat is off without the rule", () => {
    expect(seatKey({ id: 'm', sellerId: 'member-7', subcategorySlug: 'car-rental' }, { sharedSeats: true })).toBe('member-7')
    expect(seatKey({ id: 'x', sellerId: VEHICLE_SELLER_IDS[0], subcategorySlug: 'car-rental' })).toBe(VEHICLE_SELLER_IDS[0])
    // Inside the aisle itself every storefront is its own seat again.
    expect(sharedSeatsFor('car-rental', 'rentals')).toBe(false)
  })
})

/**
 * ⛔ K-VARIANTS (2026-09-29): the electronics rail was eight variants of one iPhone from one seller
 * under one cover photo. diversifyRail may DROP rows (a rail is a sample), unlike the feed.
 */
describe('diversifyRail', () => {
  /** A cover whose dHash is one hex digit repeated: any two different digits differ in ≥16 bits. */
  const H = (n: number) => `https://x.supabase.co/l/${n}-h${(n % 16).toString(16).repeat(16)}.webp`
  const SAME = 'https://x.supabase.co/l/a-hd8d6d6f4d6d6d6d4.webp'
  const rail = (id: string, sellerId: string, cover: string, model: string | null = null) =>
    ({ id, sellerId, images: [cover], brandSlug: model ? 'apple' : null, model })

  it('8 same-cover iPhones plus 4 others → one iPhone, first', () => {
    const phones = Array.from({ length: 8 }, (_, i) => rail(`p${i}`, 'shop', SAME, `iPhone 18 Pro ${i}`))
    const others = [rail('o1', 's1', H(1)), rail('o2', 's2', H(2)), rail('o3', 's3', H(3)), rail('o4', 's4', H(4))]
    const out = diversifyRail([...phones, ...others], { take: 8 })
    expect(out[0].id).toBe('p0')
    expect(out.filter((r) => r.id.startsWith('p'))).toHaveLength(1)
    expect(out).toHaveLength(5)
  })

  it('a one-seller rail of distinct covers stays full (no per-seat cap under three seats)', () => {
    const rows = Array.from({ length: 10 }, (_, i) => rail(`r${i}`, 'only', H(i)))
    expect(diversifyRail(rows, { take: 8 })).toHaveLength(8)
  })

  it('one card per (seller, model), at most two per seller once three sellers are in reach', () => {
    const rows = [
      rail('a1', 'a', H(1), 'Galaxy S25'), rail('a2', 'a', H(2), 'Galaxy S25'), rail('a3', 'a', H(3), 'Galaxy S24'),
      rail('a4', 'a', H(4), 'Galaxy S23'), rail('b1', 'b', H(5), null), rail('c1', 'c', H(6), null),
    ]
    const out = diversifyRail(rows, { take: 8 }).map((r) => r.id)
    expect(out).not.toContain('a2') // same seller, same model as a1
    expect(out.filter((id) => id.startsWith('a'))).toHaveLength(2)
  })

  it('modelScope "global" dedupes a model across sellers; interleave off keeps the given order', () => {
    const rows = [rail('x', 's1', H(1), 'iPhone 17'), rail('y', 's2', H(2), 'iPhone 17'), rail('z', 's1', H(3), 'iPhone 16')]
    expect(diversifyRail(rows, { take: 6, modelScope: 'global', interleave: false, perSeat: Infinity }).map((r) => r.id)).toEqual(['x', 'z'])
  })

  it('same input, same output', () => {
    const rows = Array.from({ length: 20 }, (_, i) => rail(`r${i}`, `s${i % 4}`, H(i), i % 3 ? `M${i % 5}` : null))
    expect(diversifyRail(rows, { take: 8 })).toEqual(diversifyRail(rows, { take: 8 }))
  })

  it('⛔ `min` is a floor: a pool that is one photo throughout keeps its rail, distinct rows first', () => {
    // One importer, one cover, one model: the rules alone keep a single card, and the home client
    // hides a rail under MIN_RAIL_ITEMS (3) — the category rail used to show eight.
    const same = Array.from({ length: 12 }, (_, i) => rail(`p${i}`, 'shop', SAME, 'iPhone 18 Pro'))
    expect(diversifyRail(same, { take: 8 })).toHaveLength(1)
    expect(diversifyRail(same, { take: 8, min: 4 }).map((r) => r.id)).toEqual(['p0', 'p1', 'p2', 'p3'])
    // The distinct rows lead and the repeats fill behind them, in rail order.
    const mixed = [...same.slice(0, 5), rail('o1', 'shop', H(1))]
    expect(diversifyRail(mixed, { take: 8, min: 4 }).map((r) => r.id)).toEqual(['p0', 'o1', 'p1', 'p2'])
    // A floor never overrides a rail that already clears it, and never exceeds `take`.
    const distinct = Array.from({ length: 10 }, (_, i) => rail(`r${i}`, 'only', H(i)))
    expect(diversifyRail(distinct, { take: 8, min: 4 })).toEqual(diversifyRail(distinct, { take: 8 }))
    expect(diversifyRail(same, { take: 2, min: 4 })).toHaveLength(2)
  })
})
