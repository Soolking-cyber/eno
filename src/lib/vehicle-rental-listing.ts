/**
 * HCMC VEHICLE RENTALS → eno REFERENCE LISTINGS: the pure half of scripts/import-vehicle-rentals.ts.
 *
 * Sources (owner, 2026-09-27/28): Mioto and BonbonCar GRANTED PERMISSION to reuse their listings and
 * photos ("moito have permission same for bonbon"); the motorbike shops were approved as "scrape for
 * now"; and the scope is "focus on hcmc". The scrapes live on disk (all_rentals.json + local photo
 * files per source); this module turns one scrape record into one staged row, or into a counted
 * reason it was dropped. It reads no file and no database — the script passes `fileOk` in — so every
 * rule below is unit-tested in vehicle-rental-listing.test.ts.
 *
 * ⛔ THE SAME INVARIANTS AS THE REVER IMPORT (scripts/import-rever-rentals.ts), for the same reasons:
 * `affiliateUrl` always set and host-pinned per source, `negotiable:false`, `listingType:'rent'` (also
 * the Meta/Google feed guard), sellers pinned by ID, and `status`/`verified`/`images` create-only. Read
 * that header before changing any of them here.
 *
 * ⛔ A RENT PRICE CARRIES ITS PERIOD. A car is priced per DAY, Jan's bikes per MONTH, other shops per
 * day/week/month. The period goes into `priceUnit` through listingMoneyFor({ rentalPeriod }) — the one
 * place the money shape is decided — and into the `rentalPeriod` facet, so the price never prints as
 * "/ month" on a per-day car.
 */
import { buildSearchText } from './fold'
import { listingMoneyFor, type RentalPeriod } from './taxonomy'
import { buildFacetTokens } from './facet-tokens'
import { usdToVnd } from './honeycomb-listing'
import { formatMoneyFull } from './vnd'

// ── Sources and sellers ──────────────────────────────────────────────────────────────────────────

/**
 * One Seller row per source. ⛔ PINNED BY ID: `Seller.name` is user-settable and not unique, so a
 * name lookup could attach these rows to a real person's shop (the Rever importer's header has the
 * incident). The ids are readable on purpose, like honeycomb-import-seller-0001.
 * `target` pins the host of the outbound link: `affiliateUrl` becomes a live button on the PDP, and
 * nothing downstream checks WHERE it points (safeAffiliateUrl only requires https).
 */
export const VEHICLE_SELLERS = {
  mioto: { id: 'vehicle-import-seller-mioto', name: 'Mioto', target: /^https:\/\/www\.mioto\.vn\/car\/[a-z0-9-]+\/[A-Z0-9]+$/ },
  bonboncar: { id: 'vehicle-import-seller-bonboncar', name: 'BonbonCar', target: /^https:\/\/www\.bonboncar\.vn\/detail\/[A-Za-z0-9_.-]+$/ },
  janmotorbike: { id: 'vehicle-import-seller-janmotorbike', name: "Jan's Motorbike", target: /^https:\/\/janmotorbike\.com\/[^\s]+$/ },
  theextramile: { id: 'vehicle-import-seller-theextramile', name: 'The Extra Mile', target: /^https:\/\/theextramile\.co\/[^\s]+$/ },
  dungmotorbikes: { id: 'vehicle-import-seller-dungmotorbikes', name: 'Dung Motorbikes', target: /^https:\/\/dungmotorbikes\.com\/[^\s]+$/ },
  tuanmotorbike: { id: 'vehicle-import-seller-tuanmotorbike', name: 'Tuan Motorbike', target: /^https:\/\/tuanmotorbike\.com\/[^\s]+$/ },
  rentabikevn: { id: 'vehicle-import-seller-rentabikevn', name: 'Rentabike Vietnam', target: /^https:\/\/rentabikevn\.com\/[^\s]+$/ },
} as const
export type SellerKey = keyof typeof VEHICLE_SELLERS
export const SHOP_KEYS = ['janmotorbike', 'theextramile', 'dungmotorbikes', 'tuanmotorbike', 'rentabikevn'] as const
export type ShopKey = (typeof SHOP_KEYS)[number]

/**
 * Where each shop's HCMC bikes are, from the shop's own pages (the scrape's `district` field is an
 * address or a sentence, not a district). Stored in the spelling the explorer's district chips match
 * (listings-explorer.constants.ts: `thu-duc` matches 'Thủ Đức', `d4` matches 'Quận 4').
 * null = the shop names no single district (it delivers city-wide).
 */
const SHOP_DISTRICT: Record<ShopKey, string | null> = {
  janmotorbike: 'Thủ Đức', // "An Phu, Thu Duc City (former District 2)"
  theextramile: null,
  dungmotorbikes: 'Quận 4', // "District 4"
  tuanmotorbike: 'Tân Bình', // HCMC branch: "2E Thai Thi Nhan - Tan Binh"
  rentabikevn: null,
}

/** The city every row is filed under — the Rever import's spelling, which the province filter
 *  matches (importers store the Vietnamese name; see eno-province-filter memory / province-match). */
export const HCMC = 'Hồ Chí Minh'

