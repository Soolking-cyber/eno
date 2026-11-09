/**
 * Saigon Moving (saigonmoving.com) → eno: ONE home-moving listing on the partner's own storefront, written ONCE, then the
 * account's to manage.
 *
 * Owner, 2026-11-09: "add https://saigonmoving.com/bang-gia.htm saigon moving as a partner for moving home", and on the
 * price: "apply this type of price formula so they know what to expect but explain it varies from case to case".
 *
 * Pure — the I/O is scripts/import-saigonmoving.ts.
 *
 * ⛔ THE PRICE GUIDE IS NOT A TABLE SAIGON MOVING PUBLISHES. Their /bang-gia.htm (read 2026-11-09) states no prices: it lists
 * their steps (enquiry → survey → quote by email or Zalo) and asks you to call. The guide below is the market formula the
 * owner chose — truck fare by size and distance + loading at both ends + extras — with the figures the owner supplied (2026-11-09),
 * and the text says what it is: typical prices for Ho Chi Minh City, a guide only, the exact price confirmed by Saigon
 * Moving after a free survey. A figure that moves is an admin's edit afterwards: the run is create-only.
 * The card price is the smallest move in the guide (SAIGONMOVING_CARD_PRICE). A service price prints EXACTLY, never "from"
 * (taxonomy.ts listingMoneyFor, owner 2026-07-22), so the description says in so many words what that figure covers.
 *
 * ⛔ THE CLAIMS ARE THEIR OWN, from saigonmoving.com's home and about pages (read 2026-11-09): full-package moves of homes,
 * offices and warehouses in Ho Chi Minh City and the neighbouring provinces; free consultation; a survey in person or
 * from what you send them; cartons, wooden crates, wrapping paper, bubble wrap and foam; fragile and bulky items packed
 * apart; trucks sized to the load; a short route; furniture put back in place on request. Their "no damage" promise is
 * NOT repeated: eno would be stating it. No other moving company is named anywhere.
 *
 * ⛔ No phone, email, link or street address in a listing text — an official partner's contact path is eno's chat, and
 * assertCleanTexts refuses them on an admin's later edit too. The address lives on the storefront (Seller.location).
 *
 * ⛔ THE TABLE ROWS HAVE A SHAPE. rich-text-blocks.ts makes a table of 'Label: value' lines only when the label starts with a
 * LETTER and holds letters, digits, spaces and / & . ' - (≤ 24 characters: no parentheses, commas or "×"), and the value is
 * ≤ 80 characters and does not end like a sentence. So a truck's cargo box is its own table, and the Vietnamese truck
 * classes are written "1.4 tấn", as the trade writes them, because "1,4 tấn" would break the row into a run-on paragraph.
 * saigonmoving-listing.test.ts pins both languages.
 *
 * ⚠️ en + vi only — the row's own columns. The other nine languages get the machine translation every listing gets
 * (translate.ts, warmed nightly); Blvck's hand-written Translation-cache rows were the owner's ask for that partner only.
 */
import { buildSearchText } from './fold'
import { listingMoneyFor } from './taxonomy'
import { formatInteger, formatMoneyFull, moneyLocale } from './vnd'

export const SAIGONMOVING_HANDLE = 'saigonmoving'
/** Published on their own about and home pages (read 2026-11-09). The account eno's admin signs in with. */
export const SAIGONMOVING_EMAIL = 'saigonmoving.com@gmail.com'
export const SAIGONMOVING_NAME = 'Saigon Moving'
/** As their site states it ("285 Nơ Trang Long, P.13, Q.Bình Thạnh, TP HCM") — on the storefront only (see the header). */
export const SAIGONMOVING_ADDRESS = '285 Nơ Trang Long, Phường 13, Quận Bình Thạnh, Thành phố Hồ Chí Minh'
/**
 * Street level, not a survey mark: photon.komoot.io's #281 Nơ Trang Long (10.818736, 106.6990404, read 2026-11-09), two doors
 * from #285, which it does not know. Kept so the row answers "search this area" (geo-radius.ts filters stored coordinates).
 */
export const SAIGONMOVING_PIN = { lat: 10.81874, lng: 106.69904 }
export const SAIGONMOVING_EXTERNAL_ID = 'saigonmoving:home-moving'
/** Their logo (saigonmoving.com/upload/images/Group_6.png), trimmed to the mark: the storefront avatar's source. */
export const SAIGONMOVING_LOGO_FILE = 'public/partners/saigonmoving.png'

