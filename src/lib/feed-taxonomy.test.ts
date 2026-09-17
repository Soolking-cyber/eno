import { describe, it, expect } from 'vitest'
import { categoryFor, subcategoryFor, brandFor, FEED_BRANDS, refreshPlacement } from './feed-taxonomy'

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

// ── The Books aisle (2026-09-13): real Tiki title shapes that all landed in `electronics` ─────────
describe('books and stationery', () => {
  it.each([
    'Sách Tâm Lý Học Thành Công Tái Bản',
    'Combo 2 Cuốn Sách Kỹ Năng Làm Việc Hay Đừng Bao Giờ Đi Ăn Một Mình Tái bản',
    'Sách Bàn Về Tự Do',
    'Truyện Tranh Thám Tử Lừng Danh Conan - Tập 12',
    'Từ Điển Đức - Việt Hiện Đại',
    'Lịch Sử Thế Giới Cổ Đại Tái bản năm 2020',
    'Sổ lò xo kép bìa nhựa 320 trang, Klong 906 - Xanh dương',
  ])('files %s as books-stationery', (title) => {
    expect(categoryFor(title)).toBe('books-stationery')
  })

  it.each(['Kệ sách gỗ 5 tầng', 'Giá sách treo tường', 'Bàn phím Bluetooth Hyper HS2310US', 'Hộp carton bìa cứng 30x20cm', 'Máy in laser in giấy A4 Canon LBP2900'])(
    'does not file %s (shelf, rack, keyboard, carton, printer) as a book or stationery', (title) => {
      expect(categoryFor(title)).not.toBe('books-stationery')
    })

  it.each([
    ['Truyện Tranh Dragon Ball Full Color - Tập 4', 'comics-manga'],
    ['Từ Điển Đức - Việt Hiện Đại', 'languages-dictionaries'],
    ['Sách Bài Tập Tiếng Anh Lớp 7', 'languages-dictionaries'],
    ['Sách Ôn Tập Luyện Thi Hóa Hữu Cơ', 'textbooks-exam'],
    ['Sổ lò xo kép bìa nhựa 320 trang', 'stationery-office'],
    ['Sách Tâm Lý Học Thành Công', null],
  ])('shelves %s under %s', (title, sub) => {
    expect(subcategoryFor('books-stationery', title)).toBe(sub)
  })
})

describe('refreshPlacement', () => {
  const feed = { categorySlug: 'electronics', subcategorySlug: 'audio' }

  it('a new row takes the feed placement', () => {
    expect(refreshPlacement(null, feed)).toEqual(feed)
  })

  it('a re-filed row keeps its placement over the title rules', () => {
    const kept = { categorySlug: 'books-stationery', subcategorySlug: 'literature' }
    expect(refreshPlacement(kept, feed)).toEqual(kept)
    expect(refreshPlacement({ categorySlug: 'books-stationery', subcategorySlug: null }, feed))
      .toEqual({ categorySlug: 'books-stationery', subcategorySlug: null })
  })

  it('a row in the same aisle with no shelf takes the feed shelf', () => {
    expect(refreshPlacement({ categorySlug: 'electronics', subcategorySlug: null }, feed)).toEqual(feed)
  })

  it('a row still in the importer\'s default bucket takes the new rule\'s answer', () => {
    const book = { categorySlug: 'books-stationery', subcategorySlug: null }
    expect(refreshPlacement({ categorySlug: 'electronics', subcategorySlug: null }, book)).toEqual(book)
    // …but an electronics row WITH a shelf was filed on purpose and stays.
    expect(refreshPlacement({ categorySlug: 'electronics', subcategorySlug: 'audio' }, book)).toEqual({ categorySlug: 'electronics', subcategorySlug: 'audio' })
  })

  it('a row whose category is unknown takes the feed placement', () => {
    expect(refreshPlacement({ categorySlug: null, subcategorySlug: null }, feed)).toEqual(feed)
  })
})

/**
 * ⛔ THE ACCESSORY-NAMES-THE-DEVICE BUG (2026-09-17). 95 of the 127 live "iPhone 18" listings were
 * cases and tempered glass filed as `phones-tablets`, because the phone rule read the phone's name
 * out of the accessory's title. Every title below is a real one, and each pins a distinct trap the
 * first fix introduced and the 60,000-title replay caught.
 */
