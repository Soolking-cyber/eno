/**
 * GoPlus (goplus.com.vn) → eno PARTNER LISTINGS: the PURE half.
 *
 * Owner, 2026-10-19: "remove all apartments and fetch all apartments from https://goplus.com.vn/ once a week for
 * availability they will become our strategic partner for property rental sector" — then "create goplus account
 * contact@goplus.com.vn … users should message that account to ask for availability", "import all available info about
 * apartments and display properly like managment fee electricity rate car access etc", "also fetch videos".
 *
 * Everything here is a function of its arguments — no fetch, no DB, no sharp — so it is unit tested
 * (goplus-listing.test.ts) and scripts/import-goplus.ts stays an I/O shell around it.
 *
 * ─── WHAT IS DIFFERENT FROM EVERY OTHER PROPERTY IMPORTER ────────────────────────────────────────
 * ⛔ THESE ARE NOT REFERENCE LISTINGS. Nhà Tốt, Muaban, Batdongsan… rows belong to an OWNERLESS import storefront and
 * carry an `affiliateUrl` (the PDP then shows an outbound button, never a chat). GoPlus is a PARTNER with its own eno
 * ACCOUNT (scripts/register-partner-seller.mjs goplus): its rows belong to that OWNED storefront and carry NO
 * affiliateUrl — POST /api/conversations answers 409 `reference_listing` for any row with one — so a renter MESSAGES
 * GoPlus on eno about a room, which is the whole point. Consequences, each deliberate:
 *  · the daily age sweep (scripts/expire-rentals.ts) and expire-apartment-rentals.ts act only on ownerless import
 *    sellers with an affiliateUrl, so they NEVER touch these rows: availability is this importer's own job — a room
 *    GoPlus stops listing as vacant ("Trống") is expired here, once a week (planGoplusExpiry);
 *  · the seller is NOT pinned by a fixed id (it is minted at registration): it is resolved by its Handle (`goplus`)
 *    AND the owning Profile's email — both, or nothing is written (goplusSellerRefusal);
 *  · GoPlus is NOT in src/lib/import-sellers.ts — that list is the ownerless import storefronts, and every operator
 *    script that acts on "all imports" (hide-imageless, rank recompute, the sweep) must keep its hands off a partner's
 *    own shop;
 *  · and, being an OWNED storefront, it is NOT outside the seller identity gate the way an ownerless import is: every
 *    create and revival asks it (goplusPublishGate), and a refusal writes the room held, never public.
 *
 * ⛔ PERSONAL / CONTACT DATA NEVER LEAVES stageGoplusRoom. Every room carries GoPlus's hotline, Zalo link and email
 * (`contact`, `saleContact`) — eno's contact path for these rows is the chat, and an official partner shares no
 * phone number (set-official-partner.mjs). Both stagers are WHITELISTS: a field is copied only if it is named below.
 *
 * ⚠️ MEASURED 2026-10-19 (all 2,669 rooms, 819 buildings, read through the public JSON API the site itself uses):
 * HCMC only; status "Trống" (vacant) 2,648 · "Đã thuê" (let) 21; types Duplex 1,272 · Studio 1,158 · 1PN 133 · 2PN 73 ·
 * 3PN 4 · Penhouse 4 · Kiot 7 · MB 1 · none 5 (+ typos: "Studio ", "Studiô", "StudioStudio", "Diplex", "duplex");
 * fees: electricity (đ/kWh) 2,652 · service 2,525 · water per person 2,472 / per m³ 152 · parking (đ/vehicle/month)
 * 1,283; 23 amenity keys; 768 rooms with a video (773 MP4s, 19–35 s sampled, median 5.9 MB); photos 0–34 a room
 * (171 rooms under 3); every photo and video on goplus.com.vn itself; every photo carries GoPlus's own watermark.
 */
import { createHash } from 'node:crypto'
import { buildSearchText, fold } from './fold'
import { facetsFor, listingMoneyFor } from './taxonomy'
import { PublishBlockedError, assertCleanTexts, minPhotosFor } from './publish-guard'
import { dropNearDuplicates, type ImageSizeFloor, type PhotoOutcome } from './import-photo-check'
import { buildFacetTokens } from './facet-tokens'
import { districtOf } from './honeycomb-listing'
import { NHATOT_CITIES, nhatotCoords, nhatotStreetName } from './nhatot-listing'
import { deriveVerification, type VerificationRow } from './compliance/derive-verification'
import { decideBeforeStatus, decideOwned, type SellerPublishDecision } from './compliance/seller-publish-decision'
import { plausibleFee } from './rental-facts'

// ─── the source ─────────────────────────────────────────────────────────────────────────────────

export const GOPLUS_ORIGIN = 'https://goplus.com.vn'
/** Every room, vacant AND let, newest first; `?page=N&limit=M` (the server caps `limit` at 200 — measured). */
export const GOPLUS_ROOMS_API = `${GOPLUS_ORIGIN}/api/public/apartments`
/** Every building ("project") in one answer — district, ward, street and the building's map point. */
export const GOPLUS_PROJECTS_API = `${GOPLUS_ORIGIN}/api/public/projects`
export const GOPLUS_PAGE_MAX = 200
/** The robots.txt product token; the full User-Agent names eno and where to find it. */
export const GOPLUS_UA_TOKEN = 'eno-goplus-import'
export const GOPLUS_UA = `${GOPLUS_UA_TOKEN}/1.0 (+https://eno.vn)`

/**
 * ⛔ THE STOREFRONT IS RESOLVED BY BOTH — the handle alone could be re-claimed by someone else's storefront, and the
 * email alone says nothing about which storefront. scripts/register-partner-seller.mjs creates exactly this pair.
 */
export const GOPLUS_HANDLE = 'goplus'
export const GOPLUS_EMAIL = 'contact@goplus.com.vn'

/** Same category and subcategory as every other apartment (taxonomy.ts): rentals › apartment-rental. */
export const GOPLUS_CATEGORY_SLUG = 'rentals'
export const GOPLUS_SUBCAT = 'apartment-rental'
/** 'VND/month' — the app decides a rent's unit (nhatot-listing.ts NHATOT_PRICE_UNIT says why). */
export const GOPLUS_PRICE_UNIT = listingMoneyFor({ categorySlug: GOPLUS_CATEGORY_SLUG, listingType: 'rent' }).priceUnit
/** The rentals publish floor: 3 DISTINCT photos — the bar a person's own post has to clear (publish-guard). */
export const GOPLUS_MIN_PHOTOS = minPhotosFor(GOPLUS_CATEGORY_SLUG)
/** Photos kept per room. GoPlus sends up to 34 (median 7); ten covers every room's real gallery but the outliers. */
export const GOPLUS_MAX_PHOTOS_DEFAULT = 10
/** GoPlus serves 1280x960 originals; the floor only refuses a thumbnail or a sliver (Nhà Tốt's rule). */
export const GOPLUS_PHOTO_FLOOR: ImageSizeFloor = { minShortEdge: 300 }
/**
 * The folder inside the `listings` bucket. ⛔ NOT `affiliate/m/`: that folder is what overlayMarkFromUrl()
 * (image-mark-url.ts) draws eno's mark over, and these photos already carry GoPlus's own — the owner chose to copy them
 * without a second mark on 2026-10-19. The host stores them with `mark: 'none'` (host-product-image.ts).
 */
