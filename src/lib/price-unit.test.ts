import { describe, expect, it } from 'vitest'
import { displayPriceUnit, priceUnitSuffix, UNIT_CODES } from './price-unit'
import { serializeListingCard } from './serialize'

/** `<Price>`'s inline parse at price.tsx:87-88 (176c0d63), verbatim: the expression the helper replaced. */
function oldInline(priceUnit: string) {
  const unitStripped = !priceUnit || priceUnit === 'VND' ? null : priceUnit.replace(/^VND\/?/, '').trim() || null
  return unitStripped === 'service' ? null : unitStripped
}

/** Every value stored in production (measured 2026-09-27), the CI fixture's bare unit, and odd shapes. */
const STORED = ['', 'VND', 'VND/month', 'VND/service', 'VND/kg', 'VND/hour']
const ODD = [
  'month', 'service', 'VND/', 'VND/ ', ' VND/month', 'VND/ month ', 'VND/service ', 'VND / month',
  'VNDmonth', 'USD/month', 'vnd/month', 'VND/week', 'VND/day', 'VND/toString',
]

describe('priceUnitSuffix', () => {
  it.each([...STORED, ...ODD])('reads %j exactly as <Price> did', (u) => {
    expect(priceUnitSuffix(u)).toBe(oldInline(u))
  })

  it('gives the suffix <Price> prints, and none for a bare VND, an empty unit or a service', () => {
    expect(priceUnitSuffix('VND')).toBeNull()
    expect(priceUnitSuffix('')).toBeNull()
    expect(priceUnitSuffix('VND/month')).toBe('month')
    expect(priceUnitSuffix('month')).toBe('month')
    expect(priceUnitSuffix('VND/service')).toBeNull()
    expect(priceUnitSuffix('VND/kg')).toBe('kg')
  })

  it('treats a missing column as no unit', () => {
    expect(priceUnitSuffix(null)).toBeNull()
    expect(priceUnitSuffix(undefined)).toBeNull()
  })
})

describe('UNIT_CODES', () => {
  it('maps the units a listing can carry to UN/CEFACT codes', () => {
    expect([...UNIT_CODES]).toEqual([['month', 'MON'], ['week', 'WEE'], ['day', 'DAY'], ['hour', 'HUR'], ['kg', 'KGM']])
  })

  it('has a code for every suffix a stored unit yields', () => {
    for (const u of STORED) {
      const suffix = priceUnitSuffix(u)
      if (suffix) expect(UNIT_CODES.get(suffix), u).toBeDefined()
    }
  })

  it('finds nothing for a unit it does not list, including an Object.prototype name', () => {
    expect(UNIT_CODES.get('service')).toBeUndefined()
    expect(UNIT_CODES.get('toString')).toBeUndefined()
    expect(UNIT_CODES.get('fortnight')).toBeUndefined()
  })
})

/**
 * K-RENT-UNIT (2026-09-29): Batdongsan and Rever store monthly rent as a bare 'VND' (~19,400 active
 * rentals), so their cards printed no "/ month". The DISPLAY rule reads the two proven sellers; the
 * column and every other seller are untouched — Nhatot stores bare 'VND' too and is NOT monthly-proven
 * (rent-index.test.ts pins that).
 */
describe('displayPriceUnit', () => {
  it('reads a Batdongsan or Rever bare VND as monthly', () => {
    expect(displayPriceUnit('VND', 'bds-vn-import-seller-0001')).toBe('VND/month')
    expect(displayPriceUnit('VND', 'cmub0wead0000zrq418bqq27m')).toBe('VND/month')
  })

  it('leaves every other seller, and every other unit, exactly as stored', () => {
    expect(displayPriceUnit('VND', 'nhatot-import-seller-0001')).toBe('VND')
    expect(displayPriceUnit('VND', null)).toBe('VND')
    expect(displayPriceUnit('VND/month', 'cmub0wead0000zrq418bqq27m')).toBe('VND/month')
    expect(displayPriceUnit('', 'bds-vn-import-seller-0001')).toBe('')
    expect(displayPriceUnit('VND/service', 'anyone')).toBe('VND/service')
  })

  it('a Rever card row serializes the monthly unit, so <Price> prints "/ month"', () => {
    const card = serializeListingCard({
      sellerId: 'cmub0wead0000zrq418bqq27m', id: 'l1', title: 'Căn hộ 2PN', titleVi: null, price: 5_000_000, priceUnit: 'VND',
      currency: 'VND', negotiable: false, location: 'Q7', district: null, city: 'HCMC', previousPrice: null, priceDropAt: null,
      urgentUntil: null, lat: null, lng: null, images: '[]', video: null, brandSlug: null, model: null, condition: null,
      marketPosition: null, verified: true, postedAt: new Date(), createdAt: new Date(), savedCount: 0, contactCount: 0,
      affiliateUrl: null, category: { id: 'c', name: 'Rentals', nameVi: 'Cho thuê', slug: 'rentals', icon: 'Home', color: 'sky' },
      seller: { trustScore: 100, officialPartner: false },
    })
    expect(card.priceUnit).toBe('VND/month')
    expect(priceUnitSuffix(card.priceUnit)).toBe('month')
  })
})
