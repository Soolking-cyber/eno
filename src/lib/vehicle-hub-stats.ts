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

/**
 * A bike's DAY price as its shop lists it: the price of a row priced by the day, or — a row priced by the month — the day rate
 * the shop lists for that same bike (`attributes.dayPrice`, written by the importer from the shop's own page: The Extra Mile
 * prices each city bike by the month on its card and by the first day on its page, src/lib/moto-partners.ts). Null when the
 * shop lists no day price.
 * ⛔ STILL NEVER DERIVED: `dayPrice` is a price the shop publishes, read off its page, not a month divided by thirty. OpenSEO
 * audit 2026-11-26: with only the rows priced by the day counted, the motorbike hub's day block said "too few to summarise"
 * (4 of 22 bikes) while 18 more bikes on it had a day price the shop publishes.
 */
export function publishedDayPrice(row: HubRow): number | null {
  const p = periodOf(row)
  if (p === 'daily') return row.price > 0 ? row.price : null
  if (p !== 'monthly') return null
  const raw = attrs(row).dayPrice
  const n = typeof raw === 'string' && /^\d{4,9}$/.test(raw) ? Number(raw) : NaN
  return n > 0 ? n : null
}

/**
 * The row as the hub's day figures may read it: ⛔ `dayPrice` counts only from an official partner shop's row (commit-gate review,
 * Opus): any seller's attributes may carry any key (core/listings.ts sanitizeAttributes), and the listing page hides this one, so a
 * day price nobody can see on the listing would otherwise reach the hub's figures and its search snippet.
 */
export function trustedHubRow<R extends HubRow>(row: R, partner: boolean): R {
  if (partner || !row.attributes || !row.attributes.includes('dayPrice')) return row
  const a = attrs(row)
  if (!('dayPrice' in a)) return row
  delete a.dayPrice
  return { ...row, attributes: JSON.stringify(a) }
}

export function seatsOf(row: HubRow): string | null {
  const s = attrs(row).seats
  return typeof s === 'string' ? s : null
}

export function transmissionOf(row: HubRow): 'automatic' | 'manual' | null {
  const t = attrs(row).transmission
  return t === 'automatic' || t === 'manual' ? t : null
}

/**
 * VinFast's ELECTRIC cars by the NAME, the one place every source carries the make ("VinFast VF5 2026", "VF3 ECO Vinfast VF3").
 * ⛔ NOT ITS PETROL ONES: the hub prints this group as "VinFast electric", and the car rental partners' VinFasts (2026-11-17)
 * are Lux A 2.0 sedans, which run on petrol (as do the Lux SA, Fadil and President) — commit-gate review, Opus.
 */
export function isVinFast(row: HubRow): boolean {
  return /vinfast/i.test(row.title) && !/\b(lux|fadil|president)\b/i.test(row.title)
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
  // By the day: every bike with a day price its shop lists (publishedDayPrice), whichever period its card is priced in.
  const day = (f: (r: HubRow) => boolean) => summarize(rows.filter(f).map(publishedDayPrice).filter((p): p is number => p != null))
  out.push({ key: 'daily-all', summary: day(() => true) })
  for (const t of ['automatic', 'manual'] as const) out.push({ key: `daily-${t}`, summary: day((r) => transmissionOf(r) === t) })
  // By the month: the rows priced by the month, their own price. A day price is never multiplied into one.
  const month = rows.filter((r) => periodOf(r) === 'monthly')
  out.push({ key: 'monthly-all', summary: summarize(month.map((r) => r.price)) })
  for (const t of ['automatic', 'manual'] as const) {
    out.push({ key: `monthly-${t}`, summary: summarize(month.filter((r) => transmissionOf(r) === t).map((r) => r.price)) })
  }
  return out
}

/**
 * One shop's line in a hub's shop comparison: its live vehicles and the lowest day and month price it lists. `name`/`href` null
 * = every other poster together (see shopLines).
 */
export type ShopLine = { name: string | null; href: string | null; count: number; dayFrom: number | null; monthFrom: number | null }

/**
 * THE SHOPS ON A HUB, SIDE BY SIDE (OpenSEO audit 2026-11-26: Google's first page for "thuê xe máy sài gòn" is shops that lead
 * with a price, and a "top 10 shops" list). From the same live rows as the cohorts, so the table and the figures above it never
 * disagree: the lowest day price a shop lists (publishedDayPrice) and the lowest month price it prices a vehicle in. Most
 * vehicles first, then by name. Rounded like the cohorts.
 */
export function shopLines(rows: readonly (HubRow & { shop: { name: string; href: string; partner: boolean } })[]): ShopLine[] {
  const m = new Map<string, ShopLine>()
  const low = (a: number | null, b: number | null) => (b == null ? a : a == null || b < a ? b : a)
  for (const r of rows) {
    // ⛔ ONLY A PARTNER SHOP IS NAMED (vehicle-hub-copy.ts: a person who posts a scooter is never named on this indexable page).
    // Everyone else is one line, with no name and no link, after the shops.
    const key = r.shop.partner ? r.shop.href : ''
    const s = m.get(key) ?? (r.shop.partner ? { name: r.shop.name, href: r.shop.href, count: 0, dayFrom: null, monthFrom: null } : { name: null, href: null, count: 0, dayFrom: null, monthFrom: null })
    s.count++
    const d = publishedDayPrice(r)
    s.dayFrom = low(s.dayFrom, d == null ? null : round1k(d))
    s.monthFrom = low(s.monthFrom, periodOf(r) === 'monthly' && r.price > 0 ? round1k(r.price) : null)
    m.set(key, s)
  }
  return [...m.values()].sort((a, b) => Number(a.name == null) - Number(b.name == null) || b.count - a.count || (a.name ?? '').localeCompare(b.name ?? ''))
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
