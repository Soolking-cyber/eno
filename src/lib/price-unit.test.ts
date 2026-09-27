import { describe, expect, it } from 'vitest'
import { priceUnitSuffix, UNIT_CODES } from './price-unit'

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