export const GOPLUS_PHOTO_PREFIX = 'partner/goplus'
/** The project-wide upload ceiling (core/media.ts VIDEO_MAX_BYTES — a script cannot import that server-only file). */
export const GOPLUS_VIDEO_MAX_BYTES = 50 * 1024 * 1024
/** A listing video is one clip of at most 60 s (schema.prisma Listing.video; the post wizard's own gate). */
export const GOPLUS_VIDEO_MAX_SECONDS = 60
/** A monthly rent outside this is a typo or a sale price, never a room (measured: 1.4 M – 25 M). */
export const GOPLUS_PRICE_MIN = 1_000_000
export const GOPLUS_PRICE_MAX = 200_000_000
/** The Size facet's own range (taxonomy.ts areaM2: 0–500) — a "1820 m²" room is a typo, published as no size. */
export const GOPLUS_AREA_MAX = 500

// ─── staging (the whitelists) ───────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
/** One line: every run of whitespace (newlines included) is one space, so no source value can forge a fact line. */
const s = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim() : ''
  return t ? t : null
}
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** A GoPlus room id: a 24-hex Mongo ObjectId (every one of the 2,669, measured). Anything else is not staged. */
const ROOM_ID = /^[a-f0-9]{24}$/
const PROJECT_ID = /^PRJ-[a-f0-9]{20}$/

export type GoplusFee = { id: 'electric' | 'water' | 'service' | 'parking'; price: number; unit: string | null }
/** The room, as staged: the public row minus every contact field. See the header. */
export type GoplusRoom = {
  id: string
  /** GoPlus's own room code ("002", "A201") — a door label, used only to tell the building's rooms apart in a log. */
  code: string | null
  area: number | null
  maxTenants: number | null
  deposit: number | null
  /** "1" = Trống (vacant), "2" = Đã thuê (let). */
  statusId: string | null
  statusTitle: string | null
  availableDate: string | null
  floor: string | null
  type: string | null
  ward: string | null
  street: string | null
  price: { base: number | null; electric: number | null; water: number | null; waterUnit: string | null; service: number | null }
  fees: GoplusFee[]
  amenityKeys: string[]
  /** Free-text extras typed by GoPlus staff ("Máy giặt riêng") — screened ONE BY ONE before any is published. */
  amenities: string[]
  negotiable: boolean
  projectId: string | null
  updatedAt: string | null
  images: string[]
  videos: string[]
}
export type GoplusProject = {
  projectId: string
  district: string | null
  ward: string | null
  street: string | null
  geo: { lat: number; lng: number; approx: boolean } | null
}

const FEE_IDS = new Set<GoplusFee['id']>(['electric', 'water', 'service', 'parking'])

/** WHITELIST a raw room. Null when it has no usable id. ⛔ `contact`, `saleContact` (hotline, Zalo, email) never copied. */
export function stageGoplusRoom(raw: unknown): GoplusRoom | null {
  if (!isObj(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : typeof raw._id === 'string' ? raw._id : null
  if (!id || !ROOM_ID.test(id)) return null
  const status = isObj(raw.status) ? raw.status : {}
  const price = isObj(raw.price) ? raw.price : {}
  const fees: GoplusFee[] = []
  for (const f of Array.isArray(raw.fees) ? raw.fees : []) {
    if (!isObj(f) || typeof f.id !== 'string' || !FEE_IDS.has(f.id as GoplusFee['id'])) continue
    const p = n(f.price)
    if (p === null) continue
    fees.push({ id: f.id as GoplusFee['id'], price: p, unit: s(f.unit) })
  }
  const projectId = typeof raw.projectId === 'string' && PROJECT_ID.test(raw.projectId) ? raw.projectId : null
  return {
    id,
    code: s(raw.code),
    area: n(raw.area),
    maxTenants: n(raw.maxTenants),
    deposit: n(raw.deposit),
    statusId: typeof status.id === 'string' || typeof status.id === 'number' ? String(status.id) : null,
    statusTitle: s(status.title),
    availableDate: goplusCalendarDay(raw.availableDate),
    floor: isObj(raw.floor) ? s(raw.floor.name) : null,
    type: isObj(raw.type) ? s(raw.type.name) : null,
    ward: s(raw.ward),
    street: s(raw.street),
    price: { base: n(price.base), electric: n(price.electric), water: n(price.water), waterUnit: s(price.waterUnit), service: n(price.service) },
    fees,
    amenityKeys: strs(raw.amenityKeys),
    amenities: strs(raw.amenities).map((a) => s(a)).filter((a): a is string => a !== null),
    negotiable: raw.negotiable === true,
    projectId,
    updatedAt: typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt)) ? raw.updatedAt : null,
    images: strs(raw.images),
    videos: strs(raw.videos),
  }
}

/** WHITELIST a raw building. ⛔ Its `contact` is never copied either. */
export function stageGoplusProject(raw: unknown): GoplusProject | null {
  if (!isObj(raw) || typeof raw.projectId !== 'string' || !PROJECT_ID.test(raw.projectId)) return null
  const g = isObj(raw.geo) ? raw.geo : null
  const lat = g ? n(g.lat) : null, lng = g ? n(g.lng) : null
  return {
    projectId: raw.projectId,
    district: s(raw.district),
    ward: s(raw.ward),
    street: s(raw.street),
    geo: lat !== null && lng !== null ? { lat, lng, approx: g?.approx === true } : null,
  }
}

export const goplusExternalId = (roomId: string) => `goplus:${roomId}`

/**
 * A move-in date as a real Vietnamese calendar day, or null. GoPlus sends a plain `YYYY-MM-DD` (all 612 dated rooms,
 * 2026-10-19); a full timestamp is read as the day it is IN VIETNAM (Mongo stores local midnight as 17:00Z the day
 * before), and a day that does not exist (2026-02-31) is null — never rolled into the next month (reviewers' catches).
 */
