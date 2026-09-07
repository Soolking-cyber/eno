import { describe, it, expect } from 'vitest'
import { categoryFor, subcategoryFor, brandFor, FEED_BRANDS } from './feed-taxonomy'

/**
 * These rules ran untested against ~9,700 live listings because they were trapped inside a script
 * that imports Prisma at module scope. The sibling rule that stayed inline (`modelFor`) invented a
 * product across 6 live listings before it could be tested. Every case below is a real title shape
 * from the feeds this maps.
 */
describe('categoryFor', () => {
  /**
   * ⛔ THE ORDERING BUG THE SOURCE COMMENT DESCRIBES. "tủ lạnh" (refrigerator) contains "tủ"
   * (cabinet), which the `storage` subcategory claims — a first-match scan files every fridge as a
   * wardrobe. This is the assertion that keeps the appliance rules ahead of the generic ones.
   */
  it('⛔ FILES A FRIDGE AS AN APPLIANCE, NOT FURNITURE-BY-KEYWORD', () => {
    expect(categoryFor('Tủ lạnh Samsung Inverter 236L')).toBe('furniture-appliances')
    expect(subcategoryFor('furniture-appliances', 'Tủ lạnh Samsung Inverter 236L')).toBe('white-goods')
    // …and a real cabinet still reaches storage.
    expect(subcategoryFor('furniture-appliances', 'Tủ quần áo gỗ 3 cánh')).toBe('storage')
  })

  /**
   * ⚠️ A SMARTWATCH IS ELECTRONICS, AN ANALOGUE WATCH IS FASHION — and this assertion changed
   * deliberately on 2026-09-07. It used to expect `fashion-beauty` for an Apple Watch, which put a
   * £600 gadget in with handbags and made `electronics/smartwatch` (a real subcategory the taxonomy
   * ships) unreachable. Order matters: "đồng hồ thông minh" contains "đồng hồ".
   */
  it('splits smartwatches from analogue watches', () => {
    expect(categoryFor('Đồng hồ thông minh Apple Watch Series 9')).toBe('electronics')
    expect(subcategoryFor('electronics', 'Apple Watch Series 9 45mm')).toBe('smartwatch')
    expect(categoryFor('Đồng hồ Casio nam dây thép')).toBe('fashion-beauty')
  })

  it('routes appliances, vehicles and audio by their own rules', () => {
    expect(categoryFor('Máy giặt LG Inverter 9kg')).toBe('furniture-appliances')
    expect(categoryFor('Xe đạp điện Yadea')).toBe('vehicles')
    expect(categoryFor('Tai nghe Bluetooth Sony WF-1000XM5')).toBe('electronics')
  })

  // ⚠️ The default is a judgement about the SOURCE (electronics retailers), not a neutral fallback.
  it('defaults an unmatched title to electronics', () => {
    expect(categoryFor('Sản phẩm không rõ loại')).toBe('electronics')
    expect(categoryFor('')).toBe('electronics')
  })
})

describe('subcategoryFor', () => {
  it('maps the common electronics shapes', () => {
    expect(subcategoryFor('electronics', 'iPhone 15 Pro Max 256GB - Cũ đẹp')).toBe('phones-tablets')
    expect(subcategoryFor('electronics', 'MacBook Air M2 13 inch')).toBe('laptops-pcs')
    expect(subcategoryFor('electronics', 'Màn hình Dell UltraSharp 27"')).toBe('tv-monitors')
    expect(subcategoryFor('electronics', 'Máy ảnh Sony Alpha A7 IV')).toBe('cameras')
    // ⚠️ `keyboards-mice`, not the old catch-all `accessories` — the taxonomy ships a dedicated
    // subcategory and burying mice in "Other accessories" is what made that facet useless.
    expect(subcategoryFor('electronics', 'Chuột Không dây Logitech M170')).toBe('keyboards-mice')
  })

  /**
   * ⚠️ NO MATCH LEAVES IT NULL, DELIBERATELY. Guessing would file a phone case under "Phones" and
   * make the facet useless; an unset subcategory is honest and the category filter still works.
   */
  it('⚠️ RETURNS NULL RATHER THAN GUESSING', () => {
    expect(subcategoryFor('electronics', 'Sản phẩm lạ')).toBeNull()
    expect(subcategoryFor('vehicles', 'Xe đạp điện Yadea')).toBeNull()
    expect(subcategoryFor('no-such-category', 'iPhone 15')).toBeNull()
  })
})

/**
 * ⛔ `\b` IS ASCII-ONLY AND FAILS ON VIETNAMESE WORDS ENDING IN A DIACRITIC. This is the bug these
 * tests caught on their first run against the rewritten rules: `/\btủ\b/` never matches "Tủ quần
 * áo" because `ủ` is not a `\w` character, while `/\bbàn\b/` DOES match "Bàn làm việc" because
 * `bàn` ends in an ASCII `n`. Half the rules working is what makes it ship.
 */
