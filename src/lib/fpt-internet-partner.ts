/**
 * FPT TELECOM HOME INTERNET — an official partner storefront, /fpttelecom (owner, 2026-11-27: "let's import next partner
 * services", with FPT's price sheet and service doc). eno holds the login: a customer messages the storefront, eno's staff
 * answer in the admin partner inbox and hand the lead to FPT. scripts/import-fpt-internet.ts is the I/O around this file.
 *
 *   · NINE LISTINGS, BUILT FROM ONE TABLE: the three plans (GIGA, SKY, META) in each of Ho Chi Minh City, Hanoi and Da Nang,
 *     in Services › Internet & TV. Each carries its plan's packages with their monthly prices, the equipment notes, the
 *     installation fee, the conditions and how to order, written here in English and Vietnamese (no machine translation).
 *   · THE CARD PRICE IS THE PLAN'S LOWEST MONTHLY (Internet only), stored per MONTH ('VND/month', price-unit.ts
 *     MONTHLY_UNIT), so every surface prints "/ month" after it; the text lists the dearer combos.
 *   · CITY-LEVEL: `city` is the city, `district` null (the schema allows it, as the eSIM and visa products do), no
 *     coordinates, so no map pin pretends FPT sits in one district. FPT installs at the customer's address.
 *
 * ⛔ THE COPY IS CONSERVATIVE UNTIL FPT CONFIRMS (owner, 2026-11-27):
 *   · the installation fee is SHOWN (300,000 đ, once) — the sheet's footer says "FREE connection", every row says 300,000;
 *     the text never says free connection or free installation;
 *   · no voucher (the footer's 200,000 đ one is unconfirmed), no separate 6- or 12-month price, no bonus months;
 *   · "first camera free" as the sheet prints it; "genuine cameras" and "FPT Play with the Premier League" may be said;
 *   · inner-city prices, and the text says so;
 *   · ⛔ eno's commission is internal: no figure, rate or word of it appears anywhere here or in a listing.
 * GIGA's TV combos are marked "Not available" on the sheet: they are not sold, so the text does not list them.
 * The speeds after each plan's headline figure (SKY uploads at 300 Mbps, META at 1 Gbps) are FPT's own, from its
 * home-internet page (https://fpt.vn/internet, read 2026-11-27): they are what tells SKY and META apart.
 */
import { CITY_NAME, CITY_NAME_EN, type CityKey } from './honeycomb-listing'
import { buildSearchText } from './fold'
import { MONTHLY_UNIT } from './price-unit'
import { PublishBlockedError, assertCleanTexts } from './publish-guard'
import { formatMoneyFull } from './vnd'

export const FPT = {
  handle: 'fpttelecom',
  name: 'FPT Telecom',
  /** The eno-held login that owns the storefront (scripts/register-partner-seller.mjs fpttelecom). */
  email: 'support+fpttelecom@eno.vn',
  /** FPT's own home-internet page (answers 200, its own canonical; read 2026-11-27): the staff-only original page. */
  site: 'https://fpt.vn/internet',
} as const

/** externalId prefix — and the edit path's one-photo marker (publish-guard.ts ONE_PHOTO_IMPORT_PREFIXES). */
export const FPT_EXTERNAL_PREFIX = 'fpt-internet:'

/** One-time fees on the sheet, in đồng: installation on first setup; the TV box; each camera after the first. */
export const FPT_FEES = { installation: 300_000, tvBox: 550_000, extraCamera: 400_000 } as const

export type FptPackageKey = 'internet' | 'camera' | 'vvip-app' | 'vvip-box' | 'triple-app' | 'triple-box'
type Words = { en: string; vi: string }

