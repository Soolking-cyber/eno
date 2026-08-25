import { describe, expect, it } from 'vitest'
import { placementForCrumbs, placementFromTitle } from './merchant-taxonomy'

const p = (...c: string[]) => placementForCrumbs(c)

describe('placementForCrumbs — the misfilings this was written to fix', () => {
  // ⛔ Each of these was measured wrong in production on 2026-08-25.
  it('files a laptop sold with a charger as a laptop, not a charger', () => {
    // The title says "70W Charger"; the merchant's own aisle says Laptop.
    expect(p('Root', 'Laptop', 'Apple')).toEqual({ category: 'electronics', subcategory: 'laptops-pcs' })
  })
  it('files a memory card under storage, not cables', () => {
    expect(p('Phụ kiện', 'Thẻ nhớ, USB')).toEqual({ category: 'electronics', subcategory: 'storage' })
  })
  it('files a warranty-exchange iPad as a tablet, not a service', () => {
    expect(p('Root', 'Máy tính bảng', 'iPad Pro')).toEqual({ category: 'electronics', subcategory: 'phones-tablets' })
  })
  // ⛔ "Hàng cũ" is a CONDITION, not a category — used phones must still browse as phones.
  it('routes second-hand stock by what the thing is', () => {
    expect(p('Hàng cũ', 'iPhone cũ')).toEqual({ category: 'electronics', subcategory: 'phones-tablets' })
    expect(p('Hàng cũ', 'Laptop cũ')).toEqual({ category: 'electronics', subcategory: 'laptops-pcs' })
    expect(p('Hàng cũ', 'Đồng hồ thông minh cũ')).toEqual({ category: 'electronics', subcategory: 'smartwatch' })
  })
  it('keeps genuine services as services', () => {
    expect(p('Phụ kiện', 'Apple Care')).toEqual({ category: 'services', subcategory: null })
    expect(p('Phụ kiện', 'Sim Viettel')).toEqual({ category: 'services', subcategory: null })
  })
  it('takes appliances out of electronics entirely', () => {
    expect(p('Điều hòa - Máy lạnh', 'Máy lạnh inverter')).toEqual({ category: 'furniture-appliances', subcategory: 'white-goods' })
    expect(p('Đồ gia dụng', 'Nồi cơm điện')).toEqual({ category: 'furniture-appliances', subcategory: 'kitchenware' })
  })
  it('resolves the big accessory bucket by its second crumb', () => {
    expect(p('Phụ kiện', 'Ốp lưng | Bao da')?.subcategory).toBe('phone-cases')
    expect(p('Phụ kiện', 'Chuột | Bàn Phím')?.subcategory).toBe('keyboards-mice')
    expect(p('Phụ kiện', 'Sạc - Cáp')?.subcategory).toBe('cables-chargers')
    expect(p('Phụ kiện', 'Balo | Túi xách')?.subcategory).toBe('bags-sleeves')
    expect(p('Phụ kiện', 'Pin dự phòng')?.subcategory).toBe('power-banks')
    expect(p('Phụ kiện', 'Dán điện thoại | Laptop')?.subcategory).toBe('screen-protectors')
    expect(p('Phụ kiện', 'Thiết bị mạng')?.subcategory).toBe('networking')
    expect(p('Phụ kiện', 'Camera')?.subcategory).toBe('cameras')
  })
  // ⚠️ The fallback is LAST, so a specific accessory never falls into the generic bucket.
  it('falls back to generic accessories only when nothing more specific matched', () => {
    expect(p('Phụ kiện', 'Phụ kiện tiện ích')?.subcategory).toBe('accessories')
  })
  // ⛔ No rule = no change. A confident wrong answer is worse than none, because nothing revisits it.
  it('returns null rather than guessing', () => {
    expect(p('Root')).toBeNull()
    expect(p()).toBeNull()
    expect(p('Something The Merchant Invented Yesterday')).toBeNull()
  })
})

describe('placementFromTitle — the "Case" trap', () => {
  const cases = { category: 'electronics', subcategory: 'phone-cases' }
  /**
   * ⛔ An Apple Watch is sold as "Aluminum Case Rubber Band" — the case is the watch's BODY. A
   * keyword classifier therefore filed 93 watches under Cases & covers (owner, 2026-08-25:
   * "apple watches in cases subcategory").
   */
  it('rescues a watch that a keyword classifier filed as a case', () => {
    expect(placementFromTitle('Apple Watch SE 3 40mm (5G) Aluminum Case Rubber Band Size S/M', cases))
      .toEqual({ category: 'electronics', subcategory: 'smartwatch' })
    expect(placementFromTitle('Apple Watch Series 10 46mm 4G Aluminum Case', cases)?.subcategory).toBe('smartwatch')
  })
  it('says nothing when the row is already right', () => {
    expect(placementFromTitle('Apple Watch SE 3 40mm', { category: 'electronics', subcategory: 'smartwatch' })).toBeNull()
  })
  // ⚠️ Narrow on purpose: it needs a named watch AND a case size, so a genuine watch STRAP or a
  // phone case that merely mentions a watch is left alone for the breadcrumb to place.
  it('does not grab an accessory that merely names a watch', () => {
    expect(placementFromTitle('Dây đeo cho Apple Watch', cases)).toBeNull()
    expect(placementFromTitle('Ốp lưng iPhone 16 Pro Max', cases)).toBeNull()
  })
})