/**
 * ⛔ THE PHOTOS ARE PINNED BY CONTENT, AS LOOKED AT BY EYE (2026-11-09). Each is the partner's own, from their site; the run
 * refuses any whose bytes differ from what was looked at, so a replaced file is never published unseen.
 * Chosen from the eight on the brief: the crew loading cartons into their van (cover) and packing furniture in a living
 * room. Left out: every one with the hotline legible on a shirt, a truck sticker or a site watermark (rsz_img_1272,
 * hình web, z3428644222635, 4bc04b5864dc9682cfcd, bn2 — the first also has a hotel's sign in frame), and a byte-identical
 * copy of the cover (l_852557561_…_n.jpg). On these two the shirt print is a blur at 720 px: no number can be read.
 * ⛔ A REUSED CIGARETTE CARTON ("CRAVEN") STANDS AMONG THE BOXES IN BOTH, its brand mark legible when zoomed. Vietnam's
 * Advertising Law bans tobacco advertising and eno.vn is the licensed company (review, 2026-11-09), so the mark is taken out
 * before the photo is checked and uploaded: cropped out of frame (`crop`) where the scene allows, else blurred soft-edged
 * (`blur`); pixels of the 720×960 original, measured by eye on 4× crops. The rest of each frame is the partner's photo as published.
 */
export type PhotoBox = { left: number; top: number; width: number; height: number }
export const SAIGONMOVING_PHOTOS: readonly { url: string; sha256: string; crop?: PhotoBox; blur: readonly PhotoBox[] }[] = [
  // The carton by the gate, behind the porter's legs — it cannot be cropped out without cutting the porter, so its face
  // (logo oval and the "10 × 20" print) gets a soft-edged blur that reads as depth of field, not a patch.
  { url: 'https://saigonmoving.com/upload/10_160754909_110355074466178_3053191631796164391_n.jpg', sha256: 'd1be5f6ae4c243ea10ba740c9862102399b72b08e763a3f339e930b8a1e5f0a5', blur: [{ left: 500, top: 484, width: 58, height: 136 }] },
  // The carton on the right edge, under the orange bag: its mark starts at x ≈ 650, so the frame is cut to 632 px wide —
  // the packing scene (the porter taping the red cushion, x ≈ 300–440) is untouched and no mark is left.
  { url: 'https://saigonmoving.com/upload/1/resources/l_2122370797_9d49c87416f1e4afbde0%20(1).jpg', sha256: '4ac617eeb5785af3261a387c7d47c6c6310618214960036cc6b75a64e4e0af29', crop: { left: 0, top: 0, width: 632, height: 960 }, blur: [] },
]
/** Both are 720×960. */
export const SAIGONMOVING_PHOTO_FLOOR = { minShortEdge: 300 }

export type SaigonmovingLang = 'en' | 'vi'

export type SaigonmovingTruck = {
  /** The row label, per language — the rich-text table's shape (header). */
  label: Record<SaigonmovingLang, string>
  /** Cargo box, metres: length, width, height. */
  box: readonly [number, number, number]
  /** Đồng: the first 10 km, then each km from km 11 to 50, then loading and unloading at both ends. */
  first10km: number
  perKm: number
  loading: number
}

const truck = (en: string, vi: string, box: readonly [number, number, number], first10km: number, perKm: number, loading: number): SaigonmovingTruck =>
  ({ label: { en, vi }, box, first10km, perKm, loading })

/** The owner's figures, 2026-11-09 — the smallest first (the card price is built from it). */
export const SAIGONMOVING_TRUCKS: readonly SaigonmovingTruck[] = [
  truck('Transit 800 kg van', 'Xe Transit 800 kg', [2.4, 1.5, 1.5], 550_000, 25_000, 700_000),
  truck('Truck 1 tonne', 'Xe tải 1 tấn', [3, 1.6, 1.6], 600_000, 25_000, 900_000),
  truck('Truck 1.4 tonnes', 'Xe tải 1.4 tấn', [3.4, 1.65, 1.6], 630_000, 30_000, 1_200_000),
  truck('Truck 1.9 tonnes', 'Xe tải 1.9 tấn', [4.38, 1.85, 1.8], 700_000, 40_000, 1_700_000),
  truck('Tail-lift truck 1.9 t', 'Xe 1.9 tấn bửng nâng', [4.4, 1.9, 1.9], 950_000, 55_000, 2_000_000),
  truck('Truck 2.2 tonnes', 'Xe tải 2.2 tấn', [4.5, 2, 2], 750_000, 45_000, 1_900_000),
  truck('Long truck 2 tonnes', 'Xe 2 tấn thùng dài', [6.2, 2, 2], 1_200_000, 55_000, 2_500_000),
]

