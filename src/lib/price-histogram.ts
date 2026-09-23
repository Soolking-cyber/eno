/**
 * THE PRICE HISTOGRAM — shared by the server (`GET /api/listings?histogram=1`) and the price panel
 * (`src/components/marketplace/price-range-filter.tsx`). Pure: no I/O, no React, no locale.
 *
 * ⚠️ WHY THIS EXISTS. The histogram endpoint used to return the matching prices themselves, capped
 * at 5,000 by `orderBy price asc take 5000` — a TRUNCATION TO THE CHEAPEST SLICE, not a sample. The
 * panel read `prices[0]`/`prices[last]` as the full range, so on any view with more than 5,000
 * matches the range stopped at the 5,000th-cheapest price, a typed max above it was clamped and
 * saved as "no max", the preset chips above it vanished and "{n} available" never passed 5,000.
 * Production (2026-09) holds 98,755 public listings spanning 0 → 1,450,000,000 VND, so the slice
 * was a small fraction of the catalogue. The server now aggregates EVERY matching price into the
 * bins defined here and ships only the bins.
 *
 * ## The bins
 * Edges are a "nice" log-spaced series — mantissas 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^k.
 * Log spacing because the distribution is: p10 75k, p50 431k, p90 22M, p99 170M — a linear axis
 * put nine tenths of the catalogue in its first bar. Nice numbers because every slider stop becomes
 * a URL value (`priceMin=500000`) and a label, and "487,213" is neither.
 *
 * ⚠️ PRICES ARE WHOLE VND, SO SO ARE THE EDGES. The mantissas 1.2, 1.5 and 2.5 are skipped in the
 * 1–10 decade, where they would be fractional — the filter parses `priceMin`/`priceMax` with
 * `parseInt`, so a fractional stop could not survive the round trip.
 *
 * ## Why `atEdge` exists (and the range is inclusive at BOTH ends)
 * Bin i holds prices in [edges[i], edges[i+1]) — half-open, with the LAST bin closed so the max is
 * counted. But the feed's price filter is `gte priceMin AND lte priceMax` — inclusive at both ends —
 * and the upper stop of a range is itself a nice number, which is exactly where real prices cluster
 * (500,000 and 1,000,000 are among the commonest prices on the site). Summing whole bins alone would
 * silently drop every listing priced exactly at the upper stop. `atEdge[k]` is the number of
 * listings priced exactly `edges[k]`, and it is what makes the count at every slider stop EXACT.
 */

/** The mantissas of one decade. */
const MANTISSAS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8] as const

export type PriceGroup = { price: number; count: number }

export type PriceHistogram = {
  /** Number of matching listings. */
  total: number
  /** Cheapest and dearest matching price (VND). 0/0 when nothing matches. */
  min: number
  max: number
  /** Bin boundaries, ascending. `edges.length - 1` bins; empty when nothing matches. */
  edges: number[]
  /** Listings per bin: [edges[i], edges[i+1]), the last bin inclusive of its upper edge. */
  counts: number[]
  /** Listings priced EXACTLY edges[k] — see the module header for why the range needs it. */
  atEdge: number[]
  /** Listings priced EXACTLY `min` / `max`. The extremes are rarely edges (1.45B sits inside the
   *  1.2B–1.5B bin), so without these a typed bound AT an extreme could only be pro-rated — and a
   *  min of exactly the dearest price pro-rated its one listing to "≈0" while the feed returned it. */
  atMin: number
  atMax: number
}

export const EMPTY_HISTOGRAM: PriceHistogram = Object.freeze({
  total: 0,
  min: 0,
  max: 0,
  edges: [],
  counts: [],
  atEdge: [],
  atMin: 0,
  atMax: 0,
}) as PriceHistogram

/** mantissa × 10^k without the binary noise (1.2 × 10^5 must be exactly 120000). */
function nice(k: number, i: number): number {
  return Number((MANTISSAS[i] * 10 ** k).toPrecision(12))
}

/** A nice value that a price can equal: whole numbers only (see the module header). */
function usable(v: number): boolean {
  return Number.isInteger(v)
}

/**
 * The nice log-spaced edges covering [min, max]: from the largest nice value ≤ max(min, 1) up to the
 * smallest nice value ≥ max, plus a leading 0 edge when min is below 1 (a free listing is priced 0,
 * and 0 has no place on a log axis). `min === max` → a single bin, [min, max].
 */
