import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { districtTextMatches } from '@/lib/district-match'
import { hashFromUrl } from '@/lib/image-hash-url'
import { MONTHLY_BARE_VND_SELLERS, MONTHLY_UNIT } from '@/lib/price-unit'
import { HOME_RENTAL_SUBCATS } from '@/lib/rental-homes'

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

/**
 * Bump when a rule changes: it is part of the cache key, so an old snapshot is never served under new rules.
 *
 * ⛔ v3 (SEO wave B, R1; owner decisions R-a…R-e, 2026-09-30) CHANGES THE FIGURES, SO IT IS NOT
 * COMPARABLE WITH v2. Four rules moved at once:
 *  · a house with no bedroom count is a commercial property, not a home (R-a) — `commercial` below;
 *  · a cross-post is proven by shared PHOTOS, not by an exact price + area match (R-b);
 *  · apartments also publish bedroom bands 1, 2 and 3+ (R-d), in new CSV rows (R-e);
 *  · every published amount is rounded to 1,000 ₫ (a type-7 median of an even count can end in …500
 *    or …99,999.5, a precision asking prices do not have).
 * And one input moved: Thảo Điền is District 2's (SEO wave B, D0), so its rows left the Thủ Đức-only
 * part for `d2` — still inside the Thủ Đức union row. The fingerprint test (rent-index.test.ts)
 * covers the constants below AND the curated spellings `assignDistrict` reads, so neither can change
 * again without this number moving.
 */
export const RENT_INDEX_RULES_VERSION = 3

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
 * ⛔ KEYED BY THE ONE LIST OF HOME SUBCATEGORIES (src/lib/rental-homes.ts), so "a home" means the same
 * three shelves here as on every page that says "homes"; a subcategory added there fails to compile
 * here until it is given a type.
 */
/**
 * ⚠️ SERVICED APARTMENTS ARE A HOME ON THE PAGES BUT NOT IN THE INDEX. Owner decision O-45 (2026-09-30)
 * put `homestay-serviced` into HOME_RENTAL_SUBCATS, so the housing pages count and list it. Its prices
 * mix nightly and monthly rates and usually bundle cleaning and bills, so folding it into "apartment"
 * would move the v3 medians the owner approved (R1, 2026-09-30) and needs its own rules version. Until
 * then it is named here, out of the index, so a NEW home subcategory still fails to compile below.
 */
export const NOT_INDEXED_HOMES = ['homestay-serviced'] as const
type IndexedHome = Exclude<(typeof HOME_RENTAL_SUBCATS)[number], (typeof NOT_INDEXED_HOMES)[number]>
const TYPE_OF: Record<IndexedHome, RentType> = {
  'apartment-rental': 'apartment',
  'house-rental': 'house',
  'room-rental': 'room',
}
const typeOf = (subcategorySlug: string | null): RentType | undefined =>
  subcategorySlug && Object.hasOwn(TYPE_OF, subcategorySlug) ? TYPE_OF[subcategorySlug as IndexedHome] : undefined

/**
 * ⛔ APARTMENT BEDROOM BANDS: 1, 2 AND 3+ (R-d). An all-sizes apartment median mostly measures the
 * SIZE MIX: 65% of District 1's apartments with a count are one-bedroom, so its ₫10.0M said little
 * about a two-bedroom (API scope, 2026-09-27: 1-bedroom ₫8.6M, 2-bedroom ₫31M). The count is the
 * `bedrooms` facet every importer stores through `roomCountValue` (src/lib/taxonomy.ts): '1'…'5'
 * exact, '6' for six or more. ⚠️ A STUDIO ('0', members only) AND A MISSING COUNT GET NO BAND — a
 * studio is not a one-bedroom flat, and a missing count is not a studio. Both still count in the
 * all-sizes apartment figure. Houses and rooms are not banded.
 */
export const APARTMENT_BANDS = ['br1', 'br2', 'br3plus'] as const
export type ApartmentBand = (typeof APARTMENT_BANDS)[number]
export function apartmentBand(bedrooms: number | null): ApartmentBand | null {
  if (bedrooms === null || bedrooms < 1) return null
  return bedrooms === 1 ? 'br1' : bedrooms === 2 ? 'br2' : 'br3plus'
}

/**
 * The stored bedroom count, or null. `attributes` is the listing's facet JSON; `bedrooms` is a
 * string there ("2"). Anything unreadable is null, never 0: a missing count is not a studio
 * (`roomCountValue`).
 */