/** Đồng. The waiting time is a range by truck size. */
export const SAIGONMOVING_EXTRAS = { carton: 18_000, peRoll: 150_000, aircon: 400_000, waitFrom: 100_000, waitTo: 200_000 } as const

/** The smallest move in the guide: the Transit van's first 10 km plus loading and unloading at both ends. */
export const SAIGONMOVING_CARD_PRICE = SAIGONMOVING_TRUCKS[0].first10km + SAIGONMOVING_TRUCKS[0].loading

/** Every price as vnd.ts prints it: "550,000 đ", and "550.000 đ" in Vietnamese. */
export const saigonmovingMoney = (n: number, lang: SaigonmovingLang) => formatMoneyFull(n, '₫', moneyLocale(lang))
/** A measure: "2.4" in English, "2,4" in Vietnamese. */
const measure = (n: number, lang: SaigonmovingLang) => (lang === 'vi' ? String(n).replace('.', ',') : String(n))

type Money = { card: string; fare: string; loading: string; carton: string; pe: string; aircon: string; wait: string }

type Copy = {
  title: string
  intro: string
  coversHeading: string
  covers: readonly string[]
  alsoOffices: string
  priceHeading: string
  formula: string
  cardNote: (m: Money) => string
  fareHeading: string
  fare: (first: string, perKm: string) => string
  loadingHeading: string
  extrasHeading: string
  extras: (m: Money) => readonly string[]
  sizesHeading: string
  noteHeading: string
  note: string
}