describe('Vietnamese word boundaries', () => {
  it('⛔ MATCHES TERMS ENDING IN A DIACRITIC — the ones a bare \\b silently drops', () => {
    expect(subcategoryFor('furniture-appliances', 'Tủ quần áo gỗ 3 cánh')).toBe('storage')
    expect(subcategoryFor('furniture-appliances', 'Kệ tivi gỗ sồi')).toBe('storage')
    expect(subcategoryFor('furniture-appliances', 'Ghế xoay văn phòng lưới')).toBe('sofa-seating')
  })

  // The boundary must still hold: a term inside a longer word is not a match.
  it('does not match a term embedded in another word', () => {
    expect(categoryFor('Bàn phím cơ Akko')).toBe('electronics')
    expect(subcategoryFor('electronics', 'Bàn phím cơ Akko')).toBe('keyboards-mice')
  })
})

/**
 * ⛔ PRODUCT TYPE BEATS SPEC TOKEN. The first ordering put component words above the product rules,
 * so a title that NAMES a product was filed by a spec it merely mentions. Measured on 6,160 staged
 * products: 260 laptops filed as `storage`, 36 tablets as `networking`. Four reviewers found it
 * independently from the diff. Every line below is one of those real titles.
 */
describe('spec tokens must not outrank the product', () => {
  it('⛔ A LAPTOP THAT MENTIONS SSD IS A LAPTOP', () => {
    expect(subcategoryFor('electronics', 'Dell Precision 3480 (i7 1370P/ 16GB/ SSD 512GB/ RTX A500)')).toBe('laptops-pcs')
    expect(subcategoryFor('electronics', 'MacBook Air M2 256GB SSD')).toBe('laptops-pcs')
    // …but a drive is still a drive.
    expect(subcategoryFor('electronics', 'Ổ cứng SSD Samsung 980 1TB')).toBe('storage')
  })

  it('⛔ AN iPAD THAT MENTIONS WiFi IS A TABLET, NOT NETWORKING', () => {
    expect(subcategoryFor('electronics', 'iPad Gen 9 WiFi 64GB - Cũ đẹp')).toBe('phones-tablets')
    expect(subcategoryFor('electronics', 'Switch mạng TP-Link 8 cổng')).toBe('networking')
  })

  it('⛔ A KIT LENS IS A CAMERA, AND USB-C EARBUDS ARE AUDIO', () => {
    expect(subcategoryFor('electronics', 'Canon EOS R50 Kit 18-45mm')).toBe('cameras')
    expect(subcategoryFor('electronics', 'AirPods Pro 2 (USB-C)')).toBe('audio')
  })

  /**
   * ⛔ `power-banks` WAS UNREACHABLE. The standard Vietnamese term is "pin sạc dự phòng", and the
   * generic `sạc` (charger) rule sat above it, so every power bank was filed as a cable.
   */
  it('⛔ REACHES power-banks — the sạc rule used to swallow it', () => {
    expect(subcategoryFor('electronics', 'Pin sạc dự phòng Anker 20000mAh')).toBe('power-banks')
    expect(subcategoryFor('electronics', 'Củ sạc nhanh 20W')).toBe('cables-chargers')
  })

  /**
   * ⛔ "để bàn" MEANS DESKTOP, NOT TABLE, and "bàn là" (iron) matches inside "bàn LÀm việc" (desk)
   * unless it carries a boundary. Two traps in one word; the second appeared while fixing the first.
   */
  it('⛔ SEPARATES DESKTOP, IRON AND DESK', () => {
    expect(categoryFor('Máy tính để bàn Dell OptiPlex 7090')).toBe('electronics')
    expect(categoryFor('Loa Bluetooth để bàn JBL')).toBe('electronics')
    expect(categoryFor('Bàn là hơi nước Philips')).toBe('electronics')
    expect(categoryFor('Bàn làm việc gỗ 1m2')).toBe('furniture-appliances')
    expect(subcategoryFor('furniture-appliances', 'Bàn làm việc gỗ 1m2')).toBe('tables-desks')
  })
})

describe('brandFor', () => {
  it('finds a brand and returns its slug', () => {
    expect(brandFor('iPhone 15 Pro Max - Apple chính hãng')).toBe('apple')
    expect(brandFor('Tủ lạnh Samsung Inverter')).toBe('samsung')
  })

  /**
   * ⛔ WORD BOUNDARIES ARE LOAD-BEARING. Without \b, "hp" matches inside "shop", "sharp" and
   * "graphics", and "lg" inside "Belgium" — filling the brand facet with products that have
   * nothing to do with the brand. These are the substrings that would break it.
   */
  it('⛔ DOES NOT MATCH A BRAND INSIDE ANOTHER WORD', () => {
    expect(brandFor('Ghế sofa cho shop thời trang')).toBeNull()   // "hp" inside "shop"
    expect(brandFor('Card đồ hoạ graphics rời')).toBeNull()        // "hp" inside "graphics"
    expect(brandFor('Sô cô la Belgium hảo hạng')).toBeNull()       // "lg" inside "Belgium"
  })

  it('returns null when no known brand appears', () => {
    expect(brandFor('Máy tính để bàn không thương hiệu')).toBeNull()
  })

  // The facet is a navigation aid: brands were chosen by frequency (15+ occurrences), not fame.
  it('keeps the brand list tight and slug-shaped', () => {
    expect(FEED_BRANDS.length).toBeLessThan(30)
    for (const b of FEED_BRANDS) expect(b, b).toMatch(/^[a-z0-9-]+$/)
  })
})
