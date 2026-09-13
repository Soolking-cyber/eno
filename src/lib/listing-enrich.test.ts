import { describe, expect, it } from 'vitest'
import { buildEnrichPrompt, decideEnrichment, parseEnrichReply, type EnrichAnswer, type EnrichInput } from './listing-enrich'

// Real item shapes from the 2026-09-13 prod sample: a Tiki book filed in electronics, a TGDD monitor.

const book: EnrichInput = {
  id: 'b1',
  titleVi: 'Sách Tâm Lý Học Thành Công Tái Bản',
  title: 'Book: Mindset: The Psychology of Success (Reprint)',
  descriptionVi: 'Tâm Lý Học Thành Công của Carol S. Dweck, NXB Thế Giới, 320 trang, khổ 14.5 x 20.5 cm. Giá 159.000đ, hotline 0901234567.',
  description: 'Mindset by Carol S. Dweck, The Gioi Publishing, 320 pages, 14.5 x 20.5 cm.',
  category: 'electronics',
  subcategory: null,
  attributes: {},
}

const goodBook: EnrichAnswer = {
  category: 'books-stationery',
  subcategory: 'self-help-business',
  confidence: 'high',
  vi: 'Cuốn sách về tư duy phát triển của Carol S. Dweck.\n\n**Thông tin sách**\n- Tác giả: Carol S. Dweck\n- Nhà xuất bản: Thế Giới\n- Số trang: 320\n- Khổ: 14.5 x 20.5 cm',
  en: 'A book on the growth mindset by Carol S. Dweck.\n\n**Book details**\n- Author: Carol S. Dweck\n- Publisher: The Gioi\n- Pages: 320\n- Size: 14.5 x 20.5 cm',
  attributes: [{ key: 'author', value: 'Carol S. Dweck' }, { key: 'bookLanguage', value: 'vietnamese' }],
}

const monitor: EnrichInput = {
  id: 'm1',
  titleVi: 'Màn hình ViewSonic VX2779-HD-PRO 27 inch',
  title: 'ViewSonic VX2779-HD-PRO 27-inch monitor',
  descriptionVi: 'Màn hình ViewSonic VX2779-HD-PRO 27 inch, tần số quét 180Hz, tấm nền IPS, nặng 5.2 kg.',
  description: 'ViewSonic VX2779-HD-PRO 27-inch monitor, 180Hz refresh rate, IPS panel, 5.2 kg.',
  category: 'electronics',
  subcategory: 'tv-monitors',
  attributes: { ram: '8gb' },
}

const goodMonitor: EnrichAnswer = {
  category: 'electronics',
  subcategory: 'tv-monitors',
  confidence: 'high',
  vi: 'Màn hình ViewSonic VX2779-HD-PRO 27 inch với tấm nền IPS.\n\n**Thông số chính**\n- Kích thước: 27 inch\n- Tần số quét: 180Hz\n- Tấm nền: IPS\n- Trọng lượng: 5.2 kg',
  en: 'A ViewSonic VX2779-HD-PRO 27-inch monitor with an IPS panel.\n\n**Key specs**\n- Size: 27 inch\n- Refresh rate: 180Hz\n- Panel: IPS\n- Weight: 5.2 kg',
  attributes: [],
}