// ── Staged shape ─────────────────────────────────────────────────────────────────────────────────

export type StagedPhoto = { local: string; source: string }
export type StagedVehicle = {
  seller: SellerKey
  externalId: string
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  price: number
  priceUnit: string
  rentalPeriod: RentalPeriod
  subcategorySlug: 'car-rental' | 'motorbike-rental'
  city: string
  district: string | null
  location: string
  lat: number | null
  lng: number | null
  attributes: string
  facetTokens: string | null
  affiliateUrl: string
  /** In display order; the first is the cover. */
  photos: StagedPhoto[]
  searchText: string
  /** When the source record was fetched — the freshness gate reads this, not file mtimes. */
  scrapedAt: string
  /**
   * When the SOURCE listed it (Mioto `timeCreated`, BonbonCar `listed_at`; the scrape time for shops,
   * which publish no date). Written create-only to `postedAt` with the starting rankScore derived
   * from it (the nhatot precedent): stamping ~6,400 rows with the import time would have floated
   * every car above every home on /c/rentals and the feed for weeks, and told buyers a 2023 Mioto
   * listing was "posted 3h ago".
   */
  postedAt: Date
}
export type StageResult = { ok: true; row: StagedVehicle } | { ok: false; reason: string }

export type StageDeps = {
  /** Absolute path of a scrape-relative local image path. */
  resolve: (rel: string) => string
  /** true when the file exists and is non-empty. A zero-byte download is not a photo. */
  fileOk: (abs: string) => boolean
}

export const MAX_PHOTOS = 6
/** Mioto's own galleries run 4–17; a car with fewer than 3 usable photos makes a thin card. */
export const MIOTO_MIN_PHOTOS = 3
/**
 * BonbonCar re-edits a share of its photos with an image model (the real plate swapped for a
 * "bonboncar" plate, some with the model's ✦ mark bottom-right). They come out at that model's output
 * sizes, so the sizes are the tell. Measured 2026-09-28: 1,139 photos on 404 cars.
 */
export const GENERATED_DIMS: ReadonlySet<string> = new Set(['1184x864', '864x1184', '1344x768', '768x1344'])
/** The shop-photo flags the scrape's review recorded that disqualify a photo from a listing. */
export const BAD_PHOTO_FLAGS: ReadonlySet<string> = new Set([
  'stock', 'watermark', 'logo_overlay', 'phone_number', 'phone_in_scene', 'face', 'people', 'likely_third_party',
])
/** A shop photo narrower than this is a thumbnail (the scrape measured 152 under 500px). */
export const MIN_SHOP_PHOTO_WIDTH = 400

/** Price bands per period, in đồng. Wide on purpose — they catch a unit or parse error (a 9.5M/day
 *  BonbonCar typo; a USD figure read as VND), not an expensive car. */
export const PRICE_BAND: Record<RentalPeriod, { min: number; max: number }> = {
  hourly: { min: 20_000, max: 2_000_000 },
  daily: { min: 50_000, max: 8_000_000 },
  weekly: { min: 200_000, max: 30_000_000 },
  monthly: { min: 500_000, max: 60_000_000 },
}
/** BonbonCar's band is tighter: its fleet tops out near 6.5M/day, and its one 9.5M row is a typo
 *  (the same car's 12h price is 760k). */
export const BONBON_DAY_BAND = { min: 300_000, max: 7_000_000 }

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const inBand = (n: number | null, b: { min: number; max: number }): n is number => n !== null && n >= b.min && n <= b.max
/** Vietnam's land extent with room to spare; anything else is a swapped or null-island pair. */
const latOk = (n: number | null): n is number => n !== null && n >= 8 && n <= 24
const lngOk = (n: number | null): n is number => n !== null && n >= 102 && n <= 110
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp
const vnd = (n: number) => formatMoneyFull(n, '₫', 'en')
const vndVi = (n: number) => formatMoneyFull(n, '₫', 'vi')
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** A source date as a Date, never later than `now` (a skewed clock must not out-rank a fresh post),
 *  else the scrape time, else `now`. */
export function sourcePostedAt(raw: unknown, scrapedAt: unknown, now: number = Date.now()): Date {
  for (const v of [raw, scrapedAt]) {
    const t = typeof v === 'string' ? Date.parse(v) : NaN
    if (Number.isFinite(t) && t > 0) return new Date(Math.min(t, now))
  }
  return new Date(now)
}

/**
 * Take contact details OUT of source text before it becomes a public description. eno never
 * publishes phone numbers, and these rows have no owner to contact through them anyway — the
 * outbound button is the contact path. Drops whole lines that are contact blocks ("Contact JAN'S
 * MOTORBIKE : +84…", "Find Us: …", "Check … HERE"), then strips any phone/email/url left inline.
 */
