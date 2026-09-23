import { describe, expect, it } from 'vitest'
import {
  barInRange,
  binCounts,
  buildHistogram,
  countBetweenEdges,
  countInRange,
  edgeIndex,
  histogramBars,
  histogramQueryFrom,
  niceEdges,
  parseHistogram,
  positionOf,
  type PriceGroup,
} from './price-histogram'

const NICE = /^(1|12|15|2|25|3|4|5|6|8)0*$/

function isNice(v: number) {
  return v === 0 || NICE.test(String(v))
}

describe('niceEdges', () => {
  it('starts with a 0 edge when min is 0, then climbs the nice series', () => {
    const e = niceEdges(0, 1_000)
    expect(e[0]).toBe(0)
    expect(e.slice(0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20])
    expect(e[e.length - 1]).toBe(1_000)
  })

  it('min === max is a single bin', () => {
    expect(niceEdges(450_000, 450_000)).toEqual([450_000, 450_000])
    expect(niceEdges(0, 0)).toEqual([0, 0])
  })

  it('a narrow range brackets min and max with nice values (9k..2.48M)', () => {
    const e = niceEdges(9_000, 2_480_000)
    expect(e[0]).toBe(8_000) // largest nice ≤ 9k
    expect(e[e.length - 1]).toBe(2_500_000) // smallest nice ≥ 2.48M
    expect(e.every(isNice)).toBe(true)
    expect(e).toContain(10_000)
    expect(e).toContain(1_200_000)
  })

  it('the production range 0..1.45B stays small, whole and ascending', () => {
    const e = niceEdges(0, 1_450_000_000)
    expect(e[0]).toBe(0)
    expect(e[1]).toBe(1)
    expect(e[e.length - 1]).toBe(1_500_000_000)
    expect(e.length).toBeLessThan(100)
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeGreaterThan(e[i - 1])
    expect(e.every(Number.isInteger)).toBe(true)
    expect(e.every(isNice)).toBe(true)
    // No binary noise: 1.2 × 10^5 is exactly 120000.
    expect(e).toContain(120_000)
  })

  it('an exact nice min and max are edges themselves', () => {
    expect(niceEdges(1_000, 2_000)).toEqual([1_000, 1_200, 1_500, 2_000])
    expect(niceEdges(1_000_000, 10_000_000)[0]).toBe(1_000_000)
  })
})

const GROUPS: PriceGroup[] = [
  { price: 0, count: 2 },
  { price: 24_000, count: 5 },
  { price: 500_000, count: 40 }, // a nice price — exactly an edge
  { price: 431_000, count: 7 },
  { price: 1_000_000, count: 30 },
  { price: 22_000_000, count: 4 },
  { price: 1_450_000_000, count: 1 },
]
const TOTAL = GROUPS.reduce((s, g) => s + g.count, 0)

describe('binCounts / buildHistogram', () => {
  it('counts sum to the total and min/max are the real extremes', () => {
    const h = buildHistogram(GROUPS)
    expect(h.total).toBe(TOTAL)
    expect(h.min).toBe(0)
    expect(h.max).toBe(1_450_000_000)
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(TOTAL)
    expect(h.counts).toHaveLength(h.edges.length - 1)
    expect(h.atEdge).toHaveLength(h.edges.length)
  })

  it('the last bin is inclusive of the max', () => {
    const edges = [0, 10, 20]
    expect(binCounts([{ price: 20, count: 3 }, { price: 10, count: 1 }, { price: 9, count: 2 }], edges)).toEqual([2, 4])
  })

  it('an interior edge opens its bin (half-open bins)', () => {
    const h = buildHistogram(GROUPS)
    const i = edgeIndex(h.edges, 500_000)
    expect(i).toBeGreaterThan(0)
    expect(h.counts[i]).toBe(40)
    expect(h.atEdge[i]).toBe(40)
  })

  it('carries the exact count at the data min and max, which are usually not edges', () => {
    const h = buildHistogram([...GROUPS, { price: 1_450_000_000, count: 2 }])
    expect(h.atMin).toBe(2) // the free listings
    expect(h.atMax).toBe(3) // 1 + 2 at 1.45B — duplicate groups are summed
    expect(edgeIndex(h.edges, h.max)).toBe(-1)
  })

  it('single price → one bin holding everything', () => {
    const h = buildHistogram([{ price: 300_000, count: 9 }])
    expect(h.edges).toEqual([300_000, 300_000])
    expect(h.counts).toEqual([9])
    expect(countBetweenEdges(h, 0, 1)).toBe(9)
    expect(countInRange(h, null, null)).toEqual({ count: 9, exact: true })
  })

  it('no rows → the empty histogram, not a crash', () => {
    expect(buildHistogram([])).toEqual({ total: 0, min: 0, max: 0, edges: [], counts: [], atEdge: [], atMin: 0, atMax: 0 })
  })
})

