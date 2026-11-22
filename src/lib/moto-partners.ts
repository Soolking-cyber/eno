/**
 * eno's MOTORBIKE RENTAL PARTNERS (owner, 2026-11-22): The Extra Mile and Saigon Scooter Centre, both in Ho Chi Minh City's
 * old District 2, written ONCE on each shop's own storefront, then the admin's to manage.
 *
 * Owner, 2026-11-22: "https://saigonscootercentre.com/ssc-rentals/ https://theextramile.co/premium-motorbike-rental/ import
 * these 2 as partners and their offering with clear prices and terms". Same shape as the car partners (car-partners.ts,
 * 2026-11-17): official partner, chat-only, an eno-held login (support+<handle>@eno.vn), the home strip and Partner inbox.
 * Blvck (blvck-listing.ts) stays eno's other motorbike partner; the 22 Extra Mile rows the vehicle importer fetched before
 * 2026-11-04 stay retired ('stale', seller vehicle-import-seller-theextramile) — these are new rows on a new storefront.
 *
 * Pure — the I/O is scripts/import-moto-partners.ts.
 *
 * ⛔ EVERY PRICE AND TERM IS THE SHOP'S OWN, READ OFF ITS SITE ON 2026-11-22 (research kept in
 * ~/eno-moto-partners-2026-11-22/<research>/data.json; the importer refuses a run whose research disagrees with a price
 * below). Nothing is completed or guessed: a term the shop does not state is not printed.
 *
 * ⛔ THE EXTRA MILE CONTRADICTS ITSELF, SO ONLY WHAT AGREES IS PRINTED. Each bike's own page gives a first-day price, a
 * month and a deposit; the site's city and road-trip price TABLES give totals by length. Where a table's month (or first
 * day) equals the bike page's, its 2-day / week / fortnight figures are printed; where it does not (city: XR 150, ADV 150,
 * ADV 160 — 5.7–6.4 M in the table against 6–7 M on the page; road trip: every bike but the Versys and the CB500X, 1–3
 * USD a day lower in the table), only the bike page's own figures are, and the listing says longer rentals cost less.
 *
 * ⛔ SAIGON SCOOTER CENTRE IS ONE LISTING, NOT THREE: its rentals page shows ONE photo of each scooter, and a rental needs 3
 * distinct photos (publish-guard.ts minPhotosFor — an admin's edit re-checks it, so fewer would be uneditable). Its three
 * photos are one of each scooter; the title names all three, cheapest first, and the card's price is that one's.
 * Its Terms page is for its guided TOURS (a 950 USD deposit per person), not the rentals: none of it is printed here.
 *
 * ⛔ PRICES IN US DOLLARS STAY IN DOLLARS IN THE TEXT. A listing price is đồng (taxonomy.ts listingMoneyFor), so a listing
 * priced only in dollars (SSC, and The Extra Mile's three road-trip-only bikes) is converted at run time at the rate the
 * importer reads once (honeycomb-listing.ts usdToVnd / vndPerUsdFrom, as Saigon Cribs), and the text says so.
 *
 * ⛔ NO PHONE, LINK, EMAIL OR STREET ADDRESS IN A LISTING TEXT (assertCleanTexts, on an admin's later edit too): the
 * address is the storefront's (Seller.location). ⛔ A 'Label: value' table needs 3+ lines whose labels start with a LETTER
 * (rich-text-blocks.ts): "Two days", not "2 days".
 *
 * ⛔ ONLY ENGLISH AND VIETNAMESE ARE WRITTEN HERE; Reach's daily Haiku job writes the nine other languages.
 */
import { buildFacetTokens } from './facet-tokens'
import { buildSearchText } from './fold'
import { usdToVnd } from './honeycomb-listing'
import { listingMoneyFor } from './taxonomy'
import { formatMoneyFull } from './vnd'

export type MotoPartnerHandle = 'theextramile' | 'saigonscootercentre'
type Lang = 'en' | 'vi'

const READ_EN = '22 November 2026'
const READ_VI = '22/11/2026'
const dong = (n: number, lang: Lang) => formatMoneyFull(n, '₫', lang)
const section = (heading: string, lines: readonly string[]) => `# ${heading}\n${lines.join('\n')}`
const bullets = (items: readonly string[]) => items.map((i) => `- ${i}`)

/** The run's dollar rate (the importer reads it once) and the day it was read, for the text that names it. */
export type Fx = { vndPerUsd: number; dayEn: string; dayVi: string }

/**
 * ⛔ EVERY PRICE IS SHOWN IN ĐỒNG (owner, 2026-11-22: "same as saigon cribs vnd prices shown, use card price"): a figure
 * the shop sets in US dollars is converted at the run's one rate, to the nearest 10,000 đ — the same conversion as the
 * card price — and no dollar figure is printed. fxLine says so once on every listing that carries one.
 */
const fromUsd = (n: number, fx: Fx, lang: Lang) => dong(usdToVnd(n, fx.vndPerUsd), lang)

function fxLine(fx: Fx, lang: Lang): string {
  const rate = dong(fx.vndPerUsd, lang)
  return lang === 'en'
    ? `Prices the shop sets in US dollars are shown in đồng at ${rate} per US dollar (${fx.dayEn}), so they are approximate.`
    : `Giá cửa hàng niêm yết bằng đô la Mỹ được quy đổi sang đồng theo tỷ giá ${rate}/USD (${fx.dayVi}), chỉ mang tính tham khảo.`
}

