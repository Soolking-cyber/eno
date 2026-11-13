import { describe, expect, it } from 'vitest'
import { ELECTRICITY_ESTIMATED, RENTAL_FACT_KEYS, RENTAL_FACT_LABELS, amenityOptions, bedroomsOf, depositSummary, plausibleFee, rentalCostRows, rentalFactHiddenKeys, rentalFactRows, rentalFactsApply, type CostRow } from './rental-facts'

/**
 * A rental's structured facts for the listing page (GoPlus partnership, 2026-10-19). The importer writes every value as
 * a STRING (attr-match.ts's substring match needs it); these readers turn them into rows, and print NOTHING for a
 * value that is not a real amount, count, floor or date — a wrong cost row is a wrong promise to a tenant.
 */
const GOPLUS = {
  bedrooms: '1', aptType: 'duplex', deposit: '3500000', maxTenants: '2', floor: '0',
  electricityPrice: '3800', waterPrice: '100000', waterUnit: 'person', serviceFee: '150000', parkingFee: '100000',
}

describe('rentalCostRows', () => {
  it('prints deposit, electricity, water, service fee and parking in that order, each with its unit', () => {
    const rows = rentalCostRows(GOPLUS)
    expect(rows.map((r) => [r.key, r.amount, r.per?.label ?? null])).toEqual([
      ['deposit', 3_500_000, null],
      ['electricityPrice', 3_800, 'kWh'],
      ['waterPrice', 100_000, 'person per month'],
      ['serviceFee', 150_000, 'month'],
      ['parkingFee', 100_000, 'vehicle per month'],
    ])
    expect(rows.find((r) => r.key === 'serviceFee')!.name).toEqual({ label: 'Service / management fee', labelVi: 'Phí dịch vụ' })
  })

  it('quotes water per m³ when the building meters it — and prints no water row for an unknown unit', () => {
    expect(rentalCostRows({ waterPrice: '18000', waterUnit: 'm3' })[0].per).toEqual({ label: 'm³', labelVi: 'm³' })
    // A reviewer's catch (2026-10-19): an amount without its basis is no promise — the pair keeps its generic rows.
    expect(rentalCostRows({ waterPrice: '18000', waterUnit: 'bucket' })).toEqual([])
    expect(rentalCostRows({ waterPrice: '18000' })).toEqual([])
    expect(rentalFactHiddenKeys({ waterPrice: '18000', waterUnit: 'bucket' })).toEqual([])
  })

  // A reviewer's catch (2026-10-19): a seller's deposit "2" (months) must never print as "2 đ".
  it('prints no amount under 100 đ — no tariff or fee in Vietnam is that small, so it is not đồng', () => {
    expect(rentalCostRows({ deposit: '2', electricityPrice: '99', serviceFee: '10000' }).map((r) => r.key)).toEqual(['serviceFee'])
  })

  // A reviewer's catch (2026-10-19), and GoPlus's own outliers: 4,000,000 đ "per kWh", 10,000,000 đ parking a month.
  it('prints no amount below its plausible floor — "3500" for a deposit meant 3.5 million', () => {
    expect(rentalCostRows({ deposit: '3500', serviceFee: '150', parkingFee: '5000', electricityPrice: '400' })).toEqual([])
    expect(rentalCostRows({ deposit: '3500000', serviceFee: '150000' }).map((r) => r.key)).toEqual(['deposit', 'serviceFee'])
  })

  it('prints no amount above its plausible ceiling — the figure is not what its unit says', () => {
    expect(rentalCostRows({ electricityPrice: '4000000', parkingFee: '10000000', serviceFee: '2000000' }).map((r) => r.key)).toEqual(['serviceFee'])
    expect(plausibleFee('waterPrice', '150000', 'person')).toBe(150_000)
    expect(plausibleFee('waterPrice', '150000', 'm3')).toBeNull()
    expect(plausibleFee('waterPrice', '18000', undefined)).toBe(18_000)
    expect(plausibleFee('electricityPrice', '3800')).toBe(3_800)
    expect(rentalFactHiddenKeys({ electricityPrice: '4000000' })).toEqual([])
  })

  it('prints nothing for a zero, a negative, a fraction, junk, or no attributes', () => {
    expect(rentalCostRows({ deposit: '0', electricityPrice: '-3800', serviceFee: '1.5', parkingFee: 'free', waterPrice: '' })).toEqual([])
    expect(rentalCostRows(null)).toEqual([])
    expect(rentalCostRows({ bedrooms: '2' })).toEqual([])
  })

  // Owner, 2026-10-20: "fix error electricity prices with closest guess" — the importer's guess carries its flag, and a
  // row that knows it is a guess is never printed as fact (rental-facts.tsx).
  it('⛔ knows a GUESSED electricity rate: estimated iff electricityEstimated holds the very figure printed, electricity only', () => {
    expect(ELECTRICITY_ESTIMATED).toBe('electricityEstimated')
    const rows = rentalCostRows({ ...GOPLUS, electricityPrice: '4000', electricityEstimated: '4000' })
    expect(rows.map((r) => [r.key, r.estimated])).toEqual([
      ['deposit', false], ['electricityPrice', true], ['waterPrice', false], ['serviceFee', false], ['parkingFee', false],
    ])
    expect(rows.find((r) => r.key === 'electricityPrice')).toMatchObject({ amount: 4_000, per: { label: 'kWh', labelVi: 'kWh' } })
    expect(rentalCostRows(GOPLUS).every((r) => r.estimated === false)).toBe(true)
    for (const flag of ['1', '0', 'true', 'yes', '', '4000.5', '-4000', 4_001, true, null]) {
      expect(rentalCostRows({ electricityPrice: '4000', electricityEstimated: flag })[0].estimated, JSON.stringify(flag)).toBe(false)
    }
    // The flag never makes an implausible rate printable — the row's amount test is unchanged.
    expect(rentalCostRows({ electricityPrice: '4000000', electricityEstimated: '4000000' })).toEqual([])
  })

  /**
   * Reviewers' catch (2026-10-20): the editor sends every stored attribute back, so a yes/no flag outlived a corrected
   * rate and called a person's real figure a guess. Bound to the figure, a rate edited since is stated as fact.
   */
  it('⛔ a rate corrected since the guess is no longer an estimate — the stale flag is ignored', () => {
    const corrected = { ...GOPLUS, electricityPrice: '3500', electricityEstimated: '4000' }
    expect(rentalCostRows(corrected).find((r) => r.key === 'electricityPrice')).toMatchObject({ amount: 3_500, estimated: false })
    // …and the stale flag never reaches the generic table as a raw figure.
    expect(rentalFactHiddenKeys(corrected)).toEqual(expect.arrayContaining(['electricityPrice', 'electricityEstimated']))
  })

  it('the estimate\'s word is an authored pair', () => {
    expect(RENTAL_FACT_LABELS.estimate).toEqual({ label: 'estimate', labelVi: 'ước tính' })
  })
})

