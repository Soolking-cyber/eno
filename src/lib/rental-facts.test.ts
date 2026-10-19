import { describe, expect, it } from 'vitest'
import { RENTAL_FACT_KEYS, amenityOptions, plausibleFee, rentalCostRows, rentalFactHiddenKeys, rentalFactRows, rentalFactsApply } from './rental-facts'

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
    expect([...RENTAL_FACT_KEYS].sort()).toEqual(['availableFrom', 'deposit', 'electricityPrice', 'floor', 'maxTenants', 'parkingFee', 'serviceFee', 'waterPrice', 'waterUnit'])
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
    for (const k of rentalFactHiddenKeys({ ...GOPLUS, availableFrom: '2030-01-01' })) expect(RENTAL_FACT_KEYS).toContain(k)
  })
})