// ── THE EXTRA MILE ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ExtraMileBike = {
  /** The bike page's slug (theextramile.co/motorbikes/<slug>/) = its research and photo folder; externalId `theextramile:<slug>`. */
  slug: string
  /** As the shop names it, year range included. */
  name: string
  kind: 'motorbike' | 'ebike'
  transmission: 'automatic' | 'manual'
  /** Engine size or 'electric', as the bike page's specification. */
  engine: string
  /** The licence the bike page asks for ("A (old A2) or IDP 1968 with category A"); 'none' = it says none is needed. */
  licence: 'A' | 'A1' | 'none'
  /** City rental in đồng, off the bike page; `table` only where the site's city table agrees with that page's month. */
  city: { firstDay: number; month: number; deposit: number; table: { d2: number; d7: number; d14: number; waiver30: number } | null } | null
  /** Road trip in US dollars, off the bike page; `table` only where the road-trip table's first day agrees with it. */
  road: { firstDayUsd: number; table: { d7: number; d14: number; d30: number } | null } | null
}

const bike = (slug: string, name: string, kind: ExtraMileBike['kind'], transmission: ExtraMileBike['transmission'], engine: string,
  licence: ExtraMileBike['licence'], city: ExtraMileBike['city'], road: ExtraMileBike['road']): ExtraMileBike =>
  ({ slug, name, kind, transmission, engine, licence, city, road })