export function bedroomCount(attributes: string | null): number | null {
  if (!attributes) return null
  let parsed: unknown
  try { parsed = JSON.parse(attributes) } catch { return null }
  const raw = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).bedrooms : undefined
  const n = typeof raw === 'string' && /^\d{1,2}$/.test(raw.trim()) ? Number(raw.trim()) : typeof raw === 'number' ? raw : NaN
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * ⛔ PUBLISHED AMOUNTS ARE WHOLE THOUSANDS OF ĐỒNG. A median of an even count is the mean of two
 * asking prices and can land on 12,499,999.5; the CSV printed it rounded to the đồng as 12,500,000
 * or 12,499,999 depending on the pair. The page already shows 100,000 ₫ steps (`roundForDisplay`).
 */
export const ROUND_VND = 1_000
const roundVnd = (n: number) => Math.round(n / ROUND_VND) * ROUND_VND

/**
 * What the page prints for an amount: 100,000 ₫ steps. A median of 15,437,000 ₫ claims a precision
 * asking prices do not have; the CSV keeps the 1,000 ₫ figure. Here, beside the rules, so every
 * surface that prints an index figure (the page, the rentals district block) rounds it one way.
 */
export const DISPLAY_STEP_VND = 100_000
export const roundForDisplay = (n: number) => Math.round(n / DISPLAY_STEP_VND) * DISPLAY_STEP_VND

export type RentRow = {
  /** Listing id — what the second loading phase asks photos for (`dedupeCandidateIds`). */
  id: string
  price: number
  priceUnit: string | null
  currency: string | null
  listingType: string | null
  subcategorySlug: string | null
  district: string | null
  areaM2: number | null
  sellerId: string
  /** The facet JSON; only `bedrooms` is read (`bedroomCount`). */
  attributes: string | null
}

export type ExclusionReason =
  | 'notResidential'
  | 'notForRent'
  | 'currency'
  | 'unit'
  | 'belowBand'
  | 'aboveBand'
  | 'commercial'
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
  /** Apartments by bedroom band. Each band's n is a subset of `cells.apartment.n`. */
  bands: Record<ApartmentBand, Stats>
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
  /** City-wide apartments by bedroom band. */
  cityBands: Record<ApartmentBand, Stats>
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

type Used = {
  id: string
  type: RentType
  band: ApartmentBand | null
  price: number
  perM2: number | null
  district: string | null
  sellerId: string
}

function stats(rows: Used[]): Stats {
  const prices = rows.map((r) => r.price).sort((a, b) => a - b)
  const perM2 = rows.map((r) => r.perM2).filter((v): v is number => v !== null).sort((a, b) => a - b)
  const enough = prices.length >= MIN_CELL_N
  return {
    n: prices.length,
    median: enough ? roundVnd(quantile(prices, 0.5)) : null,
    p25: enough ? roundVnd(quantile(prices, 0.25)) : null,
    p75: enough ? roundVnd(quantile(prices, 0.75)) : null,
    nArea: perM2.length,
    medianPerM2: perM2.length >= MIN_CELL_N ? roundVnd(quantile(perM2, 0.5)) : null,
  }
}

const byType = (rows: Used[]): Record<RentType, Stats> =>
  Object.fromEntries(RENT_TYPES.map((t) => [t, stats(rows.filter((r) => r.type === t))])) as Record<RentType, Stats>
const byBand = (rows: Used[]): Record<ApartmentBand, Stats> =>
  Object.fromEntries(APARTMENT_BANDS.map((b) => [b, stats(rows.filter((r) => r.type === 'apartment' && r.band === b))])) as Record<ApartmentBand, Stats>

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

/**
 * ⛔ THE CROSS-POST PHOTO RULE (R-b), OWNED HERE AND PINNED BY THE FINGERPRINT — not the duplicate
 * guard's `isImageRepost` (image-hash.ts), whose count is per photo of A (two near-identical uploads
 * of one room in A both "match" B's one copy) and so depends on argument order (codex + opus, R1
 * diff review). Here each listing's photos are first collapsed to DISTINCT shots, the shots are
 * matched ONE TO ONE, and the smaller count of either direction is taken, so the verdict for A,B is
 * the verdict for B,A. Two listings are the same unit when they share at least
 * CROSS_POST_MIN_SHARED shots AND more than half of the smaller listing's shots: an agency banner or
 * a floor plan shared by two flats never merges them.
 * CROSS_POST_HAMMING: two dHashes within 10 bits are one photo re-encoded (the repo's
 * SAME_ANGLE_THRESHOLD, image-hash-url.ts); different shots sit ~25+ apart.
 */
