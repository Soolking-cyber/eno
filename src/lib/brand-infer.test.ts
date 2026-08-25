import { describe, expect, it } from 'vitest'
import { inferBrand, lineBrandSlugs } from './brand-infer'

const KNOWN = ['apple', 'samsung', 'spigen', 'uag', 'baseus', 'xiaomi', 'lenovo', 'asus', 'sony', 'anker', 'lg', 'hp', 'dell', 'tefal']
const b = (title: string, sub: string | null = 'phones-tablets') => inferBrand(title, null, sub, KNOWN)

describe('inferBrand — the complaint this was written for', () => {
  /**
   * ⛔ 267 of 274 iPhones had no brand, so choosing Phones + Apple showed iPads and three old
   * handsets (owner: "i chose phones and apple but cant see iphone models"). A title never says
   * "Apple"; it says "iPhone".
   */
  it('resolves an Apple device from its product line', () => {
    expect(b('iPhone 16 Pro Max 256GB')).toBe('apple')
    expect(b('iPad Pro M5 chip 13-inch Wifi 1TB')).toBe('apple')
    expect(b('MacBook Air M5 13-inch 2026', 'laptops-pcs')).toBe('apple')
    expect(b('Apple Watch Series 10 46mm', 'smartwatch')).toBe('apple')
  })
  it('resolves the other makers whose titles name a line, not a brand', () => {
    expect(b('Galaxy S26 Ultra 512GB')).toBe('samsung')
    expect(b('Redmi Note 14 Pro 256GB')).toBe('xiaomi')
    expect(b('Laptop ThinkPad X1 Carbon', 'laptops-pcs')).toBe('lenovo')
    expect(b('Laptop VivoBook 14 M1407KA', 'laptops-pcs')).toBe('asus')
    expect(b('LG Gram 15.6 inch', 'laptops-pcs')).toBe('lg')
  })
})

describe('inferBrand — an accessory belongs to its MAKER, not the device it fits', () => {
  /**
   * ⛔ THE TRAP. "Spigen Core Armor Case for iPhone 16" names two brands. Mapping the device line
   * everywhere would file every third-party case under Apple and make the brand filter worse than
   * before. The device is already carried by the `compatibleWith` spec.
   */
  it('picks the case maker, never the phone', () => {
    expect(b('Spigen Core Armor Matte Case for iPhone 16e/15/14/13', 'phone-cases')).toBe('spigen')
    expect(b('iPhone 16 Pro Max Spigen Crystal Slot Clear Case', 'phone-cases')).toBe('spigen')
    expect(b('UAG Metropolis LT Shockproof Case for iPhone 16 Pro', 'phone-cases')).toBe('uag')
    expect(b('UAG Plyo Lt Shockproof Case for iPad Air 11', 'phone-cases')).toBe('uag')
  })
  // ⛔ An accessory whose maker is unknown gets NO brand rather than the device's.
  it('refuses to hand an unbranded accessory to the device maker', () => {
    expect(b('Op lung iPhone 16 Pro Max trong suot', 'phone-cases')).toBeNull()
    expect(b('Cap sac cho iPad Pro 2m', 'cables-chargers')).toBeNull()
    expect(b('Tui chong soc MacBook Air 13', 'bags-sleeves')).toBeNull()
  })
  it('still reads a known maker on an accessory', () => {
    expect(b('Baseus 65W GaN charger for iPhone', 'cables-chargers')).toBe('baseus')
    expect(b('Anker PowerCore 20000mAh', 'power-banks')).toBe('anker')
  })
  // ⚠️ The same title in a DEVICE subcategory is the device — that is the whole distinction.
  it('does use the device line when the product is the device', () => {
    expect(b('iPhone 16 Pro Max 256GB', 'phones-tablets')).toBe('apple')
    expect(b('iPhone 16 Pro Max 256GB', 'phone-cases')).toBeNull()
  })
})