/** Cheapest first, as a renter compares them; the e-bikes last. Yamaha WR 155 is on the site with no price: left out. */
export const EXTRA_MILE_BIKES: readonly ExtraMileBike[] = [
  bike('honda-vision-v2-2019-2020', 'Honda Vision v2 (2019-2020)', 'motorbike', 'automatic', '110 cc', 'A1', { firstDay: 280_000, month: 2_800_000, deposit: 4_000_000, table: { d2: 560_000, d7: 1_360_000, d14: 1_960_000, waiver30: 3_394_000 } }, { firstDayUsd: 14, table: null }),
  bike('yamaha-janus-2022', 'Yamaha Janus (2021-2022)', 'motorbike', 'automatic', '125 cc', 'A1', { firstDay: 280_000, month: 2_800_000, deposit: 4_000_000, table: { d2: 560_000, d7: 1_360_000, d14: 1_960_000, waiver30: 3_394_000 } }, { firstDayUsd: 14, table: null }),
  bike('yamaha-freego-s-2021', 'Yamaha Freego S (2021)', 'motorbike', 'automatic', '125 cc', 'A1', { firstDay: 280_000, month: 2_800_000, deposit: 4_000_000, table: { d2: 560_000, d7: 1_360_000, d14: 1_960_000, waiver30: 3_394_000 } }, { firstDayUsd: 17, table: null }),
  bike('kymco-candy-50cc', 'Kymco Candy 50cc (2025-2026)', 'motorbike', 'automatic', '50 cc', 'none', { firstDay: 280_000, month: 2_800_000, deposit: 4_000_000, table: { d2: 560_000, d7: 1_360_000, d14: 1_960_000, waiver30: 3_394_000 } }, { firstDayUsd: 17, table: null }),
  bike('sym-shark-50cc', 'SYM Shark 50cc', 'motorbike', 'automatic', '49 cc', 'none', { firstDay: 280_000, month: 2_800_000, deposit: 4_000_000, table: null }, { firstDayUsd: 17, table: null }),
  bike('honda-lead-125-2017-2021', 'Honda Lead 125 (2017-2021)', 'motorbike', 'automatic', '125 cc', 'A1', { firstDay: 300_000, month: 3_000_000, deposit: 4_000_000, table: { d2: 600_000, d7: 1_460_000, d14: 2_090_000, waiver30: 3_636_000 } }, { firstDayUsd: 17, table: null }),
  bike('honda-pcx-125-2015-2018', 'Honda PCX 125 (2015-2018)', 'motorbike', 'automatic', '125 cc', 'A1', { firstDay: 350_000, month: 3_500_000, deposit: 4_000_000, table: { d2: 700_000, d7: 1_690_000, d14: 2_440_000, waiver30: 4_242_000 } }, { firstDayUsd: 23, table: null }),
  bike('yamaha-nvx-155-abs-version-1-2017-2018', 'Yamaha NVX 155 ABS v1 (2017-2018)', 'motorbike', 'automatic', '155 cc', 'A', { firstDay: 350_000, month: 3_500_000, deposit: 4_000_000, table: { d2: 700_000, d7: 1_690_000, d14: 2_440_000, waiver30: 4_242_000 } }, { firstDayUsd: 23, table: null }),
  bike('honda-winner-x-2022', 'Honda Winner X (2022)', 'motorbike', 'manual', '150 cc', 'A', { firstDay: 350_000, month: 3_500_000, deposit: 4_000_000, table: { d2: 700_000, d7: 1_690_000, d14: 2_440_000, waiver30: 4_242_000 } }, { firstDayUsd: 20, table: null }),
  bike('honda-pcx-150-2019-2020', 'Honda PCX 150 (2019-2020)', 'motorbike', 'automatic', '150 cc', 'A', { firstDay: 450_000, month: 4_500_000, deposit: 4_000_000, table: { d2: 900_000, d7: 2_190_000, d14: 3_130_000, waiver30: 5_454_000 } }, { firstDayUsd: 25, table: null }),
  bike('yamaha-nvx-155-abs-v2-2022', 'Yamaha NVX 155 ABS v2 (2022)', 'motorbike', 'automatic', '155 cc', 'A', { firstDay: 450_000, month: 4_500_000, deposit: 4_000_000, table: { d2: 900_000, d7: 2_190_000, d14: 3_130_000, waiver30: 5_454_000 } }, { firstDayUsd: 25, table: null }),
  bike('honda-vario-160', 'Honda Vario 160 (2023)', 'motorbike', 'automatic', '157 cc', 'A', { firstDay: 450_000, month: 4_500_000, deposit: 4_000_000, table: { d2: 900_000, d7: 2_190_000, d14: 3_130_000, waiver30: 5_454_000 } }, { firstDayUsd: 25, table: null }),
  bike('honda-pcx-160-2022', 'Honda PCX 160 (2022)', 'motorbike', 'automatic', '157 cc', 'A', { firstDay: 550_000, month: 5_500_000, deposit: 4_000_000, table: { d2: 1_100_000, d7: 2_670_000, d14: 3_830_000, waiver30: 6_666_000 } }, { firstDayUsd: 28, table: null }),
  bike('honda-sh-150i-abs-2021', 'Honda SH 150i ABS (2021)', 'motorbike', 'automatic', '150 cc', 'A', { firstDay: 550_000, month: 5_500_000, deposit: 4_000_000, table: { d2: 1_100_000, d7: 2_670_000, d14: 3_830_000, waiver30: 6_666_000 } }, { firstDayUsd: 28, table: null }),
  bike('yamaha-xsr-155-2020', 'Yamaha XSR 155 (2020-2022)', 'motorbike', 'manual', '155 cc', 'A', { firstDay: 550_000, month: 5_500_000, deposit: 4_000_000, table: { d2: 1_100_000, d7: 2_670_000, d14: 3_830_000, waiver30: 6_666_000 } }, { firstDayUsd: 28, table: null }),
  bike('honda-xr-150', 'Honda XR 150', 'motorbike', 'manual', '150 cc', 'A', { firstDay: 600_000, month: 6_000_000, deposit: 4_000_000, table: null }, { firstDayUsd: 25, table: null }),
  bike('honda-adv-150-abs-2021', 'Honda ADV 150 ABS (2021)', 'motorbike', 'automatic', '150 cc', 'A', { firstDay: 600_000, month: 6_000_000, deposit: 4_000_000, table: null }, { firstDayUsd: 28, table: null }),
  bike('adv-160-model-2026', 'Honda ADV 160 (2026)', 'motorbike', 'automatic', '160 cc', 'A', { firstDay: 700_000, month: 7_000_000, deposit: 4_000_000, table: null }, { firstDayUsd: 30, table: null }),
  // Road trips only: the site's city price is "NA". ⛔ The Honda CRF150L (35 USD a day, 150 USD deposit) is NOT here: of
  // its six photos five carry another rental shop's watermark or banners and the sixth is the same bike (photo review,
  // 2026-11-22) — none is The Extra Mile's own, and a rental needs 3. The admin adds it once the shop sends photos.
  bike('kawasaki-versys-x-300', 'Kawasaki Versys X 300', 'motorbike', 'manual', '296 cc', 'A', null, { firstDayUsd: 50, table: { d7: 335, d14: 601, d30: 850 } }),
  bike('honda-cb500x', 'Honda CB500X', 'motorbike', 'manual', '471 cc', 'A', null, { firstDayUsd: 60, table: { d7: 399, d14: 721, d30: 1150 } }),
  // City only: the site says "Not Available" for road trips on its e-bikes.
  bike('vinfast-klara-s-v1-2021-2023', 'VinFast Klara S V1 (2021-2023)', 'ebike', 'automatic', 'electric', 'none', { firstDay: 300_000, month: 3_000_000, deposit: 4_000_000, table: { d2: 600_000, d7: 1_460_000, d14: 2_090_000, waiver30: 3_636_000 } }, null),
  bike('dat-bike-quantum-s3-2024', 'Dat Bike Quantum S3 (2024)', 'ebike', 'automatic', 'electric, 6,000 W', 'A1', { firstDay: 350_000, month: 3_500_000, deposit: 4_000_000, table: { d2: 700_000, d7: 1_690_000, d14: 2_440_000, waiver30: 4_242_000 } }, null),
]

/** The road-trip table's "Start/Finish Different Office" column: 70 USD over the same-office price, on every bike it lists. */
const ONE_WAY_EXTRA_USD = 70

/**
 * The licence line, as each bike's page states it. ⚠️ Ternaries, not an `{ en, vi }` table: scripts/gen-ui-strings.mjs
 * harvests such pairs as interface copy, and these are listing text (commit-gate review, Opus 2026-11-22).
 */
function licenceLine(kind: ExtraMileBike['licence'], lang: Lang): string {
  const en = lang === 'en'
  if (kind === 'none') return en ? 'The shop rents this one without a driving licence.' : 'Cửa hàng cho thuê xe này không cần bằng lái.'
  const cls = kind === 'A' ? (en ? 'class A (formerly A2)' : 'hạng A (trước đây là A2)') : (en ? 'class A1' : 'hạng A1')
  return en
    ? `Licence: ${cls}, or an international driving permit (1968 Convention) with category ${kind}, carried with your home licence.`
    : `Bằng lái: ${cls}, hoặc giấy phép lái xe quốc tế (Công ước 1968) có hạng ${kind}, mang kèm bằng lái gốc.`
}

