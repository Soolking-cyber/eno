/**
 * BREAK-UI FIXTURES — the worst realistic data for the dev-only `/developers/break-ui` harness (Emil
 * Kowalski's break-ui pass, 2026-10-05). Kept as the regression fixture for the next person who
 * touches a card, an avatar, a bubble or a dashboard row.
 *
 * ⚠️ PLAUSIBLE OR SCHEMA-BACKED, NEVER RANDOM. Every value below is something a real seller, buyer,
 * importer or translator produces, or the longest value the backend accepts (limits cited inline):
 * a 140-char title is the post form's cap, a 120-char shop name is updateSeller's cap, 2,000 chars is
 * the message cap — and importers write titles past 140 straight to the database.
 * ⚠️ FAILURES ARE SPREAD ACROSS ROWS the way real data spreads them, so the first screen shows most of
 * them at once instead of stacking everything into row one.
 * ⚠️ Times are computed from `now` at render, so the harness renders client-side only.
 */
import type { SerializedListing, SerializedListingCard, CategoryColor } from '@/lib/types'
import type { SellerMetrics } from '@/lib/seller-metrics'

export type BreakUiState = 'demo' | 'worst' | 'empty' | 'one' | 'many'
export const BREAK_UI_STATES: { key: BreakUiState; label: string }[] = [
  { key: 'demo', label: 'Demo data' },
  { key: 'worst', label: 'Worst case' },
  { key: 'empty', label: 'Empty' },
  { key: 'one', label: 'One' },
  { key: 'many', label: '1,000 rows' },
]

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
const iso = (t: number) => new Date(t).toISOString()

// ── categories + local photos (public/listings/*) ────────────────────────────────────────────────
type Cat = SerializedListingCard['category']
const cat = (id: string, slug: string, name: string, nameVi: string, icon: string, color: CategoryColor): Cat => ({ id, slug, name, nameVi, icon, color })
const CATS = {
  rentals: cat('c-rentals', 'rentals', 'Rentals', 'Cho thuê', 'KeyRound', 'sky'),
  electronics: cat('c-electronics', 'electronics', 'Electronics', 'Điện tử', 'Smartphone', 'indigo'),
  furniture: cat('c-furniture', 'furniture-appliances', 'Home', 'Nhà cửa', 'Sofa', 'indigo'),
  vehicles: cat('c-vehicles', 'vehicles', 'Vehicles', 'Xe cộ', 'CarFront', 'sky'),
  property: cat('c-property', 'property', 'Property', 'Nhà đất', 'Building2', 'teal'),
  jobs: cat('c-jobs', 'jobs', 'Jobs', 'Việc làm', 'Briefcase', 'violet'),
  fashion: cat('c-fashion', 'fashion-beauty', 'Fashion', 'Thời trang', 'Shirt', 'violet'),
}
const IMG = {
  sofa: '/listings/furniture-sofa.png',
  bedroom: '/listings/furniture-bedroom.png',
  iphone: '/listings/electronics-iphone.png',
  macbook: '/listings/electronics-macbook.png',
  airblade: '/listings/motorbike-airblade.png',
  wave: '/listings/motorbike-wave.png',
  apt1: '/listings/apartment-thaodien.png',
  apt2: '/listings/apartment-phumyhung.png',
  cafe: '/listings/job-cafe.png',
  panorama: '/listings/hero-market.png', // 1344×768 in a square slot
  broken: '/listings/this-photo-was-deleted.jpg', // 404: the onError path
}

// ── listing cards ────────────────────────────────────────────────────────────────────────────────
function card(now: number, i: number, over: Partial<SerializedListingCard>): SerializedListingCard {
  return {
    id: `bu-${i}`, sellerId: `bu-seller-${i % 4}`, title: 'Untitled', titleVi: null,
    price: 1_000_000, priceUnit: 'VND', currency: '₫', negotiable: false, isPartnerBooking: false,
    listingType: 'sell', jobType: null, prevPrice: null, urgent: false, urgentUntil: null,
    location: 'Hồ Chí Minh', district: null, city: 'Hồ Chí Minh', lat: null, lng: null,
    images: [IMG.sofa], video: null, brandSlug: null, model: null, condition: 'used', verified: true,
    postedAt: iso(now - 3 * HOUR), savedCount: 0, contactCount: 0, category: CATS.furniture,
    seller: { trustScore: 72, isBusiness: false, officialPartner: false, unrated: false },
    ...over,
  }
}