describe('inferBrand — two brands in one accessory title', () => {
  /**
   * ⛔ THE TRAP CODEX FOUND AFTER THE FIRST FIX. The accessory guard only covered the LINE map
   * ("iphone"), so wherever the device maker's NAME is written out — every Android accessory —
   * longest-first picked it: "Spigen case for Samsung Galaxy S26" resolved to samsung, because
   * "samsung" is a longer string than "spigen".
   */
  it('prefers the third-party maker over the device maker', () => {
    expect(b('Spigen case for Samsung Galaxy S26', 'phone-cases')).toBe('spigen')
    expect(b('Genuine Spigen Chronos With MagSafe case for Samsung Galaxy', 'phone-cases')).toBe('spigen')
  })
  // ⚠️ Apple and Samsung do sell their own cases, so a lone device maker is still accepted…
  it('accepts the device maker when it is the only brand named', () => {
    expect(b('Samsung Silicone Case for Galaxy S26', 'phone-cases')).toBe('samsung')
  })
  /**
   * …unless it appears ONLY after "for"/"cho", which marks compatibility rather than authorship.
   * ⚠️ `\S` not `\w` in that lookahead — ASCII classes cannot cross "điện thoại".
   */
  it('reads "for X" / "cho X" as compatibility, in both languages', () => {
    expect(b('Case for Samsung Galaxy S26 clear', 'phone-cases')).toBeNull()
    expect(b('Op lung cho Samsung Galaxy S26', 'phone-cases')).toBeNull()
    expect(b('Ốp lưng cho điện thoại Samsung Galaxy S26', 'phone-cases')).toBeNull()
  })
})

describe('inferBrand — a platform name is not a maker', () => {
  // ⛔ "Google Tivi Sony 55 inch" is a SONY television running Google TV. 22 of them were filed
  // under Google, because "google" out-lengths "sony" and both are in the title.
  it('ignores the operating system in a Vietnamese TV title', () => {
    expect(inferBrand('Google Tivi Sony Bravia 55 inch', null, 'tv-monitors', ['google', 'sony'])).toBe('sony')
    expect(inferBrand('Android Tivi TCL 43 inch', null, 'tv-monitors', ['google', 'tcl'])).toBe('tcl')
  })
  it('still resolves a genuine Google device', () => {
    expect(inferBrand('Google Pixel 9 Pro', null, 'phones-tablets', ['google'])).toBe('google')
  })
})

describe('inferBrand — a written brand name always wins', () => {
  it('prefers the name in the title over any inference', () => {
    expect(b('Samsung Galaxy S26 Ultra')).toBe('samsung')
    expect(b('Sony WH-1000XM6 headphones', 'audio')).toBe('sony')
  })
  // ⚠️ Longest-first, so a short slug cannot swallow a longer brand that contains it.
  it('matches the longest brand name, not a substring of one', () => {
    expect(inferBrand('Asus ROG Strix laptop', null, 'laptops-pcs', ['as', 'asus'])).toBe('asus')
  })
  it('matches whole words only', () => {
    expect(inferBrand('Pineapple corer', null, 'accessories', ['apple'])).toBeNull()
  })
})

describe('inferBrand — a line word must mean nothing else', () => {
  /**
   * ⛔ THE FIRST VERSION MAPPED DELL'S "PRECISION" LINE and immediately filed a
   * "Tefal Easy Fry + Grill Precision EY505815 Air Fryer" as a Dell. `gram` (LG's laptop AND the
   * unit of mass), `latitude`, `surface`, `switch`, `envy`, `swift`, `predator` and `pixel` were
   * all waiting to do the same. They were dropped rather than tightened, because a line word only
   * matters when the brand NAME is absent — and these titles almost always say the brand.
   */
  it('does not read an ordinary English word as a product line', () => {
    expect(inferBrand('Tefal 2-in-1 Easy Fry + Grill Precision EY505815 Air Fryer', null, 'kitchenware', ['tefal'])).toBe('tefal')
    expect(inferBrand('Ca phe rang xay 500 gram', null, 'kitchenware', KNOWN)).toBeNull()
    expect(inferBrand('Bo chuyen doi mang switch 8 cong', null, 'networking', KNOWN)).toBeNull()
  })
  // ⚠️ And the dropped words cost nothing, because the brand name is there anyway.
  it('still resolves those products from the brand name in the title', () => {
    expect(inferBrand('Laptop Dell Precision 3580', null, 'laptops-pcs', KNOWN)).toBe('dell')
    expect(inferBrand('LG Gram 15.6 inch', null, 'laptops-pcs', KNOWN)).toBe('lg')
  })
})

describe('inferBrand — null is a real answer', () => {
  /** ⛔ A wrong brand hides a product from the filter it belongs in AND pollutes another. */
  it('returns null when nothing is certain', () => {
    expect(b('Noi com dien 1.8L', 'kitchenware')).toBeNull()
    expect(b('Cap HDMI 2m', 'cables-chargers')).toBeNull()
    expect(b('', null)).toBeNull()
  })
  it('never invents a brand outside the known set or the line map', () => {
    const out = b('Some Unknown Gadget 2026')
    expect(out === null || KNOWN.includes(out) || lineBrandSlugs().includes(out)).toBe(true)
  })
})