describe('decideEnrichment — placement', () => {
  it('moves a book out of electronics at high confidence', () => {
    const d = decideEnrichment(book, goodBook)
    expect([d.category, d.subcategory]).toEqual(['books-stationery', 'self-help-business'])
  })

  it('does not move it at medium confidence', () => {
    const d = decideEnrichment(book, { ...goodBook, confidence: 'medium' })
    expect([d.category, d.subcategory]).toEqual(['electronics', null])
    expect(d.refused).toContain('placement:low-confidence-move')
  })

  it('never moves a product into a non-product category, however confident', () => {
    const d = decideEnrichment(book, { ...goodBook, category: 'services', subcategory: 'visa-legal' })
    expect(d.category).toBe('electronics')
  })

  it('never moves — or rewrites — a listing that is not in a product category', () => {
    const d = decideEnrichment({ ...book, category: 'tickets-travel' }, goodBook)
    expect(d.category).toBe('tickets-travel')
    expect(d.descriptionVi).toBeNull()
    expect(d.description).toBeNull()
  })

  it('rejects a subcategory that does not belong to the category', () => {
    const d = decideEnrichment(book, { ...goodBook, subcategory: 'phones-tablets' })
    expect(d.category).toBe('electronics')
    expect(d.refused).toContain('placement:unknown-subcategory')
  })

  it('fills a missing shelf in the same aisle at medium confidence, but does not overrule one', () => {
    const noShelf = { ...monitor, subcategory: null }
    expect(decideEnrichment(noShelf, { ...goodMonitor, confidence: 'medium' }).subcategory).toBe('tv-monitors')
    expect(decideEnrichment(monitor, { ...goodMonitor, subcategory: 'gaming', confidence: 'medium' }).subcategory).toBe('tv-monitors')
  })
})

