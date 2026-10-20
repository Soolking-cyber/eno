/**
 * A RENTAL'S STRUCTURED FACTS, READ FOR THE LISTING PAGE — the monthly costs, the occupancy facts and the amenity list
 * that GoPlus states for every room (partnership, owner 2026-10-19: "import all available info about apartments and
 * display properly like management fee, electricity rate, car access etc"). The importer writes them
 * (scripts/import-goplus.ts — keys below, every value a STRING, as attr-match.ts's substring match requires); the
 * page renders them (src/components/marketplace/rental-facts.tsx).
 *
 * ⛔ A WELL-FORMED KEY NEVER REACHES THE GENERIC DETAILS TABLE. A key there with no taxonomy facet prints its raw
 * camelCase through machine translation ("electricity price: 3800"), with the number ungrouped and no unit. The page
 * hides every key this module can draw (rentalFactHiddenKeys) and draws each with its own authored label, a grouped
 * amount and its unit. ⚠️ ONLY A WELL-FORMED ONE, AND ONLY WHERE THESE SECTIONS RENDER (rentalFactsApply — a place
 * rental priced in đồng): a seller's `deposit: "2 tháng"` or a sale listing's `floor` is not ours to swallow — it keeps
 * its generic row exactly as before (a reviewer's catch, 2026-10-19).
 * ⚠️ PURE AND CLIENT-SAFE: no React, no database — the page computes the rows on the server, the component prints them.
 * ⚠️ A VALUE THAT IS NOT A POSITIVE WHOLE NUMBER (or a real date, a known floor word) PRINTS NOTHING. A row is a promise
 * about what the tenant pays; "0 đ / kWh" or "NaN đ" would be a wrong one, and silence is the honest degradation.
 */

import { facetsFor } from '@/lib/taxonomy'
import { facetValues } from '@/lib/facet-tokens'
import { rentalCheckApplies } from '@/lib/rental-check/shared'

/** An authored label pair — `{ label, labelVi }`, which scripts/gen-ui-strings.mjs harvests for the nine MT languages. */
export type LabelPair = { label: string; labelVi: string }

/**
 * ⛔ THE PLAUSIBLE CEILING OF EACH AMOUNT, in đồng — above it the figure is not what its unit says, so it is neither
 * printed nor imported (scripts/import-goplus.ts drops it at the source with the same table — except electricity, read
 * since 2026-10-20 as its closest plausible typo and stored FLAGGED: ELECTRICITY_ESTIMATED). Measured on GoPlus's own
 * 2,669 rooms (2026-10-19): electricity p99 5,000 đ/kWh but a max of 4,000,000 (a rate with zeros added — read as
 * ≈ 4,000 since 2026-10-20); water p99 150,000 đ/person, max 4,000,000; per m³ max 50,000; service p99 300,000, max 2,000,000;
 * parking p99 300,000, max 10,000,000. A reviewer's catch: "200,000 đ / kWh" would be a wrong promise.
 */
export const RENTAL_FEE_MAX: Readonly<Record<string, number>> = {
  deposit: 1_000_000_000,
  electricityPrice: 10_000,
  'waterPrice:person': 500_000,
  'waterPrice:m3': 100_000,
  serviceFee: 5_000_000,
  parkingFee: 3_000_000,
}
/**
 * …and its plausible FLOOR: below it the figure is in another unit — a deposit of "3500" meant 3.5 million, a fee of
 * "150" meant 150,000 (a reviewer's catch: "Deposit 3,500 đ" would be a wrong promise). GoPlus's own minimums (10-19):
 * electricity 400 đ/kWh (under any tariff — the importer reads it as ≈ 4,000 since 2026-10-20, ELECTRICITY_ESTIMATED),
 * water 50,000 đ/person and 2,500 đ/m³, service 20,000, parking 50,000.
 */
export const RENTAL_FEE_MIN: Readonly<Record<string, number>> = {
  deposit: 100_000,
  electricityPrice: 500,
  'waterPrice:person': 10_000,
  'waterPrice:m3': 1_000,
  serviceFee: 10_000,
  parkingFee: 10_000,
}

