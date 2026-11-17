/**
 * eno's CAR RENTAL PARTNERS: five Ho Chi Minh City shops' self-drive cars, written ONCE on each shop's own storefront, then
 * the admin's to manage.
 *
 * Owner, 2026-11-17: "help me to import car rental services with prices and conditions and the shops as partners remove all
 * other car rental products since they lead to other websites. also partner shops logos make sure they have their logos
 * everywhere where its needed for all partners". Asked the same day: all 5 are partners (official badge, chat-only, home
 * strip); accounts on eno-managed emails (support+<handle>@eno.vn, not the shops' own); import all 5, every listing dated
 * as the shop published it, cars with no price left out, photos showing a contact, a price or another business dropped.
 *
 * Pure — the I/O is scripts/import-car-partners.ts. The pattern is Blvck's (src/lib/blvck-listing.ts, 2026-11-04).
 *
 * ⛔ EVERY PRICE AND TERM HERE IS THE SHOP'S OWN, READ OFF ITS SITE ON 2026-11-17 (research kept in
 * ~/eno-car-partners-2026-11-17/<shop>/data.json; `src` is the car's index there, and the importer refuses a run whose
 * research disagrees with a price below). Nothing is completed or guessed: a term the shop does not state is not printed,
 * and every listing says whose prices they are and when they were read. An Khánh's car pages are dated April 2024: said too.
 *
 * ⛔ ONLY ENGLISH AND VIETNAMESE ARE WRITTEN HERE. The nine other languages come from Reach's daily Haiku translation of
 * every live listing text (src/lib/mt-job.ts checks each row: numbers, contacts, currency), run by hand once after the
 * import. Blvck's eleven hand-written languages were 19 bikes from one shop; this is ~80 cars from five.
 *
 * ⛔ NO PHONE, LINK, EMAIL OR STREET ADDRESS IN A LISTING TEXT (assertCleanTexts refuses them, on an admin's later edit
 * too): an official partner is chat-only. The address is the storefront's (Seller.location), the pin the map's.
 *
 * ⛔ THE PRICES ARE BULLETS, NOT 'Label: value' LINES: rich-text-blocks.ts makes a table only of 3+ such lines (or 2 with
 * importer fact labels), and a shorter run is joined into ONE paragraph ("Self-drive per day: … Driver for 10 hours: …").
 * Most cars have one price, KarPlus's two; a list renders the same at any count.
 */
import { buildFacetTokens } from './facet-tokens'
import { buildSearchText } from './fold'
import { listingMoneyFor } from './taxonomy'
import { formatMoneyFull } from './vnd'

export type CarPartnerHandle = 'carbi' | 'karplus' | 'ankhanhtravel' | 'quehuong' | 'anbinhtours'
type Lang = 'en' | 'vi'
type Text = Record<Lang, string>

export type CarPartnerCar = {
  /** Unique within its shop; the listing's externalId is `<handle>:<slug>`. */
  slug: string
  /** Index of this car in the shop's research file (data.json `cars`): its photos and its price check. */
  src: number
  /** Make, model and the shop's own variant/year, as one display name (the same in both languages). */
  name: string
  seats: number | null
  transmission: 'automatic' | 'manual' | null
  /** Đồng per day, self-drive, as the shop lists it. */
  perDay: number
}

export type CarPartner = {
  handle: CarPartnerHandle
  name: string
  /** eno-held login (owner, 2026-11-17: "eno-managed emails"); Cloudflare Email Routing sends it to eno's inbox. */
  email: string
  /** The registered company as the shop's own site prints it; null where the site does not. */
  legalName: string | null
  /** The storefront's address (Seller.location): the shop's head office as its site gives it. Never in a listing text. */
  address: string
  district: string
  /** Street or ward level (photon.komoot.io, read 2026-11-17), not a survey mark. */
  pin: { lat: number; lng: number }
  /** The research folder's name (~/eno-car-partners-2026-11-17/<research>/). */
  research: string
  /** Where the prices come from, in each language: the line every listing ends on. */
  source: Text
  /** The shop's rental terms, one bullet each, only what its site states. */
  terms: { en: readonly string[]; vi: readonly string[] }
  /**
   * Why this shop is not registered or imported yet, when it is not: it stays out of the strip, the inbox and an `all` run
   * until the reason is gone. A rental needs 3 distinct photos (publish-guard.ts), and a shop's own storefront 404s while empty.
   */
  held?: string
  /** Extra price bullets after the day price, e.g. KarPlus's driver add-on. */
  extras?: (car: CarPartnerCar) => { en: string; vi: string }[]
  cars: readonly CarPartnerCar[]
}