/** The six packages, in the sheet's order. `what`: what it bundles. `box` / `camera`: which equipment notes it carries. */
const PACKAGES: Readonly<Record<FptPackageKey, { name: Words; what: Words | null; box: boolean; camera: boolean }>> = {
  internet: { name: { en: 'Internet only', vi: 'Chỉ Internet' }, what: null, box: false, camera: false },
  camera: { name: { en: 'Combo Camera', vi: 'Combo Camera' }, what: { en: 'internet + a security camera', vi: 'Internet + camera an ninh' }, box: false, camera: true },
  'vvip-app': { name: { en: 'Combo V.VIP App', vi: 'Combo V.VIP App' }, what: { en: 'internet + FPT Play TV in the app', vi: 'Internet + truyền hình FPT Play trên ứng dụng' }, box: false, camera: false },
  'vvip-box': { name: { en: 'Combo V.VIP Box', vi: 'Combo V.VIP Box' }, what: { en: 'internet + FPT Play TV on a TV box', vi: 'Internet + truyền hình FPT Play qua đầu thu' }, box: true, camera: false },
  'triple-app': { name: { en: 'Triple VIP App', vi: 'Triple VIP App' }, what: { en: 'internet + camera + FPT Play TV in the app', vi: 'Internet + camera + truyền hình FPT Play trên ứng dụng' }, box: false, camera: true },
  'triple-box': { name: { en: 'Triple VIP Box', vi: 'Triple VIP Box' }, what: { en: 'internet + camera + FPT Play TV on a TV box', vi: 'Internet + camera + truyền hình FPT Play qua đầu thu' }, box: true, camera: true },
}
export const FPT_PACKAGE_ORDER: readonly FptPackageKey[] = ['internet', 'camera', 'vvip-app', 'vvip-box', 'triple-app', 'triple-box']

export type FptPlanKey = 'giga' | 'sky' | 'meta'
export type FptPlan = {
  key: FptPlanKey
  name: string
  /** The headline speed, as the sheet prints it. */
  speed: string
  /** Download and upload, as FPT's home-internet page states them (read 2026-11-27). */
  speeds: Words
  /** Monthly price per package, đồng, inner city, the final customer price. ⛔ null = "Not available" on the sheet: not sold. */
  monthly: Readonly<Record<FptPackageKey, number | null>>
}

/** THE TABLE — FPT's sheet, "November 2026 sales policy (updated)", effective 1 August 2026. */
export const FPT_PLANS: readonly FptPlan[] = [
  {
    key: 'giga', name: 'GIGA', speed: '300 Mbps',
    speeds: { en: '300 Mbps download and upload', vi: 'tải xuống và tải lên đều 300 Mbps' },
    monthly: { internet: 255_000, camera: 255_000, 'vvip-app': null, 'vvip-box': null, 'triple-app': null, 'triple-box': null },
  },
  {
    key: 'sky', name: 'SKY', speed: '1 Gbps',
    speeds: { en: '1 Gbps download, 300 Mbps upload', vi: 'tải xuống 1 Gbps, tải lên 300 Mbps' },
    monthly: { internet: 265_000, camera: 265_000, 'vvip-app': 269_000, 'vvip-box': 269_000, 'triple-app': 304_000, 'triple-box': 304_000 },
  },
  {
    key: 'meta', name: 'META', speed: '1 Gbps',
    speeds: { en: '1 Gbps download and upload', vi: 'tải xuống và tải lên đều 1 Gbps' },
    monthly: { internet: 345_000, camera: 345_000, 'vvip-app': 369_000, 'vvip-box': 369_000, 'triple-app': 404_000, 'triple-box': 404_000 },
  },
]

/** The three cities, in the order the listings are written. The Vietnamese is the prose name ("TP.HCM"), not `city`. */
export const FPT_CITIES: readonly { key: CityKey; vi: string }[] = [
  { key: 'hcmc', vi: 'TP.HCM' },
  { key: 'hanoi', vi: 'Hà Nội' },
  { key: 'danang', vi: 'Đà Nẵng' },
]

/** The packages a plan SELLS, in the sheet's order, with their monthly price. */
export function soldPackages(plan: FptPlan): { key: FptPackageKey; monthly: number }[] {
  return FPT_PACKAGE_ORDER.flatMap((key) => {
    const monthly = plan.monthly[key]
    return monthly == null ? [] : [{ key, monthly }]
  })
}

const dong = (n: number, lang: 'en' | 'vi') => formatMoneyFull(n, '₫', lang)
const perMonth = (n: number, lang: 'en' | 'vi') => `${dong(n, lang)}${lang === 'en' ? '/month' : '/tháng'}`