/** The cost keys, in the order the block prints them. `waterUnit` qualifies `waterPrice` and prints nothing itself. */
const COSTS: readonly { key: string; name: LabelPair; per: LabelPair | null }[] = [
  { key: 'deposit', name: { label: 'Deposit', labelVi: 'Tiền cọc' }, per: null },
  { key: 'electricityPrice', name: { label: 'Electricity', labelVi: 'Tiền điện' }, per: { label: 'kWh', labelVi: 'kWh' } },
  // `per` for water depends on `waterUnit` — see WATER_PER.
  { key: 'waterPrice', name: { label: 'Water', labelVi: 'Tiền nước' }, per: null },
  // GoPlus calls it "Phí dịch vụ"; in HCMC rentals it is the building's service/management fee (cleaning, rubbish, lift).
  { key: 'serviceFee', name: { label: 'Service / management fee', labelVi: 'Phí dịch vụ' }, per: { label: 'month', labelVi: 'tháng' } },
  { key: 'parkingFee', name: { label: 'Parking', labelVi: 'Phí giữ xe' }, per: { label: 'vehicle per month', labelVi: 'xe / tháng' } },
]

/**
 * One cost attribute as đồng within its plausible range (RENTAL_FEE_MIN … RENTAL_FEE_MAX), else null. Water's ceiling depends on its
 * unit; a water price with an unknown unit is held to the stricter (per-m³) ceiling. Exported for the importer.
 */
export function plausibleFee(key: string, v: unknown, waterUnit?: unknown): number | null {
  const n = dong(v)
  if (n == null) return null
  const k = key === 'waterPrice' ? (waterUnit === 'person' ? 'waterPrice:person' : 'waterPrice:m3') : key
  const max = RENTAL_FEE_MAX[k]
  const min = RENTAL_FEE_MIN[k]
  return (max == null || n <= max) && (min == null || n >= min) ? n : null
}

/** `waterUnit` → what the water price is quoted per. ⚠️ AN UNKNOWN UNIT PRINTS NO WATER ROW: 18,000 đ per person, per m³
 *  or per month are different charges, and an amount without its basis is no promise at all (a reviewer's catch) —
 *  the pair then keeps its generic rows. */
const WATER_PER: Readonly<Record<string, LabelPair>> = {
  person: { label: 'person per month', labelVi: 'người / tháng' },
  m3: { label: 'm³', labelVi: 'm³' },
}

/** The heading row: the rent itself, so the block reads as the whole monthly bill. */
export const RENT_ROW: LabelPair = { label: 'Rent', labelVi: 'Tiền thuê' }
export const RENT_PER: LabelPair = { label: 'month', labelVi: 'tháng' }

/** Section and row labels the page prints — authored pairs, harvested like every other. */
export const RENTAL_FACT_LABELS = {
  // "Costs", not "Monthly costs": the deposit is paid once (a reviewer's catch, 2026-10-19).
  costs: { label: 'Costs', labelVi: 'Chi phí' },
  amenities: { label: 'Amenities', labelVi: 'Tiện ích' },
  maxTenants: { label: 'Max. occupants', labelVi: 'Số người ở tối đa' },
  floor: { label: 'Floor', labelVi: 'Tầng' },
  availableFrom: { label: 'Available from', labelVi: 'Trống từ ngày' },
  groundFloor: { label: 'Ground floor', labelVi: 'Tầng trệt' },
  mezzanineFloor: { label: 'Mezzanine', labelVi: 'Tầng lửng' },
  // A guessed amount (CostRow.estimated): the word printed after its unit, in plain sight (rental-facts.tsx).
  estimate: { label: 'estimate', labelVi: 'ước tính' },
} as const satisfies Record<string, LabelPair>

/**
 * ⛔ THE FLAG BESIDE A GUESSED AMOUNT (owner, 2026-10-20: "fix error electricity prices with closest guess"): it holds
 * THE GUESSED FIGURE ITSELF — the importer's closest reading of an impossible rate (goplus-listing.ts
 * goplusElectricityGuess: 44,000 đ/kWh read as 4,000 → `electricityPrice: '4000', electricityEstimated: '4000'`) — and the
 * row says "≈ … estimate", never the guess as fact, only WHILE `electricityPrice` STILL IS THAT FIGURE. ⚠️ BOUND TO THE
 * FIGURE, NOT A YES/NO (reviewers' catch, 2026-10-20): the editor sends every stored attribute back, so a bare '1' outlived
 * a corrected rate and printed a person's real 3,500 as "≈ 3,500 estimate"; a figure edited since is no longer the guess,
 * and the stale flag is ignored. In practice the two move TOGETHER: no form asks the rate (the taxonomy has no
 * electricity field — the edit screen only carries it back unchanged), and the weekly import rewrites `attributes` whole
 * (import-goplus.ts MUTABLE_KEYS), so a figure GoPlus corrects loses its flag that week. Only an /api/v1 write can set
 * one without the other. Like `waterUnit`, it qualifies a cost and prints nothing itself. Any seller's API post can carry
 * the key too — it then only calls that seller's own figure an estimate. Electricity only: every other implausible fee
 * is still dropped. Nothing else reads the rate: the feeds, JSON-LD and search text never print it.
 */
