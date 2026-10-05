import { describe, expect, it } from 'vitest'
import { subcategoryMatchesText, suggestSubcategory } from './taxonomy'

/**
 * ⛔ THE SUBCATEGORY SUGGESTER: WHOLE WORDS, MARKS KEPT, THE LONGEST KEYWORD WINS (nav audit N11, 2026-10-05).
 *
 * It was `title.includes(keyword)` over the subcategories in array order, first hit wins — so "Tủ lạnh Toshiba
 * 180L" under Nhà cửa › Điện máy was offered "Gợi ý: Tủ kệ?" (storage's 'tủ' sits before white-goods'
 * 'tủ lạnh'). Every title below is a real-shaped Vietnamese or English listing title; the "old:" notes say what
 * the substring/first-match rule answered, where it was wrong.
 */
const cases: [category: string, title: string, expected: string, old?: string][] = [
  // ── Nhà cửa (furniture-appliances) — the N11 report and its neighbours ──
  ['furniture-appliances', 'Tủ lạnh Toshiba 180L', 'white-goods', 'storage'],
  ['furniture-appliances', 'Tủ lạnh mini Aqua 90 lít còn mới', 'white-goods', 'storage'],
  ['furniture-appliances', 'Tủ quần áo gỗ 3 cánh', 'storage'],
  ['furniture-appliances', 'Máy giặt LG inverter 9kg', 'white-goods'],
  ['furniture-appliances', 'Máy lạnh Daikin 1HP', 'white-goods'],
  ['furniture-appliances', 'Bàn học sinh chống gù', 'tables-desks'],
  ['furniture-appliances', 'Bàn làm việc gỗ sồi', 'tables-desks'],
  ['furniture-appliances', 'Giường tầng cho bé', 'beds-mattresses'],
  ['furniture-appliances', 'Kệ sách 5 tầng', 'storage'],
  ['furniture-appliances', 'Nồi cơm điện Sharp', 'kitchenware'],
  ['furniture-appliances', 'Samsung fridge 300L', 'white-goods'],
  // 'pot' is in Kitchen AND Plants; "plants" (the plural of 'plant', 5 letters) is the longer match.
  ['furniture-appliances', 'Pot plants for the balcony', 'plants-garden', 'kitchenware'],
  // 'bed' is not a word of "Bedroom".
  ['furniture-appliances', 'Bedroom lamp', 'lighting-decor', 'beds-mattresses'],
  // ── Thanh lý (moving-sale) ──
  ['moving-sale', 'Thanh lý tủ lạnh Panasonic', 'appliances', 'furniture'],
  // ── Mẹ & Bé (baby-kids) ──
  ['baby-kids', 'Xe đẩy em bé Joie', 'strollers-seats'],
  ['baby-kids', 'Ghế ăn dặm cho bé', 'baby-gear'],
  ['baby-kids', 'Ghế ô tô cho bé Joie', 'strollers-seats'],
  ['baby-kids', 'Toys for toddlers', 'toys'],
  // ── Điện tử (electronics) — the longer, more specific phrase wins ──
  ['electronics', 'Ốp lưng iPhone 15 Pro Max', 'phone-cases', 'phones-tablets'],
  ['electronics', 'Sạc dự phòng Anker 20000mAh', 'power-banks', 'cables-chargers'],
  ['electronics', 'Camera giám sát Ezviz C6N', 'security-cameras', 'cameras'],
  ['electronics', 'Card màn hình RTX 3060', 'pc-components', 'tv-monitors'],
  ['electronics', 'Máy tính bảng Samsung Galaxy Tab S9', 'phones-tablets'],
  ['electronics', 'iPhone 13 Pro Max 256GB', 'phones-tablets'],
  ['electronics', 'Macbook Air M1 2020', 'laptops-pcs'],
  ['electronics', 'Tai nghe AirPods Pro 2', 'audio'],
  // ── Xe cộ (vehicles) ──
  ['vehicles', 'Honda Vision 2022', 'motorbike'],
  ['vehicles', 'Honda SH 150i ABS', 'motorbike'],
  ['vehicles', 'Xe đạp điện VinFast', 'ebike-scooter', 'bicycle'],
  ['vehicles', 'E-bike Pega Cap A', 'ebike-scooter', 'bicycle'],
  // 'sh' is not a word of "Shimano".
  ['vehicles', 'Shimano bike parts', 'parts-gear', 'motorbike'],
  // ── Cho thuê (rentals) ──
  ['rentals', 'Cho thuê xe máy Honda Vision theo tháng', 'motorbike-rental'],
  ['rentals', 'Thuê căn hộ 2PN Thảo Điền', 'apartment-rental'],
  // ── Việc làm (jobs) — 'it' is a word only on its own ──
  ['jobs', 'Kế toán tổng hợp - công ty IT', 'office-admin', 'it-design'],
  ['jobs', 'Marketing executive for an English centre', 'marketing-media', 'teaching'],
  ['jobs', 'Tuyển giáo viên tiếng Anh', 'teaching'],
  // ── Dịch vụ (services) ──
  ['services', 'Dọn dẹp nhà cửa theo giờ', 'cleaning'],
  ['services', 'Gia hạn visa du lịch', 'visa-legal'],
  ['services', 'Personal trainer tại nhà', 'fitness-pt'],
  // ── Thú cưng (pets) ──
  ['pets', 'Chó Poodle 3 tháng tuổi', 'dogs'],
]