/** The kind data a designer reaches for: one-line titles, round prices, every photo present. */
function demoCards(now: number): SerializedListingCard[] {
  return [
    card(now, 1, { title: 'IKEA sofa, like new', price: 3_500_000, images: [IMG.sofa, IMG.bedroom], savedCount: 4 }),
    card(now, 2, { title: 'Honda Vision 2021', price: 22_000_000, category: CATS.vehicles, images: [IMG.airblade], negotiable: true }),
    card(now, 3, { title: 'iPhone 14 Pro 128GB', price: 15_900_000, category: CATS.electronics, images: [IMG.iphone] }),
    card(now, 4, { title: '2BR apartment Thảo Điền', price: 18_000_000, priceUnit: 'month', listingType: 'rent', category: CATS.rentals, images: [IMG.apt1, IMG.apt2], condition: null }),
    card(now, 5, { title: 'MacBook Air M2', price: 19_500_000, category: CATS.electronics, images: [IMG.macbook], savedCount: 12 }),
    card(now, 6, { title: 'Barista, District 1', price: 9_000_000, priceUnit: 'month', listingType: 'job', jobType: 'full-time', category: CATS.jobs, images: [IMG.cafe], condition: null }),
  ]
}

/** One dataset, many failures; each row names what it exercises. */
function worstCards(now: number): SerializedListingCard[] {
  return [
    // 1 · importer-length Vietnamese title (182 chars — importers skip the 140 cap), price drop, urgent,
    //     a huge saved count, long non-HCMC location, partner seller
    card(now, 101, {
      title: 'Cho thuê căn hộ 3PN Vinhomes Central Park Bình Thạnh – full nội thất cao cấp, view trực diện sông Sài Gòn & Landmark 81, ban công rộng, giá tốt nhất thị trường, vào ở ngay',
      titleVi: 'Cho thuê căn hộ 3PN Vinhomes Central Park Bình Thạnh – full nội thất cao cấp, view trực diện sông Sài Gòn & Landmark 81, ban công rộng, giá tốt nhất thị trường, vào ở ngay',
      price: 45_000_000, prevPrice: 52_000_000, priceUnit: 'month', listingType: 'rent', negotiable: true,
      urgent: true, urgentUntil: iso(now + 2 * DAY), location: 'Phường Hòa Hải, Quận Ngũ Hành Sơn, Thành phố Đà Nẵng', city: 'Đà Nẵng',
      category: CATS.rentals, condition: null, images: [IMG.apt1, IMG.apt2, IMG.bedroom, IMG.sofa, IMG.macbook],
      savedCount: 128_400, contactCount: 37, seller: { trustScore: 91, isBusiness: true, officialPartner: true },
    }),
    // 2 · unbroken title — sellers glue words together to game search
    card(now, 102, { title: 'iPhone15ProMax256GB-ChínhHãngVN/A-Pin100%-FullBox-BảoHành12Tháng-TặngỐpLưng', price: 28_990_000, category: CATS.electronics, images: [IMG.iphone], savedCount: 1 }),
    // 3 · two-letter title, the "1 đ" contact-for-price trick, NO photos
    card(now, 103, { title: 'TV', price: 1, negotiable: true, images: [], postedAt: iso(now - 20_000) }),
    // 4 · CJK without spaces, a photo that 404s
    card(now, 104, { title: '出租第二郡两室公寓，近地铁站，家具齐全，可短租', price: 18_000_000, priceUnit: 'month', listingType: 'rent', category: CATS.rentals, condition: null, images: [IMG.broken], location: 'Thu Duc, Ho Chi Minh City' }),
    // 5 · the API's price ceiling (1e12 — api/listings route allows 0–1e12) on a property listing
    card(now, 105, { title: 'Bán đất nền dự án khu đô thị mới, sổ đỏ từng nền', price: 1_000_000_000_000, prevPrice: 1_100_000_000_000, category: CATS.property, condition: null, images: [IMG.panorama], seller: { trustScore: 64, isBusiness: true } }),
    // 6 · an ordinary Thảo Điền villa (95 billion, 11 digits) — the realistic big number
    card(now, 106, { title: 'Villa for sale in Thảo Điền — 420m² land, private pool, pink book', price: 95_000_000_000, category: CATS.property, condition: null, images: [IMG.apt1] }),
    // 7 · Thai (marks above AND below) + a free-text condition the card prints verbatim (≤60 via API)
    card(now, 107, { title: 'ขายมอเตอร์ไซค์ Honda Vision 2022 สภาพดีมาก เจ้าของขายเอง', price: 26_500_000, category: CATS.vehicles, condition: 'Như mới 99%, đã thay pin chính hãng, còn bảo hành 6 tháng', images: [IMG.wave] }),
    // 8 · emoji-first, an urgent HIRING badge (the longest top-left label)
    card(now, 108, { title: '🔥🔥 TUYỂN GẤP 🔥🔥 Nhân viên pha chế ca tối, lương cao, bao ăn', price: 0, listingType: 'job', jobType: 'part-time', urgent: true, urgentUntil: iso(now + 3 * HOUR), category: CATS.jobs, condition: null, images: [IMG.cafe] }),
    // 9 · a giveaway (price 0), long Russian words, an unrated new seller
    card(now, 109, { title: 'Отдам бесплатно двухместный диван-кровать «Скандинавия» в отличном состоянии', price: 0, images: [IMG.sofa], seller: { trustScore: 0, isBusiness: false, unrated: true } }),
    // 10 · Khmer (stacked subscripts), salary per month
    card(now, 110, { title: 'ស្វែងរកបុគ្គលិកផ្នែកលក់ ដែលចេះភាសាអង់គ្លេស និងវៀតណាម', price: 12_000_000, priceUnit: 'month', listingType: 'job', jobType: 'full-time', category: CATS.jobs, condition: null, images: [IMG.cafe] }),
    // 11 · a newline in a single-line field, and markup that must render literally
    card(now, 111, { title: 'Áo khoác <b>Uniqlo</b> &amp; quần jean size M\nmặc 2 lần', price: 350_000, category: CATS.fashion, images: [IMG.bedroom] }),
    // 12 · leading / trailing / repeated spaces; posted in the FUTURE (a seller's clock skew)
    card(now, 112, { title: '   Sofa   da bò   Ý   ', price: 12_500_000, postedAt: iso(now + 2 * HOUR) }),
  ]
}