export const ELECTRICITY_ESTIMATED = 'electricityEstimated'

/**
 * Every attribute key this module can draw — plus the two that only qualify a cost (`waterUnit`, ELECTRICITY_ESTIMATED).
 * The page hides the WELL-FORMED ones (rentalFactHiddenKeys), never all.
 */
export const RENTAL_FACT_KEYS: readonly string[] = [...COSTS.map((c) => c.key), 'waterUnit', ELECTRICITY_ESTIMATED, 'maxTenants', 'floor', 'availableFrom']

/**
 * Do these sections apply to this listing at all? A PLACE rental (the availability check's own gate — never vehicle hire,
 * whose prices are per day and whose "deposit" is a different thing) priced in đồng: every amount below is printed
 * as đồng, so a listing quoted in another currency gets none of it and keeps its generic rows.
 */
export function rentalFactsApply(l: { categorySlug: string | null | undefined; subcategorySlug: string | null | undefined; listingType: string | null | undefined; currency: string | null | undefined }): boolean {
  return l.listingType === 'rent' && (l.currency === '₫' || l.currency === 'VND') && rentalCheckApplies(l.categorySlug, l.subcategorySlug)
}

/** `estimated`: the amount is a guess (ELECTRICITY_ESTIMATED) — the page prints "≈" before it and "estimate" after it. */
export type CostRow = { key: string; name: LabelPair; amount: number; per: LabelPair | null; estimated: boolean }