export const CROSS_POST_HAMMING = 10
export const CROSS_POST_MIN_SHARED = 2

/**
 * A 64-bit dHash as two unsigned 32-bit halves. ⚠️ NUMBERS, NOT THE HEX: the snapshot compares
 * ~14,500 candidates' photos pairwise inside a render, and `hammingHex` re-parses every character on
 * every call — 1.8 s of a cold snapshot, measured on production data (2026-09-30), against ~0.2 s
 * this way. Same distance, same result (pinned in the test against `hammingHex`).
 */
export type Shot = readonly [number, number]
const toShot = (hex: string): Shot => [parseInt(hex.slice(0, 8), 16) >>> 0, parseInt(hex.slice(8, 16), 16) >>> 0]
const popcount32 = (v: number): number => {
  let x = v >>> 0
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24)
}
export const shotDistance = (a: Shot, b: Shot): number => popcount32(a[0] ^ b[0]) + popcount32(a[1] ^ b[1])

/** A listing's distinct shots: its embedded hashes, greedily clustered within CROSS_POST_HAMMING. */
export function distinctShots(urls: string[]): Shot[] {
  const reps: Shot[] = []
  for (const url of urls) {
    const h = hashFromUrl(url)
    if (!h) continue
    const shot = toShot(h)
    if (!reps.some((r) => shotDistance(r, shot) <= CROSS_POST_HAMMING)) reps.push(shot)
  }
  return reps
}

/** Greedy one-to-one matching of A's shots onto B's: each shot of B is used at most once. */
function matchedShots(a: Shot[], b: Shot[]): number {
  const used = new Set<number>()
  let n = 0
  for (const h of a) {
    const j = b.findIndex((g, i) => !used.has(i) && shotDistance(h, g) <= CROSS_POST_HAMMING)
    if (j >= 0) { used.add(j); n++ }
  }
  return n
}

/** Same unit by its photos: symmetric, over distinct shots (`distinctShots`). */
export function sameUnitByPhotos(a: Shot[], b: Shot[]): boolean {
  const shared = Math.min(matchedShots(a, b), matchedShots(b, a))
  return shared >= CROSS_POST_MIN_SHARED && shared > Math.min(a.length, b.length) / 2
}

type Excluded = Record<ExclusionReason, number>
const noExclusions = (): Excluded => ({
  notResidential: 0, notForRent: 0, currency: 0, unit: 0, belowBand: 0, aboveBand: 0, commercial: 0, crossPosted: 0,
})

/** Every rule but the cross-post one, in the order the exclusion counts are attributed. */
function classify(rows: RentRow[], excluded: Excluded): Used[] {
  const kept: Used[] = []
  for (const r of rows) {
    const type = typeOf(r.subcategorySlug)
    if (!type) { excluded.notResidential++; continue }
    // 'wanted' posts sit in the same category with a BUDGET as their price — a renter's ceiling, not an asking rent.
    if (r.listingType !== 'rent') { excluded.notForRent++; continue }
    if (r.currency !== '₫') { excluded.currency++; continue }
    if (!isMonthlyRent(r.priceUnit, r.sellerId)) { excluded.unit++; continue }
    const bedrooms = bedroomCount(r.attributes)
    /**
     * ⛔ A HOUSE WITH NO BEDROOM COUNT IS COMMERCIAL, NOT A HOME (R-a). Batdongsan files townhouses
     * and villas let whole — shopfronts, offices, hotels — under "Nhà phố / Biệt thự" with no
     * bedroom count, at ₫780M–1.45B and 300–1,200 m²: 81 of District 1's newest 100 houses and 73 of
     * District 3's (API scope, 2026-09-27), which is what put their house medians at ₫129M and
     * ₫125M. Houses WITH a count sat at ₫25M / 52 m² and ₫16M / 42 m². Every importer stores the
     * count when its source gives one, so the missing count is the source saying "not a dwelling".
     * ⚠️ HOUSES ONLY: an apartment or a room with no count is still a home (it just gets no band).
     * ⚠️ BEFORE THE PRICE BAND, so a ₫900M shopfront is counted as commercial — the true reason —
     * rather than as "above the band".
     */
    if (type === 'house' && bedrooms === null) { excluded.commercial++; continue }
    const price = Number(r.price)
    if (!Number.isFinite(price) || price < MIN_MONTHLY_VND) { excluded.belowBand++; continue }
    if (price > MAX_MONTHLY_VND) { excluded.aboveBand++; continue }
    const area = r.areaM2 !== null && Number.isFinite(r.areaM2) ? Number(r.areaM2) : null
    const perM2Raw = area !== null && area >= MIN_AREA_M2 && area <= MAX_AREA_M2 ? price / area : null
    const perM2 = perM2Raw !== null && perM2Raw >= MIN_VND_PER_M2 && perM2Raw <= MAX_VND_PER_M2 ? perM2Raw : null
    kept.push({
      id: r.id, type, band: type === 'apartment' ? apartmentBand(bedrooms) : null,
      price, perM2, district: assignDistrict(r.district), sellerId: r.sellerId,
    })
  }
  return kept
}