export function goplusCalendarDay(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s
    : /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s)) ? new Date(Date.parse(s) + 7 * 3_600_000).toISOString().slice(0, 10)
    : null
  if (!day) return null
  const t = Date.parse(`${day}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === day ? day : null
}
/** The room id back out of a stored externalId ('goplus:<24 hex>'), or null. */
export function goplusRoomIdOf(externalId: unknown): string | null {
  const m = typeof externalId === 'string' ? /^goplus:([a-f0-9]{24})$/.exec(externalId) : null
  return m ? m[1] : null
}

/** A GoPlus photo: on goplus.com.vn's own image folder, a plain file name, a raster extension. Anything else is dropped. */
export const isGoplusImageUrl = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/goplus\.com\.vn\/images\/img\/[A-Za-z0-9_-]{8,80}\.(?:webp|jpe?g|png)$/i.test(u)
/** A GoPlus video: the same host's video folder, MP4 or MOV only (the duration check reads ISO-BMFF; WebM is not). */
export const isGoplusVideoUrl = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/goplus\.com\.vn\/images\/video\/[A-Za-z0-9_-]{8,80}\.(?:mp4|mov)$/i.test(u)

// ─── the room's facts ───────────────────────────────────────────────────────────────────────────

/** "1" is GoPlus's id for "Trống" (vacant) — the ONLY status that is published. */
export const GOPLUS_VACANT_STATUS = '1'

export type GoplusUnit = 'studio' | 'duplex' | 'penthouse' | '1br' | '2br' | '3br' | 'room' | 'commercial' | 'unknown'
/**
 * GoPlus's unit type, typos folded ("Studiô", "StudioStudio", "Diplex", "Penhouse"). A room with no type is a plain
 * "Phòng" (the five measured are titled "403 - Phòng", "G01 - Phòng"). Kiot and MB (mặt bằng — a shop floor) are
 * COMMERCIAL premises, never an apartment: dropped. An unseen type is 'unknown' and dropped rather than guessed.
 */
export function goplusUnit(type: string | null): GoplusUnit {
  if (!type) return 'room'
  const t = fold(type).replace(/[^a-z0-9]/g, '')
  if (!t) return 'room'
  if (t.startsWith('studio')) return 'studio'
  if (t === 'duplex' || t === 'diplex' || t === 'duplec') return 'duplex'
  if (t === 'penthouse' || t === 'penhouse') return 'penthouse'
  const pn = /^([123])pn$/.exec(t)
  if (pn) return `${pn[1]}br` as GoplusUnit
  if (t === 'kiot' || t === 'kiosk' || t === 'mb' || t === 'matbang' || t === 'mbkd') return 'commercial'
  if (t === 'phong') return 'room'
  return 'unknown'
}
const UNIT_LABEL: Record<Exclude<GoplusUnit, 'commercial' | 'unknown'>, { vi: string; en: string; aptType: string | null; bedrooms: string | null }> = {
  // ⚠️ A STUDIO AND A DUPLEX COUNT AS ONE BEDROOM, as every other source lists them (taxonomy.ts aptType: "STUDIO LIVES
  // HERE, not as bedrooms=0") — the Studio/Duplex distinction is `aptType`, so the 1-bedroom chip still finds them.
  studio: { vi: 'Studio', en: 'Studio', aptType: 'studio', bedrooms: '1' },
  duplex: { vi: 'Duplex', en: 'Duplex', aptType: 'duplex', bedrooms: '1' },
  penthouse: { vi: 'Penthouse', en: 'Penthouse', aptType: 'penthouse', bedrooms: null },
  // GoPlus lets serviced flats in small buildings ("căn hộ dịch vụ") — the taxonomy's "Serviced / mini".
  '1br': { vi: 'Căn hộ 1 phòng ngủ', en: '1-bedroom apartment', aptType: 'serviced', bedrooms: '1' },
  '2br': { vi: 'Căn hộ 2 phòng ngủ', en: '2-bedroom apartment', aptType: 'serviced', bedrooms: '2' },
  '3br': { vi: 'Căn hộ 3 phòng ngủ', en: '3-bedroom apartment', aptType: 'serviced', bedrooms: '3' },
  room: { vi: 'Phòng', en: 'Room', aptType: null, bedrooms: null },
}

/**
 * The floor as the `floor` attribute stores it: '0' = ground floor, 'mezzanine', or the floor number as typed ('1' =
 * "Tầng 1", the first floor ABOVE the ground — GoPlus lists "Tầng Trệt" separately). 56 spellings measured
 * ("Tầng Trệt ", "Tầngg Trệt", "Tầng G`", "Tret", "lững", "Tầngv 4", "03"…). A number over 40 is a room number typed
 * into the floor field ("402"), never a floor of a mini building: null, like anything unreadable.
 */
export function goplusFloor(raw: string | null): string | null {
  if (!raw) return null
  const tokens = fold(raw).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  while (tokens.length && /^(?:tang|tangg|tangv|lau)$/.test(tokens[0])) tokens.shift()
  const v = tokens.join(' ')
  if (!v) return null
  if (/^(?:tret|g|ground)$/.test(v)) return '0'
  if (/^(?:lung|l)$/.test(v)) return 'mezzanine'
  const num = /^0*(\d{1,2})$/.exec(v)
  if (num) {
    const k = Number(num[1])
    return k === 0 ? '0' : k <= 40 ? String(k) : null
  }
  return null
}

export type GoplusFees = { electricity: number | null; water: number | null; waterUnit: 'person' | 'm3' | null; service: number | null; parking: number | null }
/**
 * The building's running costs. `fees[]` (with units) wins; `price.*` (no parking, no unit but water's) is the
 * fallback. ⛔ A ZERO IS NOT PUBLISHED: "0 đ/kWh" would read as free electricity, and a missing number is more often
 * "not entered" than "free" — none of the 2,669 rooms carried one, so this costs nothing measured today.
 */
export function goplusFees(room: Pick<GoplusRoom, 'fees' | 'price'>): GoplusFees {
  const pos = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null)
  const fee = (id: GoplusFee['id']) => room.fees.find((f) => f.id === id) ?? null
  const water = fee('water')
  const unitOf = (u: string | null): 'person' | 'm3' | null => {
    const f = fold(u ?? '')
    if (f === 'nguoi' || f === 'person' || f === 'nguoi/thang') return 'person'
    if (f === 'm3' || f === 'm³' || f === 'khoi') return 'm3'
    return null
  }
  // ⚠️ THE UNIT COMES FROM WHERE THE PRICE CAME FROM (a reviewer's catch, 2026-10-19): a fees[] water line with a unit we
  // cannot read must not borrow the price block's unit — "28,000 đ per person" for a per-m³ rate would be a wrong basis.
  const waterFromFees = pos(water?.price)
  const waterPrice = waterFromFees ?? pos(room.price.water)
  return {
    // `pos(a) ?? pos(b)`, never `pos(a ?? b)`: a fees[] line priced 0 must not hide the price block's real figure.
    electricity: pos(fee('electric')?.price) ?? pos(room.price.electric),
    water: waterPrice,
    waterUnit: waterPrice === null ? null : waterFromFees !== null ? unitOf(water!.unit) : unitOf(room.price.waterUnit),
    service: pos(fee('service')?.price) ?? pos(room.price.service),
    parking: pos(fee('parking')?.price),
  }
}

/**
 * GoPlus amenity key → eno's `amenities` facet VALUE (kebab-case — facet-tokens.ts SAFE_VALUE). The values are storage:
 * `balcony` and `pets` keep the spelling the taxonomy already had. `furnished` is not here — it is the `furnishing`
 * attribute ('fully'), a facet of its own.
 * ⛔ NO LABELS HERE. What an amenity is CALLED, and in what order a room's amenities are listed, is the taxonomy's — the
 * `amenities` facet of rentals › apartment-rental (src/lib/taxonomy.ts), which the filter chips and the PDP read too.
 * A second wording here once said "Car-accessible alley" beside the chip's "Car access" (UI review, 2026-10-19).
 */
export const GOPLUS_AMENITY_VALUES: Readonly<Record<string, string>> = {
  no_landlord: 'no-landlord', free_hours: 'free-hours', car_alley: 'car-alley', pet: 'pets', window: 'window',
  balcony: 'balcony', private_wc: 'private-wc', elevator: 'elevator', fingerprint: 'fingerprint-lock', mezzanine: 'mezzanine',
  aircon: 'aircon', water_heater: 'water-heater', kitchen: 'kitchen', fridge: 'fridge', washer: 'washer',
  drying_yard: 'drying-yard', bed: 'bed', wardrobe: 'wardrobe', parking: 'parking', ev_parking: 'ev-parking',
  security: 'security', wifi: 'wifi',
}
/** The taxonomy's `amenities` options for an apartment — value, English and Vietnamese label — in chip order. */
export function amenityOptions(): ReadonlyArray<{ value: string; label: string; labelVi: string }> {
  return facetsFor(GOPLUS_CATEGORY_SLUG, GOPLUS_SUBCAT).find((f) => f.key === 'amenities')?.options ?? []
}
export type GoplusAmenity = { value: string; en: string; vi: string }

