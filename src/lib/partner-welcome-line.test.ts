import { describe, expect, it } from 'vitest'
import { PARTNER_WELCOME_LINE, PARTNER_WELCOME_PARTS, localizePartnerWelcome, phoneShareText, typedPhone } from './partner-welcome-line'

describe('the partner welcome line', () => {
  it('is stored "VI · EN" and shown to each viewer in their own language', () => {
    expect(PARTNER_WELCOME_LINE).toBe(`👋 ${PARTNER_WELCOME_PARTS.vi} · ${PARTNER_WELCOME_PARTS.en}`)
    expect(localizePartnerWelcome(PARTNER_WELCOME_LINE, 'en')).toBe(`👋 ${PARTNER_WELCOME_PARTS.en}`)
    expect(localizePartnerWelcome(PARTNER_WELCOME_LINE, 'vi')).toBe(`👋 ${PARTNER_WELCOME_PARTS.vi}`)
    // Any other body is left exactly as written (a hand-made look-alike is never "localized" into the real line).
    expect(localizePartnerWelcome('👋 hello', 'vi')).toBe('👋 hello')
  })

  it('asks for the phone in both halves', () => {
    expect(PARTNER_WELCOME_PARTS.en).toMatch(/phone number/)
    expect(PARTNER_WELCOME_PARTS.vi).toMatch(/số điện thoại/)
  })
})

describe('typedPhone — what the chip accepts', () => {
  it.each([
    ['0901234567', '+84901234567'],
    ['090 123 4567', '+84901234567'],
    ['+84 90 123 4567', '+84901234567'],
    ['+49 151 12345678', '+4915112345678'],
  ])('%s → %s', (raw, out) => expect(typedPhone(raw)).toBe(out))

  it.each(['', '12345', 'call me', '+1234567890123456'])('refuses %j', (raw) => expect(typedPhone(raw)).toBeNull())

  it('the chat line is the number in the form the reader’s chips recognise', () => {
    expect(phoneShareText('+84901234567')).toBe('📞 +84901234567')
  })
})