export function cardsFor(state: BreakUiState, now: number): SerializedListingCard[] {
  if (state === 'demo') return demoCards(now)
  if (state === 'worst') return worstCards(now)
  if (state === 'empty') return []
  if (state === 'one') return [card(now, 900, { title: 'Bàn ăn gỗ 4 ghế', price: 2_000_000, savedCount: 1, contactCount: 1 })]
  const w = worstCards(now)
  return Array.from({ length: 1000 }, (_, k) => ({ ...w[k % w.length], id: `bu-many-${k}` }))
}

// ── people: names that feed avatars/initials and identity blocks ────────────────────────────────
export type BreakUiPerson = { name: string; email: string | null; color: string }
const DEMO_PEOPLE: BreakUiPerson[] = [
  { name: 'Jane Doe', email: 'jane@acme.com', color: '#0a66c2' },
  { name: 'Minh Tran', email: 'minh@example.com', color: '#0d9488' },
  { name: 'Alex Kim', email: 'alex@example.com', color: '#7c3aed' },
]
const WORST_PEOPLE: BreakUiPerson[] = [
  { name: 'Nguyễn Văn An', email: 'an.nguyen@example.com', color: '#0a66c2' }, // the commonest VN shape: "NV" for a third of the country
  { name: 'Aleksandra Wiśniewska-Kowalczyk', email: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com', color: '#dc2626' },
  { name: 'Jo', email: 'a@b.co', color: '#0d9488' },
  { name: 'J', email: null, color: '#7c3aed' }, // OAuth seeds raw full_name; onboarding accepts 1 char
  { name: '🦊 Fox', email: 'fox@example.org', color: '#ea580c' },
  { name: '👩🏽‍💻 Priya', email: 'first.last+billing-notifications@example.com', color: '#db2777' },
  { name: '王秀英', email: 'wang.xiuying@example.cn', color: '#4f46e5' },
  { name: '  Sam   Lee ', email: 'sam@example.com', color: '#0891b2' }, // leading/repeated spaces
  { name: 'Christopher Alexander Montgomery III', email: 'ops@sub.department.region.example.co.uk', color: '#65a30d' },
  { name: 'Đặng Thị Ngọc Hân', email: 'han.dang@example.vn', color: '#9333ea' }, // stacked diacritics
  { name: 'ศุภชัย ใจดี', email: 'suppachai@example.co.th', color: '#ca8a04' }, // Thai
  // 120 chars — updateSeller's cap (core/seller.ts:43); a real shop-name shape
  { name: 'Công Ty TNHH Thương Mại Dịch Vụ Xuất Nhập Khẩu Điện Máy Điện Lạnh Hoàng Phát Thành Phố Hồ Chí Minh Chi Nhánh Quận Bảy', email: 'info@hoangphat-dienmay-xuatnhapkhau.example.vn', color: '#b91c1c' },
]
export function peopleFor(state: BreakUiState): BreakUiPerson[] {
  if (state === 'demo') return DEMO_PEOPLE
  if (state === 'worst') return WORST_PEOPLE
  if (state === 'empty') return []
  if (state === 'one') return [DEMO_PEOPLE[0]]
  return Array.from({ length: 1000 }, (_, k) => WORST_PEOPLE[k % WORST_PEOPLE.length])
}

/** Seller metrics: demo = established shop; worst cycles 1 review / 0 reviews / 128,400 reviews. */
export function metricsFor(state: BreakUiState, i: number, now: number): SellerMetrics {
  const today = iso(now).slice(0, 10)
  if (state === 'demo') return { responseBucket: { key: 'fast', en: 'Replies fast', vi: 'Phản hồi nhanh' }, lastSeenDay: today, memberSinceYear: 2024, reviewCount: 12, rating: 4.8, trustScore: 82, trustTier: 'trusted' }
  const reviewCount = [1, 0, 128_400][i % 3]
  return {
    responseBucket: [{ key: 'day' as const, en: 'Usually replies within a day', vi: 'Thường trả lời trong ngày' }, { key: null, en: '', vi: '' }][i % 2],
    lastSeenDay: i % 2 ? null : today, memberSinceYear: i % 2 ? 2026 : 2019, reviewCount, rating: reviewCount ? [5, 0, 3.97][i % 3] : 0,
    trustScore: [100, 0, 57][i % 3], trustTier: 'standard',
  }
}

// ── chat messages (MessageBubble): the 2,000-char cap, URLs, emails, newlines ───────────────────
export type BreakUiMessage = { id: string; mine: boolean; body: string }
const DEMO_MESSAGES: BreakUiMessage[] = [
  { id: 'd1', mine: false, body: 'Hi, is the sofa still available?' },
  { id: 'd2', mine: true, body: 'Yes it is! You can come see it tomorrow.' },
  { id: 'd3', mine: false, body: 'Great, thanks.' },
]
const WORST_MESSAGES: BreakUiMessage[] = [
  { id: 'w1', mine: false, body: 'Xem ảnh thêm ở đây nhé: https://drive.google.com/drive/folders/1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sTuVwXyZ?usp=sharing_eip_m&ts=6720a1b2' },
  { id: 'w2', mine: true, body: 'Em gửi hợp đồng qua email bartholomew.fitzgerald@northwind-industries-holdings.example.com nha anh' },
  { id: 'w3', mine: false, body: 'Địa chỉ:\n123 Nguyễn Văn Linh\nPhường Tân Phong, Quận 7\nTP.HCM\n\nGọi trước 15 phút nhé.' }, // Shift+Enter lines
  { id: 'w4', mine: true, body: 'okkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk😂😂😂😂😂😂😂😂😂😂😂😂' },
  { id: 'w5', mine: false, body: '👍' },
  { id: 'w6', mine: false, body: 'Mã đơn hàng của bạn: 9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f' },
  // a long paste near the 2,000-char server cap (RM slices at 2000)
  { id: 'w7', mine: true, body: ('Căn hộ có 2 phòng ngủ, 2 toilet, ban công hướng Đông Nam, nội thất đầy đủ gồm sofa, giường, tủ lạnh, máy giặt, máy lạnh ở cả 3 phòng. Phí quản lý 15.000đ/m², gửi xe máy 200.000đ/tháng. ').repeat(9).slice(0, 2000) },
  { id: 'w8', mine: false, body: '<script>alert(1)</script> **bold** &amp; _not italic_' },
]
export function messagesFor(state: BreakUiState): BreakUiMessage[] {
  if (state === 'demo') return DEMO_MESSAGES
  if (state === 'worst') return WORST_MESSAGES
  if (state === 'empty') return []
  if (state === 'one') return [DEMO_MESSAGES[0]]
  return Array.from({ length: 1000 }, (_, k) => ({ ...WORST_MESSAGES[k % WORST_MESSAGES.length], id: `m${k}` }))
}

// ── dashboard rows: the card plus the seller-side fields ─────────────────────────────────────────
export function toFullListing(c: SerializedListingCard, over: Partial<SerializedListing> = {}): SerializedListing {
  return {
    ...c, description: '', descriptionVi: null, affiliateUrl: null, isSponsored: false, affiliateDiscountCode: null,
    affiliateDiscountPercent: null, priceDropAt: null, dropExpiresAt: null, video: c.video ?? null, categoryId: c.category.id,
    subcategorySlug: c.subcategorySlug ?? null, listingType: c.listingType ?? 'sell',
    seller: { id: c.sellerId, name: 'Seller', avatarColor: '#0a66c2', avatarUrl: null, rating: 0, reviewCount: 0, verifiedSeller: false,
      officialPartner: false, affiliateDiscountCode: null, affiliateDiscountPercent: null, trustTier: 'standard', trustScore: c.seller.trustScore,
      responseRate: 0, responseTime: '', memberSince: c.postedAt, phone: null, isBusiness: c.seller.isBusiness, unrated: !!c.seller.unrated },
    status: 'active', verificationMethod: null, verifiedAt: null, verifiedBy: null, verificationNotes: null, views: 0,
    availabilityConfirmedAt: null, featured: false, attributes: null, year: null, mileageKm: null, engineL: null,
    ...over,
  }
}
export function dashboardRowsFor(state: BreakUiState, now: number): SerializedListing[] {
  const cards = cardsFor(state, now)
  if (state === 'demo') return cards.slice(0, 4).map((c, i) => toFullListing(c, { views: [120, 48, 310, 9][i], contactCount: [3, 2, 7, 0][i] }))
  if (state === 'one') return cards.map((c) => toFullListing(c, { views: 1, contactCount: 1, savedCount: 1 }))
  const statuses = ['active', 'sold', 'hidden', 'expired', 'stale', 'active'] // every status the table can hold
  return cards.slice(0, state === 'many' ? 1000 : 12).map((c, i) =>
    toFullListing(c, { views: [100_000, 0, 1, 1_284, 7, 42][i % 6], contactCount: [1, 0, 12_840, 2, 1, 0][i % 6], savedCount: [1, 0, 3, 100_000, 0, 1][i % 6], status: statuses[i % 6], verified: i % 5 !== 3 }))
}