/** A positive whole number (of people), from the stored string — else null. */
function wholePositive(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim()
  if (!/^\d{1,12}$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}

/**
 * An amount of đồng: a whole number of at least MIN_DONG. ⚠️ THE FLOOR IS WHAT KEEPS A SELLER'S "2" (months) OFF A ĐỒNG
 * ROW — no electricity tariff, water charge or fee in Vietnam is under 100 đ, and "2 đ" would be a wrong promise.
 */
const MIN_DONG = 100
function dong(v: unknown): number | null {
  const n = wholePositive(v)
  return n != null && n >= MIN_DONG ? n : null
}

/** A real calendar day as `YYYY-MM-DD` — it must survive a round trip (Date.parse turns 2027-02-29 into 1 March). */
function calendarDay(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const t = Date.parse(`${s}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null
}

/** The floor as this module prints it — '0' ground, 'mezzanine', a whole number — else null. */
function floorOf(v: unknown): number | LabelPair | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s === 'mezzanine') return RENTAL_FACT_LABELS.mezzanineFloor
  if (!/^\d{1,3}$/.test(s)) return null
  // '0', '00', '000' are all the ground floor (tầng trệt) — never "Floor 0".
  return Number(s) === 0 ? RENTAL_FACT_LABELS.groundFloor : Number(s)
}

/** A cost row's amount, or null: plausible đồng, and for water a KNOWN unit as well (WATER_PER). */
function costAmount(key: string, attributes: Record<string, unknown>): number | null {
  if (key === 'waterPrice' && !(typeof attributes.waterUnit === 'string' && Object.hasOwn(WATER_PER, attributes.waterUnit))) return null
  return plausibleFee(key, attributes[key], attributes.waterUnit)
}

/**
 * The keys the page hides from the generic Details table: each WELL-FORMED rental-fact key (what this module draws, or
 * deliberately leaves unsaid — a move-in date already passed). A malformed value is not in the set, so it keeps the
 * generic row it always had. Call only where rentalFactsApply holds.
 */
export function rentalFactHiddenKeys(attributes: Record<string, unknown> | null | undefined): string[] {
  if (!attributes) return []
  const out: string[] = []
  for (const c of COSTS) if (costAmount(c.key, attributes) != null) out.push(c.key)
  if (costAmount('waterPrice', attributes) != null) out.push('waterUnit')
  // The estimate flag is machine data — a raw "electricity estimated: 4000" says nothing to a reader — so a well-formed one
  // is hidden even when it no longer matches the rate (a corrected figure) or sits beside a rate the row cannot print.
  if (wholePositive(attributes[ELECTRICITY_ESTIMATED]) != null) out.push(ELECTRICITY_ESTIMATED)
  const tenants = wholePositive(attributes.maxTenants)
  if (tenants != null && tenants <= 50) out.push('maxTenants')
  if (floorOf(attributes.floor) != null) out.push('floor')
  if (calendarDay(attributes.availableFrom) != null) out.push('availableFrom')
  return out
}

/**
 * The monthly-cost rows a listing states, in print order: deposit, electricity, water, service fee, parking. Empty when
 * it states none — the page then draws no block at all (the rent alone is already the price in the buy box).
 * The electricity row is `estimated` while ELECTRICITY_ESTIMATED holds the very figure it prints (see there).
 */
export function rentalCostRows(attributes: Record<string, unknown> | null | undefined): CostRow[] {
  if (!attributes) return []
  const rows: CostRow[] = []
  for (const c of COSTS) {
    const amount = costAmount(c.key, attributes)
    if (amount == null) continue
    const estimated = c.key === 'electricityPrice' && wholePositive(attributes[ELECTRICITY_ESTIMATED]) === amount
    const per = c.key === 'waterPrice' ? WATER_PER[String(attributes.waterUnit)] : c.per
    rows.push({ key: c.key, name: c.name, amount, per, estimated })
  }
  return rows
}

export type FactRow =
  | { key: 'maxTenants'; name: LabelPair; count: number }
  | { key: 'floor'; name: LabelPair; floor: number | LabelPair }
  | { key: 'availableFrom'; name: LabelPair; date: string }

/** `YYYY-MM-DD` of `now` in Vietnam (UTC+7, no DST) — the calendar a move-in date is written in. */
function vnToday(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
}

/**
 * The occupancy rows a listing states: max occupants, floor, available-from. `availableFrom` prints only while it is
 * still ahead (a date already passed says nothing a vacant room does not), judged on the server at render time — the
 * page is ISR, so a date may outlive its day by one revalidation, never cause a hydration mismatch (no client clock).
 */
export function rentalFactRows(attributes: Record<string, unknown> | null | undefined, now: Date = new Date()): FactRow[] {
  if (!attributes) return []
  const rows: FactRow[] = []
  const tenants = wholePositive(attributes.maxTenants)
  if (tenants != null && tenants <= 50) rows.push({ key: 'maxTenants', name: RENTAL_FACT_LABELS.maxTenants, count: tenants })
  // '0' = ground (tầng trệt), 'mezzanine' = tầng lửng, a whole number = that floor. Anything else is not printed.
  const floor = floorOf(attributes.floor)
  if (floor != null) rows.push({ key: 'floor', name: RENTAL_FACT_LABELS.floor, floor })
  const date = calendarDay(attributes.availableFrom)
  if (date && date > vnToday(now)) rows.push({ key: 'availableFrom', name: RENTAL_FACT_LABELS.availableFrom, date })
  return rows
}

/**
 * The amenities a listing carries (its `facetTokens` `amenities:*` values), as the taxonomy's options — in the
 * taxonomy's order, which leads with GoPlus's two headline filters (no live-in landlord, car access), with the
 * taxonomy's labels, so the page and the filter chip a renter tapped say the same words. A token the taxonomy does not
 * list is not printed (it has no authored label to print).
 */
export function amenityOptions(facetTokens: string | null | undefined, categorySlug: string, subcategorySlug: string | null | undefined): (LabelPair & { value: string })[] {
  const held = new Set(facetValues(facetTokens, 'amenities'))
  if (!held.size) return []
  const facet = facetsFor(categorySlug, subcategorySlug).find((f) => f.key === 'amenities')
  return facet ? facet.options.filter((o) => held.has(o.value)).map((o) => ({ value: o.value, label: o.label, labelVi: o.labelVi })) : []
}
