import { describe, expect, it } from 'vitest'
import { APPLE_VN_FROM_PRICE } from '@/app/[lang]/iphone-18-vietnam/price-guard'
import { APPLE_VN_FROM, NEW_APPLE_VI_LETTER, newAppleText, plausibleMove, plausibleNewPrice } from './new-apple-text'

const shop = { name: 'CellphoneS' }

describe('newAppleText', () => {
  it.each([
    ['MacBook Air M5 13 inch 2026 10CPU 10GPU 24GB 512GB Sạc 70W | Chính hãng Apple Việt Nam', 'MacBook Air M5 13 inch 2026 10CPU 10GPU 24GB 512GB 70W charger'],
    ['MacBook Air M5 13 inch 10CPU 8GPU 16GB/512GB - Sạc nhanh 70W', 'MacBook Air M5 13 inch 10CPU 8GPU 16GB/512GB - 70W fast charger'],
    ['Apple iMac 24 2026 M6 12CPU 12GPU 16GB 256GB Nano | Chính hãng', 'Apple iMac 24 2026 M6 12CPU 12GPU 16GB 256GB Nano'],
    ['Macbook Neo 13-inch Chip A18 Pro with 6‑core CPU and 5‑core GPU 8GB RAM 256GB SSD', 'MacBook Neo 13-inch Chip A18 Pro with 6-core CPU and 5-core GPU 8GB RAM 256GB SSD'],
    ['iPhone 18 Pro Max 256GB', 'iPhone 18 Pro Max 256GB'],
  ])('English title of %s', (name, want) => {
    const t = newAppleText.englishTitle(name)
    expect(t).toBe(want)
    expect(NEW_APPLE_VI_LETTER.test(t)).toBe(false)
  })

  it('descriptions are long enough to be indexed, name the shop, and quote no price', () => {
    const d = newAppleText.describe({ name: 'iPhone 18 Pro Max 256GB', line: { model: 'iPhone 18 Pro Max', kind: 'iphone' }, shop })
    for (const s of [d.description, d.descriptionVi]) {
      expect(s.length).toBeGreaterThanOrEqual(200)
      expect(s).toContain('CellphoneS')
      expect(s).not.toMatch(/\d{1,3}(?:[.,]\d{3}){2}/)
      expect(s).toMatch(/commission|hoa hồng/)
    }
    expect(NEW_APPLE_VI_LETTER.test(d.description)).toBe(false)
  })

  it('claims Apple Vietnam stock only when the shop\'s own name says chính hãng', () => {
    const plain = newAppleText.describe({ name: 'iPhone 18 Pro Max 256GB', line: { model: 'iPhone 18 Pro Max', kind: 'iphone' }, shop })
    expect(plain.description).not.toMatch(/VN\/A/)
    expect(plain.descriptionVi).not.toMatch(/chính hãng/)
    const said = newAppleText.describe({ name: 'MacBook Air M5 13 inch 2026 10CPU 10GPU 16GB 1TB | Chính hãng Apple Việt Nam', line: { model: 'MacBook Air M5', kind: 'mac' }, shop })
    expect(said.description).toMatch(/Apple Vietnam \(VN\/A\) stock/)
    expect(said.descriptionVi).toMatch(/chính hãng Apple Việt Nam \(VN\/A\)/)
  })

  it('two tiers of one model never share text (duplicate-import)', () => {
    const a = newAppleText.describe({ name: 'iPhone 18 Pro 256GB', line: { model: 'iPhone 18 Pro', kind: 'iphone' }, shop })
    const b = newAppleText.describe({ name: 'iPhone 18 Pro 512GB', line: { model: 'iPhone 18 Pro', kind: 'iphone' }, shop })
    expect(a.title).not.toBe(b.title)
    expect(a.description).not.toBe(b.description)
  })
})

describe('price plausibility', () => {
  it('the iPhone entry prices are price-guard\'s', () => expect(APPLE_VN_FROM).toEqual(APPLE_VN_FROM_PRICE))
  it('iPhone: [0.8×, 3×] of Apple Vietnam\'s entry price', () => {
    const l = { model: 'iPhone 18 Pro Max', kind: 'iphone' as const }
    expect(plausibleNewPrice(l, 40_990_000)).toBe(true)
    expect(plausibleNewPrice(l, 79_990_000)).toBe(true)
    expect(plausibleNewPrice(l, 450_000)).toBe(false)
    expect(plausibleNewPrice(l, 2_000_000)).toBe(false)
  })
  it('Mac: 12–250 million', () => {
    const l = { model: 'Mac Studio M5 Ultra', kind: 'mac' as const }
    expect(plausibleNewPrice(l, 158_990_000)).toBe(true)
    expect(plausibleNewPrice(l, 4_099_000)).toBe(false)
  })
  it('a night may move a price at most 40 %', () => {
    expect(plausibleMove(40_990_000, 37_990_000)).toBe(true)
    expect(plausibleMove(40_990_000, 4_099_000)).toBe(false)
    expect(plausibleMove(0, 1)).toBe(false)
  })
})
