/**
 * THE NUMBERS ON THE HCMC VEHICLE-HIRE HUBS — pure, so the method is testable and cannot drift.
 *
 * The hubs (/car-rental-ho-chi-minh-city, /motorbike-rental-ho-chi-minh-city and their Vietnamese
 * pairs) publish a price summary computed from the LIVE rows at render time. Tin's research
 * (2026-09-28) was blunt that a median table is commodity unless its method is visible and
 * honest, so the method is the product here and every rule below is printed on the page:
 *
 *   · ⛔ A PERIOD IS NEVER DERIVED FROM ANOTHER. A day price and a month price are separate cohorts;
 *     nothing multiplies a day rate into a "monthly" figure. A row's period is the one it is priced
 *     in (`attributes.rentalPeriod`, falling back to the `priceUnit` suffix).
 *   · ⛔ A COHORT TOO SMALL FOR A BAND DOES NOT GET ONE. n ≥ BAND_MIN → median and the middle half;
 *     RANGE_MIN ≤ n < BAND_MIN → the lowest and highest price only; fewer → nothing, and the page
 *     says "too few to summarise" rather than printing a median of three.
 *   · ⚠️ THESE ARE ASKING PRICES AS EACH SOURCE PUBLISHES THEM (a car's listed day rate before the
 *     source's own discounts, fees, deposit or delivery). The page says so; this module does not
 *     pretend to know a checkout total.
 *   · ⚠️ NO CROSS-SOURCE DEDUPLICATION. A car listed on both Mioto and BonbonCar counts twice. The
 *     page says that too — the overlap cannot be detected from the published fields.
 */

export type RentalPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly'

/** The fields of a live row the summary reads. */
export type HubRow = {
  price: number
  priceUnit: string
  /** `Listing.attributes` — serialized JSON, may be null. */
  attributes: string | null
  title: string
  district: string | null
}

/** n at or above which a cohort gets a median and a middle-half band. */
export const BAND_MIN = 20
/** n at or above which a cohort gets a low–high range (below BAND_MIN). Fewer → no figure at all. */
export const RANGE_MIN = 5

const UNIT_PERIOD: Record<string, RentalPeriod> = {
  'VND/hour': 'hourly',
  'VND/day': 'daily',
  'VND/week': 'weekly',
  'VND/month': 'monthly',
}

