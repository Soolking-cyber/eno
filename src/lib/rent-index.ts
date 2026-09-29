import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { districtTextMatches } from '@/lib/district-match'
import { MONTHLY_BARE_VND_SELLERS, MONTHLY_UNIT } from '@/lib/price-unit'

/**
 * THE HCMC RENT INDEX — median asking rent by district × property type, computed from the rentals
 * category. Pure: rows in, statistics out. The Prisma read lives beside the page
 * (src/app/[lang]/hcmc-rent-index/load-rent-index.ts) so this file can be unit-tested and so the
 * page and the CSV cannot compute the numbers two different ways.
 *
 * ⛔ THE PAGE EXISTS TO BE CITED, SO EVERY RULE BELOW IS ALSO PUBLISHED. A journalist quoting "the
 * median two-bedroom in District 7" will be asked where the number came from; the methodology section
 * renders these constants and the exclusion counts this function returns, so the published rules and
 * the applied rules are the same values rather than a paragraph that drifts from the code.
 *
 * ⚠️ WHAT THE ROWS ARE, MEASURED (2026-09-27): ~25,500 live rentals, every one in Hồ Chí Minh, from
 * five imported sources plus whatever members post. Asking prices, not signed leases.
 */

/** Bump when a rule changes: it is part of the cache key, so an old snapshot is never served under new rules. */
export const RENT_INDEX_RULES_VERSION = 2

/** A cell below this many listings prints "—" and its count, never a median of three. */
export const MIN_CELL_N = 10

/**
 * ⚠️ THE BAND IS FOR A HOME, NOT FOR WHAT THE IMPORTERS ACCEPT. Batdongsan and Rever keep 1M–2B ₫
 * (scripts/import-*-rentals.ts) because offices and whole buildings live in the same feed; this index
 * covers apartments, houses and rooms only, where under 1M ₫ a month is a typo or a deposit and over
 * 500M ₫ is a whole building, a commercial lease or a sale price entered as rent. Rows outside are
 * counted in `excluded` and the counts are published, so the band's effect is visible rather than
 * asserted.
 */
export const MIN_MONTHLY_VND = 1_000_000
export const MAX_MONTHLY_VND = 500_000_000

/**
 * ⚠️ ₫/m² IS COMPUTED ONLY FROM AN AREA THAT LOOKS LIKE A FLOOR AREA. Batdongsan's area needed a
 * 1000× dot-separator repair at import, and some house listings quote the LAND area — either makes
 * ₫/m² nonsense while the monthly rent itself is fine. So an implausible area never drops the row,
 * it only keeps it out of the ₫/m² figure: 5–2,000 m², and 10,000–2,000,000 ₫ per m² per month
 * (the top of HCMC's serviced-apartment market is well under 1M ₫/m²; under 10k ₫/m² is a plot of
 * land, not a floor).
 */
export const MIN_AREA_M2 = 5
export const MAX_AREA_M2 = 2_000
export const MIN_VND_PER_M2 = 10_000
export const MAX_VND_PER_M2 = 2_000_000

/**
 * ⛔ A BARE "VND" UNIT IS A MONTHLY RENT ONLY FROM TWO SELLERS — the set and its evidence now live in
 * src/lib/price-unit.ts (MONTHLY_BARE_VND_SELLERS), where the card's DISPLAY rule reads the same one
 * (displayPriceUnit). Re-exported here unchanged: the rule did not change, only where it is written,
 * so RENT_INDEX_RULES_VERSION does not move.
 */
export { MONTHLY_BARE_VND_SELLERS, MONTHLY_UNIT }

/**
 * ⛔ NO PER-SOURCE NUMBERS ARE PUBLISHED (owner, 2026-09-27). The page names the sources in aggregate
 * in its methodology and nowhere breaks a figure down by them — not on the page, not in the CSV. So
 * nothing here groups by seller; `sellerId` is read for one purpose only, the cross-seller duplicate
 * rule below.
 */

/**
 * Whether a row's price is quoted per month: the explicit unit, or a bare 'VND' from one of the two
 * sellers proven (price-unit.ts) to store monthly rent without the suffix. The UNIT rule only — the index
 * still checks listing type and currency itself. A bare 'month', which `<Price>` does print as
 * "/ month", is not accepted; production stores none (only the CI fixture `ci-l-4`, a sale).
 * ⛔ THIS IS AN INDEX RULE, SO CHANGING IT BUMPS `RENT_INDEX_RULES_VERSION`. Exported so any other
 * code asking "is this price per month?" imports the rule instead of restating the seller list.
 */
