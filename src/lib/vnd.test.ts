import { describe, it, expect } from 'vitest'
import { parseVnd, formatMoneyFull, formatVndIso, compactPrice, formatCount, formatInteger, formatRating, groupVnd, hugeVnd, HUGE_VND } from './vnd'

// Money is always displayed grouped + suffixed "đ"; parseVnd is the inverse used
// on every price input. They must round-trip.
describe('parseVnd', () => {
  it('strips dot/comma separators to an integer', () => {
    expect(parseVnd('1.080.000.000')).toBe(1_080_000_000)
    expect(parseVnd('5,000,000 VND')).toBe(5_000_000)
    // The round-trip half: what formatMoneyFull prints now, in both locales.
    expect(parseVnd(formatMoneyFull(1_200_000, '₫'))).toBe(1_200_000)
    expect(parseVnd(formatMoneyFull(1_200_000, '₫', 'vi'))).toBe(1_200_000)
  })

  it('returns 0 for empty / non-numeric', () => {
    expect(parseVnd('')).toBe(0)
    expect(parseVnd('abc')).toBe(0)
  })
})

describe('formatMoneyFull', () => {
  it('formats ₫ as grouped digits + đ suffix (en default)', () => {
    expect(formatMoneyFull(1_080_000_000, '₫')).toBe('1,080,000,000 đ')
    expect(formatMoneyFull(0, '₫')).toBe('0 đ')
  })

  it('formatVndIso keeps the ISO code for provider-facing text', () => {
    expect(formatVndIso(3_000_000)).toBe('3,000,000 VND')
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

  it('formatInteger groups a count in full, per locale — never compact, never a currency', () => {
    expect(formatInteger(63730)).toBe('63,730')
    expect(formatInteger(63730, 'vi')).toBe('63.730')
    expect(formatInteger(950, 'vi')).toBe('950')
    expect(formatInteger(1234.6)).toBe('1,235')
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

/** The narrow-surface form for 10 billion đồng and up (break-ui, 2026-10-05): the reader's scale words, exact
 *  to the million in every scale. */
describe('hugeVnd', () => {
  it('reads in the UI language\'s own scale words', () => {
    expect(HUGE_VND).toBe(10_000_000_000)
    expect(hugeVnd(95_000_000_000, 'vi')).toBe('95 tỷ đ')
    expect(hugeVnd(95_000_000_000, 'en')).toBe('95 billion đ')
    expect(hugeVnd(95_000_000_000, 'zh-Hans')).toBe('950亿 đ')
    expect(hugeVnd(95_000_000_000, 'fr')).toBe('95 milliards đ')
    expect(hugeVnd(1_000_000_000_000, 'vi')).toBe('1.000 tỷ đ') // hand-built for the SSR languages
    expect(hugeVnd(1_000_000_000_000, 'en')).toBe('1,000 billion đ')
  })
  it('is exact to the million — a different price never reads the same', () => {
    expect(hugeVnd(10_040_000_000, 'vi')).toBe('10,04 tỷ đ')
    expect(hugeVnd(12_340_000_000, 'vi')).not.toBe(hugeVnd(12_310_000_000, 'vi'))
    expect(hugeVnd(12_345_000_000, 'th')).toBe(`${new Intl.NumberFormat('th-TH', { notation: 'compact', compactDisplay: 'long', maximumFractionDigits: 6 }).format(12_345_000_000)} đ`)
    expect(hugeVnd(12_345_000_000, 'th')).toContain('1.2345') // three digits rounded this to 1.235
    expect(hugeVnd(999_999_000_000, 'hi')).not.toBe(hugeVnd(1_000_000_000_000, 'hi'))
  })
})
