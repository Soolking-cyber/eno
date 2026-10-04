import { describe, expect, it } from 'vitest'
import { cardTitle, cardCity, jobCardMeta, VEHICLE_IMPORT_SELLER_IDS, isTemplateTitleSeller } from './card-title'
import { VEHICLE_SELLERS } from './vehicle-rental-listing'
import { TAXONOMY } from './taxonomy'

const vi = (en: string, v: string) => v
const en = (e: string) => e

const rental = (title: string, sellerId: string, lang = 'vi') => cardTitle({ title, lang, sellerId, categorySlug: 'rentals', listingType: 'rent' })
// A member's SALE listing in HCMC, filed as used — the info line reads "Đã dùng · TP.HCM".
const goods = (title: string, extra: Partial<Parameters<typeof cardTitle>[0]> = {}) =>
  cardTitle({ title, lang: 'vi', sellerId: 'cmtseuzhd00019zq47d60jlh5', categorySlug: 'electronics', listingType: 'sell', condition: 'used', location: 'Hồ Chí Minh', ...extra })

describe('cardTitle — imported rental templates (vi)', () => {
  it.each([
    // Real stored titles, one per importer template (production, 2026-10-04).
    ['bds-vn-import-seller-0001', 'Cho thuê Căn hộ / Chung cư 2PN 76m² — P. An Khánh mới, Quận 2', 'Căn hộ 2PN 76m² — P. An Khánh mới, Quận 2'],
    ['bds-vn-import-seller-0001', 'Cho thuê Nhà phố / Biệt thự 127.5m² — P. Bình Thạnh mới, Quận Bình Thạnh', 'Nhà phố 127.5m² — P. Bình Thạnh mới, Quận Bình Thạnh'],
    ['nhatot-import-seller-0001', 'Cho thuê Nhà ở 1PN 30m² — P. Tân Mỹ mới, Quận 7', 'Nhà ở 1PN 30m² — P. Tân Mỹ mới, Quận 7'],
    ['muaban-net-import-seller-0001', 'Cho thuê Nhà trọ, phòng trọ 20m² — Phường Tân Chánh Hiệp, Quận 12', 'Nhà trọ, phòng trọ 20m² — Phường Tân Chánh Hiệp, Quận 12'],
    ['cmub0wead0000zrq418bqq27m', 'Cho thuê Bất động sản khác 193m² — An Khánh, Quận 2', 'Bất động sản khác 193m² — An Khánh, Quận 2'],
    ['honeycomb-import-seller-0001', 'Cho thuê căn hộ 3PN — Masteri An Phu, P. Thảo Điền, Quận 2', 'Căn hộ 3PN — Masteri An Phu, P. Thảo Điền, Quận 2'],
    ['vehicle-import-seller-mioto', 'Cho thuê xe tự lái VinFast VF5 2024 · 4 chỗ · số tự động — Quận 7', 'VinFast VF5 2024 · 4 chỗ · số tự động — Quận 7'],
    ['vehicle-import-seller-rentabikevn', 'Cho thuê xe máy Honda Lead · xe ga — Rentabike Vietnam', 'Honda Lead · xe ga — Rentabike Vietnam'],
  ])('%s: %s', (sellerId, title, want) => {
    expect(rental(title, sellerId)).toBe(want)
  })

  it('handles a decomposed (NFD) stored title the same way', () => {
    expect(rental('Cho thuê Căn hộ / Chung cư 2PN 35m² — Quận 7'.normalize('NFD'), 'nhatot-import-seller-0001')).toBe('Căn hộ 2PN 35m² — Quận 7')
  })

  it('never touches a MEMBER\'s own rental title', () => {
    expect(rental('Cho thuê xe máy giá rẻ', 'cmabc123member000000000000')).toBe('Cho thuê xe máy giá rẻ')
    expect(rental('Cho thuê Căn hộ / Chung cư 2PN Quận 7', 'cmabc123member000000000000')).toBe('Cho thuê Căn hộ / Chung cư 2PN Quận 7')
  })

  it('leaves English and other languages alone', () => {
    const t = '2 bed · 2 bath · 76 m² for rent — An Khánh Ward (new), District 2'
    expect(rental(t, 'bds-vn-import-seller-0001', 'en')).toBe(t)
    expect(rental('Cho thuê Căn hộ / Chung cư 2PN 76m²', 'bds-vn-import-seller-0001', 'en')).toBe('Cho thuê Căn hộ / Chung cư 2PN 76m²')
  })

  it('keeps the original when the shortening would leave fewer than two words', () => {
    expect(rental('Cho thuê xe máy Vision', 'vehicle-import-seller-tuanmotorbike')).toBe('Cho thuê xe máy Vision')
    expect(rental('Cho thuê nhà', 'honeycomb-import-seller-0001')).toBe('Cho thuê nhà')
  })

  it('only applies the bracket rule outside rentals', () => {
    expect(rental('[HOT] Cho thuê căn hộ Quận 7', 'bds-vn-import-seller-0001')).toBe('[HOT] Cho thuê căn hộ Quận 7')
  })
})