describe('rentalFactRows', () => {
  const NOW = new Date('2026-10-19T10:00:00Z')

  it('prints max occupants and the floor — ground as words, a number as itself', () => {
    expect(rentalFactRows(GOPLUS, NOW)).toEqual([
      { key: 'maxTenants', name: { label: 'Max. occupants', labelVi: 'Số người ở tối đa' }, count: 2 },
      { key: 'floor', name: { label: 'Floor', labelVi: 'Tầng' }, floor: { label: 'Ground floor', labelVi: 'Tầng trệt' } },
    ])
    expect(rentalFactRows({ floor: '3' }, NOW)).toEqual([{ key: 'floor', name: { label: 'Floor', labelVi: 'Tầng' }, floor: 3 }])
    expect(rentalFactRows({ floor: 'mezzanine' }, NOW)[0]).toMatchObject({ floor: { label: 'Mezzanine', labelVi: 'Tầng lửng' } })
    expect(rentalFactRows({ floor: 'Tầng Trệt' }, NOW)).toEqual([])
    expect(rentalFactRows({ floor: '00' }, NOW)[0]).toMatchObject({ floor: { label: 'Ground floor', labelVi: 'Tầng trệt' } })
  })

  it('prints a move-in date only while it is still ahead, in Vietnam\'s calendar', () => {
    expect(rentalFactRows({ availableFrom: '2026-10-25' }, NOW)).toEqual([
      { key: 'availableFrom', name: { label: 'Available from', labelVi: 'Trống từ ngày' }, date: '2026-10-25' },
    ])
    expect(rentalFactRows({ availableFrom: '2026-10-19' }, NOW)).toEqual([])
    expect(rentalFactRows({ availableFrom: '2026-10-01' }, NOW)).toEqual([])
    // 23:30 UTC on the 19th is already the 20th in Vietnam — a room free "from the 20th" is free today.
    expect(rentalFactRows({ availableFrom: '2026-10-20' }, new Date('2026-10-19T23:30:00Z'))).toEqual([])
    expect(rentalFactRows({ availableFrom: 'soon' }, NOW)).toEqual([])
    // Not a real day: Date.parse would quietly make these 1 March / 3 March.
    expect(rentalFactRows({ availableFrom: '2027-02-29' }, NOW)).toEqual([])
    expect(rentalFactRows({ availableFrom: '2027-02-31' }, NOW)).toEqual([])
    expect(rentalFactRows({ availableFrom: '2028-02-29' }, NOW)).toHaveLength(1)
  })

  it('refuses an absurd occupancy', () => {
    expect(rentalFactRows({ maxTenants: '0' }, NOW)).toEqual([])
    expect(rentalFactRows({ maxTenants: '400' }, NOW)).toEqual([])
  })
})