export const SAIGONMOVING_COPY: Record<SaigonmovingLang, Copy> = {
  en: {
    title: 'Full-package home moving in Ho Chi Minh City',
    intro: 'Saigon Moving moves homes across Ho Chi Minh City and to the neighbouring provinces as a full package: they survey first, bring the packing materials, take apart and wrap the furniture, then load, drive and unload at your new place. Message Saigon Moving here on eno for a free consultation and a free survey, in person or from photos you send in the chat.',
    coversHeading: 'What the package covers',
    covers: [
      'A free consultation and a free survey, at your home or from photos',
      'Packing materials: cartons, wooden crates, wrapping paper, bubble wrap and foam',
      'Furniture taken apart, wrapped and loaded, with fragile and bulky items packed separately',
      'A truck sized to the load and a short, sensible route',
      'Unloading at your new home, and furniture set back in place on request',
    ],
    alsoOffices: 'Saigon Moving also moves offices and warehouses.',
    priceHeading: 'How the price is worked out',
    formula: '**Total = truck fare + loading and unloading + extras, if any.**',
    cardNote: (m) => `The guide below shows typical prices in Ho Chi Minh City as of November 2026. The ${m.card} shown on this listing is the price of its smallest move: the Transit 800 kg van for the first 10 km (${m.fare}) plus loading and unloading at both ends (${m.loading}).`,
    fareHeading: 'Truck fare: the first 10 km, then each km from km 11 to 50',
    fare: (first, perKm) => `${first}, then ${perKm}/km`,
    loadingHeading: 'Loading and unloading, both ends, per truck',
    extrasHeading: 'Extras',
    extras: (m) => [
      `Carton box (60 × 40 × 35 cm): ${m.carton} each`,
      `PE wrap: ${m.pe} for a 2.4 kg roll`,
      `Air-conditioner removal and refit: ${m.aircon} per unit, not including cleaning, gas or fitting materials`,
      `Waiting time: ${m.wait} an hour, by truck size`,
      'Stairs without a lift, narrow alleys, basement car parks and furniture assembly: priced by the job',
    ],
    sizesHeading: 'Truck sizes: cargo box, length × width × height',
    noteHeading: 'Good to know',
    note: 'These are typical prices, given as a guide only. Saigon Moving confirms the exact price after the free survey, and it varies from move to move: what you are moving, the floors and whether there is a lift, the distance and the access.',
  },
  vi: {
    title: 'Chuyển nhà trọn gói tại TP. Hồ Chí Minh',
    intro: 'Saigon Moving nhận chuyển nhà trọn gói khắp TP. Hồ Chí Minh và các tỉnh lân cận: khảo sát trước, chuẩn bị vật tư đóng gói, tháo dỡ và bọc lót đồ đạc, rồi bốc xếp, vận chuyển và dỡ hàng tại nhà mới. Nhắn tin cho Saigon Moving ngay trên eno để được tư vấn và khảo sát miễn phí, trực tiếp tại nhà hoặc qua hình ảnh bạn gửi trong khung chat.',
    coversHeading: 'Gói dịch vụ gồm',
    covers: [
      'Tư vấn và khảo sát miễn phí, tại nhà hoặc qua hình ảnh',
      'Vật tư đóng gói: thùng carton, thùng gỗ, giấy gói, màng xốp hơi và mút xốp',
      'Tháo dỡ, bọc lót và bốc xếp đồ đạc; đồ dễ vỡ, cồng kềnh được đóng gói riêng',
      'Xe có tải trọng phù hợp với lượng đồ, lộ trình ngắn và hợp lý',
      'Dỡ hàng tại nhà mới và sắp xếp lại đồ đạc như cũ khi bạn cần',
    ],
    alsoOffices: 'Saigon Moving cũng nhận chuyển văn phòng và kho xưởng.',
    priceHeading: 'Cách tính giá',
    formula: '**Tổng chi phí = cước xe + phí bốc xếp + phụ phí (nếu có).**',
    cardNote: (m) => `Bảng dưới đây là giá tham khảo tại TP. Hồ Chí Minh tính đến tháng 11/2026. Giá ${m.card} hiển thị trên tin này là giá của chuyến nhỏ nhất trong bảng: xe Transit 800 kg cho 10 km đầu (${m.fare}) cộng phí bốc xếp hai đầu (${m.loading}).`,
    fareHeading: 'Cước xe: 10 km đầu, sau đó tính theo km từ km 11 đến km 50',
    fare: (first, perKm) => `${first}, sau đó ${perKm}/km`,
    loadingHeading: 'Bốc xếp hai đầu, tính theo xe',
    extrasHeading: 'Phụ phí',
    extras: (m) => [
      `Thùng carton (60 × 40 × 35 cm): ${m.carton}/thùng`,
      `Màng PE: ${m.pe}/cuộn 2,4 kg`,
      `Tháo và lắp lại máy lạnh: ${m.aircon}/bộ, chưa gồm vệ sinh, nạp gas và vật tư lắp đặt`,
      `Phí chờ: ${m.wait}/giờ, tùy loại xe`,
      'Khiêng đồ bằng cầu thang bộ (không có thang máy), hẻm nhỏ, tầng hầm gửi xe và lắp ráp nội thất: báo giá theo từng trường hợp',
    ],
    sizesHeading: 'Kích thước thùng xe: dài × rộng × cao',
    noteHeading: 'Lưu ý',
    note: 'Đây là giá tham khảo, chỉ mang tính định hướng. Saigon Moving báo giá chính xác sau khi khảo sát miễn phí, và giá thay đổi tùy từng trường hợp: đồ đạc cần chuyển, số tầng và có thang máy hay không, quãng đường và lối ra vào.',
  },
}

const section = (heading: string, lines: readonly string[]) => `# ${heading}\n${lines.join('\n')}`
const bullets = (items: readonly string[]) => items.map((i) => `- ${i}`)

export function saigonmovingTitle(lang: SaigonmovingLang): string {
  return SAIGONMOVING_COPY[lang].title
}

/** The description, in one language: what they do, the formula and what the card price covers, the guide, the caveat. */
export function saigonmovingDescription(lang: SaigonmovingLang): string {
  const c = SAIGONMOVING_COPY[lang]
  const money = (n: number) => saigonmovingMoney(n, lang)
  const smallest = SAIGONMOVING_TRUCKS[0]
  const x = SAIGONMOVING_EXTRAS
  const m: Money = {
    card: money(SAIGONMOVING_CARD_PRICE), fare: money(smallest.first10km), loading: money(smallest.loading),
    carton: money(x.carton), pe: money(x.peRoll), aircon: money(x.aircon),
    wait: `${formatInteger(x.waitFrom, moneyLocale(lang))}–${money(x.waitTo)}`,
  }
  const rows = (value: (t: SaigonmovingTruck) => string) => SAIGONMOVING_TRUCKS.map((t) => `${t.label[lang]}: ${value(t)}`)
  return [
    c.intro,
    section(c.coversHeading, bullets(c.covers)),
    c.alsoOffices,
    section(c.priceHeading, [c.formula]),
    c.cardNote(m),
    section(c.fareHeading, rows((t) => c.fare(money(t.first10km), money(t.perKm)))),
    section(c.loadingHeading, rows((t) => money(t.loading))),
    section(c.extrasHeading, bullets(c.extras(m))),
    section(c.sizesHeading, rows((t) => `${t.box.map((n) => measure(n, lang)).join(' × ')} m`)),
    section(c.noteHeading, [c.note]),
  ].join('\n\n')
}