describe('cardTitle — goods bracket tags: only what the info line already says', () => {
  it('drops a condition tag on a used listing, and a city tag on a listing in that city', () => {
    expect(goods('[Used] Dell XPS 9310 (Core i7-1165G7, 16GB, 512GB)')).toBe('Dell XPS 9310 (Core i7-1165G7, 16GB, 512GB)')
    expect(goods('[HCM]  iPhone 13 Pro 128GB')).toBe('iPhone 13 Pro 128GB')
    expect(goods('[TP.HCM] Tủ lạnh Panasonic 322L')).toBe('Tủ lạnh Panasonic 322L')
    expect(goods('[Sài Gòn] Sofa da thật')).toBe('Sofa da thật')
    expect(goods('[2nd] MacBook Air M1')).toBe('MacBook Air M1')
    expect(goods('[Cũ] Máy giặt LG 9kg')).toBe('Máy giặt LG 9kg')
    expect(goods('[Đã qua sử dụng] Ghế công thái học')).toBe('Ghế công thái học')
    expect(goods('[HN] Bàn làm việc gỗ', { location: 'Hà Nội' })).toBe('Bàn làm việc gỗ')
    // Several leading repeats go together; the first non-repeat stops it.
    expect(goods('[Used] [HCM] Dell XPS 13')).toBe('Dell XPS 13')
    expect(goods('[Used] [Cần mua] Dell XPS 13')).toBe('[Cần mua] Dell XPS 13')
  })

  it('keeps "[Like New]" — a quality claim finer than the info line\'s plain "used"', () => {
    expect(goods('[Like New] Dell XPS 13')).toBe('[Like New] Dell XPS 13')
    expect(goods('[LikeNew] Dell XPS 13')).toBe('[LikeNew] Dell XPS 13')
    expect(goods('[Like-New] Dell XPS 13')).toBe('[Like-New] Dell XPS 13')
    expect(goods('[HCM] [Like New] Dell XPS 13')).toBe('[Like New] Dell XPS 13')
  })

  it('keeps a condition tag the info line does not say, and a city tag for another city', () => {
    expect(goods('[Like New] Dell XPS 13', { condition: null })).toBe('[Like New] Dell XPS 13')
    expect(goods('[Like New] Dell XPS 13', { condition: 'new' })).toBe('[Like New] Dell XPS 13')
    expect(goods('[HCM] iPhone 13 Pro 128GB', { location: 'Hà Nội' })).toBe('[HCM] iPhone 13 Pro 128GB')
    expect(goods('[HN] Bàn làm việc gỗ')).toBe('[HN] Bàn làm việc gỗ')
    expect(goods('[HCM] iPhone 13 Pro 128GB', { location: 'Bình Thạnh' })).toBe('[HCM] iPhone 13 Pro 128GB')
  })

  it.each([
    ['[Cần mua] Laptop Dell cũ dưới 10 triệu', 'the only "wanted" marker'],
    ['[Cho thuê] Máy chiếu Sony theo ngày', 'not a sale'],
    ['[Hỏng màn] iPhone 12 Pro Max 256GB', 'a broken screen the info line would call Used'],
    ['[Xác] Samsung Galaxy S21 Ultra', 'a parts-only phone'],
    ['[Rep 1:1] Đồng hồ Rolex Submariner', 'a replica'],
    ['[Order] Giày Nike Air Force 1', 'not in stock'],
    ['[Trao đổi] PS5 lấy Nintendo Switch', 'a swap'],
    ['[Brand New] Dell XPS 14 9440 2024', 'a condition claim against the stored one'],
    ['[New 100%] Dell XPS 14 9440 2024', 'a condition claim against the stored one'],
    ['[New Outlet] Lenovo Legion R7000P 2025', 'a condition claim against the stored one'],
    ['[Mới 99%] Máy ảnh Sony A7', 'a condition claim against the stored one'],
  ])('keeps %s (%s)', (title) => {
    expect(goods(title)).toBe(title)
  })

  it('only on a SALE listing — never a wanted post, a service, a job, or a payload with no type', () => {
    expect(goods('[Like New] Dell XPS 13', { listingType: 'wanted' })).toBe('[Like New] Dell XPS 13')
    expect(goods('[HCM] Sửa máy lạnh tại nhà', { listingType: 'service', categorySlug: 'services' })).toBe('[HCM] Sửa máy lạnh tại nhà')
    expect(goods('[Like New] Dell XPS 13', { listingType: undefined })).toBe('[Like New] Dell XPS 13')
    expect(cardTitle({ title: '[HN] English teacher, full-time', lang: 'en', sellerId: 'x', categorySlug: 'jobs', listingType: 'job', location: 'Hà Nội' })).toBe('[HN] English teacher, full-time')
  })

  it('exempts jobs and teachers by CATEGORY too — an older stored card carries no listingType', () => {
    expect(goods('[HCM] English teacher, full-time', { categorySlug: 'jobs', listingType: 'sell' })).toBe('[HCM] English teacher, full-time')
    expect(goods('[HCM] IELTS tutor, 8.0', { categorySlug: 'teachers', listingType: 'sell' })).toBe('[HCM] IELTS tutor, 8.0')
  })

  it('ignores a long bracket and a bracket that is not leading', () => {
    expect(goods('[This bracket is far too long to be a tag] Sofa')).toBe('[This bracket is far too long to be a tag] Sofa')
    expect(goods('Sofa [HCM] da thật')).toBe('Sofa [HCM] da thật')
  })

  it('keeps the original when one word would remain', () => {
    expect(goods('[Like New] Sofa')).toBe('[Like New] Sofa')
  })
})

