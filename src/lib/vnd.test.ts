import { describe, it, expect } from 'vitest'
import { parseVnd, formatMoneyFull, compactPrice, formatCount, formatRating, groupVnd } from './vnd'

// Money is always displayed grouped + suffixed "VND"; parseVnd is the inverse used
// on every price input. They must round-trip.
describe('parseVnd', () => {
  it('strips dot/comma separators to an integer', () => {
    expect(parseVnd('1.080.000.000')).toBe(1_080_000_000)
    expect(parseVnd('5,000,000 VND')).toBe(5_000_000)
  })

  it('returns 0 for empty / non-numeric', () => {
    expect(parseVnd('')).toBe(0)
    expect(parseVnd('abc')).toBe(0)
  })
})

describe('formatMoneyFull', () => {
  it('formats ₫ as grouped digits + VND suffix (en default)', () => {
    expect(formatMoneyFull(1_080_000_000, '₫')).toBe('1,080,000,000 VND')
    expect(formatMoneyFull(0, '₫')).toBe('0 VND')
  })

  it('vi: dot thousands + đ suffix', () => {
    expect(formatMoneyFull(12_000_000, '₫', 'vi')).toBe('12.000.000 đ')
    expect(formatMoneyFull(1_080_000_000, '₫', 'vi')).toBe('1.080.000.000 đ')
  })

  it('round-trips with parseVnd in both locales', () => {
    expect(parseVnd(formatMoneyFull(12_000_000, '₫'))).toBe(12_000_000)
    expect(parseVnd(formatMoneyFull(12_000_000, '₫', 'vi'))).toBe(12_000_000)
  })
})

describe('compactPrice', () => {
  it('en keeps international suffixes', () => {
    expect(compactPrice(51_000_000)).toBe('51M')
    expect(compactPrice(1_200_000_000)).toBe('1.2B')
    expect(compactPrice(850_000)).toBe('850K')
  })

  it('vi uses native shorthand with comma decimal', () => {
    expect(compactPrice(51_000_000, 'vi')).toBe('51tr')
    expect(compactPrice(1_200_000_000, 'vi')).toBe('1,2 tỷ')
    expect(compactPrice(500_000, 'vi')).toBe('500k')
  })
})

describe('formatCount / formatRating / groupVnd', () => {
  it('abbreviates counts per locale', () => {
    expect(formatCount(1200)).toBe('1.2k')
    expect(formatCount(1200, 'vi')).toBe('1,2k')
    expect(formatCount(950)).toBe('950')
  })

  it('ratings use comma decimal for vi', () => {
    expect(formatRating(4.8)).toBe('4.8')
    expect(formatRating(4.8, 'vi')).toBe('4,8')
  })

  it('groups live input per locale', () => {
    expect(groupVnd('12000000')).toBe('12,000,000')
    expect(groupVnd('12000000', 'vi')).toBe('12.000.000')
  })
})