const money = (n: number, lang: Lang) => formatMoneyFull(n, '₫', lang)
const READ_EN = '17 November 2026'
const READ_VI = '17/11/2026'

/** Shared by every shop: who may drive in Vietnam (Law 36/2024 Art. 57; eno's fact-checked IDP guide, 2026-11). */
const LICENCE: Text = {
  en: 'To drive yourself you need a licence valid in Vietnam: a Vietnamese licence, or a 1968-Convention international driving permit carried with your home licence.',
  vi: 'Tự lái cần giấy phép lái xe hợp lệ tại Việt Nam: bằng lái Việt Nam, hoặc giấy phép lái xe quốc tế theo Công ước 1968 kèm bằng lái gốc.',
}

/**
 * …and above 8 seats it is not a car licence at all: under Law 36/2024 Art. 57 class B covers up to 8 seats besides the
 * driver, and 9–16 seats needs D1 (commit-gate review, Opus 2026-11-17: Quê Hương's 16-seat Ford Transit).
 */
const LICENCE_9PLUS: Text = {
  en: 'This vehicle has more than 8 passenger seats: driving it yourself needs a class D1 licence or higher.',
  vi: 'Xe trên 8 chỗ ngồi (không kể ghế lái): tự lái cần giấy phép lái xe hạng D1 trở lên.',
}

const car = (src: number, slug: string, name: string, seats: number | null, perDay: number, transmission: 'automatic' | 'manual' | null = 'automatic'): CarPartnerCar =>
  ({ src, slug, name, seats, transmission, perDay })