/** The equipment note after a package's price ("TV box 550,000 đ; first camera free, each further camera 400,000 đ"). */
function equipment(key: FptPackageKey, lang: 'en' | 'vi'): string | null {
  const p = PACKAGES[key]
  const parts = [
    p.box ? (lang === 'en' ? `TV box ${dong(FPT_FEES.tvBox, 'en')}` : `đầu thu ${dong(FPT_FEES.tvBox, 'vi')}`) : null,
    p.camera ? (lang === 'en' ? `first camera free, each further camera ${dong(FPT_FEES.extraCamera, 'en')}` : `tặng camera đầu tiên, từ camera thứ hai ${dong(FPT_FEES.extraCamera, 'vi')}/chiếc`) : null,
  ].filter((x): x is string => !!x)
  return parts.length ? parts.join('; ') : null
}

function packageLine(key: FptPackageKey, monthly: number, lang: 'en' | 'vi'): string {
  const p = PACKAGES[key]
  const kit = equipment(key, lang)
  const head = p.what ? `${p.name[lang]} (${p.what[lang]})` : p.name[lang]
  return `- ${head}: ${perMonth(monthly, lang)}${kit ? `. ${kit[0].toUpperCase()}${kit.slice(1)}` : ''}`
}

export type FptRow = {
  externalId: string
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  price: number
  priceUnit: string
  currency: '₫'
  negotiable: false
  listingType: 'service'
  condition: null
  categorySlug: 'services'
  subcategorySlug: 'internet-tv'
  city: string
  district: null
  location: string
  attributes: string
  searchText: string
}

const TITLE_MAX = 140
const DESCRIPTION_MAX = 5000