/** The Extra Mile's terms (FAQ page, read 2026-11-22), one bullet each; `city` / `road` only on a bike rented that way. */
function extraMileTerms(b: ExtraMileBike, fx: Fx, lang: Lang): string[] {
  const en = lang === 'en'
  const out = [
    en ? 'Rider 21 or older. To book: a photo of your passport (VNeID for Vietnamese citizens), your address in Vietnam (a hotel is fine) and a phone number.'
      : 'Người lái từ 21 tuổi. Để đặt xe: ảnh hộ chiếu (người Việt dùng VNeID), địa chỉ tại Việt Nam (khách sạn cũng được) và số điện thoại.',
    licenceLine(b.licence, lang),
    en ? `A pre-deposit of ${fromUsd(100, fx, 'en')} holds the bike and counts toward the rental; it is not refunded if you cancel (${fromUsd(200, fx, 'en')} when the rental starts in Đà Nẵng or Hà Nội).`
      : `Đặt trước ${fromUsd(100, fx, 'vi')} để giữ xe, được trừ vào tiền thuê; không hoàn lại nếu huỷ (${fromUsd(200, fx, 'vi')} nếu nhận xe ở Đà Nẵng hoặc Hà Nội).`,
    en ? 'The security deposit comes back at the end if the bike has no new damage. The shop never keeps a passport or other papers as a deposit.'
      : 'Tiền cọc được hoàn lại khi trả xe nếu xe không có hư hại mới. Cửa hàng không giữ hộ chiếu hay giấy tờ thay tiền cọc.',
    en ? 'Optional damage waiver: the shop pays for crash damage to the bike. It does not cover damage to others, injury, theft or lost accessories.'
      : 'Gói miễn trừ hư hại (tùy chọn): cửa hàng chịu chi phí sửa xe khi va chạm, té ngã. Không bao gồm thiệt hại cho người khác, thương tích, mất cắp hay mất phụ kiện.',
    en ? 'Included: up to 2 helmets, a raincoat, a phone holder, a copy of the registration and the compulsory insurance.'
      : 'Kèm theo: tối đa 2 mũ bảo hiểm, áo mưa, giá đỡ điện thoại, bản sao cà vẹt và bảo hiểm bắt buộc.',
  ]
  if (b.city) out.push(
    en ? `City rentals from 2 days, about 50 km a day (1,500 km a month); extra kilometres at the contract's rate, ${dong(2_000, 'en')} to ${dong(10_000, 'en')} a km.`
      : `Thuê trong thành phố từ 2 ngày, khoảng 50 km/ngày (1.500 km/tháng); km vượt tính theo hợp đồng, ${dong(2_000, 'vi')} đến ${dong(10_000, 'vi')}/km.`,
    en ? 'Free delivery for city rentals of 3 days or more to Thủ Đức (old Districts 2 and 9), Bình Thạnh, Phú Nhuận, Tân Bình and Districts 1, 3, 4 and 7, from 9:30 to 17:00, Monday to Saturday.'
      : 'Giao xe miễn phí cho thuê từ 3 ngày trở lên tại Thủ Đức (Quận 2, Quận 9 cũ), Bình Thạnh, Phú Nhuận, Tân Bình và Quận 1, 3, 4, 7, từ 9:30 đến 17:00, thứ Hai đến thứ Bảy.',
  )
  if (b.road) out.push(
    en ? 'Road trips: no kilometre limit, anywhere in Vietnam but not across the border; the bike is collected at the shop. Ending in another city by arrangement, at least 3 days ahead.'
      : 'Đi phượt: không giới hạn km, đi khắp Việt Nam nhưng không qua biên giới; nhận xe tại cửa hàng. Trả xe ở thành phố khác theo thỏa thuận, báo trước ít nhất 3 ngày.',
  )
  // ⛔ No fuel line on an e-bike: the FAQ's full-tank rule is for petrol bikes, and it states no charging rule
  // (commit-gate review, codex 2026-11-22).
  out.push(
    b.kind === 'ebike'
      ? (en ? 'Back early: half the value of the unused days is refunded, from 2 unused days.' : 'Trả sớm: hoàn 50% giá trị số ngày chưa dùng, từ 2 ngày trở lên.')
      : (en ? 'Return the tank full. Back early: half the value of the unused days is refunded, from 2 unused days.'
        : 'Trả xe đầy bình xăng. Trả sớm: hoàn 50% giá trị số ngày chưa dùng, từ 2 ngày trở lên.'),
    en ? 'Prices include VAT. Pay by card (3% fee), bank transfer or cash. Open 9:00 to 18:00, Monday to Saturday; Sundays by appointment.'
      : 'Giá đã gồm VAT. Thanh toán bằng thẻ (phí 3%), chuyển khoản hoặc tiền mặt. Mở cửa 9:00 đến 18:00, thứ Hai đến thứ Bảy; Chủ nhật theo lịch hẹn.',
  )
  return out
}

