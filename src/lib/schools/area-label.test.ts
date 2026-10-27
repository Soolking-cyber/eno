import { describe, expect, it } from 'vitest'
import { HCMC_AREAS, areaLabel } from './constants'

// Sweep 2026-10-22: Vietnamese school pages printed "District 1", "Thu Duc City (D2 & D9)", "Binh Thanh".
describe('areaLabel — an area as the reader reads it; the English stays the stored value', () => {
  it('every listed area has its Vietnamese name, and English pages keep the stored one', () => {
    for (const a of HCMC_AREAS) {
      expect(areaLabel(a, 'vi')).not.toBe(a)
      expect(areaLabel(a, 'en')).toBe(a)
    }
    expect(areaLabel('District 1', 'vi')).toBe('Quận 1')
    expect(areaLabel('Thu Duc City (D2 & D9)', 'vi')).toBe('TP. Thủ Đức (Q2 & Q9)')
    expect(areaLabel('Binh Thanh', 'vi')).toBe('Bình Thạnh')
  })
  it('a value not on the list prints as stored', () => {
    expect(areaLabel('Vung Tau', 'vi')).toBe('Vung Tau')
  })
})