/**
 * The room's amenities in the TAXONOMY's order and wording, deduped; `furnished` reported apart. A key this file does not
 * map — or one mapped to a value the taxonomy does not offer — is `unknown`: counted and reported, never published, so a
 * token can never exist that no chip can find.
 */
export function goplusAmenities(keys: readonly string[]): { list: GoplusAmenity[]; furnished: boolean; unknown: string[] } {
  const options = amenityOptions()
  const offered = new Set(options.map((o) => o.value))
  const want = new Set<string>()
  const unknown: string[] = []
  for (const k of new Set(keys)) {
    if (k === 'furnished') continue
    const v = GOPLUS_AMENITY_VALUES[k]
    if (v && offered.has(v)) want.add(v)
    else unknown.push(k)
  }
  return {
    list: options.filter((o) => want.has(o.value)).map((o) => ({ value: o.value, en: o.label, vi: o.labelVi })),
    furnished: keys.includes('furnished'),
    unknown,
  }
}

/**
 * The free-text extras worth publishing (812 rooms carry some: "Máy giặt riêng", "Bàn ăn,Giường, Máy giặt"). Staff
 * type several into one field, so each is split on , ; + | first. Kept: ≤ 60 characters, NO DIGIT (a digit is a
 * surcharge — "bếp từ,máy giặt riêng +500k" — or worse, never an amenity), not a repeat of a structured amenity, and
 * passing the publish screen ON ITS OWN — one bad item is left out, it never costs the room (assertCleanTexts on the
 * whole description would drop the row). At most 8.
 */
export const GOPLUS_EXTRA_MAX = 8
export function goplusExtras(items: readonly string[], structured: readonly { vi: string }[]): string[] {
  const seen = new Set(structured.map((a) => fold(a.vi)))
  const out: string[] = []
  // ⚠️ A SEGMENT THAT CARRIES A NUMBER IS DROPPED WHOLE, BEFORE '+' SPLITS IT (a reviewer's catch, 2026-10-19):
  // "máy giặt riêng +500k" is a surcharge, and splitting first published "Máy giặt riêng" as included.
  const segments = items.flatMap((i) => i.split(/[,;|]/)).filter((seg) => !/\p{N}/u.test(seg))
  for (const raw of segments.flatMap((seg) => seg.split('+'))) {
    const t = raw.replace(/\s+/g, ' ').trim()
    if (!t || t.length > 60) continue
    const k = fold(t)
    if (seen.has(k)) continue
    try { assertCleanTexts([t]) } catch (e) { if (e instanceof PublishBlockedError) continue; throw e }
    seen.add(k)
    out.push(t.charAt(0).toUpperCase() + t.slice(1))
    if (out.length >= GOPLUS_EXTRA_MAX) break
  }
  return out
}

/** Strips Vietnamese marks for an English place name, keeping case: "Trung Mỹ Tây" → "Trung My Tay". */
export function unaccent(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFC')
}

/**
 * The ward in both languages. GoPlus sends the POST-2025 ward ("Phường Trung Mỹ Tây"; it keeps the pre-2025 district
 * beside it, as Nhà Tốt does). ⛔ A ward with a door or alley shape ("12/4") is dropped whole (Nhà Tốt's place rule).
 */
export function goplusWard(raw: string | null): { vi: string; en: string } | null {
  const v = raw?.replace(/\s+/g, ' ').trim()
  if (!v || v.length > 60 || /\d+\s*\/\s*\d+/.test(v)) return null
  const m = /^(Phường|Xã|Thị trấn)\s+(.+)$/iu.exec(v)
  if (!m) return { vi: v, en: unaccent(v) }
  const kind = fold(m[1]), name = m[2].trim()
  if (kind === 'phuong') return { vi: v, en: /^\d{1,2}$/.test(name) ? `Ward ${Number(name)}` : `${unaccent(name)} Ward` }
  if (kind === 'xa') return { vi: v, en: `${unaccent(name)} Commune` }
  return { vi: v, en: `${unaccent(name)} Town` }
}

/**
 * The district as `Listing.district` stores it — 'Quận 12', 'Quận Gò Vấp', 'Huyện Nhà Bè', 'TP. Thủ Đức' — through
 * honeycomb-listing.ts districtOf(), the canonicaliser whose strings the HCMC district chips substring-match (its test
 * asserts that), i.e. exactly the values Nhà Tốt's rows carry. GoPlus sends the bare name ("Gò Vấp", "Quận 12").
 * ⚠️ Bến Cát and Thuận An (old Bình Dương, in HCMC since the 2025 merger; 6 rooms) have no HCMC district chip: they
 * keep `district` NULL — never an invented district string — and their name in the location text.
 */
export function goplusDistrict(raw: string | null): { vi: string; en: string; canonical: boolean } | null {
  if (!raw) return null
  const d = districtOf(raw, null)
  if (d) return { ...d, canonical: true }
  const v = raw.replace(/\s+/g, ' ').trim()
  if (!v || v.length > 40 || /\d+\s*\/\s*\d+/.test(v)) return null
  return { vi: v, en: unaccent(v), canonical: false }
}

const HCM = NHATOT_CITIES.hcm

// ─── the row ────────────────────────────────────────────────────────────────────────────────────

export type GoplusDropReason =
  | 'notVacant' | 'commercial' | 'unknownType' | 'noPrice' | 'priceRange' | 'noProject' | 'noDistrict'
  | 'noImages' | 'tooFewImages' | 'contactInText' | 'bannedWords'

export type GoplusMapped = {
  externalId: string
  roomId: string
  /** Source photo URLs, capped — to be RE-HOSTED (scripts/import-goplus.ts), never stored as they are. */
  images: string[]
  /** Source videos in GoPlus's order; the first that passes the checks is re-hosted. */
  videos: string[]
  /** GoPlus's own last change to the room, clamped to `now` — postedAt at create (and forward on a newer change). */
  sourceAt: Date
  /** Amenity keys GoPlus sent that this file does not know yet — a report, never stored. */
  unknownAmenities: string[]
  /** The refreshable fields: written on create AND on update. Never status / verified / images / video. */
  mutable: {
    title: string
    titleVi: string
    description: string
    descriptionVi: string
    price: number
    priceUnit: string
    currency: '₫'
    negotiable: boolean
    listingType: 'rent'
    subcategorySlug: string
    location: string
    district: string | null
    city: string
    lat: number | null
    lng: number | null
    areaM2: number | null
    attributes: string
    facetTokens: string | null
    searchText: string
  }
}

export type GoplusMapOptions = { now: number; maxPhotos: number }

/** The closing line of every description — OUR text: a renter reaches GoPlus by eno chat. */
export const GOPLUS_OUTRO_VI = 'Nhắn tin cho GoPlus để kiểm tra phòng trống và đặt lịch xem phòng.'
export const GOPLUS_OUTRO_EN = 'Message GoPlus to check availability and book a viewing.'

/**
 * One staged room (and its building) → the row as it would be stored, or the single reason it is not published.
 * `now` clamps the source date and judges `availableDate` (published only while it is still ahead).
 */