/**
 * ⛔ WHICH ROWS COULD BE A CROSS-POST: same type, same curated district, same exact price, and at
 * least two different sellers in that group. Only these rows' photos are ever read (the loader's
 * second phase): 14,502 of 31,890 rows on 2026-09-30 — round prices put many homes in a shared
 * group, so this halves the image read rather than shrinking it to a handful.
 * ⚠️ THE GROUP IS A FILTER, NOT EVIDENCE (R-b: photo evidence only). v2 called an exact
 * type + district + price + floor-area match a duplicate outright, and dropped 1,258 rows on it: in
 * round-number markets two real flats match that key by chance. Here the key only decides whom to
 * compare; the photos decide. A row with no district has too little identity to group, as before.
 */
function candidateGroups(kept: Used[]): Map<string, Used[]> {
  const groups = new Map<string, Used[]>()
  for (const r of kept) {
    if (r.district === null) continue
    const key = `${r.type}|${r.district}|${r.price}`
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  for (const [key, g] of groups) {
    if (new Set(g.map((r) => r.sellerId)).size < 2) groups.delete(key)
  }
  return groups
}

/** The ids whose photos `computeRentIndex` needs, in input order. Pure: the loader reads the photos. */
export function dedupeCandidateIds(rows: RentRow[]): string[] {
  const kept = classify(rows, noExclusions())
  const ids = new Set<string>()
  for (const g of candidateGroups(kept).values()) for (const r of g) ids.add(r.id)
  return kept.filter((r) => ids.has(r.id)).map((r) => r.id)
}

/**
 * `photos` maps a listing id to its stored image URLs; only `dedupeCandidateIds(rows)` need to be in
 * it. A candidate without photos is simply counted — no evidence, no merge.
 */
export function computeRentIndex(
  rows: RentRow[],
  photos: ReadonlyMap<string, string[]> = new Map(),
  now: Date = new Date(),
): RentIndex {
  const excluded = noExclusions()
  const kept = classify(rows, excluded)

  /**
   * ⚠️ THE SAME UNIT ON TWO PORTALS COUNTS ONCE — PROVEN BY ITS PHOTOS, AND ONLY ACROSS SELLERS (R-b).
   * Agents cross-post one flat to Batdongsan and Chợ Tốt; each importer re-hosts the photos, and the
   * perceptual hash baked into every stored URL (`…-h<16hex>.`, src/lib/image-hash-url.ts) survives
   * the re-encode. Two rows in one candidate group are the same unit when `sameUnitByPhotos` says so
   * (above). No sharp: only hashes already in the URLs are compared.
   * ⚠️ ROOMS ARE COMPARED TOO NOW: v2 never merged them because their round prices and sizes matched
   * by chance; a photo match is not chance.
   * ⚠️ ONE MATCH ABSORBS ONE ROW PER OTHER SELLER: seller A's one flat absorbs the first of seller
   * B's same-photo listings, and B's second (a second unit an agency shot with the same photos)
   * still counts — the rule v2 kept for its exact-key twins (opus), whichever order the rows arrive in.
   */
  const dropped = new Set<string>()
  for (const g of candidateGroups(kept).values()) {
    const survivors: { row: Used; hashes: Shot[]; absorbed: Set<string> }[] = []
    for (const r of g) {
      const hashes = distinctShots(photos.get(r.id) ?? [])
      const match = hashes.length >= CROSS_POST_MIN_SHARED
        ? survivors.find((s) => s.row.sellerId !== r.sellerId && !s.absorbed.has(r.sellerId) && sameUnitByPhotos(hashes, s.hashes))
        : undefined
      if (match) {
        match.absorbed.add(r.sellerId)
        dropped.add(r.id)
        continue
      }
      survivors.push({ row: r, hashes, absorbed: new Set() })
    }
  }
  excluded.crossPosted = dropped.size
  const used = kept.filter((r) => !dropped.has(r.id))

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
      bands: byBand(mine),
    })
  }

  return {
    rulesVersion: RENT_INDEX_RULES_VERSION,
    computedAt: now.toISOString(),
    read: rows.length,
    used: used.length,
    excluded,
    cityWide: byType(used),
    cityBands: byBand(used),
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

/**
 * ⚠️ `rules_version` IS THE LAST COLUMN (R-e), SO A SCRIPT THAT READS COLUMNS BY POSITION KEEPS WORKING.
 * It says which rules produced the row: a v2 file and a v3 file are not comparable.
 */
export const CSV_COLUMNS = [
  'snapshot_utc', 'scope', 'district_slug', 'district_name', 'part_of', 'type',
  'n', 'median_vnd_month', 'p25_vnd_month', 'p75_vnd_month', 'n_with_area', 'median_vnd_per_m2_month',
  'rules_version',
] as const

/**
 * The CSV `type` of each apartment band (R-e). ⚠️ A BAND ROW'S n IS ALSO INSIDE ITS SCOPE'S
 * `apartment` ROW — summing n over every row double-counts; the page's methodology says so.
 */
export const BAND_CSV_TYPE: Record<ApartmentBand, string> = {
  br1: 'apartment_1br',
  br2: 'apartment_2br',
  br3plus: 'apartment_3plus_br',
}

/**
 * The CSV the page links to. ⛔ SAME `RentIndex` OBJECT AS THE TABLE — the route passes the value the
 * page's loader returned, never a second query — so the two can differ only by snapshot, and each
 * row carries `snapshot_utc` to say which one. Suppressed cells keep their `n` with the statistics
 * empty, exactly as the table prints "—".
 */
export function rentIndexCsv(index: RentIndex): string {
  const lines: string[] = [CSV_COLUMNS.join(',')]
  const line = (scope: string, slug: string, name: string, partOf: string | null, type: string, s: Stats) => {
    lines.push([
      index.computedAt, scope, slug, name, partOf, type,
      s.n, s.median, s.p25, s.p75, s.nArea, s.medianPerM2, index.rulesVersion,
    ].map(field).join(','))
  }
  const row = (scope: string, slug: string, name: string, partOf: string | null, cells: Record<RentType, Stats>, bands: Record<ApartmentBand, Stats>) => {
    for (const t of RENT_TYPES) line(scope, slug, name, partOf, t, cells[t])
    for (const b of APARTMENT_BANDS) line(scope, slug, name, partOf, BAND_CSV_TYPE[b], bands[b])
  }
  row('city', 'all', 'Ho Chi Minh City', null, index.cityWide, index.cityBands)
  for (const d of index.districts) row('district', d.slug, d.nameEn, d.partOf, d.cells, d.bands)
  return lines.join('\r\n') + '\r\n'
}

/**
 * EVERY INPUT A RULE READS, IN ONE VALUE — the fingerprint test (rent-index.test.ts) hashes it and pins
 * the hash to RENT_INDEX_RULES_VERSION, so a changed constant or a changed curated spelling (D0 moved
 * Thảo Điền into `d2`) fails until the version moves with it.
 */
export const RENT_INDEX_RULE_INPUTS = {
  minCellN: MIN_CELL_N,
  monthlyBandVnd: [MIN_MONTHLY_VND, MAX_MONTHLY_VND],
  areaM2: [MIN_AREA_M2, MAX_AREA_M2],
  vndPerM2: [MIN_VND_PER_M2, MAX_VND_PER_M2],
  monthlyUnit: MONTHLY_UNIT,
  bareVndSellers: [...MONTHLY_BARE_VND_SELLERS].sort(),
  types: TYPE_OF,
  bands: APARTMENT_BANDS,
  roundVnd: ROUND_VND,
  displayStepVnd: DISPLAY_STEP_VND,
  commercial: 'house-without-bedroom-count',
  crossPost: {
    group: 'type|district|price', evidence: 'distinct shots, one-to-one, min of both directions',
    hamming: CROSS_POST_HAMMING, minShared: CROSS_POST_MIN_SHARED, share: 'more than half of the smaller',
  },
  umbrella: { slug: UMBRELLA, parts: [...UMBRELLA_PARTS].sort() },
  districts: CURATED.map((d) => ({ slug: d.slug, match: d.match })),
} as const