export function isMonthlyRent(priceUnit: string | null, sellerId: string): boolean {
  return priceUnit === MONTHLY_UNIT || (priceUnit === 'VND' && MONTHLY_BARE_VND_SELLERS.has(sellerId))
}

export const RENT_TYPES = ['apartment', 'house', 'room'] as const
export type RentType = (typeof RENT_TYPES)[number]

/**
 * ⚠️ OFFICES ARE LEFT OUT, NOT FOLDED IN. `office-rental` is 2,270 rows priced per floor plate for a
 * business; mixed into "house" or reported beside homes it would answer a question nobody reading a
 * rent index is asking. The rentals category also carries vehicle hire and nightly stays, which the
 * same map excludes.
 */
const TYPE_OF: Record<string, RentType> = {
  'apartment-rental': 'apartment',
  'house-rental': 'house',
  'room-rental': 'room',
}

export type RentRow = {
  price: number
  priceUnit: string | null
  currency: string | null
  listingType: string | null
  subcategorySlug: string | null
  district: string | null
  areaM2: number | null
  sellerId: string
}

export type ExclusionReason =
  | 'notResidential'
  | 'notForRent'
  | 'currency'
  | 'unit'
  | 'belowBand'
  | 'aboveBand'
  | 'crossPosted'

export type Stats = {
  n: number
  /** Present only when n ≥ MIN_CELL_N. Whole đồng. */
  median: number | null
  p25: number | null
  p75: number | null
  /** Listings with a usable floor area. */
  nArea: number
  /** Present only when nArea ≥ MIN_CELL_N. Whole đồng per m² per month. */
  medianPerM2: number | null
}

export type DistrictRow = {
  slug: string
  name: string
  nameEn: string
  /** 'thu-duc' for d2/d9: those rows are ALSO inside the Thủ Đức umbrella row, so summing n double-counts. */
  partOf: string | null
  /** Listings assigned to this district across all three types — > 0 means /c/rentals/<slug> is non-empty. */
  total: number
  cells: Record<RentType, Stats>
}

export type RentIndex = {
  rulesVersion: number
  /** ISO timestamp of the snapshot — the page and the CSV both print it. */
  computedAt: string
  /** Rows read from the database before any rule. */
  read: number
  /** Rows the statistics are computed from. */
  used: number
  excluded: Record<ExclusionReason, number>
  cityWide: Record<RentType, Stats>
  districts: DistrictRow[]
  /** Used rows whose district matched no curated district, or more than one. City-wide only. */
  unassigned: number
}

/** Type-7 (linear interpolation) quantile of an ascending array — what R, NumPy and Excel's PERCENTILE.INC use. */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const h = (sorted.length - 1) * p
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

type Used = { type: RentType; price: number; perM2: number | null; district: string | null; sellerId: string }

function stats(rows: Used[]): Stats {
  const prices = rows.map((r) => r.price).sort((a, b) => a - b)
  const perM2 = rows.map((r) => r.perM2).filter((v): v is number => v !== null).sort((a, b) => a - b)
  const enough = prices.length >= MIN_CELL_N
  return {
    n: prices.length,
    median: enough ? Math.round(quantile(prices, 0.5)) : null,
    p25: enough ? Math.round(quantile(prices, 0.25)) : null,
    p75: enough ? Math.round(quantile(prices, 0.75)) : null,
    nArea: perM2.length,
    medianPerM2: perM2.length >= MIN_CELL_N ? Math.round(quantile(perM2, 0.5)) : null,
  }
}

const byType = (rows: Used[]): Record<RentType, Stats> =>
  Object.fromEntries(RENT_TYPES.map((t) => [t, stats(rows.filter((r) => r.type === t))])) as Record<RentType, Stats>

