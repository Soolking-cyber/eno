/**
 * Blvck Motorbike (thuexemaysaigon.vn) → eno: the partner's 19 rental bikes, written ONCE, then theirs to manage.
 *
 * Owner, 2026-11-04: "https://thuexemaysaigon.vn/ eno.vn lets remove all motorbike rentals and add properly the from this
 * partner, create account with their email hand me password so our admin can manage listings remove all fetched
 * motorbike rental listings" · "also add info [their price table] about each bikes rental terms and price per length of
 * rental should look minimal sleek" · "and conditions they mention in all languages".
 *
 * Pure — the I/O is scripts/import-blvck.ts.
 *
 * ⛔ THE PRICES ARE READ OFF THE PARTNER'S OWN IMAGES, because their site has them nowhere else: each bike page embeds one
 * class table (xe-so, xe-50cc, xe-tay-ga, xe-tay-ga-xin, xe-con-tay, sh-150 under wp-content/uploads/2024/05/), and
 * /bang-gia-thue-xe-may-sai-gon-tp-hcm/ embeds the one-day price of all 19. Read 2026-11-04. The store feed's price must
 * agree with the first tier (blvckFeedProblem) or the run stops: a moved price means these tables are out of date.
 * The two big bikes have no class table and a 0 in the feed: their one price is the /bang-gia image's, and their terms
 * are only what their own page says. The cash-free and foreigner lines of the class tables are NOT printed on them.
 *
 * ⛔ THE TEXT IS HAND-WRITTEN IN ALL 11 LANGUAGES, NOT THE FEED'S. The feed's description is ~4,000 characters of SEO copy
 * ("many rental companies offer…") with the partner's phone number on top. An official partner's contact path is eno's
 * chat, so no phone, email, link or street address appears in a listing (assertCleanTexts refuses those, on an admin's
 * later edit too — the address lives on the storefront, Seller.location).
 *
 * ⛔ THE TIER LABELS HAVE A SHAPE. rich-text-blocks.ts makes a table of 'Label: value' lines only when the label starts
 * with a LETTER, holds no punctuation but / & . ' - and the colon is an ASCII one followed by a space. "1-2 days" or
 * "1〜2日：" would collapse into one run-on paragraph, in that language only — blvck-listing.test.ts pins every language.
 */
import { buildFacetTokens } from './facet-tokens'
import { buildSearchText } from './fold'
import { listingMoneyFor } from './taxonomy'
import { formatMoneyFull, moneyLocale } from './vnd'

export const BLVCK_HANDLE = 'blvck'
export const BLVCK_EMAIL = 'thuexemaysaigonblvck@gmail.com'
export const BLVCK_NAME = 'Blvck Motorbike'
/** As the partner's footer states it — on the storefront only (see the header). */
export const BLVCK_ADDRESS = '57 Pasteur, Bến Nghé, Quận 1, Thành phố Hồ Chí Minh'
/**
 * Street level, not a survey mark. photon.komoot.io has no #57; it has #44 Pasteur (10.7712979, 106.7024) and #94B Pasteur
 * (10.7774316, 106.6979294), read 2026-11-04, and this interpolates between them — scripts/pin-partner-offices.ts's method.
 */
export const BLVCK_PIN = { lat: 10.77289, lng: 106.70124 }
export const BLVCK_PHOTO_FLOOR = { minShortEdge: 300 }
/** The rentals publish floor (publish-guard minPhotosFor). */
export const BLVCK_MIN_PHOTOS = 3
export const BLVCK_FEED_URL = 'https://thuexemaysaigon.vn/wp-json/wc/store/v1/products?per_page=50'
/** Their published logo. The rider only: its cream "BLVCK" wordmark is invisible on the white an avatar is flattened onto. */
export const BLVCK_LOGO_URL = 'https://thuexemaysaigon.vn/wp-content/uploads/2024/05/Black_Retro_Motorcycle_Circle_Logo__1_-removebg-preview.png'
export const BLVCK_LOGO_RIDER = { left: 0, top: 0, width: 500, height: 395 }

export type BlvckLang = 'en' | 'vi' | 'zh-Hans' | 'ko' | 'ja' | 'ru' | 'km' | 'ms' | 'th' | 'fr' | 'hi'
/** The languages stored in the Translation cache; en and vi are the row's own columns. */
export const BLVCK_CACHED_LANGS: readonly BlvckLang[] = ['zh-Hans', 'ko', 'ja', 'ru', 'km', 'ms', 'th', 'fr', 'hi']

type Kind = 'scooter' | 'semi' | 'clutch' | 'electric' | 'bigbike'
/** Đồng per day for: 1-2 days, 3-15 days, over 15 days, 1 month. */
type Tiers = readonly [number, number, number, number]
/** The class table's cash deposit: from `from`, or from `from` to `to`. */
type Deposit = { from: number; to?: number }

const TIER_SO: Tiers = [100_000, 80_000, 70_000, 50_000]
const TIER_GA: Tiers = [150_000, 120_000, 100_000, 80_000]
const TIER_GA_XIN: Tiers = [300_000, 250_000, 200_000, 180_000]
const TIER_CON_TAY: Tiers = [250_000, 200_000, 150_000, 120_000]
const TIER_SH_150: Tiers = [500_000, 400_000, 350_000, 300_000]
const DEPOSIT_1M: Deposit = { from: 1_000_000 }
const DEPOSIT_2M: Deposit = { from: 2_000_000 }
const DEPOSIT_3_5M: Deposit = { from: 3_000_000, to: 5_000_000 }
const DEPOSIT_10M: Deposit = { from: 10_000_000 }