describe('counting a range', () => {
  const h = buildHistogram(GROUPS)
  const at = (v: number) => {
    const i = edgeIndex(h.edges, v)
    if (i < 0) throw new Error(`${v} is not an edge`)
    return i
  }
  /** Brute force over the raw groups — the feed's `gte AND lte`. */
  const truth = (lo: number, hi: number) => GROUPS.filter((g) => g.price >= lo && g.price <= hi).reduce((s, g) => s + g.count, 0)

  it('is EXACT at every pair of slider stops, including prices sitting on the upper stop', () => {
    for (let i = 0; i < h.edges.length; i++) {
      for (let j = i; j < h.edges.length; j++) {
        expect(countBetweenEdges(h, i, j)).toBe(truth(h.edges[i], h.edges[j]))
        expect(countInRange(h, h.edges[i], h.edges[j])).toEqual({ count: truth(h.edges[i], h.edges[j]), exact: true })
      }
    }
  })

  it('full range = total', () => {
    expect(countBetweenEdges(h, 0, h.edges.length - 1)).toBe(TOTAL)
    expect(countInRange(h, null, null)).toEqual({ count: TOTAL, exact: true })
  })

  it('the 500k listings are counted in "up to 500k"', () => {
    expect(countBetweenEdges(h, 0, at(500_000))).toBe(2 + 5 + 7 + 40)
  })

  it('a typed value off the edges is an estimate', () => {
    const r = countInRange(h, 450_000, null)
    expect(r.exact).toBe(false)
    expect(r.count).toBeGreaterThanOrEqual(truth(500_000, Infinity))
    expect(r.count).toBeLessThanOrEqual(truth(400_000, Infinity))
  })

  it('a typed value off the edges in an EMPTY bin is still exact', () => {
    expect(countInRange(h, 3_300_000, null)).toEqual({ count: truth(3_300_000, Infinity), exact: true })
  })

  it('is EXACT at every pair of stops when the max is itself an edge, and when min === max', () => {
    const cases: PriceGroup[][] = [
      [{ price: 9_000, count: 1 }, { price: 1_500_000, count: 4 }],
      [{ price: 500_000, count: 3 }],
      [{ price: 0, count: 2 }, { price: 1_000, count: 5 }],
    ]
    for (const groups of cases) {
      const hh = buildHistogram(groups)
      const t = (lo: number, hi: number) => groups.filter((g) => g.price >= lo && g.price <= hi).reduce((s, g) => s + g.count, 0)
      for (let i = 0; i < hh.edges.length; i++) {
        for (let j = i; j < hh.edges.length; j++) {
          expect(countBetweenEdges(hh, i, j)).toBe(t(hh.edges[i], hh.edges[j]))
          expect(countInRange(hh, hh.edges[i], hh.edges[j])).toEqual({ count: t(hh.edges[i], hh.edges[j]), exact: true })
        }
      }
    }
  })

  it('a typed bound beyond the data min/max is EXACT, not pro-rated', () => {
    const groups: PriceGroup[] = [{ price: 9_000, count: 10 }, { price: 300_000, count: 50 }, { price: 2_480_000, count: 5 }]
    const hh = buildHistogram(groups)
    expect(hh.edges[0]).toBe(8_000)
    // 8,500 is below the cheapest listing: it cuts nothing off.
    expect(countInRange(hh, 8_500, null)).toEqual({ count: 65, exact: true })
    // 2,490,000 is above the dearest: it keeps everything…
    expect(countInRange(hh, null, 2_490_000)).toEqual({ count: 65, exact: true })
    // …and as a MIN it keeps nothing, though it cuts the last (non-empty) bin.
    expect(countInRange(hh, 2_490_000, null)).toEqual({ count: 0, exact: true })
    expect(countInRange(hh, null, 8_500)).toEqual({ count: 0, exact: true })
  })

  /**
   * Finding: a typed bound EQUAL to a data extreme that is not an edge was pro-rated. The dearest
   * listing is 1,450,000,000 inside the 1.2B–1.5B bin; a min of exactly 1,450,000,000 pro-rated that
   * bin's one listing to 0.17 and printed "≈0 available" while the feed's `gte` returns it.
   */
  it('a bound AT a data extreme that is not an edge is EXACT, not pro-rated to ≈0', () => {
    expect(edgeIndex(h.edges, 1_450_000_000)).toBe(-1)
    expect(countInRange(h, 1_450_000_000, null)).toEqual({ count: 1, exact: true })
    expect(countInRange(h, 1_450_000_000, 1_450_000_000)).toEqual({ count: 1, exact: true })
    // Anywhere inside the last bin, the only listing there is the max itself: still exact.
    expect(countInRange(h, 1_300_000_000, null)).toEqual({ count: 1, exact: true })
    // The same at the bottom: cheapest 9,000 inside the 8k–10k bin.
    const groups: PriceGroup[] = [{ price: 9_000, count: 10 }, { price: 300_000, count: 50 }, { price: 2_480_000, count: 5 }]
    const hh = buildHistogram(groups)
    expect(edgeIndex(hh.edges, 9_000)).toBe(-1)
    expect(countInRange(hh, null, 9_000)).toEqual({ count: 10, exact: true })
    expect(countInRange(hh, 2_480_000, null)).toEqual({ count: 5, exact: true })
  })

  /**
   * The contract, checked by brute force: whenever the panel shows a count WITHOUT "≈", it is the
   * feed's `gte lo AND lte hi` count to the listing. Bounds are drawn from every edge, every price,
   * each price ± 1, the data extremes and points inside every bin — the places a special case hides.
   */
  it('an exact count is ALWAYS the true count (brute force over edges, prices and neighbours)', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const shapes: PriceGroup[][] = [GROUPS]
    for (let s = 0; s < 12; s++) {
      const n = 1 + Math.floor(rnd() * 8)
      const g: PriceGroup[] = []
      for (let i = 0; i < n; i++) g.push({ price: Math.floor(rnd() ** 3 * 2_000_000_000), count: 1 + Math.floor(rnd() * 5) })
      shapes.push(g)
    }
    shapes.push([{ price: 500_000, count: 3 }], [{ price: 0, count: 4 }, { price: 1, count: 1 }])
    for (const groups of shapes) {
      const hh = buildHistogram(groups)
      const t = (lo: number | null, hi: number | null) =>
        groups.filter((g) => g.price >= (lo ?? -Infinity) && g.price <= (hi ?? Infinity)).reduce((s, g) => s + g.count, 0)
      const pts = new Set<number>([...hh.edges, hh.min, hh.max])
      for (const g of groups) [g.price - 1, g.price, g.price + 1].forEach((v) => pts.add(Math.max(0, v)))
      for (let b = 0; b + 1 < hh.edges.length; b++) pts.add(Math.floor((hh.edges[b] + hh.edges[b + 1]) / 2))
      const bounds: (number | null)[] = [null, ...pts]
      // Collected, not asserted per pair: ~60k pairs of `expect` is seconds of pure matcher overhead.
      const wrong: string[] = []
      for (const lo of bounds) {
        for (const hi of bounds) {
          const r = countInRange(hh, lo, hi)
          if (r.exact && r.count !== t(lo, hi)) wrong.push(`[${lo}, ${hi}] → ${r.count}, truth ${t(lo, hi)}`)
        }
      }
      expect(wrong, JSON.stringify(groups)).toEqual([])
    }
  })

  it('a non-finite bound is an open end, never a NaN count', () => {
    expect(countInRange(h, Number.NaN, null)).toEqual({ count: TOTAL, exact: true })
  })

  it('values beyond the data are exact and are not clamped away', () => {
    expect(countInRange(h, null, 2_000_000_000)).toEqual({ count: TOTAL, exact: true })
    expect(countInRange(h, 2_000_000_000, null)).toEqual({ count: 0, exact: true })
    expect(countInRange(h, 5, 1)).toEqual({ count: 0, exact: true })
  })
})