export const CAR_PARTNERS: readonly CarPartner[] = [
  {
    handle: 'karplus',
    name: 'KarPlus',
    email: 'support+karplus@eno.vn',
    legalName: null,
    address: '27 Đường số 16, KDC Him Lam 6A, Bình Hưng, Bình Chánh, Thành phố Hồ Chí Minh',
    district: 'Huyện Bình Chánh',
    pin: { lat: 10.72896, lng: 106.65248 },
    research: 'karplus',
    source: { en: `Prices as KarPlus publishes them, read ${READ_EN}.`, vi: `Giá theo KarPlus công bố, cập nhật ${READ_VI}.` },
    terms: {
      en: [
        'Documents: citizen ID card and a class B driving licence or higher.',
        'Deposit: a motorbike with its original registration papers (it need not be in your name), or 20,000,000 đ in cash.',
        '400 km a day, added up over a rental of several days.',
        'A rental day runs from 19:00–21:00 the evening before to 21:00 the next day; the car can come from 16:00 if it is free.',
        'Optional scratch-and-dent cover: 20% of one day\'s price, then no charge for scratches, scrapes or dents.',
        '10% off for 3 days or more, 15% off for 7 days or more.',
      ],
      vi: [
        'Giấy tờ: căn cước công dân và giấy phép lái xe hạng B trở lên.',
        'Tài sản thế chấp: xe máy kèm cà vẹt gốc (không cần chính chủ), hoặc 20.000.000 đ tiền mặt.',
        'Giới hạn 400 km mỗi ngày, cộng dồn khi thuê nhiều ngày.',
        'Một ngày thuê tính từ 19h–21h hôm trước đến 21h hôm sau; xe trống lịch có thể giao sớm từ 16h.',
        'Bảo hiểm va quẹt tùy chọn: thêm 20% giá thuê 1 ngày, không mất thêm phí nếu trầy, xước, móp.',
        'Thuê từ 3 ngày giảm 10%, từ 7 ngày giảm 15%.',
      ],
    },
    extras: (c) => {
      const fee = c.slug === 'mercedes-c300' ? 600_000 : 500_000
      return [{ en: `With a driver: +${money(fee, 'en')} for 10 hours`, vi: `Thêm tài xế: +${money(fee, 'vi')} cho 10 tiếng` }]
    },
    cars: [
      car(0, 'ford-ecosport', 'Ford EcoSport Titanium 2017', 5, 600_000),
      car(1, 'ford-focus', 'Ford Focus Titanium 2017', 5, 600_000),
      car(2, 'honda-br-v', 'Honda BR-V L 2023', 7, 900_000),
      car(3, 'honda-civic', 'Honda Civic 1.5 Turbo 2018', 5, 900_000),
      car(4, 'honda-hr-v-l', 'Honda HR-V L 2021', 5, 900_000),
      car(5, 'honda-hr-v-g', 'Honda HR-V G 2023', 5, 1_000_000),
      car(6, 'hyundai-custin', 'Hyundai Custin Premium 2024', 7, 1_200_000),
      car(7, 'hyundai-elantra', 'Hyundai Elantra 1.6 AT 2024', 5, 900_000),
      car(8, 'hyundai-stargazer-x', 'Hyundai Stargazer X 2024', 7, 900_000),
      car(9, 'kia-carnival', 'Kia Carnival Signature 2022', 7, 2_000_000),
      car(10, 'kia-cerato', 'Kia Cerato Premium 2021', 5, 800_000),
      car(11, 'kia-sportage', 'Kia Sportage Signature 2023', 5, 1_200_000),
      car(12, 'mazda-cx-5', 'Mazda CX-5 Premium 2022', 5, 1_100_000),
      car(13, 'mazda-6', 'Mazda 6 2.0 Luxury 2021', 5, 900_000),
      car(14, 'mercedes-c300', 'Mercedes-Benz C300 AMG 2018', 5, 1_700_000),
      car(15, 'mitsubishi-xpander', 'Mitsubishi Xpander 1.5 AT 2021', 7, 800_000),
      car(16, 'suzuki-ertiga-hybrid', 'Suzuki Ertiga Hybrid 2022', 7, 800_000),
      // KarPlus lists two identical XL7s (research #17 and #18, same price): one listing, from #18's photos (#17's carry a club sticker).
      car(18, 'suzuki-xl7', 'Suzuki XL7 1.5 AT 2021', 7, 800_000),
      car(19, 'toyota-fortuner', 'Toyota Fortuner 2.7V 2021', 7, 800_000),
      car(20, 'toyota-innova', 'Toyota Innova 2.0G 2022', 7, 1_000_000),
      car(21, 'toyota-veloz-cross', 'Toyota Veloz Cross 2024', 7, 900_000),
    ],
  },
  {
    handle: 'carbi',
    name: 'Carbi',
    email: 'support+carbi@eno.vn',
    legalName: 'CÔNG TY TNHH TMDV DU LỊCH VẬN TẢI CARBI',
    address: '26 Đường 21, Phường Thông Tây Hội, Thành phố Hồ Chí Minh',
    district: 'Quận Gò Vấp',
    pin: { lat: 10.8329, lng: 106.66887 },
    research: 'carbi',
    source: { en: `Prices as Carbi publishes them, read ${READ_EN}.`, vi: `Giá theo Carbi công bố, cập nhật ${READ_VI}.` },
    terms: {
      en: [
        'Documents: ID card and a class B2 driving licence, or a motorbike with its registration papers.',
        'Low deposit (amount agreed with the shop), by bank transfer, e-wallet or cash.',
        'Delivery to your door, free within Gò Vấp; or collect the car at the office.',
      ],
      vi: [
        'Giấy tờ: CMND và bằng lái B2, hoặc xe máy kèm cà vẹt.',
        'Đặt cọc không cao (thỏa thuận với cửa hàng), chuyển khoản, ví điện tử hoặc tiền mặt.',
        'Giao xe tận nơi, miễn phí trong Gò Vấp; hoặc nhận xe tại văn phòng.',
      ],
    },
    cars: [
      car(0, 'mazda-cx-8', 'Mazda CX-8', null, 1_400_000),
      car(1, 'kia-sorento-new', 'Kia Sorento (new model)', 7, 1_500_000),
      car(2, 'kia-carnival', 'Kia Carnival', 7, 1_800_000),
      car(3, 'kia-sorento', 'Kia Sorento', 7, 1_200_000),
      car(4, 'kia-sedona', 'Kia Sedona', 7, 1_600_000),
      car(5, 'vinfast-lux-a', 'VinFast Lux A 2.0', 4, 1_000_000),
      car(6, 'vinfast-lux-a-red', 'VinFast Lux A 2.0 (red)', 4, 1_500_000),
      car(7, 'hyundai-elantra-2023', 'Hyundai Elantra 2023', 4, 1_000_000),
      car(8, 'hyundai-kona', 'Hyundai Kona', 4, 1_100_000),
      car(9, 'kia-cerato', 'Kia Cerato 2.0', 4, 900_000),
      car(10, 'mazda-3', 'Mazda 3', 4, 900_000),
      car(11, 'mazda-6', 'Mazda 6 Premium', 4, 1_300_000),
      car(12, 'honda-city', 'Honda City', 4, 800_000),
      car(13, 'mercedes-c250', 'Mercedes-Benz C250', 4, 2_500_000),
      car(14, 'mercedes-c200', 'Mercedes-Benz C200', 4, 2_400_000, null),
      car(15, 'kia-seltos', 'Kia Seltos', 5, 1_100_000, null),
      car(17, 'hyundai-elantra', 'Hyundai Elantra', 4, 900_000, null),
      car(18, 'hyundai-accent', 'Hyundai Accent', 4, 800_000, null),
      car(19, 'toyota-innova', 'Toyota Innova', 7, 1_100_000, null),
      car(20, 'toyota-fortuner', 'Toyota Fortuner', 7, 1_300_000, null),
      car(21, 'honda-cr-v', 'Honda CR-V', null, 1_300_000, null),
      car(22, 'honda-civic', 'Honda Civic', 4, 1_300_000, null),
      car(23, 'mazda-3-hatchback', 'Mazda 3 Hatchback', 4, 1_100_000, null),
      car(24, 'mazda-cx-5', 'Mazda CX-5', 5, 1_300_000, null),
      car(25, 'mitsubishi-mirage', 'Mitsubishi Mirage', 4, 600_000, null),
    ],
  },
  {
    handle: 'ankhanhtravel',
    name: 'An Khánh Travel',
    email: 'support+ankhanhtravel@eno.vn',
    legalName: 'CÔNG TY TNHH THƯƠNG MẠI VÀ VẬN TẢI DU LỊCH AN KHÁNH TRAVEL',
    address: '413/109 Lê Văn Quới, Phường Bình Trị Đông A, Quận Bình Tân, Thành phố Hồ Chí Minh',
    district: 'Quận Bình Tân',
    pin: { lat: 10.77387, lng: 106.62142 },
    research: 'ankhanh',
    source: {
      en: `Prices as An Khánh Travel publishes them on its car pages (dated April 2024), read ${READ_EN}.`,
      vi: `Giá theo An Khánh Travel công bố trên trang từng xe (đăng tháng 4/2024), cập nhật ${READ_VI}.`,
    },
    terms: {
      en: [
        'Documents: ID card, household registration book or KT3, and a class B2 driving licence or higher.',
        'Deposit agreed with the shop, in cash or by bank transfer.',
        'You pay for fuel and road tolls.',
        'Delivery to every district of Ho Chi Minh City; you can try the car before renting it.',
        'Traffic fines recorded during your rental may be charged to you afterwards.',
        'Cars from 2018 or newer, with GPS.',
      ],
      vi: [
        'Giấy tờ: CMND, sổ hộ khẩu hoặc KT3, và giấy phép lái xe hạng B2 trở lên.',
        'Đặt cọc theo thỏa thuận, tiền mặt hoặc chuyển khoản.',
        'Khách tự chi trả xăng dầu và phí cầu đường.',
        'Giao xe tại tất cả các quận huyện TP.HCM; được chạy thử trước khi thuê.',
        'Phạt nguội phát sinh trong thời gian thuê có thể được thu sau.',
        'Xe đời 2018 trở lên, có GPS định vị.',
      ],
    },
    cars: [
      car(0, 'mazda-cx-5', 'Mazda CX-5 2020', 5, 1_200_000),
      car(1, 'mazda-3', 'Mazda 3 2022', 4, 1_000_000),
      car(2, 'toyota-corolla-cross', 'Toyota Corolla Cross 2023', 5, 1_200_000),
      car(3, 'honda-civic', 'Honda Civic 2022', 5, 1_200_000),
      car(4, 'vinfast-lux-a', 'VinFast Lux A 2020', 4, 1_200_000),
      car(5, 'toyota-vios', 'Toyota Vios 2023', 4, 800_000),
      car(6, 'honda-city', 'Honda City 2020', 5, 800_000),
      car(7, 'mg-zs', 'MG ZS 2020', 5, 1_000_000),
      car(9, 'hyundai-accent', 'Hyundai Accent 2022', 4, 800_000),
      car(10, 'kia-carnival', 'Kia Carnival 2022', 7, 2_200_000),
      car(11, 'mitsubishi-xpander', 'Mitsubishi Xpander 2022', 7, 1_000_000),
      car(12, 'ford-everest', 'Ford Everest 2020', 7, 1_300_000),
      car(13, 'toyota-veloz', 'Toyota Veloz 2022', 7, 1_100_000),
      car(14, 'honda-cr-v', 'Honda CR-V 2022', 7, 1_300_000),
      car(15, 'toyota-innova', 'Toyota Innova 2019', 7, 1_000_000),
      car(16, 'mazda-cx-8', 'Mazda CX-8 2020', 7, 1_400_000),
      car(17, 'toyota-innova-venturer', 'Toyota Innova Venturer 2019', 7, 1_000_000),
    ],
  },
  {
    handle: 'quehuong',
    name: 'Quê Hương Group',
    email: 'support+quehuong@eno.vn',
    legalName: 'CÔNG TY CP TMDV QUÊ HƯƠNG',
    address: '475A Dương Thị Mười, Phường Trung Mỹ Tây, Thành phố Hồ Chí Minh',
    district: 'Quận 12',
    pin: { lat: 10.86064, lng: 106.63061 },
    research: 'thuexetulaihcm',
    source: { en: `Prices as Quê Hương Group publishes them, read ${READ_EN}.`, vi: `Giá theo Quê Hương Group công bố, cập nhật ${READ_VI}.` },
    terms: {
      en: [
        'Delivered to your home, in about 20 minutes as the shop states.',
        'Cars under 3 years old, serviced regularly.',
        'Book, sign the rental contract, collect the car; invoices for companies.',
        'Documents and deposit: ask the shop in chat (not published).',
      ],
      vi: [
        'Giao nhận xe tận nhà, khoảng 20 phút theo cửa hàng.',
        'Xe sử dụng dưới 3 năm, bảo dưỡng thường xuyên.',
        'Đặt xe, ký hợp đồng, nhận xe; có hóa đơn cho doanh nghiệp.',
        'Giấy tờ và đặt cọc: hỏi cửa hàng qua chat (chưa công bố).',
      ],
    },
    cars: [
      car(0, 'bmw-320i', 'BMW 320i 2022', 5, 2_500_000),
      car(2, 'kia-cerato', 'Kia Cerato', 4, 900_000),
      car(3, 'honda-city-top', 'Honda City Top', 4, 700_000),
      car(5, 'chevrolet-colorado', 'Chevrolet Colorado', 5, 800_000),
      car(6, 'ford-everest-4x4', 'Ford Everest 4x4 2022', 7, 1_200_000),
      car(7, 'ford-ranger', 'Ford Ranger 2022', 5, 900_000),
      car(8, 'ford-transit', 'Ford Transit', 16, 1_800_000, 'manual'),
      car(9, 'honda-civic', 'Honda Civic 2020', 5, 900_000),
      car(10, 'hyundai-elantra', 'Hyundai Elantra', 5, 1_000_000),
      car(11, 'hyundai-tucson', 'Hyundai Tucson', 5, 1_000_000),
      car(12, 'hyundai-accent', 'Hyundai Accent', 4, 750_000),
      car(13, 'kia-carnival', 'Kia Carnival', 8, 1_800_000),
      car(14, 'kia-k3', 'Kia K3 2022', 4, 900_000),
      car(15, 'kia-sedona', 'Kia Sedona', 7, 1_400_000),
      car(16, 'kia-seltos', 'Kia Seltos 2022', 5, 900_000),
      car(17, 'mazda-3', 'Mazda 3 2022', 4, 900_000),
      car(19, 'mazda-6', 'Mazda 6 2022', 5, 1_300_000),
      car(20, 'mg-5', 'MG5 2022', 5, 800_000),
      car(21, 'mg-zs', 'MG ZS', 5, 800_000),
      car(23, 'mitsubishi-outlander', 'Mitsubishi Outlander', 7, 1_000_000),
      car(31, 'mitsubishi-xpander', 'Mitsubishi Xpander 2022', 7, 800_000),
      car(25, 'nissan-navara', 'Nissan Navara 2022', 5, 900_000),
      car(26, 'peugeot-5008', 'Peugeot 5008', 7, 1_200_000),
      car(27, 'toyota-veloz', 'Toyota Veloz', 7, 900_000),
      car(28, 'toyota-vios', 'Toyota Vios', 4, 700_000),
      car(29, 'vinfast-lux-a', 'VinFast Lux A 2022', 4, 900_000),
      car(30, 'suzuki-xl7', 'Suzuki XL7', 7, 800_000),
    ],
  },
  {
    handle: 'anbinhtours',
    name: 'An Bình Tours',
    email: 'support+anbinhtours@eno.vn',
    legalName: null,
    address: '38/1 Liên khu 2-10, Phường Bình Hưng Hòa, Quận Bình Tân, Thành phố Hồ Chí Minh',
    district: 'Quận Bình Tân',
    pin: { lat: 10.78252, lng: 106.60203 },
    research: 'anbinh',
    held: 'every car on its site has ONE photo, a stock shot with a price box printed on it (2026-11-17): none reaches the 3 a rental needs — waits for the shop\'s own photos',
    source: { en: `Prices as An Bình Tours publishes them, read ${READ_EN}.`, vi: `Giá theo An Bình Tours công bố, cập nhật ${READ_VI}.` },
    terms: {
      en: [
        'Documents: ID card and a valid driving licence; a household registration book, KT3 or passport may also be asked for.',
        'Deposit: a motorbike worth over 15,000,000 đ with its original registration papers, or 10,000,000–15,000,000 đ in cash depending on the car; returned when the car comes back on time.',
        'A generous daily mileage; any extra is agreed in the contract.',
        'Sign at the office or have the car delivered to your home; delivery and return at Tân Sơn Nhất airport.',
        'Weekend prices (Friday to Sunday) may differ slightly.',
      ],
      vi: [
        'Giấy tờ: CCCD/CMND và bằng lái hợp lệ; có thể cần thêm sổ hộ khẩu, KT3 hoặc hộ chiếu.',
        'Tài sản thế chấp: xe máy trên 15.000.000 đ kèm cà vẹt gốc, hoặc 10.000.000–15.000.000 đ tiền mặt tùy dòng xe; hoàn lại khi trả xe đúng hạn.',
        'Định mức km mỗi ngày thoải mái; phụ thu nếu vượt theo thỏa thuận trong hợp đồng.',
        'Ký hợp đồng tại văn phòng hoặc giao xe tận nhà; giao nhận tại sân bay Tân Sơn Nhất.',
        'Giá cuối tuần (thứ 6 – chủ nhật) có thể chênh nhẹ.',
      ],
    },
    cars: [
      car(0, 'hyundai-accent', 'Hyundai Accent 2023', 5, 750_000),
      car(1, 'mg-5-std', 'MG5 STD 2023', 5, 800_000),
      car(2, 'kia-sonet', 'Kia Sonet 2023', 5, 800_000),
      car(3, 'mg-5-lux', 'MG5 Lux 2023', 5, 850_000),
      car(4, 'kia-cerato', 'Kia Cerato 2021', 5, 850_000),
      car(5, 'mg-zs', 'MG ZS 2023', 5, 850_000),
      car(6, 'mazda-3', 'Mazda 3 Luxury 2023', 5, 950_000),
      car(7, 'kia-k3', 'Kia K3 2.0 Premium 2022', 5, 950_000),
      car(8, 'peugeot-2008', 'Peugeot 2008', 5, 1_000_000),
      car(9, 'vinfast-lux-a', 'VinFast Lux A 2.0 Turbo 2022', 5, 1_000_000),
      car(10, 'mitsubishi-xpander-eco', 'Mitsubishi Xpander Eco 2023', 7, 850_000),
      car(11, 'hyundai-stargazer', 'Hyundai Stargazer 2023', 7, 900_000),
      car(12, 'mitsubishi-xpander-cross', 'Mitsubishi Xpander Cross 2022', 7, 900_000),
      car(13, 'mitsubishi-outlander', 'Mitsubishi Outlander 2022', 7, 1_000_000),
      car(14, 'honda-cr-v', 'Honda CR-V 2022', 7, 1_200_000),
      car(15, 'mitsubishi-pajero-sport', 'Mitsubishi Pajero Sport 2022', 7, 1_200_000),
      car(16, 'hyundai-custin', 'Hyundai Custin 2023', 7, 1_300_000),
      car(17, 'mazda-cx-8', 'Mazda CX-8 2022', 7, 1_300_000),
      car(18, 'kia-carnival', 'Kia Carnival Premium 2023', 8, 1_700_000),
    ],
  },
]

