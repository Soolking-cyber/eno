import { describe, expect, it } from 'vitest'
import { cardTitle, cardCity, cardJobType, rowTitle, jobCardMeta, jobTypeLabel, VEHICLE_IMPORT_SELLER_IDS, isTemplateTitleSeller } from './card-title'
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
    // A job is not a goods listing, but since batch 87 its grammar drops a city tag the info line prints (titleGrammar).
    expect(cardTitle({ title: '[HN] English teacher, full-time', lang: 'en', sellerId: 'x', categorySlug: 'jobs', listingType: 'job', location: 'Hà Nội' })).toBe('English teacher, full-time')
  })

  it('exempts jobs and teachers by CATEGORY too — an older stored card carries no listingType', () => {
    // A jobs-category card drops a city tag its info line prints (batch 87, titleGrammar) — never by the goods rule.
    expect(goods('[HCM] English teacher, full-time', { categorySlug: 'jobs', listingType: 'sell' })).toBe('English teacher, full-time')
    expect(goods('[Hà Nội] English teacher, full-time', { categorySlug: 'jobs', listingType: 'sell' })).toBe('[Hà Nội] English teacher, full-time')
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

describe('jobTypeLabel', () => {
  it('is the jobs jobtype facet label in the reader\'s language, or null', () => {
    const facet = TAXONOMY.find((c) => c.slug === 'jobs')!.facets!.find((f) => f.key === 'jobtype')!
    for (const o of facet.options) {
      expect(jobTypeLabel(o.value, en)).toBe(o.label)
      expect(jobTypeLabel(o.value, vi)).toBe(o.labelVi)
    }
    expect(jobTypeLabel(null, en)).toBeNull()
    expect(jobTypeLabel(undefined, en)).toBeNull()
    expect(jobTypeLabel('weekend', vi)).toBeNull()
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

describe('GoPlus\'s location tail (the info line prints the area)', () => {
  const GOPLUS = '1f82663d-0bf3-4da0-9adf-91b1ae6a82a8'
  const run = (title: string, sellerId: string, lang = 'en', location: string | null = 'Quận 12 (Phường An Phú Đông)') => cardTitle({ title, lang, sellerId, categorySlug: 'rentals', location })
  it('comes off, in both languages', () => {
    expect(run('Duplex 20 m² · An Phu Dong Ward, District 12', GOPLUS)).toBe('Duplex 20 m²')
    expect(run('Căn hộ 1 phòng ngủ 20 m² · Phường Đức Nhuận, Quận Phú Nhuận', GOPLUS, 'vi')).toBe('Căn hộ 1PN 20 m²')
  })
  // 2026-11-10: "2-bedroom apartment 45 m²" is 25 characters on a line that holds about 22, so the one template naming its rooms lost its size.
  it('writes the bedroom count short, so the size stays on the card\'s one line', () => {
    expect(run('1-bedroom apartment 20 m² · Duc Nhuan Ward, Phu Nhuan District', GOPLUS)).toBe('1-bed apartment 20 m²')
    expect(run('3-bedroom apartment 80 m² · Hoa Hung Ward, District 10', GOPLUS)).toBe('3-bed apartment 80 m²')
    expect(run('Căn hộ 2 phòng ngủ 45 m² · Phường Hòa Hưng, Quận 10', GOPLUS, 'vi')).toBe('Căn hộ 2PN 45 m²')
    // With no size, and with the tail kept (the info line would print only the city): the count is still short.
    expect(run('2-bedroom apartment · Tan Hung Ward, District 7', GOPLUS)).toBe('2-bed apartment')
    expect(run('2-bedroom apartment 45 m² · Tan Hung Ward, District 7', GOPLUS, 'en', 'Hồ Chí Minh')).toBe('2-bed apartment 45 m² · Tan Hung Ward, District 7')
    // No tail at all, under a location that names an area: the count is short and nothing else is cut (commit review).
    expect(run('2-bedroom apartment 45 m²', GOPLUS)).toBe('2-bed apartment 45 m²')
    expect(run('Căn hộ 2 phòng ngủ 45 m²', GOPLUS, 'vi')).toBe('Căn hộ 2PN 45 m²')
  })
  it('only at the start of GoPlus\'s own template', () => {
    expect(run('Duplex 20 m² near a 2-bedroom apartment · An Phu Dong Ward, District 12', GOPLUS)).toBe('Duplex 20 m² near a 2-bedroom apartment')
    expect(run('2-bedroom apartments wanted · An Phu Dong Ward, District 12', GOPLUS)).toBe('2-bedroom apartments wanted')
    expect(run('2-bedroom apartment 45 m² · Tan Hung Ward, District 7', 'some-member')).toBe('2-bedroom apartment 45 m² · Tan Hung Ward, District 7')
    expect(run('Căn hộ 2 phòng ngủ 45 m² — Masteri An Phu', 'honeycomb-import-seller-0001', 'vi')).toBe('Căn hộ 2 phòng ngủ 45 m² — Masteri An Phu')
  })
  it('stays when it would leave one word, or names no place', () => {
    expect(run('Studio · Nha Be Commune, Nha Be District', GOPLUS)).toBe('Studio · Nha Be Commune, Nha Be District')
    expect(run('BMW S1000RR for rent · big bike', GOPLUS)).toBe('BMW S1000RR for rent · big bike')
    expect(run('Duplex 20 m² · Wardrobe included', GOPLUS)).toBe('Duplex 20 m² · Wardrobe included')
    expect(run('Căn hộ 20 m² · Nhà ở xã hội', GOPLUS, 'vi')).toBe('Căn hộ 20 m² · Nhà ở xã hội')
    expect(run('Duplex 20 m² · Near District 1 market', GOPLUS)).toBe('Duplex 20 m² · Near District 1 market')
  })
  it('stays when the info line would print only the city, or nothing', () => {
    expect(run('Duplex 20 m² · An Phu Dong Ward, District 12', GOPLUS, 'en', 'Hồ Chí Minh')).toBe('Duplex 20 m² · An Phu Dong Ward, District 12')
    expect(run('Duplex 20 m² · An Phu Dong Ward, District 12', GOPLUS, 'en', null)).toBe('Duplex 20 m² · An Phu Dong Ward, District 12')
    expect(run('Duplex 20 m² · An Phu Dong Ward, District 12', GOPLUS, 'en', 'Bình Dương')).toBe('Duplex 20 m² · An Phu Dong Ward, District 12')
  })
  it('never touches another importer (a tail can hold a building name) or a member', () => {
    expect(run('Căn hộ 3PN — Masteri An Phu, P. Thảo Điền, Quận 2', 'honeycomb-import-seller-0001')).toBe('Căn hộ 3PN — Masteri An Phu, P. Thảo Điền, Quận 2')
    expect(run('Duplex 20 m² · An Phu Dong Ward, District 12', 'some-member')).toBe('Duplex 20 m² · An Phu Dong Ward, District 12')
  })
})

describe('a no-pay linked job whose slot prints the employer (UI climb 2026-11-09)', () => {
  const job = (title: string, employer: string | null | undefined, lang = 'en') =>
    cardTitle({ title, lang, sellerId: 'eslboards-com-import-seller-0001', categorySlug: 'jobs', listingType: 'job', employer })
  it('drops the importer\'s exact " — <employer>" tail, so the role gets the line', () => {
    expect(job('Associate Lecturer, Psychology — RMIT University Vietnam', 'RMIT University Vietnam')).toBe('Associate Lecturer, Psychology')
    expect(job('Giảng viên Tâm lý học — RMIT University Vietnam', 'rmit university vietnam', 'vi')).toBe('Giảng viên Tâm lý học')
  })
  it('keeps the title when the slot prints no employer, the tail is another, or one word would be left', () => {
    expect(job('Associate Lecturer — RMIT University Vietnam', null)).toBe('Associate Lecturer — RMIT University Vietnam')
    expect(job('Associate Lecturer — RMIT University Vietnam', undefined)).toBe('Associate Lecturer — RMIT University Vietnam')
    expect(job('Associate Lecturer — RMIT University Vietnam', 'VUS')).toBe('Associate Lecturer — RMIT University Vietnam')
    expect(job('RMIT University Vietnam is hiring', 'RMIT University Vietnam')).toBe('RMIT University Vietnam is hiring')
    expect(job('Lecturer — RMIT University Vietnam', 'RMIT University Vietnam')).toBe('Lecturer — RMIT University Vietnam')
  })
  it('a case change that changes length never cuts into the role (cut first, compare after)', () => {
    expect(job('Senior Lecturer — İŞ', 'i̇ş')).toBe('Senior Lecturer — İŞ')
    expect(job('Senior Lecturer — Đại Học Mở', 'đại học mở', 'vi')).toBe('Senior Lecturer')
  })
  it('never applies to anything but a job', () => {
    expect(cardTitle({ title: 'Sofa — IKEA', lang: 'en', sellerId: 'm', categorySlug: 'furniture-appliances', listingType: 'sell', employer: 'IKEA' })).toBe('Sofa — IKEA')
  })
})

describe('cardTitle — batch 87: one short display grammar on every card but a teacher\'s', () => {
  const t = (title: string, over: Partial<Parameters<typeof cardTitle>[0]> = {}) => cardTitle({ title, lang: 'en', sellerId: 'x', categorySlug: 'electronics', listingType: 'sell', ...over })
  it('a SHOUTED title reads in title case; digits, acronyms and brands keep their form', () => {
    expect(t('NEKTAR LX25+ 25 KEY USB CONTROLLER KEYBOARD')).toBe('Nektar LX25+ 25 Key USB Controller Keyboard')
    expect(t('USED IPHONE 16 PRO MAX 256GB')).toBe('Used iPhone 16 Pro Max 256GB')
    // commit review: a title that OPENS on a lower-case brand keeps it; short words are words; acronyms stay in Vietnamese too
    expect(t('IPHONE 15 PRO MAX 256GB LIKE NEW')).toBe('iPhone 15 Pro Max 256GB Like New')
    expect(t('BRAND NEW SOFA BED FOR SALE')).toBe('Brand New Sofa Bed For Sale')
    // commit review round 2: a name is never lowered, and English keeps its "I"
    expect(t('SOFA FOR SALE, I AM MOVING')).toBe('Sofa For Sale, I Am Moving')
    // commit review round 3: contractions, a decomposed title, Vietnamese typed without accents, "AI" (who)
    expect(t("DON'T MISS THIS SOFA, I'M MOVING")).toBe("Don't Miss This Sofa, I'm Moving")
    expect(t('BÁN XE MÁY HONDA CHÍNH CHỦ'.normalize('NFD'))).toBe('Bán Xe Máy Honda Chính Chủ')
    expect(t('CHO THUE CAN HO AN PHU QUAN 2', { categorySlug: 'rentals', listingType: 'rent' })).toBe('Cho Thue Can Ho An Phu Quan 2')
    expect(t('AI CẦN THANH LÝ TỦ LẠNH')).toBe('Ai Cần Thanh Lý Tủ Lạnh')
    expect(t('GRADE A CONDITION MACBOOK')).toBe('Grade A Condition MacBook')
    // round 4: Vietnamese abbreviations with Đ, and listed ones with a vowel, stay
    expect(t('BÁN NHÀ BĐS QUẬN 7 LH SĐT CHÍNH CHỦ')).toBe('Bán Nhà BĐS Quận 7 LH SĐT Chính Chủ')
    expect(t('VIP SIM SỐ ĐẸP COD TOÀN QUỐC')).toBe('VIP SIM Số Đẹp COD Toàn Quốc')
    // round 5: an unknown short word keeps its capitals (never misspelled); "AI" is "who" only in a Vietnamese title
    expect(t('IOS DEVELOPER WANTED, REMOTE OK', { categorySlug: 'jobs', listingType: 'job' })).toBe('IOS Developer Wanted, Remote OK')
    expect(t('AI ENGINEER FOR A STARTUP', { categorySlug: 'jobs', listingType: 'job' })).toBe('AI Engineer For A Startup')
    expect(t('VINFAST VF8 EV FOR SALE, LIKE NEW')).toBe('VinFast VF8 EV For Sale, Like New')
    // round 6: English words that are also Vietnamese syllables do not make an English title Vietnamese
    expect(t('YOU CAN BUY IN MAY, IOS APP INCLUDED')).toBe('You Can Buy In May, IOS App Included')
    // round 7: an English title naming an accented district stays English; vehicle codes stay
    expect(t('IOS DEVELOPER IN THẢO ĐIỀN', { categorySlug: 'jobs', listingType: 'job' })).toBe('IOS Developer In Thảo Điền')
    expect(t('BÁN XE AB 2020 CHÍNH CHỦ')).toBe('Bán Xe AB 2020 Chính Chủ')
    expect(t('VINFAST VF8 EV CHÍNH CHỦ GIÁ TỐT')).toBe('VinFast VF8 EV Chính Chủ Giá Tốt')
    expect(t('NIKE AIR FORCE 1 SIZE 42')).toBe('Nike Air Force 1 Size 42')
    expect(t('MATH TEACHER WANTED URGENTLY', { categorySlug: 'jobs', listingType: 'job' })).toBe('Math Teacher Wanted Urgently')
    expect(t('BELKIN PD 3.0 25W FAST CHARGER')).toBe('Belkin PD 3.0 25W Fast Charger')
  })
  it('a Vietnamese shouted title capitalises every word, as the market writes it — names keep their capitals', () => {
    expect(t('CHO THUÊ NHÀ BIỆT THỰ MINI MÁI THÁI QUẬN 7', { categorySlug: 'rentals', listingType: 'rent' })).toBe('Cho Thuê Nhà Biệt Thự Mini Mái Thái Quận 7')
    expect(t('BÁN XE MÁY HONDA Ở BÌNH THẠNH')).toBe('Bán Xe Máy Honda Ở Bình Thạnh')
    expect(t('BÁN XE SUZUKI RAIDER CHÍNH CHỦ')).toBe('Bán Xe Suzuki Raider Chính Chủ')
    expect(t('CHO THUÊ CĂN HỘ MASTERI THẢO ĐIỀN', { categorySlug: 'rentals', listingType: 'rent' })).toBe('Cho Thuê Căn Hộ Masteri Thảo Điền')
    expect(t('BÁN TIVI LG 55 INCH CÒN MỚI')).toBe('Bán Tivi LG 55 Inch Còn Mới')
    expect(t('BÁN IPHONE 14 VN/A RAM 6GB HCM')).toBe('Bán iPhone 14 VN/A RAM 6GB HCM')
  })
  it('leaves a title alone that is not shouted, or too short to judge', () => {
    expect(t('Used iPhone 16 128GB Ultramarine Blue')).toBe('Used iPhone 16 128GB Ultramarine Blue')
    expect(t('PS5 SLIM')).toBe('PS5 SLIM')
    expect(t('Sony WH-1000XM5 headphones, MINT')).toBe('Sony WH-1000XM5 headphones, MINT')
  })
  it('a trailing "." or "!" goes', () => {
    expect(t('PS5 games for sale.')).toBe('PS5 games for sale')
    expect(t('Indians out there in Hanoi, Zaika Is Calling You!')).toBe('Indians out there in Hanoi, Zaika Is Calling You')
    // never an ellipsis or an abbreviation's full stop (commit review round 2)
    expect(t('Moving sale, everything must go...')).toBe('Moving sale, everything must go...')
    expect(t('Office cleaning by Sao Mai Co., Ltd.')).toBe('Office cleaning by Sao Mai Co., Ltd.')
    expect(t('Books, pens, notebooks etc.')).toBe('Books, pens, notebooks etc.')
  })
  it('a job drops its kind-of-posting tag, never words that are information', () => {
    const job = (title: string) => t(title, { categorySlug: 'jobs', listingType: 'job', location: 'Hà Nội' })
    expect(job('[Job Opening] Interpreter Recruitment for K-Eyewear')).toBe('Interpreter Recruitment for K-Eyewear')
    expect(job('[Tuyển dụng] Giáo viên tiếng Anh')).toBe('Giáo viên tiếng Anh')
    // commit review: nothing after a " | " is dropped — that is where pay and visa live — and "[Urgent]" stays
    expect(job('[Hanoi] Full-time ESL Teachers at Premium Schools | High Salary | Visa')).toBe('Full-time ESL Teachers at Premium Schools | High Salary | Visa')
    expect(job('ESL Teacher | 35–45M VND | Hanoi')).toBe('ESL Teacher | 35–45M VND | Hanoi')
    expect(job('[Urgent] Kindergarten teacher')).toBe('[Urgent] Kindergarten teacher')
    expect(job('[Online] ESL tutor')).toBe('[Online] ESL tutor')
    expect(job('PART-TIME ENGLISH & STEM TEACHER (NATIVE SPEAKERS PREFERRED)')).toBe('Part-Time English & STEM Teacher (Native Speakers Preferred)')
  })
  it('a teacher\'s card is a name, and keeps every letter', () => {
    expect(t('NGUYEN VAN AN — IELTS 8.0.', { categorySlug: 'teachers', listingType: 'teacher' })).toBe('NGUYEN VAN AN — IELTS 8.0.')
  })
  it('the stored title is untouched — only the card line changes (the caller keeps `title` for the h3 and the alt)', () => {
    const title = 'NEKTAR LX25+ 25 KEY USB CONTROLLER KEYBOARD'
    t(title)
    expect(title).toBe('NEKTAR LX25+ 25 KEY USB CONTROLLER KEYBOARD')
  })
})

describe('cardJobType — batch 87: every type but Full-time', () => {
  const tr = (en: string) => en
  it('Full-time, the default, is not printed; the others are', () => {
    expect(cardJobType('fulltime', tr)).toBeNull()
    expect(cardJobType('parttime', tr)).toBe('Part-time')
    expect(cardJobType('contract', tr)).toBe('Contract')
    expect(cardJobType('remote', tr)).toBe('Remote')
    expect(cardJobType(null, tr)).toBeNull()
  })
})

describe('rowTitle — batch 87: a list row reads in the card\'s grammar, without the card\'s shortening', () => {
  const r = (title: string, over: Partial<Parameters<typeof rowTitle>[0]> = {}) => rowTitle({ title, lang: 'vi', sellerId: 'x', categorySlug: 'jobs', listingType: 'job', location: 'Hà Nội', ...over })
  it('drops a job\'s kind-of-posting tag and the shouting; keeps everything else as stored', () => {
    expect(r('[Job Opening] Interpreter Recruitment for K-Eyewear')).toBe('Interpreter Recruitment for K-Eyewear')
    expect(r('PART-TIME ENGLISH & STEM TEACHER (NATIVE SPEAKERS PREFERRED)')).toBe('Part-Time English & STEM Teacher (Native Speakers Preferred)')
  })
  it('never applies the card\'s rental shortening to a row', () => {
    const title = 'Cho thuê Căn hộ / Chung cư 2PN 76m² — P. An Khánh mới, Quận 2'
    expect(r(title, { categorySlug: 'rentals', listingType: 'rent', location: 'Hồ Chí Minh' })).toBe(title)
  })
  it('a teacher row keeps its name', () => {
    expect(r('NGUYEN VAN AN', { categorySlug: 'teachers', listingType: 'teacher' })).toBe('NGUYEN VAN AN')
  })
})
