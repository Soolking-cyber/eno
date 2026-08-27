import { describe, expect, it } from 'vitest'
import { isHcmc } from './city-short'

describe('isHcmc', () => {
  /** The value 9,726 of 9,773 live listings carry, in the exact form the database stores. */
  it('matches the stored form', () => {
    expect(isHcmc('Hồ Chí Minh')).toBe(true)
  })

  /**
   * ⚠️ DECOMPOSED VIETNAMESE MUST MATCH. "ồ" written as o + combining circumflex + combining grave
   * is three code points and is NOT equal to the composed character — a comparison that looks
   * correct and silently never fires. This test is the reason `fold()` normalises.
   */
  it('matches the decomposed spelling of the same name', () => {
    const decomposed = 'Hồ Chí Minh'.normalize('NFD')
    expect(decomposed).not.toBe('Hồ Chí Minh')       // the input really is different bytes
    expect(isHcmc(decomposed)).toBe(true)
  })

  it.each([
    'Ho Chi Minh',
    'Ho Chi Minh City',
    'ho chi minh city',
    'Thành phố Hồ Chí Minh',
    'Thanh pho Ho Chi Minh',
    '  Hồ Chí Minh  ',
    'TP. Hồ Chí Minh',
    'TP.Hồ Chí Minh',
    'TP Ho Chi Minh',
  ])('matches %s', (v) => expect(isHcmc(v)).toBe(true))

  /**
   * ⛔ A DISTRICT INSIDE THE CITY IS NOT THE CITY. "Thu Duc, Ho Chi Minh City" is a real value in
   * the catalogue, and its useful half is the district — shortening the whole label to "HCM" would
   * delete the more specific fact. This is why the pattern is anchored rather than a substring test.
   */
  it('does not match a district-qualified label', () => {
    expect(isHcmc('Thu Duc, Ho Chi Minh City')).toBe(false)
    expect(isHcmc('Bình Thạnh')).toBe(false)
  })

  it.each(['Hà Nội', 'Ha Tinh', 'Nha Trang, Khanh Hoa', 'Đà Nẵng', 'Phu Quoc, Kien Giang'])(
    'leaves %s alone', (v) => expect(isHcmc(v)).toBe(false))

  it('handles absent values without throwing', () => {
    expect(isHcmc(null)).toBe(false)
    expect(isHcmc(undefined)).toBe(false)
    expect(isHcmc('')).toBe(false)
  })
})