export type BlvckBike = {
  /** The bike's slug on thuexemaysaigon.vn — the feed's key, and the row's externalId tail. */
  slug: string
  name: string
  kind: Kind
  perDay: number
  tiers: Tiers | null
  deposit: Deposit | null
}
const classed = (slug: string, name: string, kind: Kind, tiers: Tiers, deposit: Deposit): BlvckBike => ({ slug, name, kind, perDay: tiers[0], tiers, deposit })
const bigBike = (slug: string, name: string): BlvckBike => ({ slug, name, kind: 'bigbike', perDay: 1_500_000, tiers: null, deposit: null })

export const BLVCK_BIKES: readonly BlvckBike[] = [
  classed('honda-wave-alpha', 'Honda Wave Alpha', 'semi', TIER_SO, DEPOSIT_1M),
  classed('honda-wave-rsx', 'Honda Wave RSX', 'semi', TIER_SO, DEPOSIT_1M),
  classed('honda-wave-blade', 'Honda Wave Blade', 'semi', TIER_SO, DEPOSIT_1M),
  // ⚠️ "Yamaha Surius" on their site; the model is the Sirius (their own search box says so).
  classed('yamaha-surius', 'Yamaha Sirius', 'semi', TIER_SO, DEPOSIT_1M),
  classed('honda-cub-50cc', 'Honda Cub 50cc', 'semi', TIER_SO, DEPOSIT_1M),
  classed('honda-vision', 'Honda Vision', 'scooter', TIER_GA, DEPOSIT_1M),
  classed('thue-xe-may-honda-air-blade', 'Honda Air Blade', 'scooter', TIER_GA, DEPOSIT_1M),
  classed('honda-lead', 'Honda Lead', 'scooter', TIER_GA, DEPOSIT_1M),
  classed('yamaha-janus', 'Yamaha Janus', 'scooter', TIER_GA, DEPOSIT_1M),
  classed('yamaha-nouvo', 'Yamaha Nouvo', 'scooter', TIER_GA, DEPOSIT_1M),
  classed('vinfast-evo-200', 'VinFast Evo 200', 'electric', TIER_GA, DEPOSIT_1M),
  classed('honda-vario', 'Honda Vario', 'scooter', TIER_GA_XIN, DEPOSIT_3_5M),
  classed('piaggio-vespa', 'Piaggio Vespa', 'scooter', TIER_GA_XIN, DEPOSIT_3_5M),
  classed('honda-sh-mode', 'Honda SH Mode', 'scooter', TIER_GA_XIN, DEPOSIT_3_5M),
  classed('honda-winner', 'Honda Winner', 'clutch', TIER_CON_TAY, DEPOSIT_2M),
  classed('yamaha-exciter', 'Yamaha Exciter', 'clutch', TIER_CON_TAY, DEPOSIT_2M),
  classed('honda-sh-150cc', 'Honda SH 150cc', 'scooter', TIER_SH_150, DEPOSIT_10M),
  bigBike('kawasaki-z1000', 'Kawasaki Z1000'),
  bigBike('bmw-s1000rr', 'BMW S1000RR'),
]

const TRANSMISSION: Record<Kind, 'automatic' | 'manual'> = { scooter: 'automatic', electric: 'automatic', semi: 'manual', clutch: 'manual', bigbike: 'manual' }

type Copy = {
  types: Record<Kind, string>
  title: (name: string, type: string) => string
  intro: (name: string, type: string) => string
  priceHeading: string
  tierLabels: readonly [string, string, string, string]
  perDay: (price: string) => string
  rentHeading: string
  /** The class table's first line, with the deposit phrase. */
  docs: (deposit: string) => string
  depositFrom: (price: string) => string
  depositRange: (from: string, to: string) => string
  noDeposit: string
  foreigners: string
  includedHeading: string
  helmetsOil: string
  support: string
  deliveryHeading: string
  deliveryHours: string
  deliveryFree: string
  deliveryAfter: string
  // The big bikes' own page: no class table.
  bigDocs: string
  bigDeposit: string
  bigLicence: string
  bigHelmets: string
}

/** Every price as the site prints it (vnd.ts): "150,000 đ", and "150.000 đ" in Vietnamese. */
export const blvckMoney = (n: number, lang: BlvckLang) => formatMoneyFull(n, '₫', moneyLocale(lang))