/**
 * ⛔ THỦ ĐỨC IS AN UMBRELLA, AND A ROW IS NEVER ASSIGNED TO IT WHEN A NARROWER DISTRICT CLAIMS IT.
 * Its curated spellings include "Quận 2" and "Quận 9" (abolished 2021 and merged into it), so a plain
 * first-match would put every District 2 flat under Thủ Đức and leave d2 empty. Rows are assigned to
 * exactly one NON-umbrella district; the Thủ Đức row is then built as the union of its own rows and
 * d2 + d9, which is exactly what /c/rentals/thu-duc lists.
 */
const UMBRELLA = 'thu-duc'
const UMBRELLA_PARTS = new Set(['d2', 'd9'])
const CURATED = DISTRICTS.filter((d) => d.slug !== 'all' && d.match?.length)
const NARROW = CURATED.filter((d) => d.slug !== UMBRELLA)
const UMBRELLA_ENTRY = CURATED.find((d) => d.slug === UMBRELLA)

/**
 * The one curated district a stored `district` value names, or null.
 *
 * ⚠️ THE `district` COLUMN ONLY, NEVER `location`. Location is free text ("gần Quận 10", a street
 * called Xa lộ Hà Nội); the district column is what every importer fills from the source's own
 * address field. ⚠️ TWO MATCHES IS NO MATCH: a value naming two districts cannot be put in either
 * without guessing, so it counts city-wide only. `districtTextMatches` is the number-bounded matcher
 * the feed uses, so "Quận 10" never counts as "Quận 1".
 */
export function assignDistrict(district: string | null): string | null {
  if (!district) return null
  const hits = NARROW.filter((d) => d.match!.some((m) => districtTextMatches(district, m)))
  const inUmbrella = !!UMBRELLA_ENTRY?.match!.some((m) => districtTextMatches(district, m))
  if (hits.length > 1) return null
  if (hits.length === 1) {
    // "Quận 1, TP. Thủ Đức" names two places; "Quận 2" matching the umbrella too is the SAME place (agy).
    return inUmbrella && !UMBRELLA_PARTS.has(hits[0].slug) ? null : hits[0].slug
  }
  return inUmbrella ? UMBRELLA : null
}