describe('parseHistogram', () => {
  it('accepts the current shape', () => {
    const h = buildHistogram(GROUPS)
    expect(parseHistogram(JSON.parse(JSON.stringify(h)))).toEqual(h)
  })

  it('treats the OLD cached `{ prices }` shape and garbage as no histogram', () => {
    expect(parseHistogram({ prices: [1, 2, 3] })).toBeNull()
    expect(parseHistogram(null)).toBeNull()
    expect(parseHistogram('x')).toBeNull()
    expect(parseHistogram({ total: 3, min: 0, max: 1, edges: [0, 1], counts: [1, 2], atEdge: [0, 0] })).toBeNull()
  })

  it('a body without the exact min/max counts is not the current shape', () => {
    const { atMin: _a, atMax: _b, ...rest } = buildHistogram(GROUPS)
    expect(parseHistogram(JSON.parse(JSON.stringify(rest)))).toBeNull()
  })

  it('zero matches parse to an empty histogram', () => {
    expect(parseHistogram({ total: 0, min: 0, max: 0, edges: [], counts: [], atEdge: [] })?.total).toBe(0)
  })
})

describe('bars and positions', () => {
  it('one bar per bin up to the cap, then merged — bars cover every bin once', () => {
    const small = buildHistogram([{ price: 10_000, count: 1 }, { price: 90_000, count: 1 }])
    expect(histogramBars(small)).toHaveLength(small.counts.length)
    const big = buildHistogram(GROUPS)
    expect(big.counts.length).toBeGreaterThan(60)
    const bars = histogramBars(big)
    expect(bars.length).toBeLessThanOrEqual(60)
    expect(bars.reduce((s, b) => s + b.span, 0)).toBe(big.counts.length)
    expect(bars.reduce((s, b) => s + b.count, 0)).toBe(TOTAL)
  })

  /**
   * Finding: the lit test `edges[to] >= lo && edges[from] <= hi` lit the bar just BELOW a min set
   * on a stop — a half-open [e_i, e_i+1) span holds nothing ≥ e_i+1 — and the bar just above a max.
   */
  describe('barInRange — the lit bars are exactly the ones between the thumbs', () => {
    const e = [0, 10, 20, 40, 80]
    const bars = [0, 1, 2, 3].map((i) => ({ from: i, to: i + 1 }))
    const lit = (lo: number | null, hi: number | null) => bars.filter((b) => barInRange(e, b, lo, hi)).map((b) => b.from)

    it('a min ON a stop does not light the bar below it; a max on a stop not the one above', () => {
      expect(lit(20, null)).toEqual([2, 3])
      expect(lit(null, 20)).toEqual([0, 1])
      expect(lit(10, 40)).toEqual([1, 2])
    })

    it('a bound between stops lights the bar it cuts', () => {
      expect(lit(15, null)).toEqual([1, 2, 3])
      expect(lit(null, 25)).toEqual([0, 1, 2])
    })

    it('open, inverted and zero-width ranges', () => {
      expect(lit(null, null)).toEqual([0, 1, 2, 3])
      expect(lit(30, 20)).toEqual([])
      expect(lit(20, 20)).toEqual([2]) // the bar HOLDING 20 — half-open, it opens there
      expect(lit(80, 80)).toEqual([3]) // the closed last bar holds its top edge
      expect(lit(200, null)).toEqual([])
    })

    it('a merged bar and a single-price (zero-width) bar', () => {
      expect(barInRange(e, { from: 0, to: 2 }, 20, null)).toBe(false)
      expect(barInRange(e, { from: 0, to: 2 }, 19, null)).toBe(true)
      expect(barInRange([5, 5], { from: 0, to: 1 }, 5, null)).toBe(true)
      expect(barInRange([5, 5], { from: 0, to: 1 }, 6, null)).toBe(false)
    })
  })

  it('positionOf maps edges to their index and clamps outside values', () => {
    const e = [0, 10, 20, 40]
    expect(positionOf(e, 20)).toBe(2)
    expect(positionOf(e, 30)).toBe(2.5)
    expect(positionOf(e, -5)).toBe(0)
    expect(positionOf(e, 99)).toBe(3)
  })
})