export const BLVCK_COPY: Record<BlvckLang, Copy> = {
  en: {
    types: { scooter: 'automatic scooter', semi: 'semi-automatic', clutch: 'manual clutch', electric: 'electric scooter', bigbike: 'big bike' },
    title: (name, type) => `${name} for rent · ${type}`,
    intro: (name, type) => `${name} (${type}) from Blvck Motorbike in District 1, Ho Chi Minh City. Message the shop here on eno to check availability and book.`,
    priceHeading: 'Price by rental length',
    tierLabels: ['Rent 1-2 days', 'Rent 3-15 days', 'Over 15 days', 'One month'],
    perDay: (p) => `${p}/day`,
    rentHeading: 'To rent',
    docs: (d) => `ID card and driving licence, plus a cash deposit ${d}, depending on the bike. The deposit is refunded in full when you return it.`,
    depositFrom: (p) => `from ${p}`,
    depositRange: (a, b) => `from ${a} to ${b}`,
    noDeposit: 'No cash deposit: ID card with household registration, or ID card with a car driving licence.',
    foreigners: 'Foreigners: leave your original passport.',
    includedHeading: 'Included',
    helmetsOil: '2 helmets and free oil changes.',
    support: 'Warranty support, advice and roadside rescue during your rental.',
    deliveryHeading: 'Delivery',
    deliveryHours: 'To inner-city districts of Ho Chi Minh City, 8am to 8pm, for a fee agreed in advance.',
    deliveryFree: 'Free on rentals over 10 days.',
    deliveryAfter: 'Outside those hours, collect and return the bike at the shop.',
    bigDocs: 'ID card or another photo ID, such as a driving licence or passport.',
    bigDeposit: 'A deposit is required when you collect the bike and refunded in full when you return it. It can be negotiated in advance.',
    bigLicence: 'A valid class A or A2 motorcycle licence.',
    bigHelmets: '2 helmets.',
  },
  vi: {
    types: { scooter: 'xe ga', semi: 'xe số', clutch: 'xe côn tay', electric: 'xe điện', bigbike: 'xe phân khối lớn' },
    title: (name, type) => `Cho thuê ${name} · ${type}`,
    intro: (name, type) => `${name} (${type}) của Blvck Motorbike tại Quận 1, TP. Hồ Chí Minh. Nhắn tin cho cửa hàng ngay trên eno để hỏi xe trống và đặt xe.`,
    priceHeading: 'Giá theo thời gian thuê',
    tierLabels: ['Từ 1 đến 2 ngày', 'Từ 3 đến 15 ngày', 'Trên 15 ngày', 'Thuê 1 tháng'],
    perDay: (p) => `${p}/ngày`,
    rentHeading: 'Thủ tục',
    docs: (d) => `Chứng minh hoặc thẻ căn cước, giấy phép lái xe kèm tiền cọc ${d} (tùy dòng xe). Hoàn đủ cọc khi trả xe.`,
    depositFrom: (p) => `từ ${p}`,
    depositRange: (a, b) => `từ ${a} đến ${b}`,
    noDeposit: 'Không cần cọc tiền: chứng minh hoặc thẻ căn cước kèm hộ khẩu, hoặc chứng minh kèm bằng lái ô tô.',
    foreigners: 'Người nước ngoài: gửi hộ chiếu gốc.',
    includedHeading: 'Đi kèm',
    helmetsOil: '2 nón bảo hiểm và thay nhớt miễn phí.',
    support: 'Hỗ trợ bảo hành, tư vấn và cứu hộ trong thời gian thuê xe.',
    deliveryHeading: 'Giao xe',
    deliveryHours: 'Đến các quận nội thành TP. Hồ Chí Minh, từ 8h đến 20h, có phí (thỏa thuận trước).',
    deliveryFree: 'Miễn phí khi thuê trên 10 ngày.',
    deliveryAfter: 'Ngoài khung giờ trên, vui lòng đến cửa hàng để thuê hoặc trả xe.',
    bigDocs: 'Căn cước công dân hoặc giấy tờ tùy thân khác có ảnh (giấy phép lái xe, hộ chiếu…).',
    bigDeposit: 'Bắt buộc cọc thế chân khi nhận xe, hoàn đủ cọc khi trả xe (có thể thương lượng trước).',
    bigLicence: 'Giấy phép lái xe hợp lệ hạng A hoặc A2.',
    bigHelmets: '2 nón bảo hiểm.',
  },
  'zh-Hans': {
    types: { scooter: '自动踏板车', semi: '半自动', clutch: '手动离合', electric: '电动踏板车', bigbike: '大排量摩托车' },
    title: (name, type) => `${name} 出租 · ${type}`,
    intro: (name, type) => `${name}（${type}），由胡志明市第一郡的 Blvck Motorbike 提供。请在 eno 上直接发消息给店家，查询是否有车并预订。`,
    priceHeading: '按租期计价',
    tierLabels: ['租期 1-2 天', '租期 3-15 天', '租期超过 15 天', '租期 1 个月'],
    perDay: (p) => `${p}/天`,
    rentHeading: '租车手续',
    docs: (d) => `身份证和驾驶证，外加现金押金 ${d}（视车型而定）。还车时全额退还押金。`,
    depositFrom: (p) => `${p} 起`,
    depositRange: (a, b) => `${a} 至 ${b}`,
    noDeposit: '免现金押金：身份证加户口本，或身份证加汽车驾驶证。',
    foreigners: '外国人：需留存护照原件。',
    includedHeading: '包含服务',
    helmetsOil: '2 顶头盔和免费更换机油。',
    support: '租车期间提供保修支持、咨询和道路救援。',
    deliveryHeading: '送车服务',
    deliveryHours: '早上 8 点至晚上 8 点送车到胡志明市内城各郡，需付费（事先商定）。',
    deliveryFree: '租期超过 10 天免费送车。',
    deliveryAfter: '其他时间请到店取车和还车。',
    bigDocs: '身份证或其他带照片的证件（驾驶证、护照等）。',
    bigDeposit: '取车时须支付押金，还车时全额退还（可事先协商）。',
    bigLicence: '有效的 A 或 A2 级摩托车驾照。',
    bigHelmets: '2 顶头盔。',
  },
  ko: {
    types: { scooter: '자동 스쿠터', semi: '반자동', clutch: '수동 클러치', electric: '전기 스쿠터', bigbike: '대형 오토바이' },
    title: (name, type) => `${name} 렌털 · ${type}`,
    intro: (name, type) => `${name}(${type}), 호치민시 1군의 Blvck Motorbike에서 제공합니다. eno에서 바로 매장에 메시지를 보내 대여 가능 여부를 확인하고 예약하세요.`,
    priceHeading: '대여 기간별 요금',
    tierLabels: ['대여 1-2일', '대여 3-15일', '대여 15일 초과', '대여 1개월'],
    perDay: (p) => `1일 ${p}`,
    rentHeading: '대여 조건',
    docs: (d) => `신분증과 운전면허증, 그리고 현금 보증금 ${d}(차종에 따라 다름). 보증금은 반납 시 전액 환불됩니다.`,
    depositFrom: (p) => `${p}부터`,
    depositRange: (a, b) => `${a}~${b}`,
    noDeposit: '현금 보증금 없이: 신분증과 거주 등록부(Hộ khẩu), 또는 신분증과 자동차 운전면허증.',
    foreigners: '외국인: 여권 원본을 맡겨야 합니다.',
    includedHeading: '포함 사항',
    helmetsOil: '헬멧 2개와 무료 엔진오일 교환.',
    support: '대여 기간 중 보증 지원, 상담, 긴급 출동 서비스.',
    deliveryHeading: '배달',
    deliveryHours: '오전 8시부터 오후 8시까지 호치민시 시내 구역으로 배달, 유료(사전 협의).',
    deliveryFree: '10일 초과 대여 시 무료.',
    deliveryAfter: '그 외 시간에는 매장에서 직접 수령하고 반납해 주세요.',
    bigDocs: '신분증 또는 사진이 있는 다른 신분 서류(운전면허증, 여권 등).',
    bigDeposit: '차량 수령 시 보증금이 필요하며 반납 시 전액 환불됩니다(사전 협의 가능).',
    bigLicence: '유효한 A 또는 A2 등급 오토바이 면허.',
    bigHelmets: '헬멧 2개.',
  },
  ja: {
    types: { scooter: 'オートマチックスクーター', semi: 'セミオートマチック', clutch: 'マニュアルクラッチ', electric: '電動スクーター', bigbike: '大型バイク' },
    title: (name, type) => `${name} レンタル · ${type}`,
    intro: (name, type) => `${name}（${type}）。ホーチミン市1区の Blvck Motorbike が提供します。空き状況の確認とご予約は、eno のメッセージからお店へどうぞ。`,
    priceHeading: 'レンタル期間別の料金',
    tierLabels: ['レンタル 1-2日', 'レンタル 3-15日', 'レンタル 15日超', 'レンタル 1か月'],
    perDay: (p) => `1日 ${p}`,
    rentHeading: 'レンタル条件',
    docs: (d) => `身分証明書と運転免許証、および現金の保証金 ${d}（車種により異なります）。保証金は返却時に全額返金されます。`,
    depositFrom: (p) => `${p}から`,
    depositRange: (a, b) => `${a}〜${b}`,
    noDeposit: '現金の保証金なしの場合：身分証明書と世帯登録簿（Hộ khẩu）、または身分証明書と自動車運転免許証。',
    foreigners: '外国人の方：パスポート原本をお預けいただきます。',
    includedHeading: '含まれるもの',
    helmetsOil: 'ヘルメット2個と無料のオイル交換。',
    support: 'レンタル期間中の保証サポート、相談、ロードサービス。',
    deliveryHeading: '配車',
    deliveryHours: '午前8時から午後8時まで、ホーチミン市内の各区へ配車します（有料、事前に相談）。',
    deliveryFree: '10日を超えるレンタルの場合、配車は無料です。',
    deliveryAfter: 'それ以外の時間は、店舗で受け取りと返却をお願いします。',
    bigDocs: '身分証明書または写真付きの身分証（運転免許証、パスポートなど）。',
    bigDeposit: '受け取り時に保証金が必要で、返却時に全額返金されます（事前に相談可）。',
    bigLicence: '有効な A または A2 クラスのバイク免許。',
    bigHelmets: 'ヘルメット2個。',
  },
  ru: {
    types: { scooter: 'скутер-автомат', semi: 'полуавтомат', clutch: 'механика со сцеплением', electric: 'электроскутер', bigbike: 'мощный мотоцикл' },
    title: (name, type) => `${name} в аренду · ${type}`,
    intro: (name, type) => `${name} (${type}) от Blvck Motorbike в районе 1, Хошимин. Напишите магазину здесь, на eno, чтобы уточнить наличие и забронировать.`,
    priceHeading: 'Цена по сроку аренды',
    tierLabels: ['На 1-2 дня', 'На 3-15 дней', 'Более 15 дней', 'Один месяц'],
    perDay: (p) => `${p}/день`,
    rentHeading: 'Условия аренды',
    docs: (d) => `Удостоверение личности и водительские права, а также денежный залог ${d} в зависимости от модели. Залог полностью возвращается при возврате мотоцикла.`,
    depositFrom: (p) => `от ${p}`,
    depositRange: (a, b) => `от ${a} до ${b}`,
    noDeposit: 'Без денежного залога: удостоверение личности с книгой регистрации по месту жительства (Hộ khẩu) или удостоверение личности с автомобильными правами.',
    foreigners: 'Иностранцы: оставляют оригинал паспорта.',
    includedHeading: 'Включено',
    helmetsOil: '2 шлема и бесплатная замена масла.',
    support: 'Гарантийная поддержка, консультации и помощь на дороге на весь срок аренды.',
    deliveryHeading: 'Доставка',
    deliveryHours: 'В городские районы Хошимина, с 8 утра до 8 вечера, платно (стоимость согласуется заранее).',
    deliveryFree: 'Бесплатно при аренде более чем на 10 дней.',
    deliveryAfter: 'В другое время забирайте и возвращайте мотоцикл в магазине.',
    bigDocs: 'Удостоверение личности или другой документ с фото (водительские права, паспорт и т. д.).',
    bigDeposit: 'Залог обязателен при получении и полностью возвращается при возврате мотоцикла (можно обсудить заранее).',
    bigLicence: 'Действующие мотоциклетные права категории A или A2.',
    bigHelmets: '2 шлема.',
  },
  km: {
    types: { scooter: 'ស្កូទ័រស្វ័យប្រវត្តិ', semi: 'ពាក់កណ្តាលស្វ័យប្រវត្តិ', clutch: 'ក្លាច់ដៃ', electric: 'ស្កូទ័រអគ្គិសនី', bigbike: 'ម៉ូតូធំ' },
    title: (name, type) => `ជួល ${name} · ${type}`,
    intro: (name, type) => `${name} (${type}) ពី Blvck Motorbike នៅខណ្ឌ 1 ទីក្រុងហូជីមិញ។ ផ្ញើសារទៅហាងនៅលើ eno ដើម្បីពិនិត្យម៉ូតូទំនេរ និងកក់។`,
    priceHeading: 'តម្លៃតាមរយៈពេលជួល',
    tierLabels: ['ជួល 1-2 ថ្ងៃ', 'ជួល 3-15 ថ្ងៃ', 'ជួលលើស 15 ថ្ងៃ', 'ជួល 1 ខែ'],
    perDay: (p) => `${p}/ថ្ងៃ`,
    rentHeading: 'លក្ខខណ្ឌជួល',
    docs: (d) => `អត្តសញ្ញាណប័ណ្ណ និងប័ណ្ណបើកបរ ព្រមទាំងប្រាក់កក់ ${d} អាស្រ័យលើប្រភេទម៉ូតូ។ ប្រាក់កក់នឹងប្រគល់ជូនវិញទាំងស្រុងពេលប្រគល់ម៉ូតូ។`,
    depositFrom: (p) => `ចាប់ពី ${p}`,
    depositRange: (a, b) => `ពី ${a} ដល់ ${b}`,
    noDeposit: 'គ្មានប្រាក់កក់៖ អត្តសញ្ញាណប័ណ្ណ និងសៀវភៅស្នាក់នៅ (Hộ khẩu) ឬអត្តសញ្ញាណប័ណ្ណ និងប័ណ្ណបើកបររថយន្ត។',
    foreigners: 'ជនបរទេស៖ ត្រូវទុកលិខិតឆ្លងដែនច្បាប់ដើម។',
    includedHeading: 'រួមបញ្ចូល',
    helmetsOil: 'មួកសុវត្ថិភាព 2 និងប្តូរប្រេងម៉ាស៊ីនដោយឥតគិតថ្លៃ។',
    support: 'ជំនួយការធានា ការប្រឹក្សា និងការសង្គ្រោះតាមផ្លូវ ក្នុងពេលជួល។',
    deliveryHeading: 'ការដឹកជញ្ជូន',
    deliveryHours: 'ទៅខណ្ឌក្នុងក្រុងហូជីមិញ ពីម៉ោង 8 ព្រឹកដល់ 8 យប់ មានគិតថ្លៃ (ព្រមព្រៀងជាមុន)។',
    deliveryFree: 'ឥតគិតថ្លៃ នៅពេលជួលលើស 10 ថ្ងៃ។',
    deliveryAfter: 'ក្រៅម៉ោងនេះ សូមមកទទួល និងប្រគល់ម៉ូតូនៅហាង។',
    bigDocs: 'អត្តសញ្ញាណប័ណ្ណ ឬឯកសារមានរូបថតផ្សេងទៀត (ប័ណ្ណបើកបរ លិខិតឆ្លងដែន...)។',
    bigDeposit: 'ត្រូវមានប្រាក់កក់ពេលទទួលម៉ូតូ ហើយប្រគល់ជូនវិញទាំងស្រុងពេលប្រគល់ម៉ូតូ (អាចចរចាជាមុន)។',
    bigLicence: 'ប័ណ្ណបើកបរម៉ូតូប្រភេទ A ឬ A2 ដែលមានសុពលភាព។',
    bigHelmets: 'មួកសុវត្ថិភាព 2។',
  },
  ms: {
    types: { scooter: 'skuter automatik', semi: 'separa automatik', clutch: 'manual klac', electric: 'skuter elektrik', bigbike: 'motosikal berkuasa tinggi' },
    title: (name, type) => `${name} untuk disewa · ${type}`,
    intro: (name, type) => `${name} (${type}) daripada Blvck Motorbike di Daerah 1, Bandar Raya Ho Chi Minh. Hantar mesej kepada kedai di eno untuk menyemak ketersediaan dan membuat tempahan.`,
    priceHeading: 'Harga ikut tempoh sewa',
    tierLabels: ['Sewa 1-2 hari', 'Sewa 3-15 hari', 'Lebih 15 hari', 'Satu bulan'],
    perDay: (p) => `${p}/hari`,
    rentHeading: 'Syarat sewa',
    docs: (d) => `Kad pengenalan dan lesen memandu, serta deposit tunai ${d} mengikut model. Deposit dipulangkan sepenuhnya semasa motosikal dipulangkan.`,
    depositFrom: (p) => `dari ${p}`,
    depositRange: (a, b) => `dari ${a} hingga ${b}`,
    noDeposit: 'Tanpa deposit tunai: kad pengenalan dengan buku pendaftaran isi rumah (Hộ khẩu), atau kad pengenalan dengan lesen memandu kereta.',
    foreigners: 'Warga asing: tinggalkan pasport asal.',
    includedHeading: 'Termasuk',
    helmetsOil: '2 topi keledar dan tukar minyak enjin percuma.',
    support: 'Sokongan waranti, nasihat dan bantuan tepi jalan sepanjang tempoh sewa.',
    deliveryHeading: 'Penghantaran',
    deliveryHours: 'Ke daerah dalam bandar Bandar Raya Ho Chi Minh, 8 pagi hingga 8 malam, dengan bayaran (dipersetujui lebih awal).',
    deliveryFree: 'Percuma untuk sewaan lebih 10 hari.',
    deliveryAfter: 'Di luar waktu ini, ambil dan pulangkan motosikal di kedai.',
    bigDocs: 'Kad pengenalan atau dokumen lain bergambar (lesen memandu, pasport dan lain-lain).',
    bigDeposit: 'Deposit diperlukan semasa mengambil motosikal dan dipulangkan sepenuhnya semasa memulangkannya (boleh dirunding lebih awal).',
    bigLicence: 'Lesen motosikal kelas A atau A2 yang sah.',
    bigHelmets: '2 topi keledar.',
  },
  th: {
    types: { scooter: 'สกูตเตอร์ออโต้', semi: 'กึ่งออโต้', clutch: 'เกียร์ธรรมดามีคลัตช์', electric: 'สกูตเตอร์ไฟฟ้า', bigbike: 'บิ๊กไบค์' },
    title: (name, type) => `${name} ให้เช่า · ${type}`,
    intro: (name, type) => `${name} (${type}) จาก Blvck Motorbike ในเขต 1 นครโฮจิมินห์ ส่งข้อความถึงร้านได้ที่นี่บน eno เพื่อตรวจสอบรถว่างและจอง`,
    priceHeading: 'ราคาตามระยะเวลาเช่า',
    tierLabels: ['เช่า 1-2 วัน', 'เช่า 3-15 วัน', 'เช่าเกิน 15 วัน', 'เช่า 1 เดือน'],
    perDay: (p) => `${p}/วัน`,
    rentHeading: 'เงื่อนไขการเช่า',
    docs: (d) => `บัตรประชาชนและใบขับขี่ พร้อมเงินมัดจำ ${d} ขึ้นอยู่กับรุ่นรถ คืนเงินมัดจำเต็มจำนวนเมื่อคืนรถ`,
    depositFrom: (p) => `ตั้งแต่ ${p}`,
    depositRange: (a, b) => `ตั้งแต่ ${a} ถึง ${b}`,
    noDeposit: 'ไม่ต้องวางเงินมัดจำ: บัตรประชาชนพร้อมทะเบียนบ้าน (Hộ khẩu) หรือบัตรประชาชนพร้อมใบขับขี่รถยนต์',
    foreigners: 'ชาวต่างชาติ: ฝากหนังสือเดินทางฉบับจริง',
    includedHeading: 'รวมในราคา',
    helmetsOil: 'หมวกกันน็อค 2 ใบ และเปลี่ยนน้ำมันเครื่องฟรี',
    support: 'บริการรับประกัน ให้คำปรึกษา และช่วยเหลือฉุกเฉินบนท้องถนนตลอดระยะเวลาเช่า',
    deliveryHeading: 'การจัดส่ง',
    deliveryHours: 'ถึงเขตในเมืองของนครโฮจิมินห์ เวลา 8 โมงเช้าถึง 2 ทุ่ม มีค่าบริการ (ตกลงล่วงหน้า)',
    deliveryFree: 'ส่งฟรีเมื่อเช่าเกิน 10 วัน',
    deliveryAfter: 'นอกเวลาดังกล่าว กรุณารับและคืนรถที่ร้าน',
    bigDocs: 'บัตรประชาชนหรือเอกสารที่มีรูปถ่ายอื่น (ใบขับขี่ หนังสือเดินทาง ฯลฯ)',
    bigDeposit: 'ต้องวางเงินมัดจำเมื่อรับรถ และคืนเต็มจำนวนเมื่อคืนรถ (ตกลงล่วงหน้าได้)',
    bigLicence: 'ใบขับขี่รถจักรยานยนต์ประเภท A หรือ A2 ที่ยังไม่หมดอายุ',
    bigHelmets: 'หมวกกันน็อค 2 ใบ',
  },
  fr: {
    types: { scooter: 'scooter automatique', semi: 'semi-automatique', clutch: 'manuelle à embrayage', electric: 'scooter électrique', bigbike: 'grosse cylindrée' },
    title: (name, type) => `${name} à louer · ${type}`,
    intro: (name, type) => `${name} (${type}) proposée par Blvck Motorbike dans le district 1, à Hô Chi Minh-Ville. Écrivez à la boutique ici sur eno pour vérifier la disponibilité et réserver.`,
    priceHeading: 'Prix selon la durée',
    tierLabels: ['Location 1-2 jours', 'Location 3-15 jours', 'Plus de 15 jours', 'Un mois'],
    perDay: (p) => `${p}/jour`,
    rentHeading: 'Conditions de location',
    docs: (d) => `Carte d'identité et permis de conduire, plus une caution en espèces ${d} selon le modèle. La caution est remboursée intégralement au retour de la moto.`,
    depositFrom: (p) => `à partir de ${p}`,
    depositRange: (a, b) => `de ${a} à ${b}`,
    noDeposit: "Sans caution en espèces : carte d'identité avec livret de résidence (Hộ khẩu), ou carte d'identité avec permis voiture.",
    foreigners: 'Étrangers : dépôt du passeport original.',
    includedHeading: 'Inclus',
    helmetsOil: '2 casques et vidanges gratuites.',
    support: 'Assistance garantie, conseils et dépannage pendant toute la location.',
    deliveryHeading: 'Livraison',
    deliveryHours: "Dans les districts urbains de Hô Chi Minh-Ville, de 8 h à 20 h, payante (tarif convenu à l'avance).",
    deliveryFree: 'Gratuite pour toute location de plus de 10 jours.',
    deliveryAfter: 'En dehors de ces horaires, retirez et rendez la moto à la boutique.',
    bigDocs: "Carte d'identité ou autre pièce avec photo (permis de conduire, passeport, etc.).",
    bigDeposit: "Caution obligatoire au retrait, remboursée intégralement au retour (possibilité de négocier à l'avance).",
    bigLicence: 'Permis moto de catégorie A ou A2 valide.',
    bigHelmets: '2 casques.',
  },
  hi: {
    types: { scooter: 'ऑटोमैटिक स्कूटर', semi: 'सेमी-ऑटोमैटिक', clutch: 'मैनुअल क्लच', electric: 'इलेक्ट्रिक स्कूटर', bigbike: 'बड़ी बाइक' },
    title: (name, type) => `${name} किराए पर · ${type}`,
    intro: (name, type) => `${name} (${type}), ज़िला 1, हो ची मिन्ह सिटी में Blvck Motorbike से। उपलब्धता जानने और बुक करने के लिए यहीं eno पर दुकान को संदेश भेजें।`,
    priceHeading: 'किराए की अवधि के अनुसार कीमत',
    tierLabels: ['किराया 1-2 दिन', 'किराया 3-15 दिन', 'किराया 15 दिन से अधिक', 'एक महीना'],
    perDay: (p) => `${p}/दिन`,
    rentHeading: 'किराए की शर्तें',
    docs: (d) => `पहचान पत्र और ड्राइविंग लाइसेंस, साथ में ${d} नकद जमा राशि, बाइक के अनुसार। बाइक लौटाने पर जमा राशि पूरी वापस मिलती है।`,
    depositFrom: (p) => `${p} से शुरू`,
    depositRange: (a, b) => `${a} से ${b}`,
    noDeposit: 'बिना नकद जमा: पहचान पत्र के साथ घरेलू पंजीकरण (Hộ khẩu), या पहचान पत्र के साथ कार ड्राइविंग लाइसेंस।',
    foreigners: 'विदेशी नागरिक: मूल पासपोर्ट जमा करना होगा।',
    includedHeading: 'शामिल',
    helmetsOil: '2 हेलमेट और मुफ़्त इंजन ऑयल बदलने की सुविधा।',
    support: 'किराए की अवधि में वारंटी सहायता, सलाह और सड़क पर मदद।',
    deliveryHeading: 'डिलीवरी',
    deliveryHours: 'हो ची मिन्ह सिटी के शहरी ज़िलों में, सुबह 8 बजे से रात 8 बजे तक, शुल्क के साथ (पहले से तय)।',
    deliveryFree: '10 दिन से अधिक के किराए पर मुफ़्त।',
    deliveryAfter: 'इस समय के बाहर, बाइक दुकान से लें और वहीं लौटाएँ।',
    bigDocs: 'पहचान पत्र या फ़ोटो वाला कोई अन्य दस्तावेज़ (ड्राइविंग लाइसेंस, पासपोर्ट आदि)।',
    bigDeposit: 'बाइक लेते समय जमा राशि ज़रूरी है, लौटाने पर पूरी वापस मिलती है (पहले से बातचीत की जा सकती है)।',
    bigLicence: 'श्रेणी A या A2 का वैध मोटरसाइकिल लाइसेंस।',
    bigHelmets: '2 हेलमेट।',
  },
}