export const carPartner = (handle: string): CarPartner | undefined => CAR_PARTNERS.find((p) => p.handle === handle)

/** One car's title. */
export function carTitle(c: CarPartnerCar, lang: Lang): string {
  if (lang === 'vi') return `Cho thuê xe tự lái ${c.name}${c.seats ? ` ${c.seats} chỗ` : ''}`
  return `${c.name} self-drive rental${c.seats ? ` (${c.seats} seats)` : ''}`
}

const section = (heading: string, lines: readonly string[]) => `# ${heading}\n${lines.join('\n')}`
const bullets = (items: readonly string[]) => items.map((i) => `- ${i}`)

/** One car's description: what it is, its price lines, the shop's terms, and whose prices they are. */
export function carDescription(p: CarPartner, c: CarPartnerCar, lang: Lang): string {
  const spec = lang === 'en'
    ? [c.seats ? `${c.seats} seats` : null, c.transmission].filter(Boolean).join(', ')
    : [c.seats ? `${c.seats} chỗ` : null, c.transmission ? (c.transmission === 'automatic' ? 'số tự động' : 'số sàn') : null].filter(Boolean).join(', ')
  const intro = lang === 'en'
    ? `${c.name}${spec ? ` (${spec})` : ''} for self-drive rental from ${p.name} in Ho Chi Minh City. Message the shop here on eno to check availability and book.`
    : `Cho thuê xe tự lái ${c.name}${spec ? ` (${spec})` : ''} tại ${p.name}, TP. Hồ Chí Minh. Nhắn tin cho cửa hàng ngay trên eno để kiểm tra lịch xe và đặt xe.`
  const prices = [
    lang === 'en' ? `Self-drive: ${money(c.perDay, 'en')} a day` : `Tự lái: ${money(c.perDay, 'vi')}/ngày`,
    ...(p.extras?.(c) ?? []).map((x) => x[lang]),
  ]
  return [
    intro,
    section(lang === 'en' ? 'Price' : 'Giá thuê', bullets(prices)),
    section(lang === 'en' ? 'To rent' : 'Điều kiện thuê', bullets([...p.terms[lang], LICENCE[lang], ...(c.seats && c.seats > 9 ? [LICENCE_9PLUS[lang]] : [])])),
    p.source[lang],
  ].join('\n\n')
}

