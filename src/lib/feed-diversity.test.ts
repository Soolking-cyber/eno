import { describe, expect, it } from 'vitest'
import { diversifyBySeller, FEED_DIVERSITY_WINDOW } from './feed-diversity'

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