export function redactContact(raw: string): string {
  const lines = raw.replace(/\r/g, '').split('\n')
  const kept = lines.filter((l) => !/\b(contact|whats\s*app|zalo|hotline|find us|call us|liên hệ|sđt|điện thoại)\b|\bhere\.?\s*$/i.test(l))
  return kept.join('\n')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '')
    /**
     * VN phones: +84 / 84 / 0, then 9–10 more digits with at most one space, dot or dash between them.
     * ⛔ NOT PRECEDED BY A DIGIT, DOT OR COMMA, AND NOT FOLLOWED BY A DIGIT. Without the lookbehind the
     * `0` inside "3.000.000 - 5.000.000đ" starts a match (a dot then a zero is a word boundary) and a
     * deposit range was published as "3..000đ" — a reviewer's catch; the test pins it.
     */
    .replace(/(?<![\d.,])(?:\+84|84(?=[\s.\-]?[35789])|0)(?:[\s.\-]?\d){9,10}(?!\d)/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** "VINFAST FADIL 2022" → "VinFast Fadil 2022". Mioto names are upper-cased; a card title in capitals
 *  shouts. Brand spellings from the brands' own marks; a token with a digit keeps its case (CX-5, VF8). */
const BRAND_CASE: Record<string, string> = {
  VINFAST: 'VinFast', BMW: 'BMW', MG: 'MG', KIA: 'Kia', GMC: 'GMC', BYD: 'BYD', MINI: 'MINI', GAC: 'GAC',
  LYNK: 'Lynk', 'MERCEDES-BENZ': 'Mercedes-Benz', MERCEDES: 'Mercedes', 'LAND': 'Land', ROVER: 'Rover',
}
export function titleCaseCar(raw: string): string {
  return raw.trim().split(/\s+/).map((w, i) => {
    const up = w.toUpperCase()
    if (BRAND_CASE[up]) return BRAND_CASE[up]
    if (/^I\d+$/i.test(w)) return 'i' + w.slice(1) // Hyundai i10 / i20
    if (/\d/.test(w)) return up
    if (i > 0 && w.length <= 3 && /^[A-Z]+$/.test(w) && !/^(THE|AND|NEW|MAX|PRO|ONE|VAN)$/.test(up)) return up // trims: GLX, AT, MT, LX
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  }).join(' ')
}

/** Folded facet values the rentals category defines (taxonomy: transmission / seats / delivery). */
function seatsValue(n: number | null): string | null {
  if (n === 4 || n === 5 || n === 7) return String(n)
  return n !== null && n >= 9 ? '9plus' : null
}

const PERIOD_EN: Record<RentalPeriod, string> = { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month' }
const PERIOD_VI: Record<RentalPeriod, string> = { hourly: 'giờ', daily: 'ngày', weekly: 'tuần', monthly: 'tháng' }

function attrsAndTokens(a: {
  rentalPeriod: RentalPeriod
  periods: RentalPeriod[]
  transmission?: 'automatic' | 'manual' | null
  seats?: string | null
  delivery?: ('delivered' | 'pickup')[]
}): { attributes: string; facetTokens: string | null } {
  const attrs: Record<string, string> = { rentalPeriod: a.rentalPeriod }
  if (a.transmission) attrs.transmission = a.transmission
  if (a.seats) attrs.seats = a.seats
  if (a.delivery?.length) attrs.delivery = a.delivery[0]
  // Multi-valued facts go to the importer-only token column (facet-tokens.ts): a car offered by the
  // day AND the hour must answer both chips; `attributes` holds one value per key.
  const facetTokens = buildFacetTokens({
    rentalPeriod: [...new Set([a.rentalPeriod, ...a.periods])],
    ...(a.delivery && a.delivery.length > 1 ? { delivery: a.delivery } : {}),
  })
  return { attributes: JSON.stringify(attrs), facetTokens }
}

function money(rentalPeriod: RentalPeriod) {
  return listingMoneyFor({ categorySlug: 'rentals', listingType: 'rent', rentalPeriod }).priceUnit
}

// ── Mioto ────────────────────────────────────────────────────────────────────────────────────────

const MIOTO_FEATURE_EN: Record<string, string> = {
  ep: 'ETC toll tag', bt: 'Bluetooth', gp: 'GPS', us: 'USB port', sc: 'Reversing camera', ab: 'Airbags',
  dc: 'Dashcam', mp: 'Maps', hd: 'Speed warning', dvd: 'Screen', is: 'Collision sensors', st: 'Spare tyre',
  tpms: 'Tyre-pressure sensors', pc: 'Side camera', p360c: '360° camera', bs: 'Child seat', sr: 'Sunroof',
  bn: 'Pickup bed cover',
}
const FUEL_EN: Record<string, string> = { gasoline: 'Petrol', electric: 'Electric', diesel: 'Diesel', hybrid: 'Hybrid' }
const FUEL_VI: Record<string, string> = { gasoline: 'Xăng', electric: 'Điện', diesel: 'Dầu diesel', hybrid: 'Hybrid' }

/**
 * @param sharedSha1 sha1s that occur on MORE THAN ONE car anywhere in the scrape — one fleet's
 *   leaflet shot sat on 118 cars; it is not a photo of any one of them.
 * @param sha1Of the per-car sha1 list from the scrape's image manifest, aligned with local_images.
 */
export function stageMioto(r: Record<string, any>, deps: StageDeps & { sharedSha1: ReadonlySet<string>; sha1Of: (id: string) => (string | null)[] }): StageResult {
  if (r.city !== 'TP. Hồ Chí Minh') return { ok: false, reason: 'notHcmc' }
  if (Number(r.status) !== 2) return { ok: false, reason: 'notActive' }
  const id = text(r.id)
  if (!/^[A-Z0-9]{4,12}$/.test(id)) return { ok: false, reason: 'badId' }
  const url = text(r.source_url)
  if (!VEHICLE_SELLERS.mioto.target.test(url) || !url.endsWith(`/${id}`)) return { ok: false, reason: 'badTarget' }
  const price = num(r.price_vnd_day)
  if (!inBand(price, PRICE_BAND.daily)) return { ok: false, reason: 'noPrice' }

  const photos = list(r.photos), locals = list(r.local_images), sha1 = deps.sha1Of(id)
  const kept: StagedPhoto[] = []
  for (let i = 0; i < photos.length && kept.length < MAX_PHOTOS; i++) {
    const rel = locals[i]
    if (typeof rel !== 'string' || typeof photos[i] !== 'string') continue
    const h = sha1[i]
    if (h && deps.sharedSha1.has(h)) continue
    const abs = deps.resolve(rel)
    if (!deps.fileOk(abs)) continue
    kept.push({ local: abs, source: photos[i] as string })
  }
  if (kept.length < MIOTO_MIN_PHOTOS) return { ok: false, reason: 'fewPhotos' }

  const name = titleCaseCar(text(r.name) || 'Car')
  const seats = num(r.seats)
  const transmission = r.transmission === 'automatic' || r.transmission === 'manual' ? r.transmission : null
  const fuel = text(r.fuel)
  const district = text(r.district) || null
  // ⛔ WARD + DISTRICT ONLY, never the source's free `address`: a P2P car's location is often its
  // owner's home, and a street line in the text would undo the rounded pin below (plan reviewer).
  const address = [text(r.ward), district].filter(Boolean).join(', ')
  const periods: RentalPeriod[] = Number(r.rentByHour) === 1 ? ['daily', 'hourly'] : ['daily']
  const delivery: ('delivered' | 'pickup')[] = Number(r.deliveryEnable) === 1 ? ['delivered', 'pickup'] : ['pickup']

  const spec = [seats ? `${seats} seats` : null, transmission].filter(Boolean).join(' · ')
  const specVi = [seats ? `${seats} chỗ` : null, transmission ? (transmission === 'automatic' ? 'số tự động' : 'số sàn') : null].filter(Boolean).join(' · ')
  const title = `${name} self-drive rental${spec ? ` · ${spec}` : ''}${district ? ` — ${district}` : ''}`
  const titleVi = `Cho thuê xe tự lái ${name}${specVi ? ` · ${specVi}` : ''}${district ? ` — ${district}` : ''}`

  const wk = num(r.discountWeekly) ?? 0, mo = num(r.discountMonthly) ?? 0
  const limitKm = Number(r.limitEnable) === 1 ? num(r.limitKM) : null
  const limitFee = num(r.limitPrice)
  const featEn = list(r.feature_ids).map((f) => MIOTO_FEATURE_EN[String(f)]).filter(Boolean)
  const featVi = list(r.features).map(String).filter(Boolean)
  const papers = list(r.requiredPapers).map(String).filter(Boolean)
  const mortgages = list(r.mortgages).map(String).filter(Boolean)
  const owner = redactContact(text(r.desc))
  const trips = num(r.totalTrips) ?? 0

  const factsEn = [
    `Price: ${vnd(price)}/day (list price; Mioto shows the final total, fees included, at booking)`,
    wk || mo ? `Longer rentals: ${[wk ? `${wk}% off weekly` : null, mo ? `${mo}% off monthly` : null].filter(Boolean).join(' · ')}` : null,
    periods.includes('hourly') ? 'Hourly rental available' : null,
    spec ? `Car: ${[seats ? `${seats} seats` : null, transmission, fuel ? FUEL_EN[fuel] ?? fuel : null].filter(Boolean).join(' · ')}` : null,
    limitKm ? `Mileage: ${limitKm} km/day included${limitFee ? `, then ${vnd(limitFee)}/km` : ''}` : null,
    delivery[0] === 'delivered' ? `Delivery: available${num(r.deliveryRadius) ? ` within ${num(r.deliveryRadius)} km` : ''} (fee applies)` : 'Pickup at the car’s location',
    Number(r.airportDeliveryEnable) === 1 ? 'Airport delivery available' : null,
    featEn.length ? `Features: ${featEn.join(', ')}` : null,
    address ? `Pickup area: ${address}` : null,
    trips ? `Trips completed on Mioto: ${trips}` : null,
  ].filter(Boolean).join('\n')
  const factsVi = [
    `Giá thuê: ${vndVi(price)}/ngày (giá niêm yết; tổng tiền cuối cùng, gồm các khoản phí, hiển thị trên Mioto khi đặt xe)`,
    wk || mo ? `Thuê dài ngày: ${[wk ? `giảm ${wk}% theo tuần` : null, mo ? `giảm ${mo}% theo tháng` : null].filter(Boolean).join(' · ')}` : null,
    periods.includes('hourly') ? 'Có cho thuê theo giờ' : null,
    specVi || fuel ? `Xe: ${[seats ? `${seats} chỗ` : null, transmission ? (transmission === 'automatic' ? 'số tự động' : 'số sàn') : null, fuel ? FUEL_VI[fuel] ?? fuel : null].filter(Boolean).join(' · ')}` : null,
    limitKm ? `Giới hạn: ${limitKm} km/ngày${limitFee ? `, vượt tính ${vndVi(limitFee)}/km` : ''}` : null,
    delivery[0] === 'delivered' ? `Giao xe tận nơi${num(r.deliveryRadius) ? ` trong bán kính ${num(r.deliveryRadius)} km` : ''} (có phí)` : 'Nhận xe tại vị trí xe',
    Number(r.airportDeliveryEnable) === 1 ? 'Có giao xe sân bay' : null,
    featVi.length ? `Tiện nghi: ${featVi.join(', ')}` : null,
    papers.length ? `Giấy tờ thuê xe: ${papers.join('; ')}` : null,
    mortgages.length ? `Tài sản thế chấp: ${mortgages.join('; ')}` : null,
    address ? `Khu vực nhận xe: ${address}` : null,
    trips ? `Số chuyến đã hoàn thành trên Mioto: ${trips}` : null,
  ].filter(Boolean).join('\n')

  const lat = num(r.lat), lng = num(r.lon)
  const { attributes, facetTokens } = attrsAndTokens({ rentalPeriod: 'daily', periods, transmission, seats: seatsValue(seats), delivery })
  return {
    ok: true,
    row: {
      seller: 'mioto',
      externalId: `mioto:${id}`,
      title, titleVi,
      description: `Self-drive car listed on Mioto.vn — book and pay on Mioto.\n\n${factsEn}${owner ? `\n\nOwner’s description (Vietnamese):\n${owner}` : ''}`,
      descriptionVi: `Xe tự lái đăng trên Mioto.vn — đặt xe và thanh toán trên Mioto.\n\n${factsVi}${owner ? `\n\nMô tả của chủ xe:\n${owner}` : ''}`,
      price, priceUnit: money('daily'), rentalPeriod: 'daily',
      subcategorySlug: 'car-rental',
      city: HCMC, district,
      location: [address, HCMC].filter(Boolean).join(', '),
      /**
       * ⛔ ROUNDED TO 2 DECIMALS (~1 km). Mioto is peer-to-peer: a car's coordinates are very often
       * its owner's HOME. Mioto itself shows an approximate area until a booking; a pin on our map at
       * full precision would publish the address. A reviewer raised it at plan time.
       */
      lat: latOk(lat) && lngOk(lng) ? round(lat, 2) : null,
      lng: latOk(lat) && lngOk(lng) ? round(lng, 2) : null,
      attributes, facetTokens,
      affiliateUrl: url,
      photos: kept,
      searchText: buildSearchText([title, titleVi, name, district, address, 'mioto thuê xe tự lái ô tô car rental self drive']),
      scrapedAt: text(r.scraped_at),
      postedAt: sourcePostedAt(r.timeCreated, r.scraped_at),
    },
  }
}

// ── BonbonCar ────────────────────────────────────────────────────────────────────────────────────

const BONBON_TRANSMISSION: Record<string, 'automatic' | 'manual'> = { 'Số tự động': 'automatic', 'Số sàn': 'manual' }
const BONBON_FUEL_EN: Record<string, string> = { 'Xăng': 'Petrol', 'Điện': 'Electric', 'Dầu': 'Diesel' }

export function stageBonbon(r: Record<string, any>, deps: StageDeps): StageResult {
  if (r.city !== 'Hồ Chí Minh') return { ok: false, reason: 'notHcmc' }
  if (r.status !== 'Onboard' || r.detail_ok !== true) return { ok: false, reason: 'notActive' }
  const sku = text(r.sku)
  if (!/^[A-Za-z0-9_.-]{2,40}$/.test(sku)) return { ok: false, reason: 'badId' }
  const url = text(r.source_url)
  if (!VEHICLE_SELLERS.bonboncar.target.test(url) || !url.endsWith(`/${sku}`)) return { ok: false, reason: 'badTarget' }
  const price = num(r.price_per_day_vnd)
  if (!inBand(price, BONBON_DAY_BAND)) return { ok: false, reason: 'noPrice' }

  const photos = list(r.photos), locals = list(r.local_images), meta = list(r.image_meta)
  const kept: StagedPhoto[] = []
  let generated = 0
  for (let i = 0; i < photos.length && kept.length < MAX_PHOTOS; i++) {
    const rel = locals[i], m = meta[i] as { width?: number; height?: number } | undefined
    if (typeof rel !== 'string' || typeof photos[i] !== 'string') continue
    if (m && GENERATED_DIMS.has(`${m.width}x${m.height}`)) { generated++; continue }
    const abs = deps.resolve(rel)
    if (!deps.fileOk(abs)) continue
    kept.push({ local: abs, source: photos[i] as string })
  }
  if (!kept.length) return { ok: false, reason: generated ? 'onlyGeneratedPhotos' : 'noPhotos' }

  const name = text(r.name) || text(r.model) || 'Car'
  const seats = num(r.seats)
  const transmission = BONBON_TRANSMISSION[text(r.transmission)] ?? null
  const fuel = text(r.fuel)
  const district = text(r.district) || null
  const ward = text(r.ward) || null
  const hourly = r.rent_unit === 'hour'
  const periods: RentalPeriod[] = hourly ? ['daily', 'hourly'] : ['daily']
  const deliveryKm = num(r.max_delivery_km)
  const delivery: ('delivered' | 'pickup')[] = deliveryKm ? ['delivered', 'pickup'] : ['pickup']
  const deposit = num(r.deposit_vnd)
  const kmLimit = num(r.km_limit_per_24h)
  const overKm = text(r.over_km_fee)
  const weekend = num(r.weekend_surcharge_per_day_vnd)
  const pk = ([['1h', r.price_1h_vnd], ['4h', r.price_4h_vnd], ['8h', r.price_8h_vnd], ['12h', r.price_12h_vnd]] as [string, unknown][])
    // A package that costs more than the 24h price is a parse error, not a package.
    .map(([k, v]) => [k, num(v)] as const).filter(([, v]) => v !== null && v > 0 && v < price)
  const features = list(r.features).map(String).filter(Boolean)
  const blurb = redactContact(text(r.description))

  const spec = [seats ? `${seats} seats` : null, transmission].filter(Boolean).join(' · ')
  const specVi = [seats ? `${seats} chỗ` : null, transmission ? (transmission === 'automatic' ? 'số tự động' : 'số sàn') : null].filter(Boolean).join(' · ')
  const title = `${name} self-drive rental${spec ? ` · ${spec}` : ''}${district ? ` — ${district}` : ''}`
  const titleVi = `Cho thuê xe tự lái ${name}${specVi ? ` · ${specVi}` : ''}${district ? ` — ${district}` : ''}`

  const factsEn = [
    `Price: ${vnd(price)} per 24 hours`,
    hourly && pk.length ? `Hourly packages: ${pk.map(([k, v]) => `${k} ${vnd(v!)}`).join(' · ')}` : null,
    weekend ? `Weekend surcharge: ${vnd(weekend)}/day` : null,
    deposit ? `Deposit: ${vnd(deposit)}` : null,
    kmLimit ? `Mileage: ${kmLimit} km per 24h included${overKm ? `, then ${overKm}` : ''}` : null,
    spec || fuel ? `Car: ${[seats ? `${seats} seats` : null, transmission, BONBON_FUEL_EN[fuel] ?? (fuel || null)].filter(Boolean).join(' · ')}` : null,
    deliveryKm ? `Delivery: available within ${deliveryKm} km (fee may apply)` : 'Pickup at the car’s location',
    [ward, district].filter(Boolean).length ? `Pickup area: ${[ward, district].filter(Boolean).join(', ')}` : null,
  ].filter(Boolean).join('\n')
  const factsVi = [
    `Giá thuê: ${vndVi(price)}/24 giờ`,
    hourly && pk.length ? `Gói theo giờ: ${pk.map(([k, v]) => `${k} ${vndVi(v!)}`).join(' · ')}` : null,
    weekend ? `Phụ thu cuối tuần: ${vndVi(weekend)}/ngày` : null,
    deposit ? `Đặt cọc: ${vndVi(deposit)}` : null,
    kmLimit ? `Giới hạn: ${kmLimit} km/24 giờ${overKm ? `, vượt tính ${overKm}` : ''}` : null,
    specVi || fuel ? `Xe: ${[seats ? `${seats} chỗ` : null, transmission ? (transmission === 'automatic' ? 'số tự động' : 'số sàn') : null, fuel || null].filter(Boolean).join(' · ')}` : null,
    deliveryKm ? `Giao xe tận nơi trong bán kính ${deliveryKm} km (có thể tính phí)` : 'Nhận xe tại vị trí xe',
    features.length ? `Tiện nghi: ${features.join(', ')}` : null,
    [ward, district].filter(Boolean).length ? `Khu vực nhận xe: ${[ward, district].filter(Boolean).join(', ')}` : null,
  ].filter(Boolean).join('\n')

  const lat = num(r.latitude), lng = num(r.longitude)
  const { attributes, facetTokens } = attrsAndTokens({ rentalPeriod: 'daily', periods, transmission, seats: seatsValue(seats), delivery })
  return {
    ok: true,
    row: {
      seller: 'bonboncar',
      externalId: `bonboncar:${sku}`,
      title, titleVi,
      description: `Self-drive car from BonbonCar — book and pay on bonboncar.vn.\n\n${factsEn}${features.length ? `\nFeatures (Vietnamese): ${features.join(', ')}` : ''}`,
      descriptionVi: `Xe tự lái của BonbonCar — đặt xe và thanh toán trên bonboncar.vn.\n\n${factsVi}${blurb ? `\n\n${blurb}` : ''}`,
      price, priceUnit: money('daily'), rentalPeriod: 'daily',
      subcategorySlug: 'car-rental',
      city: HCMC, district,
      location: [ward, district, HCMC].filter(Boolean).join(', '),
      // Already rounded to 3 decimals by the scrape (company parking lots, not homes).
      lat: latOk(lat) && lngOk(lng) ? round(lat, 3) : null,
      lng: latOk(lat) && lngOk(lng) ? round(lng, 3) : null,
      attributes, facetTokens,
      affiliateUrl: url,
      photos: kept,
      searchText: buildSearchText([title, titleVi, name, text(r.brand), district, ward, 'bonboncar thuê xe tự lái ô tô car rental self drive']),
      scrapedAt: text(r.scraped_at),
      postedAt: sourcePostedAt(r.listed_at, r.scraped_at),
    },
  }
}

// ── Motorbike shops ──────────────────────────────────────────────────────────────────────────────

const BIKE_TRANSMISSION: Record<string, 'automatic' | 'manual'> = {
  'automatic scooter': 'automatic', electric: 'automatic', 'semi-automatic': 'manual', manual: 'manual',
}
const BIKE_TYPE_EN: Record<string, string> = {
  'automatic scooter': 'Automatic scooter', electric: 'Electric scooter', 'semi-automatic': 'Semi-automatic', manual: 'Manual (clutch)',
}
const BIKE_TYPE_VI: Record<string, string> = {
  'automatic scooter': 'Xe ga', electric: 'Xe điện', 'semi-automatic': 'Xe số', manual: 'Xe côn tay',
}
const UNIT_PERIOD: Record<string, RentalPeriod> = { day: 'daily', week: 'weekly', month: 'monthly' }
/** The period a bike card leads with: the shortest the shop quotes (a day beats a month for a
 *  visitor comparing shops), so Jan's — monthly only — leads with its monthly price. */
const PERIOD_ORDER: RentalPeriod[] = ['daily', 'weekly', 'monthly']

export type Fx = { vndPerUsd: number; source: string }

/** "Honda Airblade 125cc for Rent" → "Honda Airblade 125cc". */
export function cleanBikeName(raw: string): string {
  return raw.replace(/\s*[-–—|]?\s*(for\s+rent|rental|cho\s+thuê)\s*$/i, '').replace(/\s+/g, ' ').trim()
}

export function stageShopBike(r: Record<string, any>, deps: StageDeps & { fx: Fx | null }): StageResult {
  const shop = r.shop as ShopKey
  if (!(SHOP_KEYS as readonly string[]).includes(shop)) return { ok: false, reason: 'shopNotInScope' }
  if (!/Ho Chi Minh/.test(text(r.city))) return { ok: false, reason: 'notHcmc' }
  // Jan's reports stock per bike; a bike marked out of stock is not available to rent.
  if (/out of stock/i.test(text(r.availability))) return { ok: false, reason: 'notActive' }
  const extId = text(r.external_id)
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(extId)) return { ok: false, reason: 'badId' }
  const seller = VEHICLE_SELLERS[shop]
  const url = text(r.source_url)
  if (!seller.target.test(url)) return { ok: false, reason: 'badTarget' }

  // Every quoted price, with its OWN currency and unit. The listing price is the shortest period's.
  type Quote = { period: RentalPeriod; vnd: number; usd: number | null; label: string }
  const quotes: Quote[] = []
  let usdWithoutFx = false
  for (const p of list(r.prices) as { amount?: unknown; currency?: unknown; unit?: unknown; label?: unknown }[]) {
    const period = UNIT_PERIOD[String(p.unit)]
    const amount = num(p.amount)
    if (!period || amount === null || amount <= 0) continue
    // "regular (pre-sale) price" / "before sale" is a struck-through figure, not what the rent costs.
    if (/pre-sale|before sale|regular/i.test(String(p.label ?? ''))) continue
    let vndAmount: number | null = null, usd: number | null = null
    if (p.currency === 'VND') vndAmount = amount
    else if (p.currency === 'USD') {
      if (!deps.fx) { usdWithoutFx = true; continue }
      usd = amount
      vndAmount = usdToVnd(amount, deps.fx.vndPerUsd)
    }
    if (vndAmount === null || !inBand(vndAmount, PRICE_BAND[period])) continue
    // Keep the first quote per period (the scrape lists the headline rate first).
    if (!quotes.some((q) => q.period === period)) quotes.push({ period, vnd: vndAmount, usd, label: String(p.label ?? '') })
  }
  if (!quotes.length) return { ok: false, reason: usdWithoutFx ? 'usdNoRate' : 'noPrice' }
  quotes.sort((a, b) => PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period))
  const lead = quotes[0]

  const photos = list(r.photos), locals = list(r.local_images), flags = list(r.photo_flags), meta = list(r.image_meta)
  const kept: StagedPhoto[] = []
  for (let i = 0; i < photos.length && kept.length < MAX_PHOTOS; i++) {
    const rel = locals[i]
    if (typeof rel !== 'string' || typeof photos[i] !== 'string') continue
    if (list(flags[i]).some((f) => BAD_PHOTO_FLAGS.has(String(f)))) continue
    const w = num((meta[i] as { width?: unknown } | undefined)?.width)
    if (w !== null && w < MIN_SHOP_PHOTO_WIDTH) continue
    const abs = deps.resolve(rel)
    if (!deps.fileOk(abs)) continue
    kept.push({ local: abs, source: photos[i] as string })
  }
  if (!kept.length) return { ok: false, reason: 'noPhotos' }

  const name = cleanBikeName(text(r.name)) || [text(r.make), text(r.model)].filter(Boolean).join(' ') || 'Motorbike'
  const type = text(r.type)
  const transmission = BIKE_TRANSMISSION[type] ?? null
  const cc = num(r.engine_cc)
  const district = SHOP_DISTRICT[shop]
  const typeEn = BIKE_TYPE_EN[type], typeVi = BIKE_TYPE_VI[type]
  const title = `${name} for rent${typeEn ? ` · ${typeEn.toLowerCase()}` : ''} — ${seller.name}${district ? `, ${district}` : ''}`
  const titleVi = `Cho thuê xe máy ${name}${typeVi ? ` · ${typeVi.toLowerCase()}` : ''} — ${seller.name}${district ? `, ${district}` : ''}`

  /**
   * ⛔ A CONVERTED PRICE SAYS SO. The shop quotes dollars; the card shows đồng because every eno
   * listing is stored in đồng (taxonomy.ts). The shop's own figure and the rate go into the text
   * next to the price, so nobody reads the converted amount as a quote the shop made in đồng
   * (the Honeycomb precedent, src/lib/honeycomb-listing.ts; a plan reviewer asked for it).
   */
  const priceLine = (q: Quote, vi: boolean) => {
    const amount = vi ? vndVi(q.vnd) : vnd(q.vnd)
    const per = vi ? PERIOD_VI[q.period] : PERIOD_EN[q.period]
    if (q.usd === null) return `${amount}/${per}`
    return vi
      ? `≈ ${amount}/${per} (cửa hàng báo giá US$${q.usd}/${per}; quy đổi ${vndVi(deps.fx!.vndPerUsd)}/US$)`
      : `≈ ${amount}/${per} (the shop quotes US$${q.usd}/${per}; converted at ${vnd(deps.fx!.vndPerUsd)} per US$)`
  }
  const deposit = redactContact(text(r.deposit))
  const deliveryText = redactContact(text(r.delivery))
  const blurb = redactContact(text(r.description)).slice(0, 1500)
  const factsEn = [
    `Price: ${quotes.map((q) => priceLine(q, false)).join(' · ')}`,
    typeEn ? `Type: ${typeEn}${cc ? `, ${cc}cc` : ''}` : cc ? `Engine: ${cc}cc` : null,
    deposit ? `Deposit: ${deposit}` : null,
    deliveryText ? `Delivery: ${deliveryText}` : null,
    `Area: ${district ? `${district}, ` : ''}Ho Chi Minh City`,
  ].filter(Boolean).join('\n')
  const factsVi = [
    `Giá thuê: ${quotes.map((q) => priceLine(q, true)).join(' · ')}`,
    typeVi ? `Loại xe: ${typeVi}${cc ? `, ${cc}cc` : ''}` : cc ? `Dung tích: ${cc}cc` : null,
    `Khu vực: ${district ? `${district}, ` : ''}TP. Hồ Chí Minh`,
  ].filter(Boolean).join('\n')

  const periods = quotes.map((q) => q.period)
  const { attributes, facetTokens } = attrsAndTokens({ rentalPeriod: lead.period, periods, transmission })
  return {
    ok: true,
    row: {
      seller: shop,
      externalId: `${shop}:${extId}`,
      title, titleVi,
      description: `Motorbike rental from ${seller.name}, a rental shop in Ho Chi Minh City — book with the shop on its website.\n\n${factsEn}${blurb ? `\n\nFrom the shop:\n${blurb}` : ''}`,
      descriptionVi: `Xe máy cho thuê của ${seller.name}, cửa hàng cho thuê xe tại TP. Hồ Chí Minh — đặt xe với cửa hàng trên trang web của họ.\n\n${factsVi}${deposit || deliveryText || blurb ? `\n\nThông tin từ cửa hàng (tiếng Anh):\n${[deposit ? `Deposit: ${deposit}` : '', deliveryText ? `Delivery: ${deliveryText}` : '', blurb].filter(Boolean).join('\n')}` : ''}`,
      price: lead.vnd, priceUnit: money(lead.period), rentalPeriod: lead.period,
      subcategorySlug: 'motorbike-rental',
      city: HCMC, district,
      location: [district, HCMC].filter(Boolean).join(', '),
      lat: null, lng: null,
      attributes, facetTokens,
      affiliateUrl: url,
      photos: kept,
      searchText: buildSearchText([title, titleVi, name, text(r.make), text(r.model), seller.name, district, 'thuê xe máy motorbike scooter rental']),
      scrapedAt: text(r.scraped_at),
      postedAt: sourcePostedAt(null, r.scraped_at),
    },
  }
}