export function computeRentIndex(rows: RentRow[], now: Date = new Date()): RentIndex {
  const excluded: Record<ExclusionReason, number> = {
    notResidential: 0, notForRent: 0, currency: 0, unit: 0, belowBand: 0, aboveBand: 0, crossPosted: 0,
  }
  const kept: (Used & { area: number | null })[] = []
  for (const r of rows) {
    const type = r.subcategorySlug ? TYPE_OF[r.subcategorySlug] : undefined
    if (!type) { excluded.notResidential++; continue }
    // 'wanted' posts sit in the same category with a BUDGET as their price — a renter's ceiling, not an asking rent.
    if (r.listingType !== 'rent') { excluded.notForRent++; continue }
    if (r.currency !== '₫') { excluded.currency++; continue }
    if (!isMonthlyRent(r.priceUnit, r.sellerId)) { excluded.unit++; continue }
    const price = Number(r.price)
    if (!Number.isFinite(price) || price < MIN_MONTHLY_VND) { excluded.belowBand++; continue }
    if (price > MAX_MONTHLY_VND) { excluded.aboveBand++; continue }
    const area = r.areaM2 !== null && Number.isFinite(r.areaM2) ? Number(r.areaM2) : null
    const perM2Raw = area !== null && area >= MIN_AREA_M2 && area <= MAX_AREA_M2 ? price / area : null
    const perM2 = perM2Raw !== null && perM2Raw >= MIN_VND_PER_M2 && perM2Raw <= MAX_VND_PER_M2 ? perM2Raw : null
    kept.push({ type, price, perM2, area, district: assignDistrict(r.district), sellerId: r.sellerId })
  }

  /**
   * ⚠️ THE SAME UNIT ON TWO PORTALS COUNTS ONCE — BUT ONLY ON AN EXACT MATCH, AND ONLY ACROSS SELLERS.
   * Agents cross-post one flat to Batdongsan and Chợ Tốt at the same price. The key is type +
   * district + exact price + exact floor area, and it collapses rows from DIFFERENT sellers only: two
   * identical units in one building listed by the same agency are two units, and a row with no
   * district or no plausible floor area has too little identity to call a duplicate. ⚠️ ROOMS ARE
   * NEVER COLLAPSED: they are priced and measured in round numbers (3,500,000 ₫, 20 m²), so two real
   * rooms on two sites in one district match the key far more often than one room cross-posted does
   * (opus, diff review). Apartments and houses carry enough spread to make an exact match mean
   * something. This is deliberately not fuzzy —
   * a near-match rule on 25,000 rows would merge real neighbours, and the repo's duplicate guard
   * (src/lib/duplicate-guard.ts) is a per-seller, per-post database check, not an aggregate tool.
   */
  // key → rows seen per seller. A row is a cross-post when ANOTHER seller already shows at least one
  // more identical unit than this seller has so far: seller A's one flat absorbs the first of seller
  // B's twins, and B's second twin still counts (opus — a plain "key seen" dropped both).
  const seen = new Map<string, Map<string, number>>()
  const used: Used[] = []
  for (const r of kept) {
    if (r.type !== 'room' && r.district !== null && r.area !== null && r.area >= MIN_AREA_M2 && r.area <= MAX_AREA_M2) {
      const key = `${r.type}|${r.district}|${r.price}|${r.area}`
      const counts = seen.get(key) ?? new Map<string, number>()
      seen.set(key, counts)
      const mine = counts.get(r.sellerId) ?? 0
      const others = Math.max(0, ...[...counts].filter(([id]) => id !== r.sellerId).map(([, n]) => n))
      counts.set(r.sellerId, mine + 1)
      if (others > mine) { excluded.crossPosted++; continue }
    }
    used.push({ type: r.type, price: r.price, perM2: r.perM2, district: r.district, sellerId: r.sellerId })
  }

  const districts: DistrictRow[] = []
  for (const d of CURATED) {
    const mine = used.filter((r) =>
      d.slug === UMBRELLA ? r.district === UMBRELLA || UMBRELLA_PARTS.has(r.district ?? '') : r.district === d.slug)
    if (mine.length === 0) continue
    districts.push({
      slug: d.slug,
      name: d.name,
      nameEn: d.nameEn,
      partOf: UMBRELLA_PARTS.has(d.slug) ? UMBRELLA : null,
      total: mine.length,
      cells: byType(mine),
    })
  }

  return {
    rulesVersion: RENT_INDEX_RULES_VERSION,
    computedAt: now.toISOString(),
    read: rows.length,
    used: used.length,
    excluded,
    cityWide: byType(used),
    districts,
    unassigned: used.filter((r) => r.district === null).length,
  }
}

/**
 * One CSV field, RFC 4180-quoted when it needs to be.
 * ⚠️ A TEXT FIELD STARTING WITH = + - @ IS PREFIXED WITH ', because a newsroom opens this in Excel or
 * Sheets and those run it as a formula (opus). Every text field is a constant today; this is so it
 * stays safe when one is not. Numbers pass through untouched — a negative is never emitted.
 */
const field = (v: string | number | null): string => {
  if (v === null) return ''
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const CSV_COLUMNS = [
  'snapshot_utc', 'scope', 'district_slug', 'district_name', 'part_of', 'type',
  'n', 'median_vnd_month', 'p25_vnd_month', 'p75_vnd_month', 'n_with_area', 'median_vnd_per_m2_month',
] as const

/**
 * The CSV the page links to. ⛔ SAME `RentIndex` OBJECT AS THE TABLE — the route passes the value the
 * page's loader returned, never a second query — so the two can differ only by snapshot, and each
 * row carries `snapshot_utc` to say which one. Suppressed cells keep their `n` with the statistics
 * empty, exactly as the table prints "—".
 */
export function rentIndexCsv(index: RentIndex): string {
  const lines: string[] = [CSV_COLUMNS.join(',')]
  const row = (scope: string, slug: string, name: string, partOf: string | null, cells: Record<RentType, Stats>) => {
    for (const t of RENT_TYPES) {
      const s = cells[t]
      lines.push([
        index.computedAt, scope, slug, name, partOf, t,
        s.n, s.median, s.p25, s.p75, s.nArea, s.medianPerM2,
      ].map(field).join(','))
    }
  }
  row('city', 'all', 'Ho Chi Minh City', null, index.cityWide)
  for (const d of index.districts) row('district', d.slug, d.nameEn, d.partOf, d.cells)
  return lines.join('\r\n') + '\r\n'
}
