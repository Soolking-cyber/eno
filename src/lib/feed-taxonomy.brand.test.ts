import { describe, expect, it } from 'vitest'
import { brandFor } from './feed-taxonomy'

describe('brandFor — a product line names its maker', () => {
  it.each([
    ['iPhone 18 Pro 256GB', 'apple'],            // CellphoneS feed title, measured
    ['iPhone 18 Pro Max 2TB', 'apple'],
    ['iPad Air 5 64G Wifi Silver', 'apple'],
    ['MacBook Air M3 13 inch', 'apple'],
    ['Tai nghe AirPods Pro 3', 'apple'],
    ['Dây đeo Apple Watch Series 9', 'apple'],    // Apple's own strap — no "cho"/"for" in the title
    ['Samsung Galaxy S26 Ultra', 'samsung'],     // an explicit brand word still wins
  ])('%s → %s', (name, brand) => expect(brandFor(name)).toBe(brand))

  it.each([
    'Ốp lưng cho điện thoại',                    // no brand at all
    'Galaxy Space Projector Night Light',        // "Galaxy" alone is not Samsung
    'Kiphonex adapter',                          // whole-word only
    // Accessories FOR the line are not the line's maker — measured titles from the same feed:
    'Ốp lưng iPhone 18 Pro/17 Pro Zagg Crystal Palace With Magsafe Clear',
    'Miếng dán camera iPhone 18 Pro/ iPhone 18 Pro Max Titanshield Mipow IRONBULL BJ18A-RD',
    'Cáp sạc USB-C cho iPhone 18',
    'Kính cường lực iPad Pro 13 inch',
    // ⚠️ "Dây đeo Apple Watch Series 9" IS still apple and sits in the list above — a strap with no
    // "cho"/"for" in its title reads as Apple's own (their Alpine Loop is titled exactly that way).
    // "Dây đeo CHO Apple Watch" is the third-party shape, and that one resolves to null; the word
    // between the product and the device is the whole signal.
  ])('%s → null', (name) => expect(brandFor(name)).toBeNull())
})

/**
 * ⛔ THE HOST-BRAND LEAK, found by both external reviewers on the 2026-09-17 diff and confirmed at
 * 914 live rows: a case or a screen protector was taking the brand of the phone it fits.
 */
describe('brandFor — an accessory is not made by the phone it fits', () => {
  it('does not brand a third-party accessory with the host device maker', () => {
    expect(brandFor('Miếng Dán Cường Lực Camera Lens Dành Cho Samsung Galaxy S23 Ultra Zeelot')).toBe(null)
    expect(brandFor('Ốp lưng iPhone 18 Pro Max/17 Pro Max Wiwu Areoshield Ultra Airbag')).toBe(null)
    expect(brandFor('Dán kính cường lực màn hình Apple iPhone 16 Pro Max Mipow Premium')).toBe(null)
  })

  it('still brands the device itself, by name or by product line', () => {
    expect(brandFor('iPhone 18 Pro 256GB')).toBe('apple')
    expect(brandFor('Điện thoại iPhone 18 Pro Max 512GB')).toBe('apple')
    expect(brandFor('Apple iPhone 18 Pro Max 512GB')).toBe('apple')
  })

  it('keeps the brand on the device itself even when the title carries accessory words', () => {
    // ⛔ THE FIRST FIX WAS TOO BLUNT AND A MEASUREMENT CAUGHT IT: keying on accessory NOUNS
    // unbranded 2,888 rows, these three among them (opus predicted it on the diff review).
    expect(brandFor('Tai nghe Bluetooth Apple AirPods 3 2022 sạc có dây - Cũ')).toBe('apple')
    expect(brandFor('Dây đeo Apple Watch Alpine Loop 44/45/46/49mm Large - Black Titanium')).toBe('apple')
    expect(brandFor('Điện thoại iPhone 18 Pro Max 512GB')).toBe('apple')
  })

  it('keeps the brand on a phone whose title merely mentions a charger or a cable', () => {
    // ⛔ agy, on the final diff: the guard on the product-line path tested `ACCESSORY_RE`, which
    // holds `sạc` and `cáp`, so a retail phone title that names its charger came back unbranded.
    expect(brandFor('iPhone 18 Pro 256GB kèm sạc nhanh')).toBe('apple')
    expect(brandFor('Tai nghe AirPods Pro 3 sạc không dây')).toBe('apple')
    // …while a sleeve FOR a MacBook still resolves to nothing rather than to Apple.
    expect(brandFor('Túi chống sốc bao da laptop macbook kiêm giá đỡ tản nhiệt')).toBe(null)
  })

  it('treats a brand named after "cho"/"for" as the target, not the maker', () => {
    expect(brandFor('Cáp sạc USB-C cho iPhone 18')).toBe(null)
    expect(brandFor('Ốp lưng cho Samsung Galaxy S26 Ultra')).toBe(null)
  })

  it('reads through a free gift so a bundled folio does not unbrand the tablet', () => {
    expect(brandFor('Xiaomi Redmi Pad 2 Wifi 8GB/256GB Chính Hãng (Tặng Kèm Bao Da Chính Hãng)')).toBe('xiaomi')
  })
})
