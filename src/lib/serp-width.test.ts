import { describe, expect, it } from 'vitest'
import { DESCRIPTION_MAX_PX, TITLE_MAX_PX, descriptionPx, titlePx } from './serp-width'
import { clipDescription, clipTitle, fillDescription, firstThatFits, fitsTitle, titleWithPrice } from './meta-description'

// Seobility's own measurements from crawl 3 (16334632, 2026-11-24): the table must land within a few px of them.
const SEOBILITY_TITLES: [string, number][] = [
  ['🛵 MOTORBIKE RENTAL IN SAIGON – ONLY 100,000... — 100,000 đ', 631],
  ['Grand Park Amusement Park — 150,000 đ | eno.vn', 460],
  ['Apple Watch Ultra 2 2024 49mm 4G Titanium... — 12,390,000 đ', 571],
  ['VietKite — eno.vn', 161],
  ['About eno.vn — free classifieds for expats and locals in Vietnam', 576],
]

describe('serp-width', () => {
  it('titles measure as Seobility measures them (Arial 20px), within 16 px', () => {
    for (const [t, px] of SEOBILITY_TITLES) expect(Math.abs(titlePx(t) - px), t).toBeLessThanOrEqual(16)
  })
  it('a Vietnamese letter measures as its base letter; đ and Đ as themselves', () => {
    expect(titlePx('Căn hộ')).toBe(titlePx('Can ho'))
    expect(titlePx('Đ')).toBeGreaterThan(titlePx('D') - 1)
  })
  it('decomposed Vietnamese (Unikey "tổ hợp") and an emoji’s variation selector measure like the composed text', () => {
    const composed = 'Căn hộ dịch vụ Thảo Điền'
    expect(titlePx(composed.normalize('NFD'))).toBeCloseTo(titlePx(composed), 5)
    expect(titlePx('🛵\uFE0F Rental')).toBeCloseTo(titlePx('🛵 Rental') - titlePx(' ') + titlePx(' '), 5)
  })
  it('a Korean name measures by its syllables, not their jamo (Seobility: "박채원매니저 — eno.vn" 180 px)', () => {
    expect(Math.abs(titlePx('박채원매니저 — eno.vn') - 180)).toBeLessThanOrEqual(10)
  })
  it('descriptions are Arial 14px: the same text is 0.7 of its title width', () => {
    expect(descriptionPx('Apartments for rent')).toBeCloseTo(titlePx('Apartments for rent') * 0.7, 5)
  })
  // Seobility crawl 10 (2026-11-26): this description measured 1,208 px; at a title's 750 the table called it 975 and let it pass.
  const KOREAN_DESC = '[통역요원 구인] 2026 베트남 안경산업 무역사절단 통역요원 모집 (비즈니스 미팅 / 현장 시찰) 안녕하세요. 국내외 전시회 및 수출상담회 운영을 전문으로 하는 브릿징 파트너스입니다. 「2026 베트남…'
  it('a description\'s Hangul and CJK are a full em — about two Latin letters (Seobility: 1,208 px)', () => {
    expect(KOREAN_DESC.length).toBe(114)
    expect(Math.abs(descriptionPx(KOREAN_DESC) - 1208)).toBeLessThanOrEqual(30)
    expect(descriptionPx('안')).toBeCloseTo(descriptionPx('ab') * (1000 / 1112), 5)
    // A title keeps its own measured 750 (the Korean shop name above).
    expect(titlePx('안')).toBeCloseTo(15, 5)
  })
})

const KOREAN_DESC_LONG = '[통역요원 구인] 2026 베트남 안경산업 무역사절단 통역요원 모집 (비즈니스 미팅 / 현장 시찰) 안녕하세요. 국내외 전시회 및 수출상담회 운영을 전문으로 하는 브릿징 파트너스입니다. 「2026 베트남 안경산업 무역사절단」에 참가하는 한국 기업'
describe('the title and description helpers hold the pixel line', () => {
  it('a 58-character capitalised title no longer passes as short', () => {
    const t = '🛵 MOTORBIKE RENTAL IN SAIGON – ONLY 100,000 VND A DAY'
    expect(t.length).toBeLessThanOrEqual(60)
    expect(fitsTitle(t)).toBe(false)
    const out = titleWithPrice(t, '100,000 đ', 'eno.vn')
    expect(titlePx(out)).toBeLessThanOrEqual(TITLE_MAX_PX)
    expect(out.endsWith(' — 100,000 đ')).toBe(true)
  })
  it('titleWithPrice keeps the site while it fits', () => {
    expect(titleWithPrice('Honda Vision 2022', '18,000,000 đ', 'eno.vn')).toBe('Honda Vision 2022 — 18,000,000 đ | eno.vn')
  })
  it('firstThatFits takes the first candidate within 60 characters and 570 px', () => {
    const wide = 'APARTMENTS & HOUSES FOR RENT IN BINH THANH | eno.vn'
    expect(firstThatFits([wide, 'Apartments for rent in Binh Thanh | eno.vn'])).toBe('Apartments for rent in Binh Thanh | eno.vn')
  })
  it('clipTitle and clipDescription cut at a word to the pixel line', () => {
    const t = clipTitle('ĐIỆN THOẠI SAMSUNG GALAXY S24 ULTRA 256GB CHÍNH HÃNG MỚI 100% NGUYÊN SEAL')
    expect(titlePx(t)).toBeLessThanOrEqual(TITLE_MAX_PX)
    expect(t.endsWith('…')).toBe(true)
    const d = clipDescription('W'.repeat(10) + ' ' + 'WIDE WORDS EVERYWHERE '.repeat(10))
    expect(descriptionPx(d)).toBeLessThanOrEqual(DESCRIPTION_MAX_PX)
  })
  it('a Korean description is cut to the pixel line, not passed at 114 characters', () => {
    const d = clipDescription(KOREAN_DESC_LONG)
    expect(d.length).toBeLessThan(114)
    expect(descriptionPx(d)).toBeLessThanOrEqual(DESCRIPTION_MAX_PX)
    expect(d.endsWith('…')).toBe(true)
  })
  it('fillDescription skips an extra that would pass the pixel line', () => {
    const d = fillDescription('MASTERI THẢO ĐIỀN APARTMENT, DISTRICT 2', ['FULLY FURNISHED WITH BALCONY AND RIVER VIEW, WALK TO METRO STATION AND SHOPS NEARBY TODAY'], { min: 120 })
    expect(descriptionPx(d)).toBeLessThanOrEqual(DESCRIPTION_MAX_PX)
  })
})
