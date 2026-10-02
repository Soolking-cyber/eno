import { describe, expect, it } from 'vitest'
import { detectContentLang, looksVietnamese, mayBeVietnamese, readsAsVietnamese, vietnameseWordShare } from './detect-lang'

/**
 * The description-side language tests (2026-10-02). Strings are live descriptions from the audit
 * export (translation-audit-2026-10-02.md), cut down where long.
 */
describe('readsAsVietnamese — is a description already Vietnamese?', () => {
  it('Vietnamese product copy with a run of English model words is Vietnamese (looksVietnamese alone says no)', () => {
    const t = 'Sạc nhanh Apple iPhone 15 Pro Max USB-C 20W chính hãng, bảo hành 12 tháng'
    expect(looksVietnamese(t)).toBe(false)
    expect(readsAsVietnamese(t)).toBe(true)
  })

  it('English that names a Vietnamese place is not (detectContentLang says it is)', () => {
    const t = 'Green (unroasted) coffee beans from Đắk Lắk. Moisture, screen size and defect ratio to the grade named in the title.'
    expect(detectContentLang(t)).toBe('vi')
    expect(readsAsVietnamese(t)).toBe(false)
    // ⚠️ THE LIMIT, PINNED: a terse English template dense with place names crosses the line. That is
    // why the rental's own descriptionVi always comes first (listing-content localizedPlan).
    expect(readsAsVietnamese('Location: District 2 (An Khánh Ward, new)\nRent: 20,000,000 đ/month')).toBe(true)
  })

  it('French and Latin-1 marks alone never make a text Vietnamese', () => {
    expect(readsAsVietnamese('Café crème, 250 g — torréfaction artisanale.')).toBe(false)
    expect(readsAsVietnamese('Pokémon cards')).toBe(false)
  })

  it('reads the NFC form, so a column stored NFD is still Vietnamese', () => {
    expect(readsAsVietnamese('Giày chạy bộ nhẹ, thân lưới thoáng khí, êm chân.'.normalize('NFD'))).toBe(true)
  })
})

describe('mayBeVietnamese — should an English reader get it translated?', () => {
  it('catches Vietnamese with no Vietnamese-EXCLUSIVE letter', () => {
    for (const t of ['Apple iPhone 14 Pro Max 128GB cũ 99%', 'Xiaomi Mi Band 10 Pro viền gốm chính hãng, giá rẻ']) {
      expect(detectContentLang(t), t).toBeNull()
      expect(mayBeVietnamese(t), t).toBe(true)
    }
    // Only Latin-1 marks, but on a fifth of the words or more.
    expect(mayBeVietnamese('Máy tính chính hãng, bàn phím Dell')).toBe(true)
  })

  it('leaves plain English and a lone Latin-1 accent alone', () => {
    expect(mayBeVietnamese('Brand new. Never used. Original box.')).toBe(false)
    expect(mayBeVietnamese('A quiet café in a leafy lane, five minutes from the market and the river.')).toBe(false)
  })
})

describe('vietnameseWordShare', () => {
  it('counts only words with letters', () => {
    expect(vietnameseWordShare('')).toBe(0)
    expect(vietnameseWordShare('12 000 —')).toBe(0)
    expect(vietnameseWordShare('cũ 99% Apple')).toBe(0.5)
  })
})