describe('subcategoryFor — accessories that name the device they fit', () => {
  const sub = (name: string) => subcategoryFor(categoryFor(name), name)

  it('files a case as a case, not as the phone it fits', () => {
    expect(sub('Ốp lưng iPhone 18 Pro Max/17 Pro Max Wiwu Areoshield Ultra Airbag AS-203')).toBe('phone-cases')
    expect(sub('Bayer II PC TPU AVA+ OCM17004B Magnetic iPhone 18 Pro Case with Button Control')).toBe('phone-cases')
    expect(sub('Bao da Mutural Design Folio cho Apple iPad 10.2 2021')).toBe('phone-cases')
  })

  it('files glass and film as protectors — including the ones that said "màn hình" or "lens"', () => {
    expect(sub('Dán kính cường lực màn hình iPhone 18 Pro Zagg Invisibleshield Xtr6')).toBe('screen-protectors')
    // `màn hình` used to reach the tv-monitors rule first: 144 phone films were filed as monitors.
    expect(sub('Dán kính cường lực màn hình Samsung Galaxy A13 Mocoll')).toBe('screen-protectors')
    // astra's catch: the camera rule owns the bare token `lens`.
    expect(sub('JCPal Preserver Aluminosilicate Camera Lens Protector for iPhone 18 Pro')).toBe('screen-protectors')
    expect(sub('Mipow IRONBULL BJ804-BK Tempered Glass Screen Protector for iPhone 18 Pro')).toBe('screen-protectors')
  })

  it('still files the phone itself as a phone', () => {
    expect(sub('iPhone 18 Pro 256GB')).toBe('phones-tablets')
    expect(sub('iPhone 18 Pro Max 2TB | Chính Hãng Apple Việt Nam')).toBe('phones-tablets')
    expect(sub('Canon EOS R50 Kit 18-45mm')).toBe('cameras')
  })

  it('does not read a free gift as the product (agy)', () => {
    // A tablet whose bundle includes a folio is NOT a case. It lands unfiled rather than in
    // `phones-tablets` because the phone rule has no token for "Redmi Pad" — honest, and the
    // category filter still works. Before the gift clause was cut it was filed as a phone case.
    expect(sub('Xiaomi Redmi Pad 2 Wifi 8GB/256GB Chính Hãng (Tặng Kèm Bao Da Chính Hãng)')).toBe(null)
    // …but "mua 1 tặng 1" is buy-one-get-one: the product comes AFTER the word, so nothing is cut.
    expect(sub('Mua 1 tặng 1 Tấm dán màn hình curved film full viền 3D cho Samsung Galaxy S23 Ultra Nillkin')).toBe('screen-protectors')
  })

  it('reads a trailing "- Kèm …" bundle as part of the device, not as the product', () => {
    expect(sub('Lenovo Idea Tab Wifi 8GB 128GB ZAFR0366VN - Kèm bút- ốp lưng')).not.toBe('phone-cases')
    // …but a case that COMES WITH a keyboard is still a case.
    expect(sub('Ốp lưng kèm bàn phím ZAGG Pro Keys iPad Pro 12.9 inch - Hàng chính hãng')).toBe('phone-cases')
  })

  it('does not file a phone as a case when the gift clause comes FIRST', () => {
    // ⛔ agy, on the final diff: an unbounded cut ate the whole title, the length guard then fell
    // back to the original, and `ốp lưng` at the front filed the handset as a phone case.
    expect(sub('Tặng kèm ốp lưng chính hãng khi mua iPhone 18 Pro 256GB')).toBe('phones-tablets')
  })

  it('does not read a watch body material as a watch case (opus — 22 live Apple Watches were moved)', () => {
    // ⛔ Apple titles its own watches with the case MATERIAL. A repair pass filed these as accessories
    // before review caught it; they were restored from the pass's snapshot.
    expect(sub('Apple Watch SE 2025 44mm GPS Aluminum Case with Sport')).toBe('smartwatch')
    expect(sub('Apple Watch Series 8 45mm Aluminum Case with Sport cũ ( Esim )')).toBe('smartwatch')
    // …while a real case FOR the watch is still an accessory.
    expect(sub('Ốp Case Siêu Mỏng Thinfit cho Apple Watch Series 7 Series 8 Size 4145mm')).toBe('accessories')
    expect(sub('Case RM Yoshi cho Apple Watch Ultra 49mm')).toBe('accessories')
  })

  it('keeps the English word "case" away from chassis, enclosures and charging cases', () => {
    expect(sub('[Like New] Dell Latitude 7430 (Core i7-1265U, 32GB, 256GB, Iris Xe, 14.0 FHD Alumium Case)')).toBe('laptops-pcs')
    // The dev-board rule claims it — an enclosure for a Pi, not a phone case.
    expect(sub('Vỏ bảo vệ bằng nhựa ABS Case for Raspberry Pi 5 V2')).toBe('accessories')
    expect(sub('Microphone không dây DJI Mic Mini 2 (2 TX + 1 MOBILE RX + CHARGING CASE)')).toBe('cameras')
    expect(sub('Case máy tính Corsair 6500X Tempered Glass Mid-Tower')).toBe('accessories')
  })

  it('sends laptop sleeves and MacBook shells to accessories, not to phone cases', () => {
    expect(sub('Túi Chống sốc Tomtoc Protective cho Macbook Pro 15.6 - 16 inch A13-E01')).toBe('accessories')
    expect(sub('Ốp lưng MacBook Air 13 (M2/M3/M4) UAG Chống Sốc Lucent Ice/Black')).toBe('accessories')
  })

  it('does not let a foam or a bookmark masquerade as an accessory', () => {
    // `\bốp\b` matched "Xốp" (foam) — JavaScript word boundaries are ASCII-only.
    expect(sub('Cây Lau Nhà MyJae Đài Loan Dạng Mút Xốp PVA Thông Minh')).not.toBe('phone-cases')
    expect(sub('Hộp 20 miếng dán mắt 3M 1539 hỗ trợ nhược thị cho trẻ trên 4 tuổi')).not.toBe('screen-protectors')
  })
})