export function mapGoplusRoom(room: GoplusRoom, project: GoplusProject | null, opts: GoplusMapOptions): { ok: true; row: GoplusMapped } | { ok: false; reason: GoplusDropReason } {
  if (room.statusId !== GOPLUS_VACANT_STATUS) return { ok: false, reason: 'notVacant' }
  const unit = goplusUnit(room.type)
  if (unit === 'commercial') return { ok: false, reason: 'commercial' }
  if (unit === 'unknown') return { ok: false, reason: 'unknownType' }
  const price = room.price.base
  if (price === null || price <= 0) return { ok: false, reason: 'noPrice' }
  if (price < GOPLUS_PRICE_MIN || price > GOPLUS_PRICE_MAX) return { ok: false, reason: 'priceRange' }
  if (!project) return { ok: false, reason: 'noProject' }
  const district = goplusDistrict(project.district)
  if (!district) return { ok: false, reason: 'noDistrict' }
  /**
   * `maxPhotos` below the floor would drop every row, so the floor wins. ⚠️ TWICE THE CAP AS CANDIDATES (a reviewer's catch,
   * 2026-10-19): the importer judges them in GoPlus's order and keeps the first `maxPhotos` real ones (goplusPhotoPlan
   * maxKeep) — a cap applied BEFORE judging dropped a room whose first ten held a few placeholders.
   */
  const images = [...new Set(room.images.filter(isGoplusImageUrl))].slice(0, 2 * Math.max(GOPLUS_MIN_PHOTOS, opts.maxPhotos))
  if (!images.length) return { ok: false, reason: 'noImages' }
  if (images.length < GOPLUS_MIN_PHOTOS) return { ok: false, reason: 'tooFewImages' }
  const videos = [...new Set(room.videos.filter(isGoplusVideoUrl))]

  const label = UNIT_LABEL[unit]
  const area = typeof room.area === 'number' && room.area > 0 && room.area <= GOPLUS_AREA_MAX ? Math.round(room.area * 10) / 10 : null
  const ward = goplusWard(room.ward ?? project.ward)
  /** ⛔ A STREET NAME, NEVER AN ADDRESS — Nhà Tốt's fail-closed rule (nhatotStreetName): GoPlus's street field holds
   *  door and alley numbers on some rooms ("237/38A1 Phạm Văn Chiêu", "A75 Bạch Đằng, Tân Sơn Hòa"), dropped whole. */
  const street = nhatotStreetName(room.street ?? project.street)
  const floor = goplusFloor(room.floor)
  const fees = goplusFees(room)
  const am = goplusAmenities(room.amenityKeys)
  const extras = goplusExtras(room.amenities, am.list)
  const tenants = typeof room.maxTenants === 'number' && room.maxTenants >= 1 && room.maxTenants <= 20 ? Math.floor(room.maxTenants) : null
  const deposit = typeof room.deposit === 'number' && room.deposit > 0 && room.deposit <= GOPLUS_PRICE_MAX ? Math.round(room.deposit) : null
  // Vietnam's calendar (UTC+7, no DST) — the day a move-in date is written in, and the one the listing page judges it by
  // (rental-facts.ts). Only a date still ahead is stored; one that passes before next week's run the page stops printing.
  const vnToday = new Date(opts.now + 7 * 3_600_000).toISOString().slice(0, 10)
  const availableFrom = room.availableDate && /^\d{4}-\d{2}-\d{2}$/.test(room.availableDate) && room.availableDate > vnToday ? room.availableDate : null
  const coords = project.geo ? nhatotCoords(project.geo.lat, project.geo.lng) : null
  const sourceTime = room.updatedAt ? Date.parse(room.updatedAt) : NaN
  const sourceAt = new Date(Number.isFinite(sourceTime) ? Math.min(sourceTime, opts.now) : opts.now)

  const whereVi = [ward?.vi, district.vi].filter(Boolean).join(', ')
  const whereEn = [ward?.en, district.en].filter(Boolean).join(', ')
  const titleVi = `${label.vi}${area ? ` ${area} m²` : ''} · ${whereVi}`
  const title = `${label.en}${area ? ` ${area} m²` : ''} · ${whereEn}`
  const location = district.canonical ? `${district.vi}${ward ? ` (${ward.vi})` : ''}` : [ward?.vi, district.vi].filter(Boolean).join(', ')

  /**
   * ⛔ ONE OR TWO SENTENCES, NOT A FACT SHEET (UI review, 2026-10-19). The PDP renders the costs (rent, deposit,
   * electricity, water, service fee, parking), the amenities and the details (floor, occupants, move-in date) in their
   * own sections from `attributes` / `facetTokens` (src/lib/rental-facts.ts) — a description repeating them would say
   * everything twice. It names what and where, and how to reach GoPlus. The free-text extras GoPlus staff typed have no
   * section of their own, so they stay — in Vietnamese only, the language they were typed in.
   */
  const placeEn = [street, ward?.en, district.en, HCM.cityEn].filter(Boolean).join(', ')
  const placeVi = [street, ward?.vi, district.vi, HCM.cityVi].filter(Boolean).join(', ')
  const sentenceEn = `${label.en}${area ? ` of ${area} m²` : ''} ${street ? 'on' : 'in'} ${placeEn}.`
  const sentenceVi = `${label.vi}${area ? ` ${area} m²` : ''} tại ${placeVi}.${extras.length ? ` Tiện ích khác: ${extras.join(', ')}.` : ''}`

  /**
   * ⛔ THE CONTACT / BANNED-WORD SCREEN A PERSON'S OWN POST GOES THROUGH (publish-guard assertCleanTexts), on everything
   * this row publishes that came from GoPlus — titles, location, both sentences (the free-text extras were also screened
   * one by one). The closing line is our fixed text.
   */
  try {
    assertCleanTexts([title, titleVi, location, sentenceEn, sentenceVi])
  } catch (e) {
    if (e instanceof PublishBlockedError) return { ok: false, reason: e.code === 'banned_words' ? 'bannedWords' : 'contactInText' }
    throw e
  }

  /** ⛔ ALL STRINGS — attr-match.ts filters with a substring `"key":"value"`, so a number would never match. */
  const attrs: Record<string, string> = {}
  if (label.bedrooms) attrs.bedrooms = label.bedrooms
  if (label.aptType) attrs.aptType = label.aptType
  if (am.furnished) attrs.furnishing = 'fully'
  if (tenants) attrs.maxTenants = String(tenants)
  if (floor) attrs.floor = floor
  if (availableFrom) attrs.availableFrom = availableFrom
  /**
   * ⛔ EVERY AMOUNT THROUGH THE PAGE'S OWN PLAUSIBILITY TEST (rental-facts.ts plausibleFee — RENTAL_FEE_MIN/MAX): GoPlus's
   * own data holds 4,000,000 đ "per kWh" and 10,000,000 đ parking a month (measured 2026-10-19). A figure outside its
   * range is not what its unit says, so it is not stored at all — the page would refuse to print it anyway, and a stored
   * one would sit in the generic table as a raw number. Water only with its unit (an amount without its basis says nothing).
   */
  const fee = (key: string, v: number | null, unit?: string | null) => (v ? plausibleFee(key, String(v), unit ?? undefined) : null)
  const depositOk = fee('deposit', deposit)
  if (depositOk) attrs.deposit = String(depositOk)
  const electricity = fee('electricityPrice', fees.electricity)
  if (electricity) attrs.electricityPrice = String(electricity)
  const water = fees.waterUnit ? fee('waterPrice', fees.water, fees.waterUnit) : null
  if (water && fees.waterUnit) { attrs.waterPrice = String(water); attrs.waterUnit = fees.waterUnit }
  const service = fee('serviceFee', fees.service)
  if (service) attrs.serviceFee = String(service)
  const parking = fee('parkingFee', fees.parking)
  if (parking) attrs.parkingFee = String(parking)

  return {
    ok: true,
    row: {
      externalId: goplusExternalId(room.id),
      roomId: room.id,
      images,
      videos,
      sourceAt,
      unknownAmenities: am.unknown,
      mutable: {
        title,
        titleVi,
        description: `${sentenceEn}\n\n${GOPLUS_OUTRO_EN}`,
        descriptionVi: `${sentenceVi}\n\n${GOPLUS_OUTRO_VI}`,
        price: Math.round(price),
        priceUnit: GOPLUS_PRICE_UNIT,
        currency: '₫',
        negotiable: room.negotiable,
        listingType: 'rent',
        subcategorySlug: GOPLUS_SUBCAT,
        location,
        district: district.canonical ? district.vi : null,
        city: HCM.city,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        areaM2: area,
        attributes: JSON.stringify(attrs),
        /** Multi-valued, so its own column (facet-tokens.ts) — the `amenities` facet filters it. */
        facetTokens: buildFacetTokens({ amenities: am.list.map((a) => a.value) }),
        /** ⚠️ title and titleVi FIRST, as every importer writes it (import-i18n.ts rebaseSearchText relies on it). */
        searchText: buildSearchText([
          title, titleVi, location, district.vi, district.en, ward?.vi, street, HCM.cityVi, HCM.cityEn, 'GoPlus',
          ...am.list.flatMap((a) => [a.vi, a.en]), am.furnished ? 'nội thất đầy đủ fully furnished' : null, ...extras,
        ]),
      },
    },
  }
}