export type CarPartnerRow = {
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
  subcategorySlug: 'car-rental'
  city: string
  district: string
  location: string
  lat: number
  lng: number
  attributes: string
  facetTokens: string | null
  searchText: string
}

/** Folded seats facet values the rentals category defines (as vehicle-rental-listing.ts seatsValue). */
function seatsValue(n: number | null): string | null {
  if (n === 4 || n === 5 || n === 7) return String(n)
  return n !== null && n >= 9 ? '9plus' : null
}

/** The listing row of one car (the storefront, category, photos, rank and publish state are the script's). */
export function stageCarPartnerCar(p: CarPartner, c: CarPartnerCar): CarPartnerRow {
  const unit = listingMoneyFor({ categorySlug: 'rentals', listingType: 'rent', rentalPeriod: 'daily' })
  const title = carTitle(c, 'en')
  const titleVi = carTitle(c, 'vi')
  const attrs: Record<string, string> = { rentalPeriod: 'daily' }
  if (c.transmission) attrs.transmission = c.transmission
  const seats = seatsValue(c.seats)
  if (seats) attrs.seats = seats
  return {
    externalId: `${p.handle}:${c.slug}`,
    title, titleVi,
    description: carDescription(p, c, 'en'),
    descriptionVi: carDescription(p, c, 'vi'),
    price: c.perDay,
    priceUnit: unit.priceUnit,
    currency: '₫',
    negotiable: false,
    listingType: 'rent',
    subcategorySlug: 'car-rental',
    city: 'Hồ Chí Minh',
    district: p.district,
    location: `${p.district}, Hồ Chí Minh`,
    ...p.pin,
    attributes: JSON.stringify(attrs),
    facetTokens: buildFacetTokens({ rentalPeriod: ['daily'] }),
    searchText: buildSearchText([title, titleVi, c.name, p.name, p.district, 'thuê xe tự lái ô tô car rental self-drive']),
  }
}