describe('decideEnrichment — text', () => {
  it('accepts a faithful rewrite that drops the price and hotline', () => {
    const d = decideEnrichment(book, goodBook)
    expect(d.refused.filter((r) => r.startsWith('vi:') || r.startsWith('en:'))).toEqual([])
    expect(d.descriptionVi).toContain('**Thông tin sách**')
  })

  it.each([
    ['a lost measured spec', monitor, { ...goodMonitor, vi: goodMonitor.vi.replace('\n- Trọng lượng: 5.2 kg', '') }, 'vi:lost-quantity'],
    ['a changed page count', book, { ...goodBook, vi: goodBook.vi.replace('320', '350') }, 'vi:invented-quantity'],
    ['an invented quantity', book, { ...goodBook, en: goodBook.en + '\n- Weight: 450 g' }, 'en:invented-quantity'],
    ['a changed unit', monitor, { ...goodMonitor, vi: goodMonitor.vi.replace('5.2 kg', '5.2 g') }, 'vi:lost-quantity'],
    ['a price', book, { ...goodBook, vi: goodBook.vi + '\n- Giá: 159.000đ' }, 'vi:price'],
    ['a phone number', book, { ...goodBook, vi: goodBook.vi + '\nLiên hệ 0901234567' }, 'vi:contact-or-link'],
    ['an invented safety claim', monitor, { ...goodMonitor, en: goodMonitor.en + '\n- Waterproof' }, 'en:invented-claim'],
    ['an invented warranty', book, { ...goodBook, en: goodBook.en + '\n\n**Warranty**\n- Official warranty' }, 'en:invented-claim'],
    ['English in the Vietnamese slot', book, { ...goodBook, vi: goodBook.en }, 'vi:not-vietnamese'],
    ['Vietnamese in the English slot', book, { ...goodBook, en: goodBook.vi }, 'en:not-english'],
  ] as [string, EnrichInput, EnrichAnswer, string][])('refuses %s and keeps BOTH texts', (_name, input, answer, reason) => {
    const d = decideEnrichment(input, answer)
    expect(d.refused).toContain(reason)
    expect(d.descriptionVi).toBeNull()
    expect(d.description).toBeNull()
  })

  it('lets a rewrite drop a promotion and a repeated model list', () => {
    const cases: EnrichInput = { ...monitor, descriptionVi: 'Ốp lưng cho iPhone 11 12 13 14 11 Pro 12 Pro. Mua lần 2 giảm 50%.', description: 'Case for iPhone 11 12 13 14 11 Pro 12 Pro.', titleVi: 'Ốp lưng iPhone 11 12 13 14', title: 'iPhone 11 12 13 14 case', subcategory: 'phone-cases', attributes: {} }
    const d = decideEnrichment(cases, { ...goodMonitor, subcategory: 'phone-cases', vi: 'Ốp lưng dành cho iPhone 11, 12, 13 và 14.\n\n**Thông số chính**\n- Tương thích: iPhone 11, 12, 13, 14 (cả bản Pro)', en: 'A case for iPhone 11, 12, 13 and 14.\n\n**Key specs**\n- Fits: iPhone 11, 12, 13, 14 (Pro models too)' })
    expect(d.refused).toEqual([])
    expect(d.descriptionVi).not.toBeNull()
  })

  it('lets a rewrite reformat sizes and spec pairs and write English compounds', () => {
    const bed: EnrichInput = { ...monitor, titleVi: 'Giường Ngủ Gỗ Cao Su 1M6x2M Cũ', title: 'Rubberwood bed 1M6x2M used', descriptionVi: 'Giường ngủ gỗ cao su 1M6x2M, bảo hành 12 tháng.', description: 'Rubberwood bed 1M6x2M, 12-month warranty.', category: 'furniture-appliances', subcategory: 'beds-mattresses', attributes: {} }
    const d = decideEnrichment(bed, { ...goodMonitor, category: 'furniture-appliances', subcategory: 'beds-mattresses', vi: 'Giường ngủ bằng gỗ cao su đã qua sử dụng.\n\n**Thông số chính**\n- Kích thước: 1m6 x 2m\n\n**Bảo hành**\n- 12 tháng', en: 'A used rubberwood bed.\n\n**Key specs**\n- Size: 1m6 x 2m\n\n**Warranty**\n- 12-month warranty' })
    expect(d.refused).toEqual([])
    const phone: EnrichInput = { ...monitor, titleVi: 'OPPO A6 Pro 4G 8GB-128GB', title: 'OPPO A6 Pro 4G 8GB-128GB', descriptionVi: 'OPPO A6 Pro 4G 8GB-128GB', description: 'OPPO A6 Pro 4G 8GB-128GB', subcategory: 'phones-tablets', attributes: {} }
    expect(decideEnrichment(phone, { ...goodMonitor, subcategory: 'phones-tablets', vi: 'Điện thoại OPPO A6 Pro bản 4G.\n\n**Thông số chính**\n- RAM: 8GB\n- Bộ nhớ: 128GB', en: 'The OPPO A6 Pro 4G phone.\n\n**Key specs**\n- RAM: 8GB\n- Storage: 128GB' }).refused).toEqual([])
  })

  it('refuses an invented single-digit count', () => {
    const d = decideEnrichment(monitor, { ...goodMonitor, en: goodMonitor.en + '\n- Ports: 2 HDMI' })
    expect(d.refused).toContain('en:invented-quantity')
  })

  it('a shop that says NO warranty does not license a warranty promise', () => {
    const noWarranty: EnrichInput = { ...monitor, descriptionVi: monitor.descriptionVi + ' Sản phẩm không bảo hành.', description: monitor.description + ' No warranty.' }
    const d = decideEnrichment(noWarranty, { ...goodMonitor, vi: goodMonitor.vi + '\n\n**Bảo hành**\n- Có bảo hành', en: goodMonitor.en + '\n\n**Warranty**\n- Covered by warranty' })
    expect(d.refused).toContain('vi:invented-claim')
    // …while repeating the shop's own "no warranty" is fine.
    expect(decideEnrichment(noWarranty, { ...goodMonitor, vi: goodMonitor.vi + '\n- Không bảo hành', en: goodMonitor.en + '\n- No warranty' }).refused).toEqual([])
  })

  it('an English-only import still needs Vietnamese in the Vietnamese slot, and keeps its English specs', () => {
    const englishOnly: EnrichInput = { ...monitor, titleVi: null, descriptionVi: null }
    expect(decideEnrichment(englishOnly, { ...goodMonitor, vi: goodMonitor.en }).refused).toContain('vi:not-vietnamese')
    expect(decideEnrichment(englishOnly, { ...goodMonitor, en: goodMonitor.en.replace('\n- Weight: 5.2 kg', '') }).refused).toContain('en:lost-quantity')
  })

  it('refuses a brand or a panel type the item never names', () => {
    expect(decideEnrichment(monitor, { ...goodMonitor, en: goodMonitor.en.replace('IPS', 'OLED') }).refused).toContain('en:invented-term')
    expect(decideEnrichment(monitor, { ...goodMonitor, vi: goodMonitor.vi + '\n- Tương thích: Samsung Galaxy' }).refused).toContain('vi:invented-term')
  })

  it('a heading above the shop\'s own denial is not a promise; "warranty not included" does not license one', () => {
    const noWarranty: EnrichInput = { ...monitor, descriptionVi: monitor.descriptionVi + ' Không hỗ trợ bảo hành.', description: monitor.description + ' Warranty not included.' }
    expect(decideEnrichment(noWarranty, { ...goodMonitor, vi: goodMonitor.vi + '\n\n**Bảo hành**\n- Không hỗ trợ bảo hành', en: goodMonitor.en + '\n\n**Warranty**\n- Not included' }).refused).toEqual([])
    expect(decideEnrichment(noWarranty, { ...goodMonitor, en: goodMonitor.en + '\n- Covered by warranty' }).refused).toContain('en:invented-claim')
  })

  it('an answer that invented a fact does not get to re-file or tag the listing', () => {
    const d = decideEnrichment(book, { ...goodBook, en: goodBook.en + '\n- Weight: 450 g' })
    expect(d.category).toBe('electronics')
    expect(d.attributes).toEqual({})
    expect(d.refused).toContain('placement:untrusted-answer')
  })

  it('allows a Vietnamese author name inside English copy', () => {
    const d = decideEnrichment(book, { ...goodBook, en: goodBook.en.replace('The Gioi', 'Thế Giới') })
    expect(d.refused.filter((r) => r.startsWith('en:'))).toEqual([])
  })

  it('an unrelated "không" in the rewrite does not hide an invented claim', () => {
    expect(decideEnrichment(monitor, { ...goodMonitor, vi: goodMonitor.vi + '\nKhông cần lo, hàng chính hãng.' }).refused).toContain('vi:invented-claim')
  })

  it('iPhone is not iPad, water-resistant is not waterproof', () => {
    const caseFor: EnrichInput = { ...monitor, titleVi: 'Ốp lưng iPhone 15 kháng nước', title: 'iPhone 15 water-resistant case', descriptionVi: 'Ốp lưng iPhone 15 kháng nước.', description: 'Water-resistant iPhone 15 case.', subcategory: 'phone-cases', attributes: {} }
    const base = { ...goodMonitor, subcategory: 'phone-cases', vi: 'Ốp lưng kháng nước cho iPhone 15.', en: 'A water-resistant case for iPhone 15.' }
    expect(decideEnrichment(caseFor, base).refused).toEqual([])
    expect(decideEnrichment(caseFor, { ...base, en: 'A water-resistant case for iPad 15.' }).refused).toContain('en:invented-term')
    expect(decideEnrichment(caseFor, { ...base, en: 'A waterproof case for iPhone 15.' }).refused).toContain('en:invented-claim')
  })

  it('a snack weighing 128g does not become 128GB of storage', () => {
    const snack: EnrichInput = { ...monitor, titleVi: 'Hạt điều rang muối 128g', title: 'Salted cashews 128g', descriptionVi: 'Hạt điều rang muối, gói 128g.', description: 'Salted cashews, 128g pack.', category: 'food-drink', subcategory: null, attributes: {} }
    const ok = { ...goodMonitor, category: 'food-drink', subcategory: null, vi: 'Hạt điều rang muối đóng gói.\n\n**Thông số chính**\n- Khối lượng: 128g', en: 'Salted cashews in a pack.\n\n**Key specs**\n- Weight: 128g' }
    expect(decideEnrichment(snack, ok).refused).toEqual([])
    expect(decideEnrichment(snack, { ...ok, en: 'Salted cashews in a pack.\n\n**Key specs**\n- Storage: 128GB' }).refused).toContain('en:invented-quantity')
  })

  it('an invented warranty DENIAL is refused too', () => {
    expect(decideEnrichment(monitor, { ...goodMonitor, vi: goodMonitor.vi + '\n- Không bảo hành' }).refused).toContain('vi:invented-claim')
  })

  it('a single-digit measured spec must survive', () => {
    const drive: EnrichInput = { ...monitor, titleVi: 'Ổ cứng di động Toshiba 2TB', title: 'Toshiba portable drive 2TB', descriptionVi: 'Ổ cứng di động Toshiba dung lượng 2TB.', description: 'Toshiba portable drive, 2TB capacity.', subcategory: 'storage', attributes: {} }
    const d = decideEnrichment(drive, { ...goodMonitor, subcategory: 'storage', vi: 'Ổ cứng di động của Toshiba.', en: 'A portable drive from Toshiba.' })
    expect(d.refused).toContain('vi:lost-quantity')
  })

  it('refuses visa, itinerary or PayPal copy outright, even when the item mentions a Visa card', () => {
    const cardShop: EnrichInput = { ...monitor, descriptionVi: monitor.descriptionVi + ' Thanh toán bằng thẻ Visa, không nhận PayPal.', description: monitor.description + ' Pay by Visa card, PayPal not accepted.' }
    expect(decideEnrichment(cardShop, { ...goodMonitor, vi: goodMonitor.vi + '\nHỗ trợ xin thị thực nhanh.' }).refused).toContain('vi:forbidden-term')
    expect(decideEnrichment(cardShop, { ...goodMonitor, en: goodMonitor.en + '\nPay with PayPal.' }).refused).toContain('en:forbidden-term')
  })

  it('a stated warranty may not come back denied, and an invented warranty heading is refused', () => {
    const warranted: EnrichInput = { ...monitor, descriptionVi: monitor.descriptionVi + ' Bảo hành 12 tháng.', description: monitor.description + ' 12-month warranty.' }
    expect(decideEnrichment(warranted, { ...goodMonitor, vi: goodMonitor.vi + '\n- Không bảo hành' }).refused).toContain('vi:invented-claim')
    expect(decideEnrichment(monitor, { ...goodMonitor, en: goodMonitor.en + '\n\n**Warranty**\n- Included' }).refused).toContain('en:invented-claim')
  })

  it('a hijacked answer (a hotline added) does not re-file, and a disputed move keeps the text too', () => {
    const hijacked = decideEnrichment(book, { ...goodBook, vi: goodBook.vi + '\nHotline 0901234567' })
    expect(hijacked.category).toBe('electronics')
    const disputed = decideEnrichment(book, { ...goodBook, confidence: 'medium' })
    expect([disputed.category, disputed.descriptionVi]).toEqual(['electronics', null])
  })

  it('a denied warranty cannot come back as "Có" under a heading', () => {
    const denied: EnrichInput = { ...monitor, descriptionVi: monitor.descriptionVi + ' Không bảo hành.', description: monitor.description + ' No warranty.' }
    expect(decideEnrichment(denied, { ...goodMonitor, vi: goodMonitor.vi + '\n\n**Bảo hành**\n- Có' }).refused).toContain('vi:invented-claim')
  })

  it('decomposed Vietnamese does not slip visa copy past the licensing terms', () => {
    const decomposed = 'Hỗ trợ xin thị thực.'.normalize('NFD')
    expect(decideEnrichment(monitor, { ...goodMonitor, vi: goodMonitor.vi + '\n' + decomposed }).refused).toContain('vi:forbidden-term')
  })

  it('an answer that loses a spec AND invents a claim is still untrusted to re-file', () => {
    const d = decideEnrichment(book, { ...goodBook, en: goodBook.en.replace('- Pages: 320\n', '') + '\n- Waterproof' })
    expect(d.category).toBe('electronics')
    expect(d.refused).toContain('placement:untrusted-answer')
  })

  it('a confident move to a category that does not exist keeps the old text too', () => {
    const d = decideEnrichment(book, { ...goodBook, category: 'jobs', subcategory: null })
    expect([d.category, d.descriptionVi]).toEqual(['electronics', null])
  })

  it('spacing or a hyphen does not get licensing terms past, in text or in a generated attribute', () => {
    expect(decideEnrichment(monitor, { ...goodMonitor, en: goodMonitor.en + '\nPay with Pay Pal.' }).refused).toContain('en:forbidden-term')
    const paypalShop: EnrichInput = { ...book, descriptionVi: book.descriptionVi + ' Không nhận PayPal.' }
    expect(decideEnrichment(paypalShop, { ...goodBook, attributes: [{ key: 'publisher', value: 'PayPal' }] }).attributes.publisher).toBeUndefined()
  })

  it('a description that promises and denies a warranty is refused', () => {
    const warranted: EnrichInput = { ...monitor, descriptionVi: monitor.descriptionVi + ' Bảo hành 12 tháng.', description: monitor.description + ' 12-month warranty.' }
    const d = decideEnrichment(warranted, { ...goodMonitor, vi: goodMonitor.vi + '\n\n**Bảo hành**\n- 12 tháng\n- Không bảo hành' })
    expect(d.descriptionVi).toBeNull()
  })

  it('refuses hyphenated or plural licensing terms, invented origin and invented brands', () => {
    expect(decideEnrichment(monitor, { ...goodMonitor, en: goodMonitor.en + '\nWe arrange travel itineraries.' }).refused).toContain('en:forbidden-term')
    expect(decideEnrichment(monitor, { ...goodMonitor, vi: goodMonitor.vi + '\nHỗ trợ làm vi-sa.' }).refused).toContain('vi:forbidden-term')
    expect(decideEnrichment(monitor, { ...goodMonitor, vi: goodMonitor.vi + '\nHàng xách tay Nhật.' }).refused).toContain('vi:invented-claim')
    expect(decideEnrichment(monitor, { ...goodMonitor, en: goodMonitor.en + '\nDesigned with Nike.' }).refused).toContain('en:invented-term')
  })

  it('does not mistake a Samsung TV or a striped shirt for licensing copy', () => {
    const tv: EnrichInput = { ...monitor, titleVi: 'Tivi Samsung 55 inch', title: 'Samsung 55-inch TV', descriptionVi: 'Tivi Samsung 55 inch áo sọc.', description: 'Samsung 55-inch TV, striped stand.', subcategory: 'tv-monitors', attributes: {} }
    expect(decideEnrichment(tv, { ...goodMonitor, vi: 'Tivi Samsung màn hình 55 inch.', en: 'A Samsung TV with a 55-inch screen and a striped stand.' }).refused.filter((r) => r.includes('forbidden'))).toEqual([])
  })

  it('"No manufacturer\'s warranty" does not license a warranty promise', () => {
    const src: EnrichInput = { ...monitor, description: monitor.description + " No manufacturer's warranty.", descriptionVi: monitor.descriptionVi + ' Không có bảo hành của nhà sản xuất.' }
    expect(decideEnrichment(src, { ...goodMonitor, en: goodMonitor.en + '\n- Covered by warranty' }).refused).toContain('en:invented-claim')
  })

  it('a spec repeated in the summary and the bullets is not an invented quantity', () => {
    expect(decideEnrichment(monitor, { ...goodMonitor, en: 'A 27-inch ViewSonic VX2779-HD-PRO monitor with an IPS panel, 5.2 kg.\n\n**Key specs**\n- Size: 27 inch\n- Refresh rate: 180Hz\n- Weight: 5.2 kg' }).refused).toEqual([])
  })

  it('refuses a changed model code', () => {
    const d = decideEnrichment(monitor, { ...goodMonitor, vi: goodMonitor.vi.replaceAll('VX2779-HD-PRO', 'VX2779-HD'), en: goodMonitor.en.replaceAll('VX2779-HD-PRO', 'VX2779-HD') })
    expect(d.refused.some((r) => r.endsWith('lost-code'))).toBe(true)
  })
})

