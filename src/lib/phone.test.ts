import { describe, it, expect } from 'vitest'
import { containsPhoneNumber, normalizePhone, normalizePhoneNoPlus } from './phone'

// The phone-in-text gate keeps contact info OFF public listings (the core
// "reply in-app" strategy). False negatives leak phones; false positives block
// legit VND prices. Both directions matter, so both are covered.
describe('containsPhoneNumber', () => {
  it('catches VN mobile numbers in common formats', () => {
    expect(containsPhoneNumber('call me 0901234567')).toBe(true)
    expect(containsPhoneNumber('+84 90 123 4567')).toBe(true)
    expect(containsPhoneNumber('090.123.4567')).toBe(true) // dotted — a very common VN format
    expect(containsPhoneNumber('zalo 0 9 0 1 2 3 4 5 6 7')).toBe(true) // spaced out
  })

  it('does NOT flag VND prices (dot/comma thousand separators)', () => {
    expect(containsPhoneNumber('Giá 1.080.000.000 VND')).toBe(false)
    expect(containsPhoneNumber('only 5,000,000')).toBe(false)
  })

  it('does NOT flag a model number next to a year range (the "E200 2016-2020" false positive)', () => {
    // The trailing 0 of a model + a year range read as "0 2016-2020" ≈ a VN phone.
    expect(containsPhoneNumber('Mercedes-Benz E200 2016-2020 Upgrade to 2021 AMG Body Kit')).toBe(false)
    expect(containsPhoneNumber('Honda SH150 2019-2021')).toBe(false)
    expect(containsPhoneNumber('iPhone 14 Pro 256GB 2021')).toBe(false)
  })

  it('handles empty / null', () => {
    expect(containsPhoneNumber('')).toBe(false)
    expect(containsPhoneNumber(null)).toBe(false)
    expect(containsPhoneNumber(undefined)).toBe(false)
  })
})

describe('normalizePhone', () => {
  it('canonicalizes any VN format to +84 E.164', () => {
    expect(normalizePhone('0901234567')).toBe('+84901234567')
    expect(normalizePhone('+84 901 234 567')).toBe('+84901234567')
    expect(normalizePhone('84901234567')).toBe('+84901234567')
  })

  it('noPlus form drops the leading +', () => {
    expect(normalizePhoneNoPlus('0901234567')).toBe('84901234567')
  })

  it('empty stays empty', () => {
    expect(normalizePhone('')).toBe('')
  })
})