function attrs(row: HubRow): Record<string, unknown> {
  if (!row.attributes) return {}
  try {
    const v = JSON.parse(row.attributes)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * The period a row is PRICED in. `attributes.rentalPeriod` first (the importer writes it), then the
 * price-unit suffix. ⚠️ A bare 'VND/month' with no attribute is the rent default — it still reads
 * monthly, which is what the card prints.
 */
export function periodOf(row: HubRow): RentalPeriod | null {
  const p = attrs(row).rentalPeriod
  if (p === 'hourly' || p === 'daily' || p === 'weekly' || p === 'monthly') return p
  return UNIT_PERIOD[row.priceUnit] ?? null
}

export function seatsOf(row: HubRow): string | null {
  const s = attrs(row).seats
  return typeof s === 'string' ? s : null
}

export function transmissionOf(row: HubRow): 'automatic' | 'manual' | null {
  const t = attrs(row).transmission
  return t === 'automatic' || t === 'manual' ? t : null
}

/** VinFast by the NAME, the one place both sources carry the make ("VinFast VF5 2026", "VF3 ECO Vinfast VF3"). */
export function isVinFast(row: HubRow): boolean {
  return /vinfast/i.test(row.title)
}

/**
 * Linear-interpolated quantile over an ASCENDING array (the common "type 7" definition — the same one
 * a spreadsheet's QUARTILE.INC gives, so a reader can reproduce it).
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Round a displayed price to the nearest 1,000 đ — a median of 812,500 đ reads as false precision. */
const round1k = (n: number) => Math.round(n / 1000) * 1000

export type PriceSummary =
  | { kind: 'band'; n: number; median: number; p25: number; p75: number; min: number; max: number }
  | { kind: 'range'; n: number; min: number; max: number }
  | { kind: 'too-few'; n: number }

export function summarize(prices: readonly number[]): PriceSummary {
  const clean = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b)
  const n = clean.length
  if (n < RANGE_MIN) return { kind: 'too-few', n }
  const min = round1k(clean[0])
  const max = round1k(clean[n - 1])
  if (n < BAND_MIN) return { kind: 'range', n, min, max }
  return {
    kind: 'band',
    n,
    median: round1k(quantile(clean, 0.5)),
    p25: round1k(quantile(clean, 0.25)),
    p75: round1k(quantile(clean, 0.75)),
    min,
    max,
  }
}

export type Cohort = { key: string; summary: PriceSummary }

/**
 * Cars: DAY prices only (every car source prices per day). Four cohorts a renter chooses between.
 * ⚠️ "4–5 seats" is one cohort: a Vietnamese "xe 4 chỗ" is routinely a five-seat sedan, and the
 * sources label the same models both ways.
 */
export function carCohorts(rows: readonly HubRow[]): Cohort[] {
  const day = rows.filter((r) => periodOf(r) === 'daily')
  const pick = (f: (r: HubRow) => boolean) => summarize(day.filter(f).map((r) => r.price))
  return [
    { key: 'all', summary: pick(() => true) },
    { key: 'seats-4-5', summary: pick((r) => seatsOf(r) === '4' || seatsOf(r) === '5') },
    { key: 'seats-7', summary: pick((r) => seatsOf(r) === '7') },
    { key: 'vinfast', summary: pick(isVinFast) },
  ]
}

/**
 * Motorbikes: one cohort per (period × transmission), day and month kept apart. A shop that quotes
 * both is filed under the SHORTEST period it quotes (the importer's rule), so it is counted once.
 */
export function bikeCohorts(rows: readonly HubRow[]): Cohort[] {
  const out: Cohort[] = []
  for (const period of ['daily', 'monthly'] as const) {
    const inPeriod = rows.filter((r) => periodOf(r) === period)
    out.push({ key: `${period}-all`, summary: summarize(inPeriod.map((r) => r.price)) })
    for (const t of ['automatic', 'manual'] as const) {
      out.push({ key: `${period}-${t}`, summary: summarize(inPeriod.filter((r) => transmissionOf(r) === t).map((r) => r.price)) })
    }
  }
  return out
}

/** Count per district, largest first, rows with no district left out (they deliver city-wide). */
export function districtCounts(rows: readonly HubRow[], limit = 8): { district: string; count: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) if (r.district) m.set(r.district, (m.get(r.district) ?? 0) + 1)
  return [...m.entries()]
    .map(([district, count]) => ({ district, count }))
    .sort((a, b) => b.count - a.count || a.district.localeCompare(b.district))
    .slice(0, limit)
}

/**
 * WHAT THE HUB MAY SAY ABOUT WHERE ITS LISTINGS BOOK — from counts, never from a source's name.
 *
 * ⛔ ONLY `all` MAY BE WORDED AS "every car links to the page where you book it". The hub counts every
 * live HCMC vehicle-hire row by design, so the day a person posts a scooter on eno.vn the page is
 * mixed; "every" and "each one is a reference listing" would then be false for that listing (codex,
 * 2026-09-29). `some` names the linked sources and says the rest are answered in chat; `none` makes no
 * booking-elsewhere claim at all.
 */
export type LinkState = 'all' | 'some' | 'none'
export function linkState(total: number, linked: number): LinkState {
  if (total > 0 && linked === total) return 'all'
  return linked > 0 ? 'some' : 'none'
}

/** The sources whose rows book elsewhere — the only names a "listed on …" sentence may use. */
export function referenceSources(sources: readonly { name: string; linkedCount: number }[]): string[] {
  return sources.filter((s) => s.linkedCount > 0).map((s) => s.name)
}

/** A date as YYYY-MM-DD in Ho Chi Minh City time — one clock for the printed date AND the JSON-LD. */
export function hcmcIsoDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