export function extraMileTitle(b: ExtraMileBike, lang: Lang): string {
  if (b.kind === 'ebike') return lang === 'en' ? `${b.name} e-scooter rental` : `Cho thuê xe máy điện ${b.name}`
  return lang === 'en' ? `${b.name} motorbike rental` : `Cho thuê xe máy ${b.name}`
}

/** The listing's own price: the city month in đồng, or — road trips only — the first day converted from dollars. */
export function extraMilePrice(b: ExtraMileBike, fx: Fx): { price: number; period: 'monthly' | 'daily'; convertedFromUsd: number | null } {
  if (b.city) return { price: b.city.month, period: 'monthly', convertedFromUsd: null }
  if (!b.road) throw new Error(`${b.slug}: neither a city nor a road-trip price`)
  return { price: usdToVnd(b.road.firstDayUsd, fx.vndPerUsd), period: 'daily', convertedFromUsd: b.road.firstDayUsd }
}

export function extraMileDescription(b: ExtraMileBike, fx: Fx, lang: Lang): string {
  const en = lang === 'en'
  const tx = en ? b.transmission : (b.transmission === 'automatic' ? 'tay ga / tự động' : 'côn tay / số')
  // Vietnamese groups thousands with a DOT: "6,000 W" would read as six watts (commit-gate review, Opus 2026-11-22).
  const engine = en ? b.engine : b.engine.replace('electric', 'điện').replace(/(\d),(\d{3})/g, '$1.$2')
  const ways = b.city && b.road
    ? (en ? 'by the day or month in the city, or for a road trip anywhere in Vietnam' : 'theo ngày hoặc tháng trong thành phố, hoặc đi phượt khắp Việt Nam')
    : b.city ? (en ? 'by the day or month in the city' : 'theo ngày hoặc tháng trong thành phố')
      : (en ? 'for road trips anywhere in Vietnam' : 'đi phượt khắp Việt Nam')
  const intro = en
    ? `${b.name} for rent from The Extra Mile in Ho Chi Minh City, ${ways}. ${engine[0].toUpperCase()}${engine.slice(1)}, ${tx}. Message the shop here on eno with your dates to check availability and book.`
    : `Cho thuê ${b.name} tại The Extra Mile, TP. Hồ Chí Minh, ${ways}. Xe ${engine}, ${tx}. Nhắn tin cho cửa hàng ngay trên eno kèm ngày thuê để kiểm tra lịch xe và đặt xe.`
  const parts = [intro]

  if (b.city) {
    const c = b.city
    const rows = c.table
      ? [
        en ? `Two days: ${dong(c.table.d2, 'en')}` : `Hai ngày: ${dong(c.table.d2, 'vi')}`,
        en ? `One week: ${dong(c.table.d7, 'en')}` : `Một tuần: ${dong(c.table.d7, 'vi')}`,
        en ? `Two weeks: ${dong(c.table.d14, 'en')}` : `Hai tuần: ${dong(c.table.d14, 'vi')}`,
        en ? `One month: ${dong(c.month, 'en')}` : `Một tháng: ${dong(c.month, 'vi')}`,
        en ? `With damage waiver: ${dong(c.table.waiver30, 'en')} a month` : `Kèm miễn trừ hư hại: ${dong(c.table.waiver30, 'vi')}/tháng`,
        en ? `Security deposit: ${dong(c.deposit, 'en')}` : `Tiền cọc: ${dong(c.deposit, 'vi')}`,
      ]
      : [
        en ? `First day: ${dong(c.firstDay, 'en')}` : `Ngày đầu: ${dong(c.firstDay, 'vi')}`,
        en ? `One month: ${dong(c.month, 'en')}` : `Một tháng: ${dong(c.month, 'vi')}`,
        en ? `Security deposit: ${dong(c.deposit, 'en')}` : `Tiền cọc: ${dong(c.deposit, 'vi')}`,
      ]
    const note = c.table
      ? (en ? 'Past a month, the same monthly rate. Totals for the whole period, VAT included.' : 'Trên một tháng: tính theo giá tháng. Giá trọn gói cho cả kỳ thuê, đã gồm VAT.')
      : (en ? 'The longer you rent, the lower the price a day: ask the shop for your dates.' : 'Thuê càng lâu giá mỗi ngày càng thấp: hỏi cửa hàng theo ngày thuê của bạn.')
    parts.push(section(en ? 'City rental' : 'Thuê trong thành phố', [...rows, '', note]))
  }

  if (b.road) {
    const r = b.road
    const rows = r.table
      ? [
        en ? `One day: ${fromUsd(r.firstDayUsd, fx, 'en')}` : `Một ngày: ${fromUsd(r.firstDayUsd, fx, 'vi')}`,
        en ? `One week: ${fromUsd(r.table.d7, fx, 'en')}` : `Một tuần: ${fromUsd(r.table.d7, fx, 'vi')}`,
        en ? `Two weeks: ${fromUsd(r.table.d14, fx, 'en')}` : `Hai tuần: ${fromUsd(r.table.d14, fx, 'vi')}`,
        en ? `One month: ${fromUsd(r.table.d30, fx, 'en')}` : `Một tháng: ${fromUsd(r.table.d30, fx, 'vi')}`,
        en ? `Ending in another city: +${fromUsd(ONE_WAY_EXTRA_USD, fx, 'en')}` : `Trả xe ở thành phố khác: +${fromUsd(ONE_WAY_EXTRA_USD, fx, 'vi')}`,
      ]
      : null
    const lines = rows
      ? [...rows, '', en ? 'No kilometre limit. Totals for the whole trip, VAT included.' : 'Không giới hạn km. Giá trọn gói cho cả chuyến, đã gồm VAT.']
      : bullets([
        en ? `From ${fromUsd(r.firstDayUsd, fx, 'en')} a day, no kilometre limit; the longer the trip, the lower the price a day.`
          : `Từ ${fromUsd(r.firstDayUsd, fx, 'vi')}/ngày, không giới hạn km; đi càng lâu giá mỗi ngày càng thấp.`,
      ])
    parts.push(section(en ? 'Road trip' : 'Thuê đi phượt', lines))
  }

  parts.push(section(en ? 'To rent' : 'Điều kiện thuê', bullets(extraMileTerms(b, fx, lang))))
  // Every bike carries a dollar-set figure (the pre-deposit at least), so every one says how it was converted.
  parts.push(en ? `Prices and terms as The Extra Mile publishes them, read ${READ_EN}. ${fxLine(fx, 'en')}` : `Giá và điều kiện theo The Extra Mile công bố, cập nhật ${READ_VI}. ${fxLine(fx, 'vi')}`)
  return parts.join('\n\n')
}