const section = (heading: string, lines: readonly string[]) => `# ${heading}\n${lines.join('\n')}`
const bullets = (items: readonly string[]) => items.map((i) => `- ${i}`)

/** One bike's title, in one language. */
export function blvckTitle(bike: BlvckBike, lang: BlvckLang): string {
  const c = BLVCK_COPY[lang]
  return c.title(bike.name, c.types[bike.kind])
}

/** One bike's description, in one language: what it is, the price by rental length, then the partner's conditions. */
export function blvckDescription(bike: BlvckBike, lang: BlvckLang): string {
  const c = BLVCK_COPY[lang]
  const intro = c.intro(bike.name, c.types[bike.kind])
  if (!bike.tiers || !bike.deposit) {
    return [
      intro,
      section(c.rentHeading, bullets([c.bigLicence, c.bigDocs, c.bigDeposit])),
      section(c.includedHeading, bullets([c.bigHelmets])),
      section(c.deliveryHeading, bullets([c.deliveryHours, c.deliveryAfter])),
    ].join('\n\n')
  }
  const { from, to } = bike.deposit
  const money = (n: number) => blvckMoney(n, lang)
  const deposit = to ? c.depositRange(money(from), money(to)) : c.depositFrom(money(from))
  return [
    intro,
    section(c.priceHeading, bike.tiers.map((price, i) => `${c.tierLabels[i]}: ${c.perDay(money(price))}`)),
    section(c.rentHeading, bullets([c.docs(deposit), c.noDeposit, c.foreigners])),
    section(c.includedHeading, bullets([c.helmetsOil, c.support])),
    section(c.deliveryHeading, bullets([c.deliveryHours, c.deliveryFree, c.deliveryAfter])),
  ].join('\n\n')
}