export function niceEdges(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  const lo = Math.max(0, Math.min(min, max))
  const hi = Math.max(0, Math.max(min, max))
  if (lo === hi) return [lo, hi]

  const start = Math.max(lo, 1)
  // Decade of `start`. log10 is inexact near powers of ten (log10(1000) = 2.9999999999999996),
  // so correct the guess against the real powers rather than trusting it.
  let k = Math.floor(Math.log10(start))
  if (10 ** (k + 1) <= start) k += 1
  if (10 ** k > start) k -= 1
  // Largest usable nice value ≤ start. 1 × 10^k ≤ start always holds, and 10^k is whole for k ≥ 0.
  let i = 0
  for (let j = 0; j < MANTISSAS.length; j++) {
    const v = nice(k, j)
    if (v <= start && usable(v)) i = j
  }

  const edges: number[] = lo < 1 ? [0] : []
  for (;;) {
    const v = nice(k, i)
    if (usable(v)) {
      edges.push(v)
      if (v >= hi) break
    }
    i += 1
    if (i === MANTISSAS.length) {
      i = 0
      k += 1
    }
  }
  return edges
}

/** Index of the bin a price falls in: [edges[i], edges[i+1]), last bin closed. Out-of-range
 *  prices clamp to the first/last bin so the counts always sum to the total. */
function binOf(edges: number[], price: number): number {
  const bins = edges.length - 1
  let a = 0
  let b = bins - 1
  if (price >= edges[bins - 1]) return bins - 1
  if (price < edges[1]) return 0
  // Largest i with edges[i] <= price.
  while (a < b) {
    const m = (a + b + 1) >> 1
    if (edges[m] <= price) a = m
    else b = m - 1
  }
  return a
}

/** Listings per bin for grouped prices. The last bin is inclusive of the top edge. */
export function binCounts(groups: PriceGroup[], edges: number[]): number[] {
  if (edges.length < 2) return []
  const counts = new Array<number>(edges.length - 1).fill(0)
  for (const g of groups) counts[binOf(edges, g.price)] += g.count
  return counts
}

/** Listings priced exactly at each edge. */
export function edgeCounts(groups: PriceGroup[], edges: number[]): number[] {
  const at = new Map<number, number>()
  for (const g of groups) at.set(g.price, (at.get(g.price) ?? 0) + g.count)
  return edges.map((e) => at.get(e) ?? 0)
}

/** The whole server-side aggregation: `groupBy price` rows in, the response body out. */
export function buildHistogram(groups: PriceGroup[]): PriceHistogram {
  const rows = groups.filter((g) => Number.isFinite(g.price) && g.count > 0)
  if (!rows.length) return { ...EMPTY_HISTOGRAM, edges: [], counts: [], atEdge: [] }
  let total = 0
  let min = Infinity
  let max = -Infinity
  for (const g of rows) {
    total += g.count
    if (g.price < min) min = g.price
    if (g.price > max) max = g.price
  }
  let atMin = 0
  let atMax = 0
  for (const g of rows) {
    if (g.price === min) atMin += g.count
    if (g.price === max) atMax += g.count
  }
  const edges = niceEdges(min, max)
  return { total, min, max, edges, counts: binCounts(rows, edges), atEdge: edgeCounts(rows, edges), atMin, atMax }
}

/** Index of `value` in `edges`, or -1 when it is not an edge. */
export function edgeIndex(edges: number[], value: number): number {
  return edges.indexOf(value)
}

/**
 * EXACT number of listings priced in [edges[i], edges[j]] (both inclusive, as the feed filters),
 * for edge indices i ≤ j — what the panel shows at a slider stop.
 */
export function countBetweenEdges(h: PriceHistogram, i: number, j: number): number {
  const bins = h.counts.length
  if (!bins || i > j) return 0
  if (i <= 0 && j >= bins) return h.total
  // Both stops on the LAST edge: [max edge, max edge] is exactly the listings priced at it. The loop
  // below would sum nothing (no bin starts there) and the atEdge term is skipped at the last edge.
  if (i >= bins) return h.atEdge[bins] ?? 0
  let n = 0
  for (let b = Math.max(0, i); b < Math.min(j, bins); b++) n += h.counts[b]
  // The upper stop's own point mass: it opens bin j, which the loop above did not sum. At the last
  // edge the closed last bin already holds it.
  if (j < bins) n += h.atEdge[j] ?? 0
  return n
}