// ── SAIGON SCOOTER CENTRE ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Its rentals page, read 2026-11-22: three scooters, US dollars a day, a deposit "applicable" on each (amount not stated). */
export const SSC_SCOOTERS = [
  { key: 'airblade', name: 'Honda Air Blade 110cc', perDayUsd: 10 },
  { key: 'scomadi', name: 'Scomadi TT125i', perDayUsd: 45 },
  { key: 'vespa', name: 'Vintage Vespa', perDayUsd: 75 },
] as const

export const SSC_SLUG = 'scooter-rental'

export function sscTitle(lang: Lang): string {
  return lang === 'en' ? 'Scooter rental: Honda Air Blade, Scomadi TT125i or vintage Vespa' : 'Cho thuê xe tay ga: Honda Air Blade, Scomadi TT125i hoặc Vespa cổ'
}

export function sscDescription(fx: Fx, lang: Lang): string {
  const en = lang === 'en'
  const [ab, sc, ve] = SSC_SCOOTERS
  return [
    en ? 'Three scooters for rent by the day from Saigon Scooter Centre, the classic-scooter workshop in Thủ Đức (old District 2), Ho Chi Minh City. Message the shop here on eno with your dates and the scooter you want.'
      : 'Ba mẫu xe tay ga cho thuê theo ngày tại Saigon Scooter Centre, xưởng xe cổ ở Thủ Đức (Quận 2 cũ), TP. Hồ Chí Minh. Nhắn tin cho cửa hàng ngay trên eno kèm ngày thuê và mẫu xe bạn muốn.',
    section(en ? 'Price a day' : 'Giá thuê mỗi ngày', [
      `${ab.name}: ${fromUsd(ab.perDayUsd, fx, lang)}`,
      `${sc.name}: ${fromUsd(sc.perDayUsd, fx, lang)}`,
      `${en ? ve.name : 'Vespa cổ'}: ${fromUsd(ve.perDayUsd, fx, lang)}`,
      '',
      ...bullets([
        en ? 'The Air Blade and the Scomadi are twist-and-go automatics. The vintage Vespas are the PX150E and other 4-speed manual, kick-start models.'
          : 'Air Blade và Scomadi là xe tay ga tự động. Vespa cổ gồm PX150E và các mẫu số tay 4 cấp, đạp nổ.',
        en ? 'A deposit applies to every scooter: ask the shop for the amount.' : 'Mỗi xe đều có tiền đặt cọc: hỏi cửa hàng số tiền cụ thể.',
        en ? 'One-way rentals ending outside Ho Chi Minh City by arrangement; a collection fee may apply depending on where the scooter is left.'
          : 'Có thể trả xe ngoài TP. Hồ Chí Minh theo thỏa thuận; có thể tính phí thu hồi xe tùy nơi trả.',
        fxLine(fx, lang),
      ]),
    ]),
    section(en ? 'Included' : 'Bao gồm', bullets([
      en ? 'Rider and passenger helmets, a rear luggage rack and straps for your bags.' : 'Mũ bảo hiểm cho người lái và người ngồi sau, baga sau và dây chằng hành lý.',
      en ? 'Notarised copies of the ownership papers and the compulsory third-party insurance.' : 'Bản sao công chứng giấy tờ xe và bảo hiểm trách nhiệm dân sự bắt buộc.',
      en ? 'A workshop check before you collect, a short orientation, and route and riding advice.' : 'Xưởng kiểm tra xe trước khi giao, hướng dẫn sử dụng, tư vấn lộ trình và cách chạy xe.',
      en ? 'Phone and workshop support during the rental if the scooter has a mechanical problem.' : 'Hỗ trợ qua điện thoại và xưởng sửa chữa nếu xe gặp sự cố trong thời gian thuê.',
    ])),
    section(en ? 'To rent' : 'Điều kiện thuê', bullets([
      en ? 'A motorcycle licence from your home country for this size of scooter, and an international driving permit with a motorcycle category recognised in Vietnam, carried together. A car licence alone does not cover a scooter.'
        : 'Bằng lái xe mô tô của nước bạn phù hợp với loại xe, và giấy phép lái xe quốc tế có hạng mô tô được công nhận tại Việt Nam, mang theo cùng nhau. Bằng lái ô tô không thay được bằng lái xe máy.',
      en ? 'Riding experience is essential. If you are unsure whether your licence fits, send the shop a copy before booking.'
        : 'Cần có kinh nghiệm lái xe máy. Nếu chưa chắc bằng lái của bạn có phù hợp, hãy gửi bản sao cho cửa hàng trước khi đặt.',
      en ? 'Open Monday to Saturday, 8:00 to 12:00 and 13:30 to 17:30.' : 'Mở cửa thứ Hai đến thứ Bảy, 8:00 đến 12:00 và 13:30 đến 17:30.',
    ])),
    en ? `Prices and terms as Saigon Scooter Centre publishes them, read ${READ_EN}.` : `Giá và điều kiện theo Saigon Scooter Centre công bố, cập nhật ${READ_VI}.`,
  ].join('\n\n')
}

