import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ONE_TAP_PHRASES, SYSTEM_LINES, halvesOf, isFixedChatText, localizeChatText, localizeLineHead } from './chat-phrases'
import { CALL_REQUEST_TEXT, MISSED_TEXT } from './calls/card-text'
import { TEACHER_JOBS_BODY, composite } from './teachers/alert-copy'
import { teacherThreadChips, jobsDeskChips } from '@/components/marketplace/quick-reply-chips'
import { PARTNER_BUY_LINE, PARTNER_BUY_WELCOME_LINE, PARTNER_WELCOME_LINE, localizePartnerWelcome } from './partner-welcome-line'
import { OFFER_ACCEPTED_LINE } from './offer-lines'

const pairTr = (en: string, vi: string) => `${en}\u0001${vi}`
const split = (s: string) => { const [en, vi] = s.split('\u0001'); return { en, vi } }
const known = (p: { en: string; vi: string }) => ONE_TAP_PHRASES.some((q) => q.en === p.en && q.vi === p.vi)

describe('the reader sees eno\'s words in their own language (owner 2026-11-25)', () => {
  it('a Vietnamese buyer\'s one-tap opener reads as eno\'s English for an English seller, never "dish"', () => {
    expect(localizeChatText('Chào bạn! Món này còn không?', 'en')).toBe('Hi! Is this still available?')
    expect(localizeChatText('Hi! Is this still available?', 'vi')).toBe('Chào bạn! Món này còn không?')
    expect(localizeChatText('Chào bạn! Món này còn không?', 'vi')).toBe('Chào bạn! Món này còn không?')
  })
  it('a stored "VI · EN" line shows one half, with what it carries after it', () => {
    expect(localizeChatText(`${OFFER_ACCEPTED_LINE} — 2,000,000 đ`, 'vi')).toBe('✅ Đã chấp nhận — 2,000,000 đ')
    expect(localizeChatText(`${OFFER_ACCEPTED_LINE} — 2,000,000 đ`, 'en')).toBe('✅ Offer accepted — 2,000,000 đ')
    expect(localizeChatText('📞 Cuộc gọi · Call · 3:12', 'en')).toBe('📞 Call · 3:12')
    expect(localizeChatText('📞 Cuộc gọi · Call · 3:12', 'vi')).toBe('📞 Cuộc gọi · 3:12')
    expect(localizeChatText('📞 Muốn gọi cho bạn · Would like to call you', 'en')).toBe('📞 Would like to call you')
  })
  it('the bell\'s rows and the pushes take one half too', () => {
    expect(localizeChatText('Trả giá · Offered 2,000,000 đ', 'en')).toBe('Offered 2,000,000 đ')
    expect(localizeLineHead('Trả giá · Offered 2,000,000 đ — can collect today', 'vi')).toBe('Trả giá 2,000,000 đ — can collect today')
    expect(localizeChatText(MISSED_TEXT, 'vi')).toBe('Cuộc gọi nhỡ')
    expect(localizeChatText(composite(TEACHER_JOBS_BODY), 'en')).toBe('Alex from eno.vn sent you new jobs.')
    expect(localizeChatText(composite(TEACHER_JOBS_BODY), 'vi')).toBe('Alex · eno.vn đã gửi cho bạn việc làm mới.')
    expect(halvesOf(CALL_REQUEST_TEXT)).toEqual({ vi: '📞 Muốn gọi cho bạn', en: '📞 Would like to call you' })
  })
  it('the partner welcome reads exactly as it did', () => {
    for (const line of [PARTNER_WELCOME_LINE, PARTNER_BUY_WELCOME_LINE, PARTNER_BUY_LINE]) {
      for (const lang of ['vi', 'en']) expect(localizeChatText(line, lang)).toBe(localizePartnerWelcome(line, lang))
    }
  })
  it('anyone else\'s words are left alone — and go to translation as before (commit gate, 2026-11-25)', () => {
    for (const t of [
      'Chào bạn! Món này còn không ạ, giảm giá được không?', 'Can meet in District 1', 'Price is firm?', '✅ Đã chấp nhận · Offer accepted!',
      // a person's note after an offer line, and a copied line with a number typed after it
      'Trả giá · Offered 4.500.000 ₫ — Could you do 4.5M if I collect it myself?',
      '📇 Đã chia sẻ số điện thoại, email và CV · Shared my phone, email and CV — 0901234567',
    ]) {
      expect(localizeChatText(t, 'en')).toBeNull()
      expect(isFixedChatText(t, 'vi')).toBe(false)
    }
  })
  it('a reader in a machine-translated language is left exactly as before', () => {
    expect(localizeChatText('Chào bạn! Món này còn không?', 'ko')).toBeNull()
    expect(isFixedChatText('Price is firm', 'ja')).toBe(false)
    expect(localizeLineHead('Trả giá · Offered 2,000,000 đ', 'ko')).toBeNull()
  })
  it('every system line parses into a mark, a Vietnamese half and an English half', () => {
    for (const l of SYSTEM_LINES) {
      expect(l.stored).toBe(`${l.mark ? `${l.mark} ` : ''}${l.vi} · ${l.en}`)
      expect(l.en.length).toBeGreaterThan(2)
    }
  })
})

