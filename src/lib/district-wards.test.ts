import { describe, expect, it } from 'vitest'
import { topWards, wardOf } from './district-wards'
import { joinNames } from './join-names'

describe('wardOf', () => {
  it('reads the Vietnamese and the English form, in the official spelling, and nothing from a location without a ward', () => {
    expect(wardOf('Quận 12 (Phường An Phú Đông)')).toBe('An Phú Đông')
    expect(wardOf('Thao Dien Ward, Thu Duc')).toBe('Thảo Điền')
    expect(wardOf('Quận 3 (Phường 7)')).toBe('7')
    expect(wardOf('Quận 12, Hồ Chí Minh')).toBeNull()
    expect(wardOf('Quận Tân Bình (Sora Apartment)')).toBeNull()
    expect(wardOf(null)).toBeNull()
  })

  it('prints no seller free text: only a listed ward or a number; "07" is ward 7; decomposed text still reads', () => {
    expect(wardOf('Quận 2 (Phường Thảo Điền gần sông)')).toBeNull()
    expect(wardOf('Quận 7 (Phường liên hệ Zalo nhé)')).toBeNull()
    expect(wardOf('Phường 7 Quận 3 gần công viên')).toBeNull()
    expect(wardOf('District 1 Ward 5')).toBeNull()
    expect(wardOf('Quận Tân Bình (Sora Apartment, near ward office)')).toBeNull()
    expect(wardOf('Quận 3 (Phường 07)')).toBe('7')
    expect(wardOf('Quận 3 (Phường 0)')).toBeNull()
    expect(wardOf('Quận 3 (Phường 99)')).toBeNull()
    expect(wardOf('Quận 12 (Phường An Phú Đông)'.normalize('NFD'))).toBe('An Phú Đông')
    // Unaccented and shared by two wards (Tân Định, HCMC; Tân Dĩnh elsewhere): prints neither.
    expect(wardOf('Tan Dinh Ward, District 1')).toBeNull()
    expect(wardOf('Quận 1 (Phường Tân Định)')).toBe('Tân Định')
  })
})

describe('topWards', () => {
  it('ranks by count over the scope, merges spellings, names numbered wards', () => {
    const wards = topWards([
      { location: 'Quận 2 (Phường Thao Dien)', count: 3 },
      { location: 'Quận 2 (Phường Thảo Điền)', count: 2 },
      { location: 'Quận 3 (Phường 7)', count: 4 },
      { location: 'Quận 12, Hồ Chí Minh', count: 50 },
      { location: 'Quận 2 (Phường An Khánh)', count: 1 },
    ])
    expect(wards).toEqual([
      { en: 'Thảo Điền', vi: 'Thảo Điền' },
      { en: 'Ward 7', vi: 'Phường 7' },
      { en: 'An Khánh', vi: 'An Khánh' },
    ])
  })

  it('stops at max', () => {
    const names = ['Tân Định', 'Đa Kao', 'Bến Nghé', 'Bến Thành', 'Cầu Kho', 'Cô Giang']
    const groups = names.map((n, i) => ({ location: `Quận 1 (Phường ${n})`, count: 10 - i }))
    expect(topWards(groups, 5).map((w) => w.en)).toEqual(names.slice(0, 5))
  })
})

describe('joinNames', () => {
  it('joins in each language', () => {
    expect(joinNames(['A', 'B', 'C'], 'en')).toBe('A, B and C')
    expect(joinNames(['A', 'B', 'C'], 'vi')).toBe('A, B và C')
    expect(joinNames(['A'], 'en')).toBe('A')
  })
})