describe('template sellers', () => {
  it('pins the vehicle ids to VEHICLE_SELLERS', () => {
    expect([...VEHICLE_IMPORT_SELLER_IDS].sort()).toEqual(Object.values(VEHICLE_SELLERS).map((s) => s.id).sort())
  })
  it('covers IMPORT_SELLERS and the vehicle shops, nobody else', () => {
    expect(isTemplateTitleSeller('bds-vn-import-seller-0001')).toBe(true)
    expect(isTemplateTitleSeller('vehicle-import-seller-mioto')).toBe(true)
    expect(isTemplateTitleSeller('vehicle-import-seller-someone-new')).toBe(false)
  })
})

describe('jobCardMeta', () => {
  it('reads the jobs jobtype facet labels exactly', () => {
    const facet = TAXONOMY.find((c) => c.slug === 'jobs')!.facets!.find((f) => f.key === 'jobtype')!
    for (const o of facet.options) {
      expect(jobCardMeta(o.value, null, 'en', en)).toBe(o.label)
      expect(jobCardMeta(o.value, null, 'vi', vi)).toBe(o.labelVi)
    }
  })

  it('joins type and city, in the reader\'s language', () => {
    expect(jobCardMeta('fulltime', 'Hà Nội', 'vi', vi)).toBe('Toàn thời gian · Hà Nội')
    expect(jobCardMeta('fulltime', 'Hà Nội', 'en', en)).toBe('Full-time · Hanoi')
    expect(jobCardMeta('parttime', 'Đà Nẵng', 'en', en)).toBe('Part-time · Da Nang')
    expect(jobCardMeta('temporary', 'Hồ Chí Minh', 'en', en)).toBe('Temporary · HCM')
    expect(jobCardMeta('temporary', 'Hồ Chí Minh', 'vi', vi)).toBe('Thời vụ · TP.HCM')
  })

  it('returns null without a known type, so the caller keeps today\'s label', () => {
    expect(jobCardMeta(null, 'Hà Nội', 'vi', vi)).toBeNull()
    expect(jobCardMeta('weekend', 'Hà Nội', 'vi', vi)).toBeNull()
  })

  it('omits an empty city and passes an unknown one through', () => {
    expect(jobCardMeta('fulltime', '', 'en', en)).toBe('Full-time')
    expect(cardCity('Atlantis', 'en', en)).toBe('Atlantis')
  })

  it('finds a province whatever letter carries the tone mark, and prints a new unit unaccented in English', () => {
    // The job importer's vn-units spellings (job-listing.ts PLACES) against the explorer list's.
    expect(cardCity('Khánh Hoà', 'en', en)).toBe('Khanh Hoa')
    expect(cardCity('Thanh Hoá', 'en', en)).toBe('Thanh Hoa')
    expect(cardCity('Huế', 'en', en)).toBe('Hue')
    expect(cardCity('Đắk Lắk'.normalize('NFD'), 'en', en)).toBe('Dak Lak')
    // A Vietnamese reader keeps the stored name, composed.
    expect(cardCity('Khánh Hoà'.normalize('NFD'), 'vi', vi)).toBe('Khánh Hoà')
  })
})