describe('amenityOptions', () => {
  it('lists the tokens as the taxonomy\'s options, in its order — headline filters first, unknown tokens out', () => {
    const out = amenityOptions('|amenities:wifi|amenities:car-alley|amenities:jacuzzi|amenities:no-landlord|size:m|', 'rentals', 'apartment-rental')
    expect(out.map((o) => o.value)).toEqual(['no-landlord', 'car-alley', 'wifi'])
    expect(out[0]).toEqual({ value: 'no-landlord', label: 'No live-in landlord', labelVi: 'Không chung chủ' })
  })
  it('is empty without tokens, and outside a view that has the facet', () => {
    expect(amenityOptions(null, 'rentals', 'apartment-rental')).toEqual([])
    expect(amenityOptions('|amenities:wifi|', 'rentals', 'house-rental')).toEqual([])
  })
})

describe('RENTAL_FACT_KEYS', () => {
  it('hides every key this module draws from the generic Details table — and no facet key', () => {
    expect([...RENTAL_FACT_KEYS].sort()).toEqual(['availableFrom', 'deposit', 'electricityEstimated', 'electricityPrice', 'floor', 'maxTenants', 'parkingFee', 'serviceFee', 'waterPrice', 'waterUnit'])
    for (const k of ['bedrooms', 'aptType', 'furnishing']) expect(RENTAL_FACT_KEYS).not.toContain(k)
  })
})

/**
 * WHERE THE FACTS APPLY, AND WHICH RAW KEYS THEY HIDE (reviewer catches, 2026-10-19): only a place rental priced in
 * đồng, and only a well-formed value — anything else keeps the generic Details row it always had.
 */
describe('rentalFactsApply + rentalFactHiddenKeys', () => {
  const apt = { categorySlug: 'rentals', subcategorySlug: 'apartment-rental', listingType: 'rent', currency: '₫' }

  it('applies to a place rental priced in đồng — never vehicle hire, a sale, or another currency', () => {
    expect(rentalFactsApply(apt)).toBe(true)
    expect(rentalFactsApply({ ...apt, currency: 'VND' })).toBe(true)
    expect(rentalFactsApply({ ...apt, subcategorySlug: null })).toBe(true)
    expect(rentalFactsApply({ ...apt, subcategorySlug: 'motorbike-rental' })).toBe(false)
    expect(rentalFactsApply({ ...apt, listingType: 'sell' })).toBe(false)
    expect(rentalFactsApply({ ...apt, currency: 'USD' })).toBe(false)
    expect(rentalFactsApply({ ...apt, categorySlug: 'electronics' })).toBe(false)
  })

  it('hides every well-formed key of a GoPlus room', () => {
    expect(rentalFactHiddenKeys({ ...GOPLUS, availableFrom: '2026-10-25' }).sort()).toEqual(
      ['availableFrom', 'deposit', 'electricityPrice', 'floor', 'maxTenants', 'parkingFee', 'serviceFee', 'waterPrice', 'waterUnit'],
    )
  })

  it('leaves a malformed value in the generic table — and hides a well-formed date already passed (nothing to say)', () => {
    expect(rentalFactHiddenKeys({ deposit: '2 tháng', floor: 'Tầng Trệt', maxTenants: 'many', availableFrom: '2027-02-31', waterUnit: 'person' })).toEqual([])
    expect(rentalFactHiddenKeys({ availableFrom: '2020-01-01' })).toEqual(['availableFrom'])
    // waterUnit only goes with a water price it qualifies.
    expect(rentalFactHiddenKeys({ waterUnit: 'm3' })).toEqual([])
    expect(rentalFactHiddenKeys(null)).toEqual([])
  })

  it('every key it can hide is one this module knows', () => {
    for (const k of rentalFactHiddenKeys({ ...GOPLUS, availableFrom: '2030-01-01', electricityEstimated: '3800' })) expect(RENTAL_FACT_KEYS).toContain(k)
  })

  // A guessed rate's flag (owner, 2026-10-20) is machine data: "electricity estimated: 4000" in the generic table says nothing.
  it('⛔ hides a well-formed estimate flag — even beside a rate the row cannot print — and nothing else', () => {
    expect(rentalFactHiddenKeys({ ...GOPLUS, electricityPrice: '4000', electricityEstimated: '4000' }).sort()).toEqual(
      ['deposit', 'electricityEstimated', 'electricityPrice', 'floor', 'maxTenants', 'parkingFee', 'serviceFee', 'waterPrice', 'waterUnit'],
    )
    expect(rentalFactHiddenKeys({ electricityPrice: '4000000', electricityEstimated: '4000' })).toEqual(['electricityEstimated'])
    // Any other value is not the importer's flag: it keeps its generic row, like every malformed value here.
    expect(rentalFactHiddenKeys({ electricityPrice: '4000', electricityEstimated: 'yes' })).toEqual(['electricityPrice'])
  })
})