/** (name, kind) when `title` is EXACTLY BLVCK_COPY[lang].title(name, types[kind]) for a non-empty one-line name; every reading. */
function blvckTitleParts(title: string, lang: 'en' | 'vi'): { name: string; kind: Kind }[] {
  const c = BLVCK_COPY[lang]
  const out: { name: string; kind: Kind }[] = []
  for (const kind of Object.keys(c.types) as Kind[]) {
    const [pre, post] = c.title('\u0000', c.types[kind]).split('\u0000')
    if (title.length <= pre.length + post.length || !title.startsWith(pre) || !title.endsWith(post)) continue
    const name = title.slice(pre.length, title.length - post.length)
    if (name.trim() === name && !/\n/.test(name)) out.push({ name, kind })
  }
  return out
}

/**
 * ⛔ ENO'S OWN INTRO SENTENCE, REBUILT — NEVER MATCHED BY LOOKS (UI climb batch 90, 2026-11-14; blind A/B on live eno.vn,
 * Opus +0.14/+0.12, GPT +0.17, trust ±0). blvckDescription opens every bike on BLVCK_COPY.intro ("Honda SH Mode (automatic
 * scooter) from Blvck Motorbike in District 1, Ho Chi Minh City. Message the shop here on eno to check availability and
 * book."), which says again what the page's first screen says: the title, the type, the shop, its place and Chat now. These
 * are the sentences that intro would be for the bike this listing's OWN titles name: the English title gives the name and
 * type for English and the nine cached languages (blvckTranslations writes them from the same name and kind), the
 * Vietnamese title for Vietnamese. A title that is not the template's exact shape gives none, and a missing titleVi gives no
 * Vietnamese one, so that text is kept. The listing page drops a description's first paragraph only when it IS one of
 * these, character for character (lead-paragraph.ts): a partner's edited sentence, one word apart, stays. Display only —
 * the stored text, metadata and JSON-LD keep it; the price table, "To rent", Included and Delivery are untouched (owner,
 * 2026-11-04: "should look minimal sleek"; the hand-written languages and tier-label shape above do not change).
 */
