import { describe, expect, it } from 'vitest'
import { isUsedTitle, textSaysUsed, urlSaysUsed } from './used-signal'

/**
 * Fixtures are LIVE titles and URLs from the production catalogue (read-only, 2026-10-03), so the cues
 * are tested against what the shops actually write — including the rows the first pass got wrong.
 */
describe('isUsedTitle — the shop says it is second-hand', () => {
  it.each([
    'Samsung Galaxy S24 Ultra 256GB Cũ 99%',
    'iPhone 13 Pro Max Likenew Pin 100%',
    'iPhone 14 Pro Max 128GB Likenew Fullbox',
    'iPhone 13 Pro 256GB Pin 100 LL/A',
    'MacBook Air M1 2020 Máy Đẹp',
    'iPhone 15 Pro CPO chính hãng',
    'MacBook Pro 14 M3 Sạc 422 Lần',
    'Apple iPhone X 64GB cũ-Silver',
    'iPhone XR 64GB Cũ',
    'Mic Karaoke Alpha Works D2 - Cũ',
    'iPad Air 13 inch M4 Wifi 128GB 2026 | Hàng trưng bày',
    'IPHONE 17 256GB LAVENDER ZP/A TRƯNG BÀY FULLBOX',
    'ThinkPad T480 second hand',
    'Dell Latitude 7490 used',
    'AirPods Pro 2nd Gen - Cũ',
  ])('used: %s', (t) => {
    expect(isUsedTitle(t)).toBe(true)
  })

  it.each([
    'Củ sạc nhanh Apple 20W USB-C',
    'Combo củ sạc , cáp sạc Apple 96W USB-C Power Adapter NOBOX',
    'Bộ dụng cụ sửa chữa điện thoại 25 trong 1',
    'Ốp lưng cũng đẹp cho iPhone 17',
    'Atomic Habits 2nd Edition',
    // An accessory that PREVENTS scratches — the reason "trầy xước" is not a cue.
    'Cường Lực iPhone LITO Viền Silicone Chống Va Đập Và Trầy Xước Màn Hình',
    'Miếng Dán Chống Trầy Cho Điện Thoại Android',
    // Commit-gate review: battery LIFE is not battery health, a discount is not a grade, clearance is not "used".
    'Tai nghe Marshall Major V pin 100 giờ',
    'Loa JBL Flip 6 Pin 90 phút',
    'Tai nghe Sony battery 90 hours',
    'Ốp lưng iPhone 17 giảm 95%',
    'Cáp sạc Anker sale 99%',
    'Máy lọc không khí lọc bụi 99%',
    'Màn hình 99% DCI-P3',
    'Ốp lưng kháng khuẩn giảm đến 99%',
    'Kệ trưng bày điện thoại',
    'Thanh lý tai nghe mới nguyên seal',
    'AirPods Pro 2nd Gen',
    'Sách Tiếng Anh 2nd reprint',
    'iPhone 17 Pro Max 256GB Chính hãng VN/A',
    'Máy lạnh Panasonic 1.5HP 2026 (CU/CS-RU12CKH-8D)',
    // English "used" as a verb — the machine translation of "dùng cho" on new accessories (commit-gate review).
    'Case used for iPhone 17 Pro Max',
    'USB-C cable can be used with MacBook and iPad',
    'Screen protector commonly used on Galaxy S25',
    '',
  ])('not used: %s', (t) => {
    expect(isUsedTitle(t)).toBe(false)
  })

  it('"2nd Gen" is not a condition in EITHER title — the 2026-10-03 SQL checked only the English one', () => {
    expect(isUsedTitle('AirPods Pro 2nd Gen USB-C', 'Tai nghe AirPods Pro 2nd Gen USB-C')).toBe(false)
  })

  it('reads the Vietnamese title when the English one is a translation without the cue', () => {
    expect(isUsedTitle('Apple Watch S8 41mm', 'Apple Watch S8 41mm cũ đổi bảo hành')).toBe(true)
  })

  it('matches a decomposed ũ (u + combining tilde) after NFC normalisation', () => {
    expect(textSaysUsed('iPhone 12 cũ')).toBe(true)
  })
})