/** One plan in one city → its listing. Throws when the text would not pass the publish screens (a bug in this file). */
export function fptListing(plan: FptPlan, city: { key: CityKey; vi: string }): FptRow {
  const sold = soldPackages(plan)
  const price = Math.min(...sold.map((s) => s.monthly))
  const tv = sold.some((s) => s.key.startsWith('vvip') || s.key.startsWith('triple'))
  const cityEn = CITY_NAME_EN[city.key]
  const title = `FPT Home Internet ${plan.name} ${plan.speed} – fibre, ${tv ? 'TV and camera combos' : 'camera combo available'}, ${cityEn}`
  const titleVi = `Lắp mạng Internet FPT gói ${plan.name} ${plan.speed} – cáp quang, ${tv ? 'có combo truyền hình và camera' : 'có gói kèm camera'}, ${city.vi}`
  const fees = FPT_FEES.installation
  const description = [
    `FPT fibre internet installed at your home in ${cityEn}, arranged in English through eno. ${plan.name} is FPT's ${plan.speed} plan: ${plan.speeds.en}.`,
    tv
      ? `Internet only is ${perMonth(price, 'en')}. The combos below add FPT Play TV (with the Premier League), a genuine FPT security camera, or both.`
      : `One price, ${perMonth(price, 'en')}, for Internet only or with a genuine FPT security camera (Combo Camera).`,
    `Installation is ${dong(fees, 'en')}, paid once on first setup. These are FPT's inner-city prices as of November 2026; outer districts may differ, so ask us.`,
    `# Monthly prices\n${sold.map((s) => packageLine(s.key, s.monthly, 'en')).join('\n')}`,
    '# Good to know\n- Houses and townhouses in the inner city: the prices above, exactly.\n- Apartments: the price may differ by building, set by the building management or developer. Message us for a quote for your building.\n- 6-month and 12-month packages are available.',
    '# How to order\nMessage eno here with your address, the building name (if it is an apartment) and the plan you want. We handle the paperwork and book the installation with FPT for you. eno introduces FPT Telecom; your service contract is with FPT.',
  ].join('\n\n')
  const descriptionVi = [
    `Lắp mạng cáp quang FPT tại nhà ở ${city.vi}, đăng ký nhanh qua eno. ${plan.name} là gói ${plan.speed} của FPT: ${plan.speeds.vi}.`,
    tv
      ? `Gói chỉ có Internet giá ${perMonth(price, 'vi')}. Các gói combo bên dưới có thêm truyền hình FPT Play (xem Ngoại hạng Anh), camera an ninh FPT chính hãng, hoặc cả hai.`
      : `Cùng một giá ${perMonth(price, 'vi')}: chỉ Internet, hoặc kèm camera an ninh FPT chính hãng (Combo Camera).`,
    `Phí lắp đặt ${dong(fees, 'vi')}, trả một lần khi lắp mới. Đây là giá nội thành của FPT, cập nhật tháng 11/2026; khu vực ngoại thành có thể khác, hãy nhắn để hỏi.`,
    `# Giá cước hằng tháng\n${sold.map((s) => packageLine(s.key, s.monthly, 'vi')).join('\n')}`,
    '# Lưu ý\n- Nhà riêng, nhà phố trong nội thành: đúng giá trên.\n- Căn hộ chung cư: giá có thể khác tùy tòa nhà, theo quy định của ban quản lý hoặc chủ đầu tư. Nhắn tin để được báo giá cho tòa nhà của bạn.\n- Có gói 6 tháng và 12 tháng.',
    '# Cách đăng ký\nNhắn tin cho eno ngay tại đây, kèm địa chỉ, tên tòa nhà (nếu là chung cư) và gói bạn muốn dùng. eno lo giấy tờ và đặt lịch lắp đặt với FPT cho bạn. eno giới thiệu FPT Telecom; hợp đồng dịch vụ là giữa bạn và FPT.',
  ].join('\n\n')

  const externalId = `${FPT_EXTERNAL_PREFIX}${city.key}:${plan.key}`
  if (title.length > TITLE_MAX || titleVi.length > TITLE_MAX) throw new Error(`${externalId}: title over ${TITLE_MAX} characters`)
  if (description.length > DESCRIPTION_MAX || descriptionVi.length > DESCRIPTION_MAX) throw new Error(`${externalId}: description over ${DESCRIPTION_MAX} characters`)
  try { assertCleanTexts([title, titleVi, description, descriptionVi]) } catch (e) {
    if (e instanceof PublishBlockedError) throw new Error(`${externalId}: ${e.code}${e.message ? ` (${e.message})` : ''}`)
    throw e
  }
  return {
    externalId, title, titleVi, description, descriptionVi,
    price, priceUnit: MONTHLY_UNIT, currency: '₫', negotiable: false, listingType: 'service', condition: null,
    categorySlug: 'services', subcategorySlug: 'internet-tv',
    city: CITY_NAME[city.key], district: null, location: CITY_NAME[city.key],
    // Installed at the customer's address, by a business — the Services filters read both (import-esim.ts writes the same).
    attributes: JSON.stringify({ serviceLocation: 'at-customer', providerType: 'business' }),
    searchText: buildSearchText([title, titleVi, cityEn, city.vi, CITY_NAME[city.key], FPT.name, plan.name, plan.speed,
      ...sold.map((s) => PACKAGES[s.key].name.en),
      'home internet wifi fibre fiber broadband cáp quang lắp mạng internet gia đình camera',
      // ⛔ The TV words only on a plan that sells TV: a search for "Premier League" must not find GIGA (commit gate, opus).
      tv ? 'TV truyền hình FPT Play Premier League Ngoại hạng Anh' : null]),
  }
}

/** All nine: every plan in every city, cities in FPT_CITIES order. */
export function fptInternetListings(): FptRow[] {
  return FPT_CITIES.flatMap((city) => FPT_PLANS.map((plan) => fptListing(plan, city)))
}

export type FptSeller = { id: string; ownerId: string | null; ownerEmail: string | null; officialPartner: boolean; trustScore: number }
/** Why the storefront may not take these listings, or null: it must be FPT's own, eno-held, official. */
export function fptSellerRefusal(seller: FptSeller | null): string | null {
  if (!seller) return `no /${FPT.handle} storefront — register it first (scripts/register-partner-seller.mjs ${FPT.handle} --apply)`
  if (!seller.ownerId) return `/${FPT.handle} has no owner account`
  if (seller.ownerEmail !== FPT.email) return `/${FPT.handle} is owned by ${seller.ownerEmail ?? '?'}, not eno's ${FPT.email}`
  if (!seller.officialPartner) return `/${FPT.handle} is not an official partner — scripts/set-official-partner.mjs ${FPT.handle} --apply`
  return null
}