export function blvckIntroSentences(row: { title: string; titleVi?: string | null }): string[] {
  const out: string[] = []
  for (const { name, kind } of blvckTitleParts(row.title, 'en')) {
    for (const lang of ['en', ...BLVCK_CACHED_LANGS] as BlvckLang[]) out.push(BLVCK_COPY[lang].intro(name, BLVCK_COPY[lang].types[kind]))
  }
  if (row.titleVi) for (const { name, kind } of blvckTitleParts(row.titleVi, 'vi')) out.push(BLVCK_COPY.vi.intro(name, BLVCK_COPY.vi.types[kind]))
  return out
}

export type BlvckRow = {
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
  subcategorySlug: 'motorbike-rental'
  city: string
  district: string
  location: string
  lat: number
  lng: number
  attributes: string
  facetTokens: string | null
  searchText: string
}

/** The listing row of one bike (the storefront, category, photos, rank and publish state are the script's). */
export function stageBlvckBike(bike: BlvckBike): BlvckRow {
  const money = listingMoneyFor({ categorySlug: 'rentals', listingType: 'rent', rentalPeriod: 'daily' })
  const title = blvckTitle(bike, 'en')
  const titleVi = blvckTitle(bike, 'vi')
  return {
    externalId: `blvck:${bike.slug}`,
    title, titleVi,
    description: blvckDescription(bike, 'en'),
    descriptionVi: blvckDescription(bike, 'vi'),
    price: bike.perDay,
    priceUnit: money.priceUnit,
    currency: '₫',
    negotiable: false,
    listingType: 'rent',
    subcategorySlug: 'motorbike-rental',
    city: 'Hồ Chí Minh',
    district: 'Quận 1',
    location: 'Quận 1, Hồ Chí Minh',
    ...BLVCK_PIN,
    attributes: JSON.stringify({ rentalPeriod: 'daily', transmission: TRANSMISSION[bike.kind] }),
    // A bike with a monthly tier answers the Monthly chip too; `attributes` holds one value per key (vehicle-rental-listing.ts).
    facetTokens: buildFacetTokens({ rentalPeriod: bike.tiers ? ['daily', 'monthly'] : ['daily'] }),
    searchText: buildSearchText([title, titleVi, bike.name, BLVCK_NAME, 'Quận 1', 'thuê xe máy motorbike scooter rental']),
  }
}

