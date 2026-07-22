import { describe, expect, it } from 'vitest'
import { containsPhoneNumber, contactLinksFor, extractPhoneNumber } from './phone'

// The gate (containsPhoneNumber) and the extractor must agree about VND prices, because a
// disagreement is user-visible: a "Chat on WhatsApp" button built out of a price.
describe('extractPhoneNumber', () => {
  it('pulls a VN mobile out of a sentence, in E.164 digits', () => {
    expect(extractPhoneNumber('call me on 0912 345 678 thanks')).toBe('84912345678')
    expect(extractPhoneNumber('+84 912 345 678')).toBe('84912345678')
    expect(extractPhoneNumber('090.123.4567')).toBe('84901234567')
  })

  it('keeps a foreign number on its own country code', () => {
    // The buyer half of the feature: a foreigner's own number must not be re-homed to +84.
    const uk = extractPhoneNumber('reach me on +44 7700 900123')
    expect(uk).toBe('447700900123')
    expect(uk?.startsWith('84')).toBe(false)
  })

  it('does NOT turn a Vietnamese price into a phone number', () => {
    // 3.160.000 ₫ is a real listing price on the visa desk — the dotted form is exactly
    // what the dotted-phone fallback strips, so this is the case most likely to regress.
    for (const price of ['3.160.000 đ', '12.000.000 VND', 'giá 790.000', '1,320,000 VND']) {
      expect(containsPhoneNumber(price), `gate: ${price}`).toBe(false)
      expect(extractPhoneNumber(price), `extract: ${price}`).toBeNull()
    }
  })

  it('returns null rather than guessing at a spelled-out number', () => {
    // The gate catches this (it is an evasion attempt); the extractor deliberately does not
    // reconstruct it. A wrong number is worse than no button.
    const spelled = 'zero nine one two three four five six seven eight'
    expect(containsPhoneNumber(spelled)).toBe(true)
    expect(extractPhoneNumber(spelled)).toBeNull()
  })

  it('is null-safe and rejects junk', () => {
    expect(extractPhoneNumber('')).toBeNull()
    expect(extractPhoneNumber(null)).toBeNull()
    expect(extractPhoneNumber('no digits here at all')).toBeNull()
    expect(extractPhoneNumber('order #12345')).toBeNull()
  })

  it('builds both deep links off the SAME number', () => {
    const links = contactLinksFor('84912345678')
    expect(links.zalo).toBe('https://zalo.me/84912345678')
    expect(links.whatsapp).toBe('https://wa.me/84912345678')
    expect(links.tel).toBe('tel:+84912345678')
  })
})