// ─── photos ─────────────────────────────────────────────────────────────────────────────────────

/** One photo's verdict: the shared measure's outcome, or 'gone' (the source answered 404/410 — it no longer exists). */
export type GoplusPhotoOutcome = PhotoOutcome | 'gone'
export type GoplusPhotoPlan = {
  decision: 'create' | 'photoFailed' | 'tooFewRealPhotos'
  keep: number[]
  refused: Partial<Record<'placeholder' | 'tooSmall' | 'undecodable' | 'gone', number>>
  duplicates: number
}
/**
 * ⛔ ONE PHOTO RULE FOR THE PROBE AND --apply (Nhà Tốt's nhatotPhotoPlan, for a partner's gallery):
 *  - a fetch that never got an answer (a timeout, a 5xx after retries) fails the row ('photoFailed') — the next run
 *    retries it rather than publishing a gallery short of a photo we could not see;
 *  - a photo the partner deleted (404/410), one that will not decode, a text card / logo, a thumbnail: LEFT OUT — a
 *    partner's one broken file must not keep the room off eno for good, which fail-closed-on-the-row would do;
 *  - the same shot twice counts once (the publish gate counts DISTINCT angles);
 *  - fewer than `minPhotos` left → 'tooFewRealPhotos', the row is not created.
 */
export function goplusPhotoPlan(judged: { outcome: GoplusPhotoOutcome; hash?: string | null }[], minPhotos = GOPLUS_MIN_PHOTOS, maxKeep = Infinity): GoplusPhotoPlan {
  const refused: GoplusPhotoPlan['refused'] = {}
  const keep: number[] = []
  let failed = false
  judged.forEach((j, i) => {
    if (j.outcome === 'ok') keep.push(i)
    else if (j.outcome === 'fetchFailed') failed = true
    else refused[j.outcome] = (refused[j.outcome] ?? 0) + 1
  })
  if (failed) return { decision: 'photoFailed', keep: [], refused, duplicates: 0 }
  const d = dropNearDuplicates(keep, judged.map((j) => j.hash ?? null))
  const keepCapped = d.keep.slice(0, Math.max(minPhotos, maxKeep))
  return { decision: keepCapped.length >= minPhotos ? 'create' : 'tooFewRealPhotos', keep: keepCapped, refused, duplicates: d.duplicates }
}

/** 16 hex of the SOURCE URL's SHA-256 — the photo's stable name in our bucket (re-runs land on the same object). */
export function goplusSourceKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16)
}

/** The public URL prefix every photo this importer stores starts with (`storageUrl` = NEXT_PUBLIC_SUPABASE_URL). */
export const goplusPhotoUrlPrefix = (storageUrl: string) => `${storageUrl.replace(/\/+$/, '')}/storage/v1/object/public/listings/${GOPLUS_PHOTO_PREFIX}/`
/** The source key a stored photo URL carries, or null when the URL is not one of ours (a person's own upload). */
export function goplusStoredPhotoKey(url: unknown, storageUrl: string): string | null {
  const tail = storedTail(url, goplusPhotoUrlPrefix(storageUrl))
  const m = tail === null ? null : /^([0-9a-f]{16})(?:-h[0-9a-f]{16})?\.webp$/.exec(tail)
  return m ? m[1] : null
}
/**
 * The object name after a storage prefix — matched on the URL's PATH, not its host (a reviewer's catch, 2026-10-19):
 * moving NEXT_PUBLIC_SUPABASE_URL to another domain must not turn every stored GoPlus photo into "a person's upload" and
 * freeze its gallery. The path (`…/listings/partner/goplus/`, `…/listing-videos/<ms>-gp<hex>`) is what says it is ours.
 */
function storedTail(url: unknown, prefix: string): string | null {
  if (typeof url !== 'string') return null
  let path: string, want: string
  try { path = new URL(url).pathname; want = new URL(prefix).pathname } catch { return null }
  return path.startsWith(want) ? path.slice(want.length) : null
}

/**
 * What an EXISTING row's photos need this run.
 *  · 'human'     — a stored photo is not one this importer wrote (GoPlus staff changed the gallery in eno's editor):
 *                  their edit stands, the importer leaves the gallery alone;
 *  · 'unchanged' — every stored photo is still in GoPlus's list: nothing to fetch. ⚠️ A photo GoPlus ADDED is not
 *                  picked up by this (the first run judged the gallery and may have left some out on purpose, so "not
 *                  stored" cannot be told from "refused") — `--refresh-media` re-judges every gallery;
 *  · 'rehost'    — GoPlus removed or replaced a stored photo, or the gallery is empty: judged and re-hosted again (an
 *                  unchanged photo lands on its existing object — the host reuses it).
 */
export function goplusPhotoAction(stored: readonly string[], desired: readonly string[], storageUrl: string, refresh: boolean): 'human' | 'unchanged' | 'rehost' {
  const keys = stored.map((u) => goplusStoredPhotoKey(u, storageUrl))
  if (keys.some((k) => k === null)) return 'human'
  if (refresh || !keys.length) return 'rehost'
  const want = new Set(desired.map(goplusSourceKey))
  return keys.every((k) => want.has(k!)) ? 'unchanged' : 'rehost'
}

// ─── video ──────────────────────────────────────────────────────────────────────────────────────

/** 8 hex of the source URL's SHA-256: the tail of the stored object's name, so a re-run can tell the same clip. */
export const goplusVideoHex = (srcUrl: string) => createHash('sha256').update(srcUrl).digest('hex').slice(0, 8)
/**
 * The object name in `listing-videos`, in the MINTED shape every stored listing video must have (core/media.ts
 * VIDEO_PATH_RE `^\d{10,16}-[a-z0-9]{4,12}\.(mp4|webm|mov)$`, checked by isCanonicalVideoUrl → parseVideoField: a stored
 * URL that fails it is IGNORED by the listing editor). The tail is the source's hash (goplusVideoHex), not a random
 * string, so the importer knows next week which clip it already holds; the head is the real mint time, which the
 * nightly video GC (cron/video-gc) reads only for an object no listing references.
 */