describe('the lists themselves', () => {
  it('every system line is in the list (none left out by a bad shape)', () => expect(SYSTEM_LINES.length).toBe(19))
  it('a half belongs to one pair only — the lookup never picks between two', () => {
    const seen = new Map<string, string>()
    for (const p of ONE_TAP_PHRASES) for (const [k, other] of [[p.en, p.vi], [p.vi, p.en]]) {
      if (seen.has(k)) expect(seen.get(k), k).toBe(other)
      seen.set(k, other)
    }
  })
  it('an amount grouped with a no-break space still reads as eno\'s', () => {
    expect(localizeChatText('✅ Đã chấp nhận · Offer accepted — 3.000.000\u00a0đ', 'en')).toBe('✅ Offer accepted — 3.000.000\u00a0đ')
  })
})

describe('every one-tap chip that sends on tap is in the list', () => {
  it('the teacher-thread chips', () => {
    const sets = [
      teacherThreadChips({ isSeller: true, buyerHasSent: true, sellerRepliedAfterBuyer: false, teacherShared: false }, pairTr),
      teacherThreadChips({ isSeller: false, buyerHasSent: false, sellerRepliedAfterBuyer: false, teacherShared: false, voice: 'person' }, pairTr),
      teacherThreadChips({ isSeller: false, buyerHasSent: false, sellerRepliedAfterBuyer: false, teacherShared: false, voice: 'school' }, pairTr),
    ]
    for (const c of sets.flat().filter((c) => c.complete)) expect(known(split(c.text)), c.text).toBe(true)
  })
  it('the jobs desk replies', () => {
    for (const lang of ['vi', 'en']) for (const c of jobsDeskChips((en) => en, lang)) expect(isFixedChatText(c.text, lang), c.text).toBe(true)
  })
  it('the seller chips written inline in quick-reply-chips.tsx', () => {
    const src = readFileSync(new URL('../components/marketplace/quick-reply-chips.tsx', import.meta.url), 'utf8')
    const inline = [...src.matchAll(/text: tr\('([^']+)', '([^']+)'\), complete: true/g)].map((m) => ({ en: m[1], vi: m[2] }))
    // Every line that sends a literal on tap is read here — a chip written another way fails this count, not silently.
    expect(inline.length).toBe(src.split('\n').filter((l) => /text: tr\(/.test(l) && /complete: true/.test(l)).length)
    expect(inline.length).toBeGreaterThanOrEqual(5)
    for (const p of inline) expect(known(p), p.en).toBe(true)
  })
})
