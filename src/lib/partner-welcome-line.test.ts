import { describe, expect, it } from 'vitest'
import {
  PARTNER_BUY_LINE, PARTNER_BUY_PARTS, PARTNER_BUY_WELCOME_LINE, PARTNER_BUY_WELCOME_PARTS, PARTNER_WELCOME_LINE, PARTNER_WELCOME_LINES, PARTNER_WELCOME_PARTS,
  isPartnerBuyMessage, localizePartnerWelcome, phoneShareText, typedPhone,
} from './partner-welcome-line'

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

describe('the buy-now lines (owner 2026-11-23)', () => {
  it('stored "VI · EN", each viewer their half', () => {
    expect(localizePartnerWelcome(PARTNER_BUY_WELCOME_LINE, 'en')).toBe(`👋 ${PARTNER_BUY_WELCOME_PARTS.en}`)
    expect(localizePartnerWelcome(PARTNER_BUY_WELCOME_LINE, 'vi')).toBe(`👋 ${PARTNER_BUY_WELCOME_PARTS.vi}`)
    expect(localizePartnerWelcome(PARTNER_BUY_LINE, 'en')).toBe(`🛒 ${PARTNER_BUY_PARTS.en}`)
    expect(localizePartnerWelcome(PARTNER_BUY_LINE, 'vi')).toBe(`🛒 ${PARTNER_BUY_PARTS.vi}`)
    expect(PARTNER_WELCOME_LINES).toEqual([PARTNER_WELCOME_LINE, PARTNER_BUY_WELCOME_LINE])
  })

  it('the buy-now welcome says both: buy now from the official store, or ask — and still asks for the phone', () => {
    expect(PARTNER_BUY_WELCOME_PARTS.en).toMatch(/Buy now.*official store.*question.*phone number/)
    expect(PARTNER_BUY_WELCOME_PARTS.vi).toMatch(/Mua ngay.*chính hãng.*sản phẩm.*số điện thoại/)
  })

  it('the "Buy now" line fits the inbox preview whole (cutText 140), so the inbox can show the reader\'s half', () => {
    expect(PARTNER_BUY_LINE.length).toBeLessThanOrEqual(140)
  })
  it('no URL in any stored line — the link lives only behind the button', () => {
    for (const line of [PARTNER_BUY_WELCOME_LINE, PARTNER_BUY_LINE]) expect(line).not.toMatch(/https?:|www\.|\.vn|\.com/)
  })

  it('the button sits under a buy line by kind AND exact body only', () => {
    expect(isPartnerBuyMessage({ kind: 'partner_welcome', body: PARTNER_BUY_WELCOME_LINE })).toBe(true)
    expect(isPartnerBuyMessage({ kind: 'partner_buy', body: PARTNER_BUY_LINE })).toBe(true)
    expect(isPartnerBuyMessage({ kind: 'partner_welcome', body: PARTNER_WELCOME_LINE })).toBe(false)
    expect(isPartnerBuyMessage({ kind: 'text', body: PARTNER_BUY_LINE })).toBe(false)
    expect(isPartnerBuyMessage({ kind: undefined, body: PARTNER_BUY_WELCOME_LINE })).toBe(false)
  })
})