/**
 * Listings priced in [lo, hi] (inclusive; `null` = open end), as the feed's `gte AND lte` counts
 * them. EXACT whenever the answer follows from what the histogram knows; otherwise the partly
 * covered bins are pro-rated and `exact` is false, so the panel can say "≈".
 *
 * WHAT THE HISTOGRAM KNOWS about bin i, [edges[i], edges[i+1]): its total, and three POINT MASSES
 * with exact counts — its opening edge (`atEdge[i]`), and the data's own `min` and `max` when they
 * fall in it (`atMin` / `atMax`). Only the REST of the bin — the listings at none of those prices,
 * all strictly between max(edge, min) and min(next edge, max) — has an unknown position, and only
 * the rest is ever pro-rated. So:
 *  · at every slider stop the rest of each bin is wholly in or wholly out → exact;
 *  · a bound AT the data's extreme is exact whether or not the extreme is an edge (a min of exactly
 *    the dearest price is that price's listings, never "≈0" pro-rated out of a 1.2B–1.5B bin);
 *  · a bound inside a bin whose only listings sit on its known points is exact too.
 */
export function countInRange(h: PriceHistogram, lo: number | null, hi: number | null): { count: number; exact: boolean } {
  // A non-finite bound (a malformed URL's NaN) is an open end, never a NaN count.
  const rawL = lo != null && Number.isFinite(lo) ? lo : -Infinity
  const rawH = hi != null && Number.isFinite(hi) ? hi : Infinity
  const bins = h.counts.length
  if (!bins || rawL > rawH) return { count: 0, exact: true }
  // Past the far end of the data nothing matches; at or short of the near end the bound cuts
  // nothing off, i.e. it counts exactly like an open end on that side.
  if (rawL > h.max || rawH < h.min) return { count: 0, exact: true }
  const L = rawL <= h.min ? -Infinity : rawL
  const H = rawH >= h.max ? Infinity : rawH
  let n = 0
  let exact = true
  for (let b = 0; b < bins; b++) {
    const count = h.counts[b]
    if (!count) continue
    const a = h.edges[b]
    const c = h.edges[b + 1]
    const last = b === bins - 1
    // The bin's known prices → their exact counts. A Map, because min (or max) can BE the opening
    // edge, and the same listings must not be counted twice.
    const holds = (p: number) => p >= a && (last ? p <= c : p < c)
    const points = new Map<number, number>([[a, h.atEdge[b] ?? 0]])
    if (holds(h.min)) points.set(h.min, h.atMin)
    if (holds(h.max)) points.set(h.max, h.atMax)
    let known = 0
    for (const [p, k] of points) {
      known += k
      if (p >= L && p <= H) n += k
    }
    const rest = count - known
    if (rest <= 0) continue
    // The rest lies strictly inside (s, e): above the edge and the data min, below the next edge
    // and the data max. Nonempty, so s < e.
    const s = Math.max(a, h.min)
    const e = Math.min(c, h.max)
    if (L <= s && H >= e) n += rest
    else if (H <= s || L >= e) continue
    else {
      n += (rest * (Math.min(H, e) - Math.max(L, s))) / (e - s)
      exact = false
    }
  }
  return { count: exact ? n : Math.round(n), exact }
}

/**
 * Validates a histogram response. Anything that is not the current shape — including the OLD
 * `{ prices }` shape an edge cache can still hold for a few minutes after a deploy — is `null`,
 * which the panel treats as "no histogram" rather than crashing on it.
 */
export function parseHistogram(body: unknown): PriceHistogram | null {
  if (!body || typeof body !== 'object') return null
  const d = body as Record<string, unknown>
  const nums = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x))
  const { total, min, max, edges, counts, atEdge, atMin, atMax } = d
  if (typeof total !== 'number' || typeof min !== 'number' || typeof max !== 'number') return null
  if (!nums(edges) || !nums(counts) || !nums(atEdge)) return null
  if (total === 0) return { ...EMPTY_HISTOGRAM, edges: [], counts: [], atEdge: [] }
  if (typeof atMin !== 'number' || typeof atMax !== 'number') return null
  if (edges.length < 2 || counts.length !== edges.length - 1 || atEdge.length !== edges.length) return null
  return { total, min, max, edges, counts, atEdge, atMin, atMax }
}

