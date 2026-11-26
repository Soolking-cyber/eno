import { describe, expect, it } from 'vitest'
import { NEW_APPLE_IPHONE_MODELS, isNewAppleExternalId, newAppleLine } from './new-apple'

const model = (t: string, url?: string) => newAppleLine(t, url)?.model ?? null

describe('newAppleLine — the device rows of the 2026-11-26 feeds and pages', () => {
  it.each([
    ['iPhone 18 Pro 256GB', 'iPhone 18 Pro'],
    ['iPhone 18 Pro 2TB', 'iPhone 18 Pro'],
    ['iPhone 18 Pro Max 256GB', 'iPhone 18 Pro Max'],
    ['iPhone Duo 1TB', 'iPhone Duo'],
    ['Macbook Neo 13-inch Chip A18 Pro with 6‑core CPU and 5‑core GPU 8GB RAM 256GB SSD', 'MacBook Neo'],
    ['MacBook Neo 13 inch A18 Pro 2026 6CPU 5GPU 8GB 512GB Touch ID | Chính hãng Apple Việt Nam', 'MacBook Neo'],
    ['MacBook Neo 2026 8GB/256GB', 'MacBook Neo'],
    ['MacBook Air M5 13 inch 2026 10CPU 10GPU 24GB 512GB Sạc 70W | Chính hãng Apple Việt Nam', 'MacBook Air M5'],
    ['MacBook Air M5 13 inch 10CPU 8GPU 16GB/512GB - Sạc nhanh 70W', 'MacBook Air M5'],
    ['Macbook Air 13-inch M5 chip with 10‑core CPU and 8‑core GPU, 24GB, 512GB SSD/70W', 'MacBook Air M5'],
    ['MacBook Pro PROLED XDR 14-inch M5 Pro chip with 15CPU 16GPU 24GB 1TB', 'MacBook Pro M5 Pro'],
    ['MacBook Pro (M5 Pro) 16 inch chip with 18‑core CPU and 20‑core GPU, 24GB', 'MacBook Pro M5 Pro'],
    ['MacBook Pro M5 Max 16 inch 2026 18CPU 40GPU 48GB 2TB Sạc 140W | Chính hãng Apple Việt Nam', 'MacBook Pro M5 Max'],
    ['MacBook Pro 14-inch M6 12CPU 12GPU 16GB 1TB', 'MacBook Pro M6'],
    ['iMac 24-inch M6 12CPU 12GPU 16GB 256GB - Nano texture glass', 'iMac M6'],
    ['Apple iMac 24 2026 M6 10CPU 10GPU 16GB 256GB | Chính hãng', 'iMac M6'],
    ['Apple Mac mini M6 12CPU 12GPU 16GB 256GB 2026 | Chính hãng Apple Việt Nam', 'Mac mini M6'],
    ['Mac mini M5 Pro chip with 15-core CPU and 16-core GPU, 24GB, 512GB SSD', 'Mac mini M5 Pro'],
    ['Mac Studio M5 Ultra chip with 30-core CPU, 64-core GPU, 96GB, 1TB', 'Mac Studio M5 Ultra'],
    ['Apple Mac Studio M5 Max 18CPU 32GPU 36GB 512GB 2026 | Chính hãng Apple Việt Nam', 'Mac Studio M5 Max'],
  ])('%s → %s', (title, want) => expect(model(title)).toBe(want))

  it.each([
    // last year's or older lines
    'MacBook Pro 14 inch M5 2025 (10 core GPU| 10 core CPU| 16GB RAM| 1TB SSD)',
    'MacBook Pro 14 M5 10CPU 10GPU 16GB 1TB | Chính hãng Apple Việt Nam',
    'iMac M4 2024 24 inch (8 Core GPU/16GB/256GB)',
    'Mac mini M4 2024 10CPU 10GPU 16GB 512GB | Chính hãng Apple Việt Nam',
    'Apple Mac Studio M4 Max 16CPU 40GPU 48GB 1TB | Chính hãng Apple Việt Nam',
    'MacBook Air M4 13 inch 2025 10CPU 10GPU 24GB 512GB Sạc 70W | Chính hãng Apple Việt Nam',
    'iPhone 17 Pro Max 256GB',
    'iPhone 18 256GB',
    // opened, used, swapped
    'iPhone 18 Pro Max 2TB - Đã kích hoạt',
    'iPhone 18 Pro 256GB - Cũ đẹp',
    'iPhone 18 Pro 1TB - Đổi bảo hành',
    'MacBook Air M5 13 inch 2026 10CPU 8GPU 16GB 512GB | Chính hãng - Đã Kích Hoạt',
    'MacBook Neo 13 inch A18 Pro 2026 6CPU 5GPU 8GB 256GB - Cũ Đẹp',
    // accessories and services that name the device
    'Apple iPhone 18 Pro/18 Pro Max dán bảo vệ camera Mipow viền',
    'AppleCare+ cho iPhone 18 Pro',
    'Ốp lưng iPhone 18 Pro Max Apple With Magsafe Clear',
    'Bộ dán Full Innostyle MacBook 3m 6in1 For MacBook Neo 13 inch Diamond Guard',
    'S-Buyback iPhone 17 Pro Max cam kết giá thu 15 tháng',
    // no tier
    'Mac Studio M2 Ultra',
  ])('%s → null', (title) => expect(model(title)).toBeNull())

  it('a used product URL disqualifies the row', () => {
    expect(model('iPhone 18 Pro 256GB', 'https://cellphones.com.vn/iphone-18-pro-256gb-cu-dep.html')).toBeNull()
    expect(model('iPhone 18 Pro 256GB', 'https://cellphones.com.vn/iphone-18-pro.html')).toBe('iPhone 18 Pro')
  })

  it('decodes entities and tolerates spacing', () => {
    expect(model('iPhone 18 Pro Max&nbsp;512GB')).toBe('iPhone 18 Pro Max')
    expect(model('  iphone  duo  256 GB ')).toBe('iPhone Duo')
  })

  it('the iPhone models are the exact Listing.model values the pages read', () => {
    expect(NEW_APPLE_IPHONE_MODELS).toEqual(['iPhone 18 Pro Max', 'iPhone 18 Pro', 'iPhone Duo'])
  })

  it('the externalId namespace', () => {
    expect(isNewAppleExternalId('new:141654')).toBe(true)
    expect(isNewAppleExternalId('141654')).toBe(false)
    expect(isNewAppleExternalId(null)).toBe(false)
  })
})