describe('suggestSubcategory — real titles', () => {
  it.each(cases)('%s: "%s" → %s', (category, title, expected) => {
    expect(suggestSubcategory(category, title)).toBe(expected)
  })

  it('the cases that used to go wrong are real regressions of the old rule, not new behaviour by accident', () => {
    // A self-check on the table: every "old" answer differs from the new one.
    for (const [, , expected, old] of cases) if (old) expect(old).not.toBe(expected)
  })
})

describe('suggestSubcategory — the matching rule', () => {
  it('a keyword matches whole words only: "Taxi to the airport" is not Legal & permits ("tax")', () => {
    expect(suggestSubcategory('services', 'Taxi to the airport')).toBeUndefined()
  })

  it('a two-letter code takes no plural: "Its" is not IT', () => {
    expect(suggestSubcategory('jobs', 'Its a great team')).toBeUndefined()
  })

  it('an English keyword takes its plural ("tables", "bags")', () => {
    expect(suggestSubcategory('furniture-appliances', 'Two oak tables')).toBe('tables-desks')
    expect(suggestSubcategory('fashion-beauty', 'Leather bags')).toBe('bags')
  })

  it('NFD input and upper case read as the same words (a decomposed "ủ" is the same letter)', () => {
    expect(suggestSubcategory('furniture-appliances', 'Tủ lạnh Toshiba 180L'.normalize('NFD'))).toBe('white-goods')
    expect(suggestSubcategory('furniture-appliances', 'TỦ LẠNH TOSHIBA 180L')).toBe('white-goods')
  })

  it('marks are part of the word — an unaccented "tu lanh" is not "tủ lạnh" (folded forms collide on every short word)', () => {
    expect(suggestSubcategory('furniture-appliances', 'tu lanh toshiba')).toBeUndefined()
  })

  it('a phrase matches across any run of whitespace', () => {
    expect(suggestSubcategory('furniture-appliances', 'Tủ  lạnh\nToshiba')).toBe('white-goods')
  })

  it('a tie keeps the taxonomy order (sofa-seating before tables-desks for two 3-letter words)', () => {
    expect(suggestSubcategory('furniture-appliances', 'Ghế bàn')).toBe('sofa-seating')
  })

  it('no text, no category, no match → undefined', () => {
    expect(suggestSubcategory('furniture-appliances', '')).toBeUndefined()
    expect(suggestSubcategory('furniture-appliances', '   ')).toBeUndefined()
    expect(suggestSubcategory('no-such-category', 'Tủ lạnh')).toBeUndefined()
    expect(suggestSubcategory('furniture-appliances', 'Xyz 123')).toBeUndefined()
  })
})

describe('subcategoryMatchesText — the post wizard keeps quiet when the pick already fits', () => {
  it('the chosen subcategory\'s own keywords match the title', () => {
    expect(subcategoryMatchesText('furniture-appliances', 'white-goods', 'Tủ lạnh Toshiba 180L')).toBe(true)
    // "Tủ" is storage's own word too — a seller who filed the fridge under Tủ kệ is not second-guessed.
    expect(subcategoryMatchesText('furniture-appliances', 'storage', 'Tủ lạnh Toshiba 180L')).toBe(true)
  })

  it('a subcategory none of whose keywords is in the title does not', () => {
    expect(subcategoryMatchesText('furniture-appliances', 'sofa-seating', 'Tủ lạnh Toshiba 180L')).toBe(false)
    expect(subcategoryMatchesText('furniture-appliances', 'no-such-sub', 'Tủ lạnh')).toBe(false)
    expect(subcategoryMatchesText('furniture-appliances', 'white-goods', '')).toBe(false)
  })
})

describe('suggestSubcategory — a digit glued to a model name is a boundary (gate, 2026-10-05)', () => {
  it('finds the keyword in "iPhone13 128GB", "Honda SH150i" and "Vision2022"', () => {
    expect(suggestSubcategory('electronics', 'iPhone13 128GB xanh')).toBe('phones-tablets')
    expect(suggestSubcategory('vehicles', 'Honda SH150i 2021 chính chủ')).toBe('motorbike')
    expect(suggestSubcategory('vehicles', 'Honda Vision2022 bstp')).toBe('motorbike')
  })
  it('still keeps letters as part of the word: "Shimano" is not a Honda SH, "taxi" is not "tax"', () => {
    expect(suggestSubcategory('vehicles', 'Shimano bike parts')).not.toBe('motorbike')
  })
})