describe('decideEnrichment — attributes', () => {
  it('keeps an author named in the item and an exact option value', () => {
    expect(decideEnrichment(book, goodBook).attributes).toEqual({ author: 'Carol S. Dweck', bookLanguage: 'vietnamese' })
  })

  it('refuses an author the item never names, and a value that is not an option', () => {
    const d = decideEnrichment(book, { ...goodBook, attributes: [{ key: 'author', value: 'Malcolm Gladwell' }, { key: 'bookLanguage', value: 'Tiếng Việt' }] })
    expect(d.attributes).toEqual({})
    expect(d.refused).toEqual(expect.arrayContaining(['attr:author:not-in-item', 'attr:bookLanguage:bad-value']))
  })

  it('does not read "Việt Nam" as a men\'s product', () => {
    const shirt: EnrichInput = { ...monitor, titleVi: 'Áo thun cotton sản xuất tại Việt Nam', title: 'Cotton T-shirt made in Vietnam', descriptionVi: 'Áo thun cotton sản xuất tại Việt Nam.', description: 'Cotton T-shirt made in Vietnam.', category: 'fashion-beauty', subcategory: 'mens', attributes: {} }
    const d = decideEnrichment(shirt, { ...goodMonitor, category: 'fashion-beauty', subcategory: 'mens', vi: 'Áo thun cotton sản xuất tại Việt Nam.', en: 'A cotton T-shirt made in Vietnam.', attributes: [{ key: 'gender', value: 'men' }] })
    expect(d.attributes.gender).toBeUndefined()
  })

  it('needs evidence in the item for a filter value, and a confident answer', () => {
    // A Vietnamese-titled book is not "english" just because english is a legal option.
    expect(decideEnrichment(book, { ...goodBook, attributes: [{ key: 'bookLanguage', value: 'english' }] }).refused).toContain('attr:bookLanguage:no-evidence')
    expect(decideEnrichment({ ...book, subcategory: 'self-help-business', category: 'books-stationery' }, { ...goodBook, confidence: 'medium' }).attributes.bookLanguage).toBeUndefined()
  })

  it('refuses a facet the final shelf does not offer', () => {
    const d = decideEnrichment(book, { ...goodBook, subcategory: 'stationery-office', attributes: [{ key: 'bookLanguage', value: 'vietnamese' }] })
    expect(d.attributes).toEqual({})
  })

  it('drops the listing\'s own keys the new shelf does not offer when it is re-filed', () => {
    const d = decideEnrichment({ ...book, attributes: { ram: '8gb' } }, goodBook)
    expect(d.attributes.ram).toBeUndefined()
  })

  it('keeps the listing\'s own keys when the placement does not change', () => {
    expect(decideEnrichment(monitor, goodMonitor).attributes).toEqual({ ram: '8gb' })
  })
})