describe('depositSummary — the deposit beside the price (best-practice gap 2026-11-10)', () => {
  const row = (amount: number): CostRow => ({ key: 'deposit', name: { label: 'Deposit', labelVi: 'Tiền cọc' }, amount, per: null, estimated: false })
  it('a whole number of months (1–6) reads in months', () => {
    expect(depositSummary([row(3_800_000)], 3_800_000)).toEqual({ months: 1 })
    expect(depositSummary([row(8_000_000)], 4_000_000)).toEqual({ months: 2 })
    expect(depositSummary([row(24_000_000)], 4_000_000)).toEqual({ months: 6 })
  })
  it('anything else is the amount — "2 months" is a promise about money', () => {
    expect(depositSummary([row(3_800_000)], 4_000_000)).toEqual({ amount: 3_800_000 })
    expect(depositSummary([row(28_000_000)], 4_000_000)).toEqual({ amount: 28_000_000 }) // 7 months: not a usual deposit
    expect(depositSummary([row(2_000_000)], 4_000_000)).toEqual({ amount: 2_000_000 }) // half a month
    expect(depositSummary([row(3_000_000)], null)).toEqual({ amount: 3_000_000 }) // rent not per month
  })
  it('no deposit row, no chip', () => {
    expect(depositSummary([], 4_000_000)).toBeNull()
    expect(depositSummary(rentalCostRows({ deposit: '2 tháng' }), 4_000_000)).toBeNull() // free text keeps its own row
  })
})

/**
 * Batch 89 (2026-11-13): the facts line under the title prints the bedroom count — from the `bedrooms` attribute's facet
 * values, in authored words ("1 bedroom", "2 phòng ngủ"), never the filter chip's "2 BR".
 */
describe('bedroomsOf — the facts line\'s bedroom count (batch 89)', () => {
  it("reads the facet's values: 0 a studio, 1–5 that many, 6 the facet's 6+", () => {
    expect(bedroomsOf({ bedrooms: '0' })).toEqual({ studio: true })
    expect(bedroomsOf({ bedrooms: '1' })).toEqual({ n: '1' })
    expect(bedroomsOf({ bedrooms: ' 3 ' })).toEqual({ n: '3' })
    expect(bedroomsOf({ bedrooms: '6' })).toEqual({ n: '6+' })
    expect(bedroomsOf({ bedrooms: 2 })).toEqual({ n: '2' })
    // A larger whole number an importer wrote is printed as written.
    expect(bedroomsOf({ bedrooms: '8' })).toEqual({ n: '8' })
  })
  it('anything else is no fact (the Details row keeps it)', () => {
    for (const v of ['', '2-3', 'two', '-1', '1.5', '100', null, undefined, ['2']]) expect(bedroomsOf({ bedrooms: v }), JSON.stringify(v)).toBeNull()
    expect(bedroomsOf(null)).toBeNull()
  })
  it('its words are authored pairs, and the deposit fact has no colon', () => {
    expect(RENTAL_FACT_LABELS.bedroomOne).toEqual({ label: '1 bedroom', labelVi: '1 phòng ngủ' })
    expect(RENTAL_FACT_LABELS.bedroomsN).toEqual({ label: '{n} bedrooms', labelVi: '{n} phòng ngủ' })
    expect(RENTAL_FACT_LABELS.depositMonth).toEqual({ label: 'Deposit 1 month', labelVi: 'Cọc 1 tháng' })
  })
})