/** What the research file says about one car, for the run's consistency check. */
export type ResearchCar = { model: string; selfDrive?: { perDay?: number | null } | null; photoFiles?: string[] | null }

/** Letters and digits only, lower case, no marks: "MG 5 2022" and "MG5 2022" read the same. */
/** Words a shop's site puts beside a model that are not the model (squashed): chỗ, xe, hoa, gầm cao, mới, đời. */
const MODEL_FILLER = new Set(['cho', 'xe', 'hoa', 'gam', 'cao', 'moi', 'doi', 'new'])
const squash = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Why a car cannot be written from this read of the research, or null: a moved price means the tables here are stale, and a
 * research row naming another car means `src` points at the wrong row — its PHOTOS would go on this listing (commit-gate
 * review, Opus 2026-11-17: many cars share a price, so the price alone cannot tell). The research's model words (3+ letters,
 * notes and filler aside) must all be in this car's name.
 */
export function carResearchProblem(p: CarPartner, c: CarPartnerCar, r: ResearchCar | undefined): string | null {
  if (!r) return `${p.handle}:${c.slug}: no car #${c.src} in the research file`
  const name = squash(c.name)
  // The model's own words: the research's notes in brackets ("(ghi 'INOVA VENTUNER')") and Vietnamese filler ("16 CHỔ",
  // "Gầm Cao") are not the model; every word left must be in this car's name.
  const words = r.model.replace(/\([^)]*\)/g, ' ').split(/[^\p{L}\p{N}]+/u).map(squash)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !MODEL_FILLER.has(w))
  if (words.some((w) => !name.includes(w))) {
    return `${p.handle}:${c.slug}: research row #${c.src} is "${r.model}", not "${c.name}" — the research file was reordered`
  }
  const day = r.selfDrive?.perDay ?? null
  if (day !== c.perDay) return `${p.handle}:${c.slug}: the research says ${day} đ/day for "${r.model}", this module says ${c.perDay}`
  return null
}

export type CarPartnerSeller = { id: string; ownerId: string | null; ownerEmail: string | null; officialPartner: boolean; trustScore: number; location: string | null }

/** Why these rows must not go on this storefront, or null. Handle AND owner email AND chat-only, as blvckSellerRefusal. */
export function carPartnerSellerRefusal(p: CarPartner, seller: CarPartnerSeller | null): string | null {
  if (!seller) return `no storefront with the handle "${p.handle}" — register it first: node --env-file=.env scripts/register-partner-seller.mjs ${p.handle} --apply`
  if (!seller.ownerId) return `the "${p.handle}" storefront (${seller.id}) has no owning account — a renter's message would reach nobody`
  if ((seller.ownerEmail ?? '').toLowerCase() !== p.email) return `the "${p.handle}" storefront (${seller.id}) is owned by ${seller.ownerEmail ?? 'an account with no email'}, not ${p.email}`
  if (!seller.officialPartner) return `the "${p.handle}" storefront (${seller.id}) is not an official partner yet — run scripts/set-official-partner.mjs ${p.handle} --apply first`
  return null
}