export function goplusVideoObjectName(srcUrl: string, now: number): string {
  const ext = /\.mov$/i.test(srcUrl) ? 'mov' : 'mp4'
  // `gp` + 8 hex: a tail the editor never mints (it mints 6 base-36 characters — upload/video/sign), so a person's own
  // upload can never read as this importer's (a reviewer's catch, 2026-10-19). 10 characters, inside VIDEO_PATH_RE.
  return `${Math.floor(now)}-gp${goplusVideoHex(srcUrl)}.${ext}`
}
export const goplusVideoUrlPrefix = (storageUrl: string) => `${storageUrl.replace(/\/+$/, '')}/storage/v1/object/public/listing-videos/`
/** The source hash a stored video URL carries, or null when it is not one this importer stored (a person's upload). */
export function goplusStoredVideoHex(url: unknown, storageUrl: string): string | null {
  const tail = storedTail(url, goplusVideoUrlPrefix(storageUrl))
  const m = tail === null ? null : /^\d{10,16}-gp([0-9a-f]{8})\.(?:mp4|mov)$/.exec(tail)
  return m ? m[1] : null
}
/**
 * What an EXISTING row's video needs: 'human' (someone set it in eno's editor — it stands), 'unchanged' (the stored clip
 * is one of GoPlus's current ones), 'clear' (GoPlus has no video any more), 'fetch' (no clip yet, or GoPlus replaced it).
 * ⚠️ A ROW WHOSE ONLY CLIP FAILED THE CHECKS (over 60 s, over 50 MB) IS 'fetch' AGAIN NEXT WEEK — the clip is downloaded
 * and judged again; measured, every sampled GoPlus clip passed, so this costs a handful of downloads at most.
 */
export function goplusVideoAction(stored: string | null, desired: readonly string[], storageUrl: string): 'human' | 'unchanged' | 'clear' | 'fetch' {
  if (stored) {
    const hex = goplusStoredVideoHex(stored, storageUrl)
    if (hex === null) return 'human'
    if (desired.some((u) => goplusVideoHex(u) === hex)) return 'unchanged'
    return desired.length ? 'fetch' : 'clear'
  }
  return desired.length ? 'fetch' : 'unchanged'
}

export type Mp4Info = { brand: string | null; durationS: number | null; tracks: string[]; width: number | null; height: number | null }
/**
 * Read an ISO-BMFF (MP4/MOV) file's own header: its `ftyp` brand, the movie duration (`moov/mvhd`), each track's
 * handler (`vide`/`soun`) and the video track's size (`tkhd`). Pure; null when the buffer is not ISO-BMFF at all.
 * ⚠️ The whole file, not its head: a clip that was not "fast-started" keeps `moov` at the END.
 */
export function mp4Info(buf: Uint8Array): Mp4Info | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const type = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])
  if (buf.length < 16 || type(4) !== 'ftyp') return null
  /** The child boxes of [start, end): [type, payloadStart, end] — a box that overruns its parent ends the walk. */
  const boxes = (start: number, end: number): [string, number, number][] => {
    const out: [string, number, number][] = []
    let o = start
    while (o + 8 <= end) {
      let size = dv.getUint32(o)
      let head = 8
      if (size === 1) {
        if (o + 16 > end) break
        const big = dv.getBigUint64(o + 8)
        if (big > BigInt(end - o)) break
        size = Number(big); head = 16
      } else if (size === 0) size = end - o
      if (size < head || o + size > end) break
      out.push([type(o + 4), o + head, o + size])
      o += size
    }
    return out
  }
  const top = boxes(0, buf.length)
  const ftyp = top.find((b) => b[0] === 'ftyp')
  const brand = ftyp && ftyp[2] - ftyp[1] >= 4 ? type(ftyp[1]).trim() : null
  const moov = top.find((b) => b[0] === 'moov')
  const info: Mp4Info = { brand, durationS: null, tracks: [], width: null, height: null }
  if (!moov) return info
  for (const [t, s0, e0] of boxes(moov[1], moov[2])) {
    if (t === 'mvhd' && e0 - s0 >= 20) {
      const v = buf[s0]
      const [scale, dur] = v === 1 && e0 - s0 >= 32
        ? [dv.getUint32(s0 + 20), Number(dv.getBigUint64(s0 + 24))]
        : [dv.getUint32(s0 + 12), dv.getUint32(s0 + 16)]
      if (scale > 0) info.durationS = dur / scale
    }
    if (t === 'trak') {
      let handler: string | null = null
      let size: [number, number] | null = null
      for (const [t2, s2, e2] of boxes(s0, e0)) {
        if (t2 === 'tkhd' && e2 - s2 >= 8) size = [dv.getUint32(e2 - 8) >>> 16, dv.getUint32(e2 - 4) >>> 16]
        if (t2 === 'mdia') for (const [t3, s3, e3] of boxes(s2, e2)) if (t3 === 'hdlr' && e3 - s3 >= 12) handler = type(s3 + 8)
      }
      if (handler) info.tracks.push(handler)
      if (handler === 'vide' && size && size[0] > 0 && size[1] > 0 && info.width === null) [info.width, info.height] = size
    }
  }
  return info
}

export type GoplusVideoVerdict = 'ok' | 'tooBig' | 'notMp4' | 'noDuration' | 'tooLong' | 'noVideoTrack'
/** The listing-video rules, on the downloaded bytes: ≤ 50 MB, ISO-BMFF, a readable duration ≤ 60 s, a picture track. */
export function goplusVideoVerdict(bytes: number, info: Mp4Info | null): GoplusVideoVerdict {
  if (bytes > GOPLUS_VIDEO_MAX_BYTES) return 'tooBig'
  if (!info) return 'notMp4'
  if (info.durationS === null || !Number.isFinite(info.durationS) || info.durationS <= 0) return 'noDuration'
  if (info.durationS > GOPLUS_VIDEO_MAX_SECONDS + 0.5) return 'tooLong'
  /** ⛔ A clip with no picture is a sound file (memory: the 10-18 no-picture clip) — never a listing video. */
  if (!info.tracks.includes('vide')) return 'noVideoTrack'
  return 'ok'
}

// ─── the seller identity gate ───────────────────────────────────────────────────────────────────

/**
 * ⛔ GOPLUS IS AN OWNED STOREFRONT, SO ITS PUBLISHES ASK THE SELLER IDENTITY GATE — unlike Nhà Tốt's ownerless one,
 * which has nobody to verify. The app's own PURE rules (src/lib/compliance/seller-publish-decision.ts), wired exactly as
 * scripts/publish-held.ts wires them: decideBeforeStatus (gate off → allowed, nothing read) → the owner's
 * identity_verifications, derived (derive-verification.ts) → decideOwned (the grace window by account age; revoked and
 * expired refused even inside it). `verifications` is called ONLY when the answer depends on it.
 * A refusal is not an error: the importer writes the room HELD (verified false, identityHold true — never public), and
 * releaseIdentityHolds (src/lib/compliance/identity-holds.ts) publishes it the moment the GoPlus account verifies.
 */
