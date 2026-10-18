import { describe, it, expect } from 'vitest'
import { parseVnd, formatMoneyFull, formatVndIso, compactPrice, formatCount, formatInteger, formatRating, groupVnd, hugeVnd, HUGE_VND, compactVnd, compactVndStep, cardCompactAbove, RATE_COMPACT_VND, vndWords } from './vnd'

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

/**
 * A CARD'S PER-UNIT PRICE READS IN MILLIONS (owner, 2026-10-18 — a rent on one line): the đồng figure still leads,
 * and it is never falsely exact — the label is exact to its step in every language. Vietnamese prints no "đ" after
 * "triệu" ("8,5 triệu", Chợ Tốt's form): the owner's explicit exception the same day ("go on apply all
 * recommended"), so "8,5 triệu / tháng ≈ $332" fits a 390px phone's card. Every other form keeps the mark.
 */
describe('compactVnd', () => {
  it('reads millions in each server language — English with the mark, Vietnamese without one after "triệu"', () => {
    expect(RATE_COMPACT_VND).toBe(1_000_000)
    expect(compactVnd(8_500_000, 'en')).toBe('8.5M đ')
    expect(compactVnd(8_500_000, 'vi')).toBe('8,5 triệu')
    expect(compactVnd(1_000_000, 'en')).toBe('1M đ')
    expect(compactVnd(12_000_000, 'vi')).toBe('12 triệu')
    expect(compactVnd(999_999_000, 'vi')).toBe('999,999 triệu')
  })
  it('drops the mark on that ONE form — the tỷ scale, English, the MT languages and the full figures keep "đ"', () => {
    expect(compactVnd(1_200_000_000, 'vi')).toBe('1,2 tỷ đ') // a tỷ and up: hugeVnd, unchanged
    expect(compactVnd(95_000_000_000, 'vi')).toBe('95 tỷ đ')
    expect(compactVnd(8_500_000, 'en')).toBe('8.5M đ')
    expect(compactVnd(8_500_000, 'zh-Hans')).toBe('850万 đ')
    expect(vndWords(8_500_000, 'vi')).toBe('8,5 triệu đ') // the price input's helper, not a card line
    expect(formatMoneyFull(8_500_000, '₫', 'vi')).toBe('8.500.000 đ') // the PDP, every digit
  })
  it("a tỷ and up is hugeVnd's words, unchanged", () => {
    expect(compactVnd(2_300_000_000, 'vi')).toBe(hugeVnd(2_300_000_000, 'vi'))
    expect(compactVnd(95_000_000_000, 'en')).toBe('95 billion đ')
  })
  it('is exact to its step — a thousand in millions, a million in tỷ — in every UI language', () => {
    expect(compactVndStep(8_555_000)).toBe(1_000)
    expect(compactVndStep(999_999_999)).toBe(1_000)
    expect(compactVndStep(1_500_000_000)).toBe(1_000_000)
    expect(compactVnd(8_555_000, 'en')).toBe('8.555M đ')
    expect(compactVnd(8_555_000, 'vi')).toBe('8,555 triệu')
    expect(compactVnd(8_500_000, 'zh-Hans')).toBe('850万 đ')
    for (const lang of ['zh-Hans', 'ko', 'ja', 'ru', 'km', 'ms', 'th', 'fr', 'hi']) {
      // A thousand apart never reads the same — CJK's 亿 (1e8) and Hindi's करोड़ (1e7) included: with three
      // decimals 999,999,000 printed "10亿".
      expect(compactVnd(999_999_000, lang), lang).not.toBe(compactVnd(999_998_000, lang))
      expect(compactVnd(8_555_000, lang), lang).not.toBe(compactVnd(8_556_000, lang))
      expect(compactVnd(8_500_000, lang).endsWith(' đ'), lang).toBe(true)
    }
  })
})

describe('cardCompactAbove — ONE threshold for a card\'s price and its struck was-price', () => {
  it('a per-unit price of a million or more → millions (a rent, a hire, a monthly salary)', () => {
    expect(cardCompactAbove({ price: 8_500_000, priceUnit: 'VND/month' })).toBe(RATE_COMPACT_VND)
    expect(cardCompactAbove({ price: 1_000_000, priceUnit: 'VND/day', prevPrice: 1_200_000 })).toBe(RATE_COMPACT_VND)
    expect(cardCompactAbove({ price: 15_000_000, priceUnit: 'VND/month', prevPrice: null })).toBe(RATE_COMPACT_VND)
  })
  it('a sale price, a "/ service" price and a rent under a million keep the narrow-surface default', () => {
    expect(cardCompactAbove({ price: 41_990_000, priceUnit: '' })).toBe(HUGE_VND)
    expect(cardCompactAbove({ price: 41_990_000, priceUnit: 'VND' })).toBe(HUGE_VND)
    expect(cardCompactAbove({ price: 3_030_000, priceUnit: 'VND/service' })).toBe(HUGE_VND)
    expect(cardCompactAbove({ price: 950_000, priceUnit: 'VND/month' })).toBe(HUGE_VND)
  })
  it('a real drop across 10 tỷ whose new price is still a tỷ or more → both in tỷ, as before', () => {
    expect(cardCompactAbove({ price: 9_990_000_000, prevPrice: 12_000_000_000, priceUnit: '' })).toBe(1_000_000_000)
    expect(cardCompactAbove({ price: 900_000_000, prevPrice: 12_000_000_000, priceUnit: '' })).toBe(HUGE_VND)
    expect(cardCompactAbove({ price: 9_990_000_000, prevPrice: null, priceUnit: '' })).toBe(HUGE_VND)
  })
})
