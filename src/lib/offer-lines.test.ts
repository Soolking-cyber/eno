import { describe, expect, it } from 'vitest'
import { OFFER_ACCEPTED_LINE, OFFER_MADE_LINE, localizeOfferLine, offerLineKind } from './offer-lines'
import { formatMoneyFull } from './vnd'

describe('persisted offer lines', () => {
  it('regroups the stored amount for a Vietnamese reader, and leaves English as written', () => {
    expect(localizeOfferLine('✅ Đã chấp nhận · Offer accepted — 3,000,000 đ', 'vi')).toBe('✅ Đã chấp nhận · Offer accepted — 3.000.000 đ')
    expect(localizeOfferLine('❌ Đã từ chối · Offer declined — 950,000 đ', 'vi')).toBe('❌ Đã từ chối · Offer declined — 950.000 đ')
    expect(localizeOfferLine('Trả giá · Offered 12,500,000 đ — can you do Friday?', 'vi')).toBe('Trả giá · Offered 12.500.000 đ — can you do Friday?')
    expect(localizeOfferLine('✅ Đã chấp nhận · Offer accepted — 3,000,000 đ', 'en')).toBe('✅ Đã chấp nhận · Offer accepted — 3,000,000 đ')
    expect(localizeOfferLine('✅ Đã chấp nhận · Offer accepted — 500 đ', 'vi')).toBe('✅ Đã chấp nhận · Offer accepted — 500 đ')
  })
  it('reads exactly what the writer writes (formatMoneyFull, English grouping) — a round trip, not a hand-typed string', () => {
    for (const n of [1_000, 950_000, 3_000_000, 1_250_000_000]) {
      expect(localizeOfferLine(`${OFFER_ACCEPTED_LINE} — ${formatMoneyFull(n, '₫')}`, 'vi')).toBe(`${OFFER_ACCEPTED_LINE} — ${formatMoneyFull(n, '₫', 'vi')}`)
      expect(localizeOfferLine(`${OFFER_MADE_LINE} ${formatMoneyFull(n, '₫')}`, 'vi')).toBe(`${OFFER_MADE_LINE} ${formatMoneyFull(n, '₫', 'vi')}`)
    }
  })
  it('leaves every other text alone — a line with no amount, a note, a message quoting a price', () => {
    for (const t of [OFFER_ACCEPTED_LINE, 'I can pay 3,000,000 đ', '✅ great, 3,000,000 đ works', '']) expect(localizeOfferLine(t, 'vi')).toBe(t)
  })
  it('names a line by its full bilingual opening, never by its emoji', () => {
    expect(offerLineKind('✅ Đã chấp nhận · Offer accepted — 3,000,000 đ')).toBe('accepted')
    expect(offerLineKind('❌ Đã từ chối · Offer declined')).toBe('declined')
    expect(offerLineKind('Trả giá · Offered 1,000 đ')).toBe('offered')
    expect(offerLineKind('✅ deal, see you at 5')).toBeNull()
    expect(offerLineKind(null)).toBeNull()
  })
})