// ── THE PARTNERS AND THEIR ROWS ────────────────────────────────────────────────────────────────────────────────────────────

export type MotoPartner = {
  handle: MotoPartnerHandle
  name: string
  /** eno-held login (support+<handle>@eno.vn); Cloudflare Email Routing sends it to eno's inbox. */
  email: string
  /** The storefront's address (Seller.location), as the shop's site prints it. Never in a listing text. */
  address: string
  district: string
  /** Street level (photon.komoot.io, read 2026-11-22), not a survey mark. */
  pin: { lat: number; lng: number }
  /** ~/eno-moto-partners-2026-11-22/<research>/ */
  research: string
}

export const MOTO_PARTNERS: readonly MotoPartner[] = [
  {
    handle: 'theextramile',
    name: 'The Extra Mile',
    email: 'support+theextramile@eno.vn',
    address: 'LK 3-8 Saigon Mystery Villas, 2 Đường N1, Phường Bình Trưng Tây, Thành phố Thủ Đức, Thành phố Hồ Chí Minh',
    district: 'Quận 2',
    // Đường N1-2 in the Saigon Mystery Villas compound, Bình Trưng (photon) — the street their shop sign names.
    pin: { lat: 10.77855, lng: 106.75063 },
    research: 'extramile',
  },
  {
    handle: 'saigonscootercentre',
    name: 'Saigon Scooter Centre',
    email: 'support+saigonscootercentre@eno.vn',
    address: '89 Trịnh Khắc Lập, Khu phố 1, Phường Thạnh Mỹ Lợi, Thành phố Thủ Đức, Thành phố Hồ Chí Minh',
    district: 'Quận 2',
    // Trịnh Khắc Lập street, Cát Lái (formerly Thạnh Mỹ Lợi).
    pin: { lat: 10.78071, lng: 106.75804 },
    research: 'ssc',
  },
]

export const motoPartner = (handle: string): MotoPartner | undefined => MOTO_PARTNERS.find((p) => p.handle === handle)

export type MotoPartnerRow = {
  externalId: string
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  price: number
  priceUnit: string
  currency: string
  negotiable: false
  listingType: 'rent'
  subcategorySlug: 'motorbike-rental' | 'ebike-rental'
  city: string
  district: string
  location: string
  lat: number
  lng: number
  attributes: string
  facetTokens: string | null
  searchText: string
}

function row(p: MotoPartner, o: {
  slug: string; title: string; titleVi: string; description: string; descriptionVi: string; price: number; period: 'monthly' | 'daily'
  periods: ('daily' | 'monthly')[]; subcategorySlug: MotoPartnerRow['subcategorySlug']; transmission: 'automatic' | 'manual' | null; words: string[]
}): MotoPartnerRow {
  const unit = listingMoneyFor({ categorySlug: 'rentals', listingType: 'rent', rentalPeriod: o.period })
  const attrs: Record<string, string> = { rentalPeriod: o.period }
  if (o.transmission) attrs.transmission = o.transmission
  return {
    externalId: `${p.handle}:${o.slug}`,
    title: o.title, titleVi: o.titleVi,
    description: o.description, descriptionVi: o.descriptionVi,
    price: o.price, priceUnit: unit.priceUnit, currency: '₫', negotiable: false,
    listingType: 'rent', subcategorySlug: o.subcategorySlug,
    city: 'Hồ Chí Minh', district: p.district, location: `${p.district}, Hồ Chí Minh`, ...p.pin,
    attributes: JSON.stringify(attrs),
    facetTokens: buildFacetTokens({ rentalPeriod: o.periods }),
    searchText: buildSearchText([o.title, o.titleVi, p.name, p.district, ...o.words]),
  }
}

/** One Extra Mile bike's listing row (the storefront, category, photos, rank and publish state are the script's). */
export function stageExtraMileBike(b: ExtraMileBike, fx: Fx): MotoPartnerRow {
  const p = motoPartner('theextramile')!
  const { price, period } = extraMilePrice(b, fx)
  return row(p, {
    slug: b.slug, title: extraMileTitle(b, 'en'), titleVi: extraMileTitle(b, 'vi'),
    description: extraMileDescription(b, fx, 'en'), descriptionVi: extraMileDescription(b, fx, 'vi'),
    price, period, periods: b.city ? ['daily', 'monthly'] : ['daily'],
    subcategorySlug: b.kind === 'ebike' ? 'ebike-rental' : 'motorbike-rental', transmission: b.transmission,
    words: [b.name, b.kind === 'ebike' ? 'thuê xe điện e-scooter electric rental' : 'thuê xe máy motorbike scooter rental', ...(b.road ? ['road trip phượt'] : [])],
  })
}