export function goplusPublishGate(
  i: { enforced: boolean; ownerId: string | null; accountCreatedAt: Date | null; now: Date },
  verifications: () => readonly VerificationRow[],
): SellerPublishDecision {
  const early = decideBeforeStatus({ enforced: i.enforced, ownerId: i.ownerId, accountCreatedAt: i.accountCreatedAt, now: i.now })
  if (early) return early
  return decideOwned(deriveVerification([...verifications()], i.now).status, i.accountCreatedAt, i.now)
}

// ─── the read, the storefront, the expiry ───────────────────────────────────────────────────────

/**
 * ⛔ THE READ MUST BE WHOLE BEFORE ANYTHING IS WRITTEN — the expiry below takes every live room the read did not see
 * as vacant, so a short read would expire real rooms. Whole = every page answered, the server's `total` never moved,
 * and exactly `total` distinct rooms collected (a room that shifted pages mid-read shows up twice or not at all).
 * Null = whole; otherwise why not.
 */
export function goplusReadProblem(r: { totals: number[]; collected: number; pages: number; lastPageSize: number }): string | null {
  if (!r.totals.length) return 'no page answered'
  const total = r.totals[0]
  if (!Number.isInteger(total) || total <= 0) return `the server's total is ${total} — not a catalogue`
  if (r.totals.some((t) => t !== total)) return `the server's total moved during the read (${[...new Set(r.totals)].join(' → ')}) — rooms were added or let while paging`
  if (r.collected !== total) return `collected ${r.collected} distinct rooms of the ${total} the server counts — pages shifted during the read`
  // The pagination itself must add up (reviewers' catch): exactly ceil(total / page size) pages, the last one the rest.
  const expected = Math.ceil(total / GOPLUS_PAGE_MAX)
  if (r.pages !== expected) return `${r.pages} pages for ${total} rooms at ${GOPLUS_PAGE_MAX} a page (expected ${expected}) — the server's paging changed`
  if (r.lastPageSize !== total - (expected - 1) * GOPLUS_PAGE_MAX) return `the last page held ${r.lastPageSize} rooms, not the ${total - (expected - 1) * GOPLUS_PAGE_MAX} the total leaves — the server's paging changed`
  return null
}

/** The storefront the rows are written into, as read: the Handle's seller, its owner's email and badges. */
export type GoplusSeller = { id: string; name: string; ownerId: string | null; ownerEmail: string | null; officialPartner: boolean; trustScore: number }
/**
 * ⛔ NOTHING IS WRITTEN INTO A STOREFRONT THAT IS NOT PLAINLY GOPLUS'S: no Handle `goplus` (not registered yet), an
 * ownerless one (chat would reach nobody), or one whose owner is not contact@goplus.com.vn (the handle was claimed by
 * someone else — writing 2,600 rooms into a stranger's shop). Null = fine.
 */
export function goplusSellerRefusal(seller: GoplusSeller | null): string | null {
  if (!seller) return `no storefront with the handle "${GOPLUS_HANDLE}" — register it first: PARTNER_PASSWORD='…' node --env-file=.env scripts/register-partner-seller.mjs goplus --apply`
  if (!seller.ownerId) return `the "${GOPLUS_HANDLE}" storefront (${seller.id}) has no owning account — a renter's message would reach nobody; refusing`
  if ((seller.ownerEmail ?? '').toLowerCase() !== GOPLUS_EMAIL) return `the "${GOPLUS_HANDLE}" storefront (${seller.id}) is owned by ${seller.ownerEmail ?? 'an account with no email'}, not ${GOPLUS_EMAIL} — refusing to write into someone else's shop`
  // ⛔ CHAT-ONLY BEFORE A SINGLE ROOM (a reviewer's catch, 2026-10-19): the official-partner flag is what keeps its rooms
  // out of eno's availability check (rental-check/shared.ts isChatOnlyPartner) and its phone private — so it comes first.
  if (seller.officialPartner !== true) return `the "${GOPLUS_HANDLE}" storefront (${seller.id}) is not marked an official partner yet — run  node --env-file=.env scripts/set-official-partner.mjs goplus --apply  first`
  return null
}

/** Below this many live rows the share guard proves nothing (a first run, a test); at or above it, it applies. Low on
 *  purpose (a reviewer's catch): 99 live rooms and a broken read keeping 1 must refuse too. */
export const GOPLUS_EXPIRY_GUARD_FLOOR = 20
/** The share of the LIVE rows that must survive the expiry, or it reads as a broken read and refuses. */
export const GOPLUS_EXPIRY_MIN_SHARE = 0.6
/**
 * THE AVAILABILITY EXPIRY: every LIVE GoPlus row whose room is not in this run's available set (let, gone from the
 * catalogue, or no longer publishable) → expired. ⛔ Two refusals, both the shape of a broken read or a broken mapper
 * rather than a real week: fewer than GOPLUS_EXPIRY_MIN_SHARE of the live rows SURVIVING (from GOPLUS_EXPIRY_GUARD_FLOOR
 * live rows), or EVERY live row going (from 3). `force` overrides both — for an operator holding independent evidence
 * (GoPlus really did let 40% of its stock in a week).
 * ⚠️ THE SURVIVORS, NEVER THE SIZE OF THE AVAILABLE SET (both reviewers, 2026-10-19): 2,600 live rows and a read of 2,000
 * rooms of which only 1,100 are already live passes a size test (2,000 ≥ 60% of 2,600) and expires 1,500 — exactly what a
 * mapper regression looks like when new stock happens to offset it.
 */
export function planGoplusExpiry(o: { live: readonly { id: string; externalId: string | null }[]; available: ReadonlySet<string>; force: boolean }): { expire: string[]; keep: number; refusal: string | null } {
  // ⛔ ONLY THIS IMPORTER'S ROWS (`goplus:<room id>`): a room GoPlus staff post by hand in eno's editor is theirs, never
  // expired by the feed — and never counted in the guard's share (a reviewer's catch; the importer's query pins it too).
  const ours = o.live.filter((r) => goplusRoomIdOf(r.externalId) !== null)
  const expire = ours.filter((r) => !o.available.has(r.externalId!)).map((r) => r.id)
  const keep = ours.length - expire.length
  let refusal: string | null = null
  if (!o.force && ours.length >= GOPLUS_EXPIRY_GUARD_FLOOR && keep < GOPLUS_EXPIRY_MIN_SHARE * ours.length) {
    refusal = `only ${keep} of the ${ours.length} live GoPlus rows would survive (under ${GOPLUS_EXPIRY_MIN_SHARE * 100}%) — the shape of a broken read or mapper, not a week of lettings; pass --force only with independent evidence`
  } else if (!o.force && ours.length >= 3 && expire.length === ours.length) {
    refusal = `every one of the ${ours.length} live GoPlus rows would expire — refusing; pass --force only with independent evidence`
  }
  return { expire, keep, refusal }
}

/**
 * An --apply run's exit status — the weekly job reads it (scripts/apartments-weekly.sh run_goplus):
 * 2 = a stop (429, a challenge, robots) ended the run early · 3 = the rows were written but the expiry was REFUSED by its
 * guard (alert; no success stamp) · 1 = some row failed on OUR side (an error, an upload, an ISR tombstone) · 0 = all done.
 * A row left out on the SOURCE's photos (too few real ones) is the rule working, not a failure.
 */
export function goplusApplyExitCode(stat: { errored: number; uploadFailed: number; tombstoneFailed: boolean }, stopped: string | null, expiryRefused: boolean): number {
  if (stopped) return 2
  if (expiryRefused) return 3
  return stat.errored + stat.uploadFailed > 0 || stat.tombstoneFailed ? 1 : 0
}