/** The (source text → translated text) rows a bike puts in the Translation cache, for the languages that have no column. */
export function blvckTranslations(bike: BlvckBike): { source: string; target: BlvckLang; value: string }[] {
  const en = stageBlvckBike(bike)
  return BLVCK_CACHED_LANGS.flatMap((target) => [
    { source: en.title, target, value: blvckTitle(bike, target) },
    { source: en.description, target, value: blvckDescription(bike, target) },
  ])
}

export type BlvckFeedItem = {
  slug: string
  isInStock: boolean
  /** Đồng; 0 = the feed states no price. */
  price: number
  photos: readonly string[]
}

/** Why a bike cannot be written from this read of the partner's feed, or null. */
export function blvckFeedProblem(bike: BlvckBike, item: BlvckFeedItem | undefined): string | null {
  if (!item) return `${bike.slug} is not in the partner's feed`
  if (!item.isInStock) return `${bike.slug} is out of stock on the partner's site`
  if (item.price === 0 ? bike.tiers !== null : item.price !== bike.perDay) return `${bike.slug}: the feed says ${item.price}, the partner's price table said ${bike.perDay} — re-read the tables`
  if (item.photos.length < BLVCK_MIN_PHOTOS) return `${bike.slug}: ${item.photos.length} photos in the feed, ${BLVCK_MIN_PHOTOS} needed`
  const foreign = item.photos.find((u) => !u.startsWith('https://thuexemaysaigon.vn/wp-content/uploads/'))
  return foreign ? `${bike.slug}: a photo outside the partner's uploads (${foreign})` : null
}

export type BlvckSeller = { id: string; ownerId: string | null; ownerEmail: string | null; officialPartner: boolean; trustScore: number; location: string | null }

/** Why these rows must not go on this storefront, or null. Handle AND owner email AND chat-only, as goplusSellerRefusal. */
export function blvckSellerRefusal(seller: BlvckSeller | null): string | null {
  if (!seller) return `no storefront with the handle "${BLVCK_HANDLE}" — register it first: PARTNER_PASSWORD='…' node --env-file=.env scripts/register-partner-seller.mjs blvck --apply`
  if (!seller.ownerId) return `the "${BLVCK_HANDLE}" storefront (${seller.id}) has no owning account — a renter's message would reach nobody`
  if ((seller.ownerEmail ?? '').toLowerCase() !== BLVCK_EMAIL) return `the "${BLVCK_HANDLE}" storefront (${seller.id}) is owned by ${seller.ownerEmail ?? 'an account with no email'}, not ${BLVCK_EMAIL}`
  if (!seller.officialPartner) return `the "${BLVCK_HANDLE}" storefront (${seller.id}) is not an official partner yet — run scripts/set-official-partner.mjs ${BLVCK_HANDLE} --apply first`
  return null
}