describe('urlSaysUsed — the product URL slug', () => {
  it.each([
    'https://cellphones.com.vn/micro-karaoke-alpha-works-d2-cu.html',
    'https://go.isclix.com/deep_link/1/2?url=https%3A%2F%2Fcellphones.com.vn%2Fipad-a16-11-inch-cu-doi-bao-hanh.html',
    'https://cellphones.com.vn/iphone-15-256gb-cu-chinh-hang-da-kich-hoat.html',
    'https://dienthoaigiakho.vn/iphone-13-like-new',
    'https://dienthoaigiakho.vn/iphone-13-likenew',
    'https://bachlongstore.vn/iphone-15-pro-max-256gb-cu-99.html',
    'https://bachlongstore.vn/samsung-galaxy-z-fold7-12gb/512gb-cu.html',
    'https://bachlongstore.vn/iphone-14-pro-cu-1710237884.html',
  ])('used: %s', (u) => {
    expect(urlSaysUsed(u)).toBe(true)
  })

  it.each([
    // "củ sạc" — a charger. These two rows were kept and labelled used on this clause alone.
    'https://bachlongstore.vn/combo-cu-sac-cap-sac-apple-96w-usb-c-power-adapter-nobox.html',
    'https://bachlongstore.vn/combo-cu-sac-cap-sac-apple-96w-usb-c-power-adapter.html',
    'https://bachlongstore.vn/bo-cu-sac.html',
    // An unaccented "cu" that is not "cũ" — the commonest "-cu-" slugs across the import shops.
    'https://www.nhatot.com/cho-thue-can-ho-chung-cu-quan-7.htm',
    'https://bachlongstore.vn/bo-cong-cu-sua-chua.html',
    'https://bachlongstore.vn/cu-nguon-sac-nhanh-20w.html',
    'https://bachlongstore.vn/bo-cu-phat-wifi-4g.html',
    // "củ đa năng" — a multi-port charger; only `-cu-da-kich…` (đã kích hoạt, activated) is a cue.
    'https://bachlongstore.vn/bo-cu-da-nang-65w.html',
    // "củ đôi" (a dual charger) and a port count are not cues; only `-cu-doi-bao-hanh` and a 9x grade are.
    'https://bachlongstore.vn/cu-sac-doi-20w.html',
    'https://bachlongstore.vn/bo-cu-doi-35w.html',
    'https://bachlongstore.vn/combo-cu-2-cong-65w.html',
    // An allow-listed suffix only counts as a whole word: "cu-chuyen-doi" is an adapter (củ chuyển đổi).
    'https://bachlongstore.vn/adapter-cu-chuyen-doi-type-c.html',
    'https://bachlongstore.vn/combo-cap-va-cu-20w.html',
    // "dụng cụ" — a tool or kit, not "cũ".
    'https://go.isclix.com/deep_link/1/2?url=https%3A%2F%2Fcellphones.com.vn%2Fbo-dung-cu-nuong-banh-philips-hd9925-01.html',
    // Panasonic air-conditioner model codes, CU/CS-…
    'https://go.isclix.com/deep_link/1/2?url=https%3A%2F%2Fcellphones.com.vn%2Fmay-lanh-panasonic-inverter-1-5-hp-cu-cs-ru12ckh-8d',
    'https://cellphones.com.vn/iphone-17-pro-max.html',
    '',
  ])('not used: %s', (u) => {
    expect(urlSaysUsed(u)).toBe(false)
  })

  it('a charger combo with no used cue anywhere is not used', () => {
    expect(isUsedTitle(
      'Apple 96W USB-C Power Adapter Charger & Cable Combo NOBOX',
      'Combo củ sạc , cáp sạc Apple 96W USB-C Power Adapter NOBOX',
      'https://bachlongstore.vn/combo-cu-sac-cap-sac-apple-96w-usb-c-power-adapter-nobox.html',
    )).toBe(false)
  })
})
