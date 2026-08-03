import { describe, expect, it } from 'vitest'
import { normalizePhoneVN, isVietnamesePhone, preferredOtpChannel } from './otp-channels'

// Characterization (audit P2): the OTP dispatch number. The old implementation
// 84-prefixed EVERY non-84 number — a +1/+44 expat sign-up became a bogus VN number
// and the code went nowhere on every channel.
describe('normalizePhoneVN', () => {
  it('canonicalizes VN forms', () => {
    expect(normalizePhoneVN('0901234567')).toBe('84901234567')
    expect(normalizePhoneVN('+84 901 234 567')).toBe('84901234567')
    expect(normalizePhoneVN('84901234567')).toBe('84901234567')
    expect(normalizePhoneVN('901234567')).toBe('84901234567') // bare 9-digit mobile
  })

  it('keeps foreign E.164 numbers intact', () => {
    expect(normalizePhoneVN('+1 555 010 0000')).toBe('15550100000')
    expect(normalizePhoneVN('+442079460958')).toBe('442079460958')
  })

  it('keeps bare full international digits intact (Supabase drops the +)', () => {
    expect(normalizePhoneVN('15550100000')).toBe('15550100000')
    expect(normalizePhoneVN('442079460958')).toBe('442079460958')
  })
})

// ⚠️ THE ROUTING THE OWNER ASKED FOR (2026-08-02): "zalo otp for local phone numbers and whatsapp
// otp for foreign numbers". These run against the NORMALIZED number, so they compose with
// normalizePhoneVN above — a user typing '0901234567' must route to Zalo exactly like '+84…'.
describe('isVietnamesePhone', () => {
  it('accepts every VN form once normalized', () => {
    expect(isVietnamesePhone(normalizePhoneVN('0901234567'))).toBe(true)
    expect(isVietnamesePhone(normalizePhoneVN('+84 901 234 567'))).toBe(true)
    expect(isVietnamesePhone(normalizePhoneVN('901234567'))).toBe(true)
  })

  it('rejects foreign numbers', () => {
    expect(isVietnamesePhone(normalizePhoneVN('+1 555 010 0000'))).toBe(false)
    expect(isVietnamesePhone(normalizePhoneVN('+442079460958'))).toBe(false)
    expect(isVietnamesePhone(normalizePhoneVN('+7 495 000 0000'))).toBe(false)
  })

  // ⚠️ THE CASE A BARE `startsWith('84')` GETS WRONG. Several countries have E.164 numbers that
  // begin 84 once the '+' is stripped — Bangladesh (+880…) is the obvious one, and any longer
  // number starting 84 would also pass a prefix-only check. Routing one of those to Zalo, which is
  // Vietnam-only, spends a request to learn what the country code already said.
  it('does not mistake a longer number that merely starts with 84 for a VN one', () => {
    expect(isVietnamesePhone('8801712345678')).toBe(false) // Bangladesh, 13 digits
    expect(isVietnamesePhone('84123456789012')).toBe(false) // too long to be VN
    expect(isVietnamesePhone('8490')).toBe(false) // too short
  })
})

describe('preferredOtpChannel', () => {
  it('sends VN numbers to Zalo and everyone else to WhatsApp', () => {
    expect(preferredOtpChannel(normalizePhoneVN('0901234567'))).toBe('zalo')
    expect(preferredOtpChannel(normalizePhoneVN('+84901234567'))).toBe('zalo')
    expect(preferredOtpChannel(normalizePhoneVN('+15550100000'))).toBe('whatsapp')
    expect(preferredOtpChannel(normalizePhoneVN('+442079460958'))).toBe('whatsapp')
  })

  // Garbage in must still pick SOMETHING rather than throw — this runs inside the Supabase hook,
  // where an exception would abort a real user's sign-in.
  it('never throws on junk input', () => {
    expect(() => preferredOtpChannel('')).not.toThrow()
    expect(preferredOtpChannel('')).toBe('whatsapp')
  })
})