/**
 * Bars for the panel: one per bin, merging adjacent bins only when there are more than `maxBars`.
 * `span` is the number of bins a bar covers, so the bars stay aligned with the slider's stops
 * (the slider moves over edge INDICES, where every bin is the same width).
 */
export function histogramBars(h: PriceHistogram, maxBars = 60): { from: number; to: number; count: number; span: number }[] {
  const bins = h.counts.length
  if (!bins) return []
  const g = bins > maxBars ? Math.ceil(bins / maxBars) : 1
  const bars: { from: number; to: number; count: number; span: number }[] = []
  for (let b = 0; b < bins; b += g) {
    const end = Math.min(b + g, bins)
    let count = 0
    for (let x = b; x < end; x++) count += h.counts[x]
    bars.push({ from: b, to: end, count, span: end - b })
  }
  return bars
}

/**
 * Whether a bar is drawn as inside the selected range (`null` = open end). A bar covers
 * [edges[from], edges[to]) — half-open like its bins, the last one closed — and is lit when that
 * span overlaps [lo, hi] by MORE THAN A POINT: the lit bars are exactly the ones between the two
 * thumbs. ⚠️ The old test `edges[to] >= lo` lit the bar just BELOW a min set on a stop, whose
 * half-open span holds nothing ≥ lo. A zero-width range (lo === hi), or a zero-width bar (single-
 * price data, edges [p, p]), falls back to "does the bar hold that price".
 */
export function barInRange(edges: number[], bar: { from: number; to: number }, lo: number | null, hi: number | null): boolean {
  const L = lo != null && Number.isFinite(lo) ? lo : -Infinity
  const H = hi != null && Number.isFinite(hi) ? hi : Infinity
  if (L > H) return false
  const a = edges[bar.from]
  const c = edges[bar.to]
  const closed = bar.to === edges.length - 1
  if (a === c) return L <= a && a <= H
  if (L === H) return a <= L && (L < c || (closed && L === c))
  return a < H && c > L
}

/**
 * Params that shape the feed PAGE rather than its result set — plus the price range itself, the one
 * filter the histogram must NOT apply (the panel shows the market around the user's range).
 * `buildFeedFilters` reads none of the others into `where` (`verified` is ignored for public callers,
 * `priorityCategory` is a soft boost, `sort` an ORDER BY), so dropping them changes no count and lets
 * every sort order share one edge-cached histogram.
 */
const NOT_HISTOGRAM_FILTERS = ['priceMin', 'priceMax', 'sort', 'verified', 'lang', 'limit', 'offset', 'priorityCategory', 'facets']

/**
 * The histogram request for a feed request: the SAME params, minus the ones above.
 *
 * ⚠️ DERIVED FROM THE FEED'S PARAMS, NEVER REBUILT BESIDE THEM. The explorer used to assemble the
 * histogram query by hand next to the feed's, and the two drifted: with a brand picked it dropped
 * `subcategory` (the feed has sent it since the 2026-08-25 phone-cases fix) and it never sent
 * `match=any`, so "{n} available" described a different set than the grid under it. Same rule as
 * src/lib/facet-counts.ts: re-use the feed's own inputs, so whatever the feed filters on, this does.
 */
export function histogramQueryFrom(feedParams: string | URLSearchParams): string {
  const p = new URLSearchParams(feedParams)
  for (const k of NOT_HISTOGRAM_FILTERS) p.delete(k)
  p.set('histogram', '1')
  return p.toString()
}

/**
 * A price's position on the slider's index axis: an edge's own index, or a fractional position
 * between its two neighbours. Clamped to [0, edges.length - 1] — a URL-restored value outside the
 * data parks its thumb at the end without being rewritten.
 */
export function positionOf(edges: number[], value: number): number {
  const last = edges.length - 1
  if (last <= 0) return 0
  if (value <= edges[0]) return 0
  if (value >= edges[last]) return last
  const i = binOf(edges, value)
  const a = edges[i]
  const c = edges[i + 1]
  return c > a ? i + (value - a) / (c - a) : i
}