describe('parseEnrichReply', () => {
  const reply = (items: unknown[]) => 'Here you go:\n```json\n' + JSON.stringify({ items }) + '\n```'
  const item = (i: number) => ({ i, category: 'electronics', subcategory: null, confidence: 'high', vi: 'x', en: 'y', attributes: [] })

  it('reads a fenced reply in index order', () => {
    const r = parseEnrichReply(reply([item(2), item(1)]), 2)
    expect(r.ok).toBe(true)
  })

  it.each([
    ['a missing item', [item(1)], 'missing-items'],
    ['a duplicate index', [item(1), item(1)], 'bad-index'],
    ['an out-of-range index', [item(1), item(3)], 'bad-index'],
  ])('fails the batch on %s', (_n, items, reason) => {
    expect(parseEnrichReply(reply(items), 2)).toEqual({ ok: false, reason })
  })

  it('fails the batch when an entry is missing its descriptions', () => {
    const { vi: _vi, ...noVi } = item(2)
    expect(parseEnrichReply(reply([item(1), noVi]), 2)).toEqual({ ok: false, reason: 'bad-item' })
  })

  it('fails the batch, not the run, on a null item', () => {
    expect(parseEnrichReply(reply([item(1), null]), 2)).toEqual({ ok: false, reason: 'bad-item' })
  })

  it('fails on no JSON at all', () => {
    expect(parseEnrichReply('I cannot help with that.', 1)).toEqual({ ok: false, reason: 'no-json' })
  })
})

describe('buildEnrichPrompt', () => {
  it('fences the rows as data and lists only product categories', () => {
    const p = buildEnrichPrompt([book])
    expect(p).toContain('ITEMS BEGIN')
    expect(p).toContain('books-stationery')
    expect(p).not.toMatch(/^- services /m)
    expect(p).not.toMatch(/^- jobs /m)
  })
})