/**
 * Finding: the histogram must describe EXACTLY the set the feed returns, minus the price range.
 * The server side of that already held (`where` IS `{ AND: andFilters }`, text and subcategory
 * clauses included) — the drift was in the CLIENT, which rebuilt the histogram's params by hand.
 * feed-query.histogram.test.ts proves the resulting `where` clauses match through the real builder.
 */
describe('histogramQueryFrom', () => {
  it('keeps every filter the feed sends and drops price, sort, paging and presentation', () => {
    const feed = new URLSearchParams({
      subcategory: 'phone-cases', brand: 'apple', model: 'iPhone 16 Pro Max', category: 'electronics',
      q: 'case', match: 'any', district: 'd1', condition: 'new', deal: 'good', type: 'sell',
      attr_color: 'black', range_year: '2020-', building: 'vinhomes', seller: 's1',
      priceMin: '100000', priceMax: '500000', sort: 'price-low', verified: 'all', lang: 'ko',
      limit: '24', offset: '48', priorityCategory: 'electronics',
    })
    const got = new URLSearchParams(histogramQueryFrom(feed))
    expect(got.get('histogram')).toBe('1')
    for (const k of ['subcategory', 'brand', 'model', 'category', 'q', 'match', 'district', 'condition', 'deal', 'type', 'attr_color', 'range_year', 'building', 'seller']) {
      expect(got.get(k), k).toBe(feed.get(k))
    }
    for (const k of ['priceMin', 'priceMax', 'sort', 'verified', 'lang', 'limit', 'offset', 'priorityCategory']) expect(got.has(k), k).toBe(false)
  })

  it('does not mutate the params it is given', () => {
    const feed = new URLSearchParams('priceMin=1&q=x')
    histogramQueryFrom(feed)
    expect(feed.toString()).toBe('priceMin=1&q=x')
  })
})