/** Saigon Scooter Centre's one listing row: priced at its cheapest scooter, the one its title names first. */
export function stageSscListing(fx: Fx): MotoPartnerRow {
  const p = motoPartner('saigonscootercentre')!
  return row(p, {
    slug: SSC_SLUG, title: sscTitle('en'), titleVi: sscTitle('vi'),
    description: sscDescription(fx, 'en'), descriptionVi: sscDescription(fx, 'vi'),
    price: usdToVnd(SSC_SCOOTERS[0].perDayUsd, fx.vndPerUsd), period: 'daily', periods: ['daily'],
    subcategorySlug: 'motorbike-rental', transmission: null,
    words: [...SSC_SCOOTERS.map((s) => s.name), 'vespa lambretta classic scooter thuê xe máy xe tay ga motorbike rental'],
  })
}

/** What the research file says about a bike (data.json `bikes`), for the run's consistency check. */
export type ResearchBike = {
  slug: string
  cityFirst: number | null
  cityMonth: number | null
  /** "4,000,000 VND" / "150 USD" / "NA", as the bike page prints it. */
  deposit: string | null
  roadFirstUsd: number | null
  cityTable?: { month: number; d2: number; d7: number; d14: number; waiver30: number } | null
  roadTable?: { d1: number; d7: number; d14: number; d30: number; oneWayExtra: number } | null
}

/**
 * Why a bike cannot be written from this read of the research, or null. EVERY figure the listing prints is compared, not
 * only its card price (commit-gate review, codex 2026-11-22): the first day, the month, the deposit, and each table row —
 * and a table this module prints must be the research's table for a month that agrees with the bike page.
 */
export function extraMileResearchProblem(b: ExtraMileBike, r: ResearchBike | undefined): string | null {
  const id = `theextramile:${b.slug}`
  if (!r) return `${id}: not in the research file`
  const differs = (what: string, mine: unknown, theirs: unknown) => (JSON.stringify(mine ?? null) === JSON.stringify(theirs ?? null) ? null : `${id}: ${what} — the research says ${JSON.stringify(theirs ?? null)}, this module says ${JSON.stringify(mine ?? null)}`)
  const depositVnd = r.deposit && /VND/.test(r.deposit) ? Number(r.deposit.replace(/\D/g, '')) : null
  const c = b.city
  const cityTable = r.cityTable && r.cityTable.month === r.cityMonth ? { d2: r.cityTable.d2, d7: r.cityTable.d7, d14: r.cityTable.d14, waiver30: r.cityTable.waiver30 } : null
  const roadTable = r.roadTable && r.roadTable.d1 === r.roadFirstUsd ? { d7: r.roadTable.d7, d14: r.roadTable.d14, d30: r.roadTable.d30 } : null
  return differs('a month', c?.month, r.cityMonth)
    ?? differs('the first day', c?.firstDay, r.cityFirst)
    ?? (c ? differs('the deposit', c.deposit, depositVnd) : null)
    ?? (c ? differs('the city table', c.table, cityTable) : null)
    ?? differs('a road-trip day (USD)', b.road?.firstDayUsd, r.roadFirstUsd)
    ?? (b.road ? differs('the road-trip table', b.road.table, roadTable) : null)
    ?? (b.road?.table ? differs('the one-way extra (USD)', ONE_WAY_EXTRA_USD, r.roadTable?.oneWayExtra) : null)
}

/** SSC's research (data.json `scooters`): the same three prices, or the run stops. */
export function sscResearchProblem(r: { key: string; perDayUsd: number }[] | undefined): string | null {
  for (const s of SSC_SCOOTERS) {
    const found = r?.find((x) => x.key === s.key)
    if (!found) return `saigonscootercentre: ${s.key} is not in the research file`
    if (found.perDayUsd !== s.perDayUsd) return `saigonscootercentre: the research says ${found.perDayUsd} USD a day for ${s.key}, this module says ${s.perDayUsd}`
  }
  return null
}

export type MotoPartnerSeller = { id: string; ownerId: string | null; ownerEmail: string | null; officialPartner: boolean; trustScore: number; location: string | null }

/** Why these rows must not go on this storefront, or null. Handle AND owner email AND official partner, as the car partners. */
export function motoPartnerSellerRefusal(p: MotoPartner, seller: MotoPartnerSeller | null): string | null {
  if (!seller) return `no storefront with the handle "${p.handle}" — register it first: node --env-file=.env scripts/register-partner-seller.mjs ${p.handle} --apply`
  if (!seller.ownerId) return `the "${p.handle}" storefront (${seller.id}) has no owning account — a renter's message would reach nobody`
  if ((seller.ownerEmail ?? '').toLowerCase() !== p.email) return `the "${p.handle}" storefront (${seller.id}) is owned by ${seller.ownerEmail ?? 'an account with no email'}, not ${p.email}`
  if (!seller.officialPartner) return `the "${p.handle}" storefront (${seller.id}) is not an official partner yet — run scripts/set-official-partner.mjs ${p.handle} --apply first`
  return null
}