export type SaigonmovingRow = {
  externalId: string
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  price: number
  priceUnit: string
  currency: string
  negotiable: false
  listingType: 'service'
  subcategorySlug: 'moving-delivery'
  city: string
  district: string
  location: string
  lat: number
  lng: number
  attributes: string
  searchText: string
}

/**
 * The listing row (the storefront, category, photos, rank and publish state are the script's). `providerType` is the
 * DERIVED facet createListingCore writes from the owner's Profile.accountType (core/listings.ts withDerivedAttributes):
 * 'business' only when the account says so.
 */
export function stageSaigonmovingListing(providerType: 'business' | 'individual'): SaigonmovingRow {
  // One-time (a whole move), so 'VND/service' — the Pricing facet mirrors the unit, as createListingCore stores it.
  const money = listingMoneyFor({ categorySlug: 'services', subcategorySlug: 'moving-delivery', listingType: 'service', priceBasis: 'one-time' })
  const title = saigonmovingTitle('en')
  const titleVi = saigonmovingTitle('vi')
  const description = saigonmovingDescription('en')
  const descriptionVi = saigonmovingDescription('vi')
  return {
    externalId: SAIGONMOVING_EXTERNAL_ID,
    title, titleVi, description, descriptionVi,
    price: SAIGONMOVING_CARD_PRICE,
    priceUnit: money.priceUnit,
    currency: money.currency,
    // A service is fixed-price (createListingCore: "SERVICES ARE FIXED-PRICE"): no offers on a quoted job.
    negotiable: false,
    listingType: 'service',
    subcategorySlug: 'moving-delivery',
    city: 'Hồ Chí Minh',
    district: 'Quận Bình Thạnh',
    location: 'Quận Bình Thạnh, Hồ Chí Minh',
    ...SAIGONMOVING_PIN,
    // Their crew comes to you: "At yours". Key order as createListingCore builds it (asked, Pricing, derived).
    attributes: JSON.stringify({ serviceLocation: 'at-customer', priceBasis: 'one-time', providerType }),
    // createListingCore's recipe (titles, descriptions, district, category names) plus the partner's name.
    searchText: buildSearchText([title, titleVi, description, descriptionVi, 'Quận Bình Thạnh', 'Services', 'Dịch vụ', 'Moving', 'Chuyển nhà', SAIGONMOVING_NAME]),
  }
}

export type SaigonmovingSeller = { id: string; ownerId: string | null; ownerEmail: string | null; officialPartner: boolean; trustScore: number }

/** Why this row must not go on this storefront, or null. Handle AND owner email AND chat-only, as blvckSellerRefusal. */
export function saigonmovingSellerRefusal(seller: SaigonmovingSeller | null): string | null {
  if (!seller) return `no storefront with the handle "${SAIGONMOVING_HANDLE}" — register it first: PARTNER_PASSWORD='…' node --env-file=.env scripts/register-partner-seller.mjs saigonmoving --apply`
  if (!seller.ownerId) return `the "${SAIGONMOVING_HANDLE}" storefront (${seller.id}) has no owning account — a customer's message would reach nobody`
  if ((seller.ownerEmail ?? '').toLowerCase() !== SAIGONMOVING_EMAIL) return `the "${SAIGONMOVING_HANDLE}" storefront (${seller.id}) is owned by ${seller.ownerEmail ?? 'an account with no email'}, not ${SAIGONMOVING_EMAIL}`
  if (!seller.officialPartner) return `the "${SAIGONMOVING_HANDLE}" storefront (${seller.id}) is not an official partner yet — run node --env-file=.env scripts/set-official-partner.mjs ${SAIGONMOVING_HANDLE} --apply first`
  return null
}
