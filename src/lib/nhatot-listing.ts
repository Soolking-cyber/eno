/**
 * Nhà Tốt (nhatot.com, Chợ Tốt's property desk) → eno REFERENCE LISTINGS: the PURE half.
 *
 * Everything here is a function of its arguments — no fetch, no DB, no sharp — so it can be unit
 * tested (nhatot-listing.test.ts) and so scripts/import-nhatot-com.ts stays an I/O shell around it.
 *
 * ─── WHAT THE SOURCE IS ─────────────────────────────────────────────────────────────────────────
 * Chợ Tốt's public JSON gateway: `https://gateway.chotot.com/v1/public/ad-listing?cg=…&st=u&region_v2=…`.
 * The gateway host has no robots.txt (404 → no rules, RFC 9309 §2.3.1.3) and serves no challenge;
 * www.nhatot.com's HTML answers automation with a Cloudflare "Just a moment…" 403, so the importer
 * never touches the HTML. Field shapes below were read from live responses on 2026-09-24.
 *
 * ⛔ PERSONAL DATA NEVER LEAVES `stageNhatotAd` / `classifyNhatotLiveness`. Every ad carries the
 * poster's real name (`account_name`, `full_name`, `seller_info.full_name`, `shop.name`), their
 * avatar, account ids, and free text (`subject`, `body`) that routinely contains a phone number or
 * a first name ("gặp Đô tư vấn"). The detail endpoint (used by the retire pass) adds `phone`. None
 * of it is needed to describe a flat or to tell whether it is still let, so both are WHITELISTS:
 * a field is copied only if it is named below. A blacklist would leak the next field Chợ Tốt adds.
 */
import { buildSearchText } from './fold'
import { listingMoneyFor, roomAttributes, roomCountValue } from './taxonomy'
import { PublishBlockedError, assertCleanTexts, minPhotosFor } from './publish-guard'
import { formatMoneyFull } from './vnd'
import { browseRankScore } from './ranking-formula'
import { dropNearDuplicates, galleryPlan, type ImageSizeFloor, type PhotoOutcome } from './import-photo-check'
import { localizeImportText, type MissingSegment } from './import-i18n'

/**
 * ⛔ THE SELLER IS PINNED BY ID. `Seller.name` is not unique and is user-settable, so a name lookup
 * could attach every imported row to a real person's shop, who would then get the enquiries.
 * ⚠️ THE NAME IS THE OUTBOUND CTA TEXT ("Rent on Nhatot.com"), and the importer refuses to write if
 * the pinned row carries any other name — so pick it BEFORE the first --apply. Domain-style to
 * match the two existing import storefronts ("Batdongsan.com.vn", "Rever.vn").
 */
export const NHATOT_SELLER_ID = 'nhatot-import-seller-0001'
export const NHATOT_SELLER_NAME = 'Nhatot.com'
/**
 * The official NHÀ TỐT wordmark (568x128 PNG, orange/yellow on transparent), served by Chợ Tốt's
 * own static host. ⚠️ set-partner-avatar.ts measures ink on the PADDED 512² square and this
 * wide wordmark scores 6.1% there (26.7% measured fit-inside) — under its 8% floor, the same
 * refusal the Batdongsan wordmark hits. The 176x53 variant below passes (10.7%) but is upscaled ~3x.
 */
export const NHATOT_LOGO_URL = 'https://static.chotot.com/storage/APP_WRAPPER/logo/pty-logo-appwrapper.png'
export const NHATOT_LOGO_FALLBACK_URL = 'https://static.chotot.com/storage/APP_WRAPPER/logo/pty.png'

export const NHATOT_API = 'https://gateway.chotot.com/v1/public/ad-listing'
/** The gateway caps `total` at 10,000 and serves at most 50 rows a page (both measured). */
export const NHATOT_TOTAL_CAP = 10_000
export const NHATOT_PAGE_MAX = 50
/** The robots.txt product token. The full User-Agent is `${token}/1.0 (+https://eno.vn)`. */
export const NHATOT_UA_TOKEN = 'eno-property-import'
export const NHATOT_UA = `${NHATOT_UA_TOKEN}/1.0 (+https://eno.vn)`
/** Politeness floor and default, per host. A rate argument can raise it, never lower it. */
export const NHATOT_GAP_MS_MIN = 1200
export const NHATOT_GAP_MS_DEFAULT = 1200

/**
 * ⛔ `city` IS THE vn-units `name` — 'Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng' — the string the post wizard
 * stores and ~98,000 existing rows already carry (owner/lead decision, 2026-09-24): ONE spelling per
 * city, so anything that groups by `city` sees one bucket. The province filter sends the English
 * `nameEn` and matches the Vietnamese name through province-match.ts's aliases (commit 10107374),
 * so the filter still finds these rows. `provinceCode` is the vn-units.json code; the test pins each
 * `city` to that file's `name` and runs the real filter predicate over it.
 * `cityVi` / `cityEn` are DISPLAY names for titles and the facts block, never stored in `city`.
 */
export const NHATOT_CITIES = {
  hcm: { region: 13000, provinceCode: '79', city: 'Hồ Chí Minh', cityVi: 'TP. Hồ Chí Minh', cityEn: 'Ho Chi Minh City' },
  hn: { region: 12000, provinceCode: '01', city: 'Hà Nội', cityVi: 'Hà Nội', cityEn: 'Hanoi' },
  dn: { region: 3017, provinceCode: '48', city: 'Đà Nẵng', cityVi: 'Đà Nẵng', cityEn: 'Da Nang' },
} as const
export type NhatotCityKey = keyof typeof NHATOT_CITIES
const CITY_BY_REGION = new Map<number, (typeof NHATOT_CITIES)[NhatotCityKey]>(
  Object.values(NHATOT_CITIES).map((c) => [c.region, c]),
)

/**
 * Chợ Tốt category (`cg`) → eno rentals subcategory. Slugs from taxonomy.ts and never renamed.
 * Serviced and mini flats ('Căn hộ dịch vụ, mini') are listed under 1010 and so land in
 * apartment-rental, like every other importer's — never homestay-serviced, which sits beside hotels.
 * ⚠️ Land (1040) maps to NULL on purpose, like Batdongsan's 'Kho xưởng / Đất': forcing it into a
 * home slug would put plots in the flat filter. It is also OFF by default (135 HCMC rows).
 */
export const NHATOT_CATEGORIES: Record<number, { subcat: string | null; kindVi: string; kindEn: string }> = {
  1010: { subcat: 'apartment-rental', kindVi: 'Căn hộ / Chung cư', kindEn: 'Apartment' },
  1020: { subcat: 'house-rental', kindVi: 'Nhà ở', kindEn: 'House' },
  1030: { subcat: 'office-rental', kindVi: 'Văn phòng / Mặt bằng', kindEn: 'Office / shopfront' },
  1050: { subcat: 'room-rental', kindVi: 'Phòng trọ', kindEn: 'Room' },
  1040: { subcat: null, kindVi: 'Đất', kindEn: 'Land' },
}
export const NHATOT_DEFAULT_CATEGORIES = [1010, 1020, 1030, 1050] as const
/** Only homes carry a bedroom facet (taxonomy.ts: bedrooms → apartment/house/room). */
const BEDROOM_SUBCATS = new Set(['apartment-rental', 'house-rental', 'room-rental'])

/**
 * ⛔ THE RENT UNIT COMES FROM THE APP, NOT FROM HERE. taxonomy.ts decides what a rent price's unit
 * is ('VND/month' → <Price> renders "/ month"); writing 'VND' dropped the suffix on every card and
 * made this source's cards look different from Honeycomb's in the same grid.
 */
export const NHATOT_PRICE_UNIT = listingMoneyFor({ categorySlug: 'rentals', listingType: 'rent' }).priceUnit

/** The ad, as staged: the public row minus everything personal. See the header. */
export type NhatotStagedAd = {
  list_id: number
  category: number
  type: string | null
  status: string | null
  region_v2: number | null
  area_v2: number | null
  area_name: string | null
  ward_name: string | null
  ward_name_v3: string | null
  /** SANITISED at staging (nhatotStreetName): never a house or alley number. */
  street_name: string | null
  pty_project_name: string | null
  price: number | null
  price_string: string | null
  is_price_not_valid: boolean
  size: number | null
  size_unit_string: string | null
  rooms: number | null
  toilets: number | null
  latitude: number | null
  longitude: number | null
  images: string[]
  list_time: number | null
  kind_label: string | null
  furnishing_label: string | null
  company_ad: boolean | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A staged string: one line (every run of whitespace, newlines included, is one space) so no source
 *  value can forge a second "Key: value" fact line in the description. */
const s = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return t ? t : null
}
/** A place name (ward, district): a staged string that is not a door — '506/35' drops it whole. */
const place = (v: unknown): string | null => {
  const t = s(v)
  return t && !/\d+\s*\/\s*\d+/.test(t) ? t : null
}
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The labelled value Chợ Tốt renders for a param id ("Loại hình" → "Chung cư"), read from feature_params. */
function featureLabel(ad: Obj, ids: string[]): string | null {
  const fp = ad.feature_params
  if (!isObj(fp)) return null
  for (const section of Object.values(fp)) {
    const items = isObj(section) && Array.isArray(section.items) ? section.items : []
    for (const it of items) {
      if (isObj(it) && typeof it.id === 'string' && ids.includes(it.id)) {
        const v = s(it.value)
        if (v) return v
      }
    }
  }
  return null
}

/**
 * ⛔ A STREET NAME, NEVER AN ADDRESS. Chợ Tốt's `street_name` is poster-typed: of 171 distinct
 * values in the 2026-09-24 cache, 36 carried digits — door and alley numbers ('506/35 Lạc Long
 * Quân', '76 Nguyễn Xí', 'Hẻm 656 Quang Trung', 'Ngõ 14 Phố Mễ Trì Hạ') beside real numbered names
 * ('Đường số 12', 'Đường 15B', 'Đường Quốc lộ 50'). On a private landlord's room a door number is
 * their home address, next to photos of it.
 *
 * THE CONTRACT — a value is published only when it is, WHOLE, one of:
 *  (a) a plain name: Latin-script letters, spaces and . ' - only — so NO digit of any script (a
 *      fullwidth '１２' or a Roman 'Ⅻ' is not a letter) and no look-alike from another script; none
 *      of the alley/door words in ALLEY_WORD anywhere, whatever tone it is typed with; ≤ 60 characters;
 *  (b) EXACTLY a numbered street NAME from NUMBERED_STREET — shapes with no named street in them for
 *      a door number to belong to: 'Đường số 12', 'Đường 15B', 'Quốc lộ 13', '3 Tháng 2', 'Đường 3/2'.
 * Everything else is DROPPED WHOLE — nothing is stripped or salvaged.
 * ⚠️ WHY NOTHING IS SALVAGED: the first cut stripped a leading number and then trusted any value that
 * began with 'Đường'/'Phố'/'Quốc lộ' to carry its digits legitimately, which published
 * 'Đường Kiệt 64 Trần Đình Tri', 'Đường Nguyễn Trãi 123', 'Phố Huế 102' and 'Quốc lộ 13 số 250'
 * (review, 2026-09-24). A named street followed by a number ('Thạnh Xuân 13', 'Bàu Cát 3') is
 * sometimes a real name and sometimes a door, and the two cannot be told apart — so it is dropped.
 * The cost is a missing "Street:" fact on those rows; the ward and district still say where it is.
 * ⚠️ 'kiệt' is an alley word AND a given name, so 'Võ Văn Kiệt' boulevard is dropped too — the same
 * fail-closed trade, taken deliberately rather than special-cased.
 * ⚠️ THE NUMBERED SHAPES CAN READ LIKE A BARE DOOR ('Đường 102', 'Đường 12/4'), and are kept anyway:
 * each has no named street in it, and a door or alley number locates nothing without the street it
 * is on — 'Đường 102' is also a real street in Thủ Đức, and 'Đường 12/4' has exactly the shape of the
 * 'Đường 3/2' the owner listed as a street to keep. Telling them apart would need a street register.
 * Idempotent (an accepted value is returned as typed, normalised), so a staged file re-staged on read
 * is unchanged.
 */
const NUMBERED_STREET: RegExp[] = [
  /^đường số [0-9]{1,3}[a-z]?$/iu,                                                        // Đường số 12, Đường Số 1A
  /^đường [0-9]{1,3}[a-z]?$/iu,                                                           // Đường 15B, Đường 65
  /^(?:đường )?(?:quốc lộ|ql|tỉnh lộ|tl|hương lộ|đường tỉnh|đt) ?[0-9]{1,3}[a-z]?$/iu,    // Quốc lộ 13, QL13, Đường Quốc lộ 50
  /^(?:(?:đường|phố) )?(?:[1-9]|[12][0-9]|3[01]) tháng (?:[1-9]|1[0-2])$/iu,               // 3 Tháng 2, Đường 30 Tháng 4
  /^(?:đường|phố) (?:[1-9]|[12][0-9]|3[01]) ?\/ ?(?:[1-9]|1[0-2])$/iu,                     // Đường 3/2, Phố 8/3 — a BARE '3/2' is a door
]
/**
 * Alley / door words, as whole words, matched on the TONELESS lower-case form (see `toneless`): so a
 * misspelt 'hẽm' or 'ngỏ' — Southern speech merges the hỏi and ngã tones, and posters type what they
 * say — reads like 'hẻm' / 'ngõ', and an unmarked 'hem' / 'kiet' / 'ngo' / 'so' is caught too.
 * Unmarked 'ngo'/'so' cost 'Ngo Quyen' typed without marks — a lost fact, never a leak.
 */
const ALLEY_WORD = /(?<![\p{L}\p{M}])(?:hem|kiêt|kiet|ngo|ngach|sô|so|sn)(?![\p{L}\p{M}])/u
/** Strips the five TONE marks only — never the vowel marks (â ê ô ơ ư ă), so 'Ngô Quyền' stays 'ngô
 *  quyên' and is not the alley word 'ngo', while 'ngõ', 'ngỏ' and 'ngo' all read 'ngo'. */
const toneless = (v: string) => v.normalize('NFD').replace(/[\u0300\u0301\u0303\u0309\u0323]/g, '').normalize('NFC').toLowerCase()
/** Letters, marks, space and . ' - only — a digit of ANY script (\p{N}: ASCII, fullwidth '３２',
 *  superscript, Roman 'Ⅻ') is never a letter or a mark, so it cannot pass. */
const PLAIN_NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u
/** A letter from outside the Latin script (Vietnamese is Latin script): a Cyrillic 'е' in 'Hеm' would
 *  otherwise pass as a letter and hide the alley word from ALLEY_WORD. */
const NON_LATIN_LETTER = /(?=\p{L})\P{Script=Latin}/u
export const NHATOT_STREET_MAX = 60
export function nhatotStreetName(raw: unknown): string | null {
  const v = typeof raw === 'string'
    ? raw.normalize('NFC').replace(/\s+/g, ' ').replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '').trim()
    : ''
  if (!v) return null
  if (NUMBERED_STREET.some((re) => re.test(v))) return v
  if (ALLEY_WORD.test(toneless(v)) || !PLAIN_NAME.test(v) || NON_LATIN_LETTER.test(v) || v.length > NHATOT_STREET_MAX) return null
  return v
}

/**
 * The building / project name, or null — the SAME fail-closed contract as a plain street name.
 * ⚠️ `pty_project_name` reaches the published "Building:" / "Dự án:" line and searchText. On the 330
 * real ads of 2026-09-24 it is a catalogue name, but nothing proves a poster cannot type an address
 * into it, and a door number cannot be told from a building number ('Chung cư 57 Vũ Trọng Phụng' is
 * a building; 'Chung cư 12 Lê Lợi' may be a house). So, like a street: NO DIGIT of any script, no
 * alley/door word in any tone (ALLEY_WORD on the toneless form), Latin letters only, ≤ 80 chars —
 * anything else is DROPPED WHOLE. The cost, measured: 6 of 330 rows lose their Building line ('Sky
 * 89 An Gia', 'Q7 Boulevard', …); the row itself, its ward and district stay.
 * ⚠️ A first cut screened only '129/35', alley word + number and a leading number, and each review
 * round found another address shape it let through — so the rule is now the street's, not a list.
 * Applied at STAGING too, so a staged file never holds a dropped value.
 */
export const NHATOT_PROJECT_MAX = 80
export function nhatotProjectName(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.normalize('NFC').replace(/\s+/g, ' ').trim() : ''
  if (!v || v.length > NHATOT_PROJECT_MAX) return null
  if (/\p{N}/u.test(v) || ALLEY_WORD.test(toneless(v)) || NON_LATIN_LETTER.test(v)) return null
  return v
}

/**
 * The district in the form the rest of the catalogue stores it: 'Quận N', 'Quận Bình Thạnh',
 * 'Huyện Nhà Bè' verbatim; Chợ Tốt's 'Thành phố Thủ Đức' becomes 'TP. Thủ Đức'. The HCMC district
 * chips substring-match these (DISTRICTS[].match: 'Thủ Đức', 'Quận 12', 'Bình Chánh' …).
 */
export function nhatotDistrict(areaName: unknown): string | null {
  const a = typeof areaName === 'string' ? areaName.normalize('NFC').replace(/\s+/g, ' ').trim() : ''
  if (!a) return null
  const city = /^(?:thành phố|tp\.?)\s*(.+)$/iu.exec(a)
  return city ? `TP. ${city[1].trim()}` : a
}

/**
 * WHITELIST a raw gateway row into the staged shape. Returns null when the row has no usable id.
 * ⛔ Nothing personal is copied: no names, avatars, account ids, shop, subject, body or phone —
 * and the poster-typed street is reduced to a street name here, so the file never holds a door number.
 */
/** A list_id the outbound URL and the externalId parser both accept: 1–12 digits. A wider one would be
 *  stored with a link verify calls off-host and an externalId --retire cannot read back. */
export const NHATOT_LIST_ID_MAX = 999_999_999_999
const listIdOk = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && id <= NHATOT_LIST_ID_MAX
export function stageNhatotAd(raw: unknown): NhatotStagedAd | null {
  if (!isObj(raw)) return null
  const id = raw.list_id
  if (!listIdOk(id)) return null
  const category = n(raw.category)
  if (category === null) return null
  const images = Array.isArray(raw.images) ? raw.images.filter((u): u is string => typeof u === 'string') : []
  return {
    list_id: id,
    category,
    type: s(raw.type),
    status: s(raw.status),
    region_v2: n(raw.region_v2),
    area_v2: n(raw.area_v2),
    area_name: place(raw.area_name),
    ward_name: place(raw.ward_name),
    ward_name_v3: place(raw.ward_name_v3),
    street_name: nhatotStreetName(raw.street_name),
    pty_project_name: nhatotProjectName(raw.pty_project_name),
    price: n(raw.price),
    price_string: s(raw.price_string),
    is_price_not_valid: raw.is_price_not_valid === true,
    size: n(raw.size),
    size_unit_string: s(raw.size_unit_string),
    rooms: n(raw.rooms),
    toilets: n(raw.toilets),
    latitude: n(raw.latitude),
    longitude: n(raw.longitude),
    images,
    list_time: n(raw.list_time),
    /** From the raw row's feature_params, or — re-validating a staged file — the already-staged label. */
    kind_label: featureLabel(raw, ['apartment_type', 'house_type', 'commercial_type', 'land_type']) ?? s(raw.kind_label),
    furnishing_label: featureLabel(raw, ['furnishing_rent', 'furnishing_sell']) ?? s(raw.furnishing_label),
    company_ad: typeof raw.company_ad === 'boolean' ? raw.company_ad : null,
  }
}

/**
 * ⛔ THE OUTBOUND CTA IS ONLY AS TRUSTWORTHY AS THIS. Built from the numeric id, never read from
 * the payload, and host-pinned again before storing. `https://nha.chotot.com/<id>.htm` 301s to exactly
 * this URL (measured 2026-09-24); what www.nhatot.com then serves is behind Cloudflare and was
 * NOT fetched — a human browser check of one link is on the pre-apply list.
 */
export const nhatotAffiliateUrl = (listId: number) => `https://www.nhatot.com/${listId}.htm`
export const isNhatotAffiliateUrl = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/www\.nhatot\.com\/[1-9]\d{0,11}\.htm$/.test(u)
/** The list_id back out of a stored externalId ('nhatot:123' → 123), or null. */
export function nhatotListIdOf(externalId: unknown): number | null {
  const m = typeof externalId === 'string' ? /^nhatot:([1-9]\d{0,11})$/.exec(externalId) : null
  return m ? Number(m[1]) : null
}

/**
 * Full-size photos only (imgproxy `preset:view`), on Chợ Tốt's CDN. Anything else — a thumbnail
 * preset, another host, a `javascript:` string — is dropped before it reaches the re-host step.
 */
export const isNhatotImageUrl = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/cdn\.chotot\.com\/[A-Za-z0-9_-]+\/preset:view\/plain\/[A-Za-z0-9_.-]+\.(jpe?g|png|webp)$/i.test(u)

export const NHATOT_PRICE_MIN = 1_000_000
export const NHATOT_PRICE_MAX = 2_000_000_000

export type NhatotPriceDrop = 'priceInvalid' | 'pricePerM2' | 'pricePeriod' | 'priceRange'
/**
 * The monthly rent in VND, or the reason it is not one.
 * ⛔ TWO INDEPENDENT PER-m² SIGNALS, same rule as the Batdongsan importer: the source's own
 * "price not valid" flag, and the rendered string. Either one saying it is not a lump monthly
 * figure drops the row. ⚠️ `/tháng` IS REQUIRED — a yearly or nightly figure published as the
 * monthly rent is the same class of lie as a per-m² one.
 */
export function nhatotMonthlyPrice(ad: Pick<NhatotStagedAd, 'price' | 'price_string' | 'is_price_not_valid'>): number | NhatotPriceDrop {
  if (ad.is_price_not_valid) return 'priceInvalid'
  const str = (ad.price_string ?? '').toLowerCase()
  if (str.includes('/m')) return 'pricePerM2'
  if (!str.includes('/tháng')) return 'pricePeriod'
  const p = ad.price
  if (typeof p !== 'number' || !Number.isFinite(p) || p < NHATOT_PRICE_MIN || p > NHATOT_PRICE_MAX) return 'priceRange'
  return p
}

/** Finite, positive, in m². The gateway sends a number, so there is no thousands-dot to re-parse. */
export function nhatotAreaM2(ad: Pick<NhatotStagedAd, 'size' | 'size_unit_string'>): number | null {
  if (ad.size_unit_string && ad.size_unit_string !== 'm²' && ad.size_unit_string !== 'm2') return null
  return typeof ad.size === 'number' && Number.isFinite(ad.size) && ad.size > 0 ? ad.size : null
}

/**
 * ⛔ A MISSING BEDROOM COUNT IS NOT A STUDIO. Absent → null (no attribute), never '0'.
 * Offices and land never get the facet even if the source sent a number.
 */
export function nhatotBedroomFacet(rooms: number | null, subcat: string | null): string | null {
  if (!subcat || !BEDROOM_SUBCATS.has(subcat)) return null
  if (typeof rooms !== 'number' || !Number.isFinite(rooms) || rooms <= 0) return null
  return roomCountValue(rooms)
}

/**
 * Coordinates inside Vietnam, ROUNDED TO 3 DECIMALS (~110 m), or null.
 * ⛔ Finite checks and VN bounds: a string, (0,0) or a swapped pair pins a flat in the Gulf of Guinea.
 * ⚠️ THE ROUNDING IS A PRIVACY CHOICE. Chợ Tốt's own map tile is drawn off-centre (`pty_map_modifier`
 * 0.0008 ≈ 90 m) — it does not show the raw point — and many of these are private landlords renting
 * rooms in their own house. Republishing a sharper pin than the source displays is not ours to do.
 */
export function nhatotCoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const ok = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
  if (!ok(lat, 8, 24) || !ok(lng, 102, 110)) return null
  return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 }
}

/** "Phường Đông Hưng Thuận" → "P. Đông Hưng Thuận mới" — the post-2025 ward, in the Batdongsan rows' style. */
export function nhatotWardLabel(ad: Pick<NhatotStagedAd, 'ward_name' | 'ward_name_v3'>): string | null {
  if (ad.ward_name_v3) return `${ad.ward_name_v3.replace(/^Phường\s+/, 'P. ')} mới`
  return ad.ward_name
}

/**
 * Chợ Tốt's `kind_label` in English. ⚠️ THE ENGLISH BLOCK PRINTED THE VIETNAMESE LABEL ('Type: Căn hộ
 * dịch vụ, mini') — English is a translation target here, not the source. These are the 12 labels of
 * the 330 real ads of 2026-09-24; an unseen label falls back to the category's English kind, never
 * to the Vietnamese text.
 */
const KIND_EN: Record<string, string> = {
  'Căn hộ dịch vụ, mini': 'Serviced / mini apartment',
  'Chung cư': 'Apartment',
  'Duplex': 'Duplex',
  'Penthouse': 'Penthouse',
  'Officetel': 'Officetel',
  'Tập thể, cư xá': 'Collective housing block',
  'Nhà ngõ, hẻm': 'House on a lane',
  'Nhà mặt phố, mặt tiền': 'Street-front house',
  'Nhà biệt thự': 'Villa',
  'Nhà phố liền kề': 'Townhouse',
  'Mặt bằng kinh doanh': 'Commercial premises',
  'Văn phòng': 'Office',
}
const FURNISHING_EN: Record<string, string> = {
  'Nội thất cao cấp': 'Premium furnished',
  'Nội thất đầy đủ': 'Fully furnished',
  'Nhà trống': 'Unfurnished',
  'Hoàn thiện cơ bản': 'Basic finish',
  'Bàn giao thô': 'Bare shell',
}

/** The fixed first paragraph of every description — OUR text, so it is not screened (it names a domain). */
export const NHATOT_INTRO_EN = 'Listed on Nhatot.com. eno links to the original — enquiries and viewings are handled there, not by eno.'
export const NHATOT_INTRO_VI = 'Tin đăng trên Nhatot.com. eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do bên đó xử lý, không qua eno.'

export type NhatotDropReason =
  | 'notRent' | 'notActive' | 'unknownRegion' | 'unknownCategory' | NhatotPriceDrop | 'noImages' | 'tooFewImages'
  | 'stale' | 'contactInText' | 'bannedWords'

/**
 * ⛔ THE PUBLISH FLOOR APPLIES TO IMPORTS TOO. Every rentals subcategory lives in the `rentals`
 * category, whose floor (publish-guard's minPhotosFor) is 3 DISTINCT photos — the bar a seller's own
 * post has to clear. Checked twice: at map time on the candidate URLs (a row that cannot reach it is
 * dropped before anything is fetched), and at --apply on the photos that pass the real-photo test.
 */
export const NHATOT_CATEGORY_SLUG = 'rentals'
export const NHATOT_MIN_PHOTOS = minPhotosFor(NHATOT_CATEGORY_SLUG)
/**
 * The size floor for a Chợ Tốt photo: 300 px on the SHORT edge (Honeycomb's rule), on top of the shared
 * 300 px long-edge default. `preset:view` serves the upload fitted inside 1024 px (the 2026-09-24
 * `--probe-photos` run: 140 real photos, short edge 340–931, portraits 575x1024), so unlike muaban's
 * 672 px thumbnails a short-edge floor refuses nothing real — while a 232x504 sliver or a sub-300
 * avatar crop is refused. ⚠️ A long-edge floor of 400 was tried first and refused a real 304x313
 * shopfront photo (nhatot:133643964) in that same run, so it is not used.
 */
export const NHATOT_PHOTO_FLOOR: ImageSizeFloor = { minShortEdge: 300 }

export type NhatotMapped = {
  externalId: string
  sourceId: number
  /** Source photo URLs, full-size, capped — to be RE-HOSTED, never stored as-is. */
  images: string[]
  /**
   * CREATE-ONLY: the source's own post date (`list_time`), clamped to `now` — never the import time.
   * The starting rankScore is computed from it (nhatotStartingRank), so a week-old ad does not enter
   * the default browse ranked as if it were posted today. Never refreshed on update.
   */
  postedAt: Date
  /** Mixed-language segments the reviewed dictionary does not cover yet (import-i18n.ts) — a report, never stored. */
  untranslated: MissingSegment[]
  /** The refreshable fields: written on create AND on update. Never status/verified/images. */
  mutable: {
    title: string
    titleVi: string
    description: string
    descriptionVi: string
    price: number
    priceUnit: string
    currency: '₫'
    negotiable: false
    listingType: 'rent'
    subcategorySlug: string | null
    location: string
    district: string | null
    city: string
    lat: number | null
    lng: number | null
    areaM2: number | null
    attributes: string | null
    affiliateUrl: string
    searchText: string
  }
}

export type NhatotMapOptions = { now: number; maxAgeDays: number; maxPhotos: number }

/** One staged ad → the row as it would be stored, or the single reason it is dropped. */
export function mapNhatotAd(ad: NhatotStagedAd, opts: NhatotMapOptions): { ok: true; row: NhatotMapped } | { ok: false; reason: NhatotDropReason } {
  if (ad.type !== 'u') return { ok: false, reason: 'notRent' }
  if (ad.status !== null && ad.status !== 'active') return { ok: false, reason: 'notActive' }
  const city = ad.region_v2 === null ? undefined : CITY_BY_REGION.get(ad.region_v2)
  if (!city) return { ok: false, reason: 'unknownRegion' }
  const cat = NHATOT_CATEGORIES[ad.category]
  if (!cat) return { ok: false, reason: 'unknownCategory' }
  const price = nhatotMonthlyPrice(ad)
  if (typeof price !== 'number') return { ok: false, reason: price }
  /** ⚠️ `!(age <= max)`, not `age > max`: a missing or NaN list_time must FAIL the freshness test. */
  const ageDays = ad.list_time === null ? NaN : (opts.now - ad.list_time) / 86_400_000
  if (!(ageDays <= opts.maxAgeDays)) return { ok: false, reason: 'stale' }
  /** `maxPhotos` below the floor would drop every row, so the floor wins. */
  const images = [...new Set(ad.images.filter(isNhatotImageUrl))].slice(0, Math.max(NHATOT_MIN_PHOTOS, opts.maxPhotos))
  if (!images.length) return { ok: false, reason: 'noImages' }
  if (images.length < NHATOT_MIN_PHOTOS) return { ok: false, reason: 'tooFewImages' }
  const postedAt = nhatotPostedAt(ad.list_time, opts.now)
  if (!postedAt) return { ok: false, reason: 'stale' }

  const area = nhatotAreaM2(ad)
  const beds = nhatotBedroomFacet(ad.rooms, cat.subcat)
  const rooms = typeof ad.rooms === 'number' && ad.rooms > 0 ? Math.floor(ad.rooms) : null
  const baths = typeof ad.toilets === 'number' && ad.toilets > 0 ? Math.floor(ad.toilets) : null
  const ward = nhatotWardLabel(ad)
  const district = nhatotDistrict(ad.area_name)
  /** Belt and braces: a staged file from before the street sanitiser, or a hand edit, is re-cleaned. */
  const street = nhatotStreetName(ad.street_name)
  const isHcm = city.region === NHATOT_CITIES.hcm.region
  const where = [ward, district, isHcm ? null : city.cityVi].filter(Boolean).join(', ') || city.cityVi
  const coords = nhatotCoords(ad.latitude, ad.longitude)
  const affiliateUrl = nhatotAffiliateUrl(ad.list_id)

  const bitsEn = [cat.kindEn]
  if (rooms && cat.subcat && BEDROOM_SUBCATS.has(cat.subcat)) bitsEn.push(`${rooms} bed`)
  // Beds and baths describe a home: an office or shopfront title does not count its toilets.
  if (baths && cat.subcat && BEDROOM_SUBCATS.has(cat.subcat)) bitsEn.push(`${baths} bath`)
  if (area) bitsEn.push(`${area} m²`)
  const title = `${bitsEn.join(' · ')} for rent — ${where}`
  const titleVi = `Cho thuê ${cat.kindVi}${rooms && beds ? ` ${rooms}PN` : ''}${area ? ` ${area}m²` : ''} — ${where}`

  /**
   * ⚠️ "Former ward" ONLY BESIDE A NEW ONE. `ward_name_v3` is the post-2025 ward; without it the ad's
   * `ward_name` is the only ward there is, and it is shown as the ward — the same value the card's
   * location uses (nhatotWardLabel). Calling it "former" with no current ward would tell a renter the
   * listing's ward no longer exists.
   */
  const currentWard = ad.ward_name_v3 ?? ad.ward_name
  const project = nhatotProjectName(ad.pty_project_name)
  const formerWard = ad.ward_name_v3 && ad.ward_name && ad.ward_name !== ad.ward_name_v3 ? ad.ward_name : null
  const factsEn = ([
    ['Type', (ad.kind_label && KIND_EN[ad.kind_label]) || cat.kindEn],
    ['Area', area ? `${area} m²` : null],
    ['Bedrooms', beds ? rooms : null],
    ['Bathrooms', baths],
    // An unmapped label is left out of the English block rather than printed in Vietnamese.
    ['Furnishing', ad.furnishing_label ? FURNISHING_EN[ad.furnishing_label] ?? null : null],
    ['Building', project],
    ['Street', street],
    ['Ward', currentWard],
    ['Former ward', formerWard],
    ['District', district],
    ['City', city.cityEn],
    ['Rent', `${formatMoneyFull(price, '₫', 'en')}/month`],
  ] as [string, unknown][])
  const factsVi = ([
    ['Loại hình', ad.kind_label ?? cat.kindVi],
    ['Diện tích', area ? `${area} m²` : null],
    ['Phòng ngủ', beds ? rooms : null],
    ['Phòng vệ sinh', baths],
    ['Nội thất', ad.furnishing_label],
    ['Dự án', project],
    ['Đường', street],
    ['Phường/xã', currentWard],
    ['Phường cũ', formerWard],
    ['Quận/huyện', district],
    ['Tỉnh/thành', city.cityVi],
    ['Giá thuê', `${formatMoneyFull(price, '₫', 'vi')}/tháng`],
  ] as [string, unknown][])
  const block = (rows: [string, unknown][]) => rows
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`).join('\n')
  const blockEn = block(factsEn), blockVi = block(factsVi)

  const location = `${district ?? city.cityVi}${ward ? ` (${ward})` : ''}${isHcm ? '' : `, ${city.cityVi}`}`

  /**
   * ⛔ THE ENGLISH TEXT IS MADE ENGLISH HERE, NOT LATER IN THE DATABASE (import-i18n.ts): the title's
   * "— P. Tân Hòa mới, Quận Tân Bình" and the Street / Ward / Former ward / District / Building lines
   * carry Chợ Tốt's Vietnamese values, and every one of these fields is in MUTABLE_KEYS — a row fixed
   * only in the database would be reverted by the next refresh. Done before the screen (so the screen
   * sees what is published) and before searchText (so "district 7" finds the English title).
   */
  const text = localizeImportText({ title, titleVi, description: blockEn, descriptionVi: blockVi })

  /**
   * ⛔ THE SAME CONTACT/ADDRESS SCREEN A SELLER'S OWN POST GOES THROUGH (publish-guard's
   * assertCleanTexts: phone, email, link, @handle, "zalo: …", "số nhà N", banned words). The owner
   * accepted contact marks burned into PHOTOS as part of the rival-watermark decision; TEXT is not
   * covered by that, and the building / street / ward fields are poster- or source-typed. Our own
   * intro paragraph is not screened — it names the source's domain, which the link rule would flag
   * on every row. Both the composed and the localized text are screened: a dictionary entry must not
   * be able to launder a source value the screen would have refused.
   */
  try {
    assertCleanTexts([title, titleVi, location, blockEn, blockVi, text.title, text.titleVi, text.description, text.descriptionVi])
  } catch (e) {
    if (e instanceof PublishBlockedError) return { ok: false, reason: e.code === 'banned_words' ? 'bannedWords' : 'contactInText' }
    throw e
  }

  return {
    ok: true,
    row: {
      externalId: `nhatot:${ad.list_id}`,
      sourceId: ad.list_id,
      images,
      postedAt,
      untranslated: text.missing,
      mutable: {
        title: text.title,
        titleVi: text.titleVi,
        description: `${NHATOT_INTRO_EN}\n\n${text.description}`,
        descriptionVi: `${NHATOT_INTRO_VI}\n\n${text.descriptionVi}`,
        price,
        priceUnit: NHATOT_PRICE_UNIT,
        currency: '₫',
        negotiable: false,
        listingType: 'rent',
        subcategorySlug: cat.subcat,
        location,
        district,
        city: city.city,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        areaM2: area,
        // The bathroom count rides with the bedroom facet: offices and land get neither.
        attributes: beds === null ? null : roomAttributes({ bedrooms: beds, bathrooms: baths }),
        affiliateUrl,
        /** ⚠️ title and titleVi FIRST — rebaseSearchText (import-i18n.ts) relies on that order. */
        searchText: buildSearchText([
          text.title, text.titleVi, location, district, ad.kind_label, ad.ward_name, project,
          street, city.cityVi, city.cityEn,
        ]),
      },
    },
  }
}

/**
 * The source's post date as a Date, never later than `now`, or null when there is none.
 * ⛔ CLAMPED, NOT TRUSTED: a clock-skewed or hand-edited future `list_time` would otherwise give the
 * row a rankScore above a listing posted this second, and keep it there until real time caught up.
 */
export function nhatotPostedAt(listTime: number | null, now: number): Date | null {
  if (typeof listTime !== 'number' || !Number.isFinite(listTime) || listTime <= 0) return null
  return new Date(Math.min(listTime, now))
}

/**
 * The rankScore an imported row is CREATED with: the same browseRankScore every create uses (and the
 * nightly SQL recompute mirrors), fed the SOURCE's post date instead of the import time — so the
 * starting score is what the recompute would give the row anyway, not a fresh-post boost for a stale ad.
 */
export function nhatotStartingRank(postedAt: Date, sellerTrustScore: number, now: number): number {
  return browseRankScore({ sellerTrustScore, postedAt, featured: false }, now)
}

/**
 * ⛔ ONE PHOTO RULE FOR THE DRY-RUN PROBE AND --apply. `judged` is every candidate photo in source
 * order, each already measured by import-photo-check's measureImage + imageVerdict(NHATOT_PHOTO_FLOOR):
 *  - a fetch/decode failure fails the row ('photoFailed' — all-or-nothing, the next run retries it);
 *  - a text card, a logo or a too-small image is left out, so it can never be the cover;
 *  - the same shot twice counts once (the publish gate counts DISTINCT angles);
 *  - fewer than `minPhotos` real, distinct photos left → 'tooFewRealPhotos': the row is not created.
 */
export type NhatotPhotoPlan = {
  decision: 'create' | 'photoFailed' | 'tooFewRealPhotos'
  keep: number[]
  refused: Partial<Record<'placeholder' | 'tooSmall', number>>
  duplicates: number
}
export function nhatotPhotoPlan(judged: { outcome: PhotoOutcome; hash?: string | null }[], minPhotos = NHATOT_MIN_PHOTOS): NhatotPhotoPlan {
  const g = galleryPlan(judged.map((j) => j.outcome))
  if (g.failed) return { decision: 'photoFailed', keep: [], refused: g.refused, duplicates: 0 }
  const d = dropNearDuplicates(g.keep, judged.map((j) => j.hash ?? null))
  return { decision: d.keep.length >= minPhotos ? 'create' : 'tooFewRealPhotos', keep: d.keep, refused: g.refused, duplicates: d.duplicates }
}

/**
 * Split a `--limit` across the (city × category) slices so a 30-row sample covers every slice
 * instead of 30 HCMC apartments. Sums to exactly `limit`; earlier slices take the remainder.
 * `null` = no limit (read each slice to its end). ⚠️ A slice can get 0 — that means SKIP it, and
 * the caller must not confuse it with "unlimited".
 */
export function sliceQuotas(limit: number, slices: number): (number | null)[] {
  if (!(slices > 0)) return []
  if (!(limit > 0)) return Array.from({ length: slices }, () => null)
  const base = Math.floor(limit / slices), extra = limit % slices
  return Array.from({ length: slices }, (_, i) => base + (i < extra ? 1 : 0))
}

/**
 * `--cap hcm=3000,hn=1500,dn=1500` → the newest N ads per city across its categories.
 * Throws on anything it cannot read exactly — a typo'd cap must not become "no cap".
 */
export function parseNhatotCaps(raw: string | null): Partial<Record<NhatotCityKey, number>> {
  const out: Partial<Record<NhatotCityKey, number>> = {}
  if (!raw) return out
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^([a-z]+)=(\d{1,6})$/.exec(part)
    if (!m || !Object.hasOwn(NHATOT_CITIES, m[1])) throw new Error(`--cap: cannot read "${part}" (use e.g. hcm=3000,hn=1500,dn=1500)`)
    const v = Number(m[2])
    if (!(v > 0)) throw new Error(`--cap: "${part}" must be a positive count`)
    out[m[1] as NhatotCityKey] = v
  }
  return out
}

/**
 * ⛔ A `--cap` RUN MUST CAP EVERY CITY IT READS, AND CAP NOTHING IT DOES NOT. A city without a cap is
 * read the uncapped way — every category to its end, re-split per district past the gateway's 10,000
 * — so `--cap hcm=3000` alone (all three cities are the default) would cap HCMC and then crawl Hà Nội
 * and Đà Nẵng in full: hours of requests and rows nobody asked for, with the cap printed as if it
 * governed the run. A cap on a city `--city` leaves out would silently read nothing for it.
 * null = fine; otherwise the refusal.
 */
export function nhatotCapsProblem(cities: readonly NhatotCityKey[], caps: Partial<Record<NhatotCityKey, number>>): string | null {
  const named = (Object.keys(caps) as NhatotCityKey[]).filter((c) => caps[c])
  if (!named.length) return null
  const uncapped = cities.filter((c) => !caps[c])
  if (uncapped.length) return `--cap names ${named.join(', ')} but the run also reads ${uncapped.join(', ')}, which would be read in full — cap every city, or narrow with --city ${named.join(',')}`
  const outside = named.filter((c) => !cities.includes(c))
  if (outside.length) return `--cap names ${outside.join(', ')}, which --city leaves out — nothing would be read for it`
  return null
}

/**
 * Whether this run touches the network — and so must read the publisher's robots.txt first. A live
 * read does; so does a replay of a staged file that fetches photos (`--apply` re-hosts every kept
 * photo, `--probe-photos` judges them). ⚠️ The replay skipped the site policy and printed "no
 * network" on exactly the run that publishes, so a Disallow added between staging and apply went
 * unseen. Only a plain replay (`--src` alone) is offline.
 */
export function nhatotRunReadsNetwork(o: { src: boolean; apply: boolean; probePhotos: boolean }): boolean {
  return !o.src || o.apply || o.probePhotos
}

/**
 * An import run's exit status: 2 when a stop (429, challenge, robots) ended it early, 1 when any row
 * failed on OUR side — an error, or a photo upload to our storage — else 0. ⚠️ A batch that errored
 * (or failed every upload) used to exit 0. A race (another run created the row) is not a failure, and
 * neither is a row skipped on the SOURCE's photos (gone, or too few real ones): that is the rule
 * working.
 */
export function nhatotApplyExitCode(stat: { errored: number; uploadFailed: number }, stopped: string | null): number {
  if (stopped) return 2
  return stat.errored + stat.uploadFailed > 0 ? 1 : 0
}

/**
 * Whether a newest-first slice is read to its end once `offset` rows are in.
 * ⚠️ A MISSING `total` IS NOT ZERO. The loop used `min(total ?? 0, cap)`, so a gateway page without a
 * numeric `total` ended every slice after its first 50 ads — and the run still called itself a
 * complete read. Without a total the read goes on until an empty page (the loop's other exit) or the
 * gateway's own 10,000 cap.
 */
export function nhatotSliceEnd(offset: number, total: number | null): boolean {
  return offset >= Math.min(total ?? NHATOT_TOTAL_CAP, NHATOT_TOTAL_CAP)
}

/**
 * THE NEWEST `cap` ADS ACROSS SEVERAL NEWEST-FIRST LISTS (one per category), reading only as many
 * pages as the merge needs — a k-way merge, not "read `cap` from every list and throw most away".
 * The gateway lists are newest-first by `list_time` (measured: 0 inversions over 4 lists).
 * `fetchPage` may throw to stop the read (429, challenge); the ads picked so far are returned with
 * the error, never lost, and never a reason to keep reading.
 */
export async function readNewestAcross<K, T extends { list_id: number; list_time: number | null }>(
  keys: K[],
  cap: number,
  /** `consumed` = raw rows the page held (defaults to ads.length) — the offset advances by it, so a
   *  row the caller dropped while staging does not make the next page re-read or skip anything. */
  fetchPage: (key: K, offset: number, limit: number) => Promise<{ ads: T[]; total: number | null; consumed?: number }>,
  pageMax = NHATOT_PAGE_MAX,
): Promise<{ picked: T[]; stats: Map<K, { read: number; total: number | null; exhausted: boolean }>; error: unknown }> {
  const st = new Map(keys.map((k) => [k, { buf: [] as T[], offset: 0, read: 0, total: null as number | null, exhausted: false }]))
  const picked: T[] = []
  const seen = new Set<number>()
  let error: unknown = null
  try {
    while (picked.length < cap) {
      for (const [k, v] of st) {
        /** `while`, not `if`: a page whose rows were all dropped while staging leaves the buffer empty. */
        while (!v.buf.length && !v.exhausted) {
          const page = await fetchPage(k, v.offset, Math.min(pageMax, cap - picked.length))
          if (v.total === null) v.total = page.total
          const consumed = page.consumed ?? page.ads.length
          if (!consumed) { v.exhausted = true; continue }
          v.buf.push(...page.ads)
          v.offset += consumed
          v.read += consumed
          if (v.offset >= Math.min(v.total ?? Number.POSITIVE_INFINITY, NHATOT_TOTAL_CAP)) v.exhausted = true
        }
      }
      let best: { k: K; t: number } | null = null
      for (const [k, v] of st) {
        if (!v.buf.length) continue
        const t = v.buf[0].list_time ?? Number.NEGATIVE_INFINITY
        if (!best || t > best.t) best = { k, t }
      }
      if (!best) break
      const ad = st.get(best.k)!.buf.shift()!
      if (seen.has(ad.list_id)) continue   // an ad that shifted pages while we read
      seen.add(ad.list_id)
      picked.push(ad)
    }
  } catch (e) {
    error = e
  }
  return { picked, stats: new Map([...st].map(([k, v]) => [k, { read: v.read, total: v.total, exhausted: v.exhausted }])), error }
}

/** A staged file older than this refuses --apply: Nhà Tốt rentals turn over in days. */
export const NHATOT_STAGE_MAX_AGE_H = 72

/**
 * Why a staged file's own timestamp refuses --apply, or null when it is fresh.
 * ⛔ `!(age <= max)` so a garbled date fails, AND a FUTURE date fails: `now - future` is negative,
 * which is "≤ 72 h" — a hand-edited or clock-skewed `fetchedAt` would otherwise never expire.
 */
export function nhatotStageAgeProblem(fetchedAt: unknown, now: number, maxH = NHATOT_STAGE_MAX_AGE_H): string | null {
  if (typeof fetchedAt !== 'string') return 'the file has no fetchedAt/checkedAt timestamp'
  const t = Date.parse(fetchedAt)
  if (!Number.isFinite(t)) return `timestamp "${fetchedAt}" is not a date`
  const ageH = (now - t) / 3_600_000
  if (ageH < -0.25) return `timestamp ${fetchedAt} is in the future — refusing a file that can never go stale`
  if (!(ageH <= maxH)) return `staged ${fetchedAt} (${ageH.toFixed(1)} h ago) — over ${maxH} h; re-fetch with --save`
  return null
}

/**
 * ⛔ A RATE ARGUMENT THAT DOES NOT PARSE IS THE DEFAULT, NEVER "NO DELAY". `Number('1500ms')` is
 * NaN, `Math.max(1000, NaN)` is NaN, and `wait > 0` with a NaN wait is false — so a typo used to
 * turn the rate limit OFF. A finite value below the floor is raised to it.
 */
export function nhatotRateArg(raw: string | null | undefined, def: number, floor: number): number {
  const v = typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : Number.NaN
  return Math.max(floor, Number.isFinite(v) ? v : def)
}

/**
 * Why one response must END the whole read, or null. ⛔ 429 is a stop, never a retry; a Cloudflare
 * challenge (cf-mitigated) or an HTML page where JSON or an image was expected is a wall, and walls
 * are never worked around — for the gateway, for the image CDN, and for the liveness pass alike.
 */
export function nhatotStopReason(status: number, contentType: string | null, cfMitigated: string | null): string | null {
  if (status === 429) return 'HTTP 429 — rate limited; stopping, not retrying'
  if (cfMitigated) return `HTTP ${status} cf-mitigated=${cfMitigated} — a challenge; INFEASIBLE without bypass, stopping`
  if (/text\/html/i.test(contentType ?? '')) return `HTTP ${status} ${contentType} — an HTML page, not the API/image; stopping`
  return null
}

/**
 * Whether a response HALTS its host for the rest of the run: a 429 or a challenge. ⚠️ ONLY THOSE —
 * not an HTML body in general, because a robots.txt 404 is often an HTML page and means "no rules".
 * The importer records the host and refuses every later request to it without sending one, so no
 * later probe or fallback (a second logo URL, the next photo) knocks again after a 429.
 */
export function nhatotHostHalt(status: number, cfMitigated: string | null): string | null {
  if (status === 429) return 'HTTP 429'
  if (cfMitigated) return `challenge (cf-mitigated=${cfMitigated})`
  return null
}

/**
 * RFC 9309 robots.txt evaluation for one product token. The group(s) naming the token win;
 * otherwise the `*` group(s); no applicable group = allowed. Longest matching rule wins, an
 * `allow` wins a tie; `*` is a wildcard and a trailing `$` anchors. Non-rule lines inside a group
 * (Sitemap, Content-Signal, Crawl-delay) neither end it nor count as rules.
 */
export function nhatotRobotsAllows(robotsTxt: string, uaToken: string, path: string): boolean {
  type Rule = { allow: boolean; pattern: string }
  const groups: { agents: string[]; rules: Rule[] }[] = []
  let cur: { agents: string[]; rules: Rule[] } | null = null
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase(), val = m[2].trim()
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur) }
      cur.agents.push(val.toLowerCase())
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      if (val) cur.rules.push({ allow: key === 'allow', pattern: val })
      else cur.rules.push({ allow: true, pattern: '' })   // "Disallow:" (empty) = nothing disallowed
    }
  }
  const token = uaToken.toLowerCase()
  const mine = groups.filter((g) => g.agents.includes(token))
  const applicable = mine.length ? mine : groups.filter((g) => g.agents.includes('*'))
  const toRe = (p: string) => {
    const anchored = p.endsWith('$')
    const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${body}${anchored ? '$' : ''}`)
  }
  let best: { allow: boolean; len: number } | null = null
  for (const r of applicable.flatMap((g) => g.rules)) {
    if (!r.pattern || !toRe(r.pattern).test(path)) continue
    const len = r.pattern.length
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len }
  }
  return best ? best.allow : true
}

/**
 * ⛔ AN IMPORT SELLER THAT IS NOT PLAINLY OURS IS NEVER WRITTEN TO. Renamed → someone else's
 * storefront; owned → a real person who would receive every enquiry and could edit every row;
 * verified / verifiedSeller / officialPartner → a badge that tells buyers eno vetted these, which
 * it did not. Any one refuses the whole write (import AND retire), before anything is uploaded.
 */
export function nhatotSellerRefusal(seller: {
  name: string; ownerId: string | null; verified: boolean; verifiedSeller: boolean; officialPartner: boolean
} | null): string | null {
  if (!seller) return null
  if (seller.name !== NHATOT_SELLER_NAME) return `seller ${NHATOT_SELLER_ID} is named "${seller.name}", expected "${NHATOT_SELLER_NAME}" — refusing to write into someone else's shop`
  if (seller.ownerId) return `seller ${NHATOT_SELLER_ID} has ownerId ${seller.ownerId} — refusing to attach imported rows to a real person`
  const badges = (['verified', 'verifiedSeller', 'officialPartner'] as const).filter((b) => seller[b])
  if (badges.length) return `seller ${NHATOT_SELLER_ID} carries ${badges.join(', ')} — an import seller must carry no badge; refusing`
  return null
}

/**
 * ⛔ THE JOURNAL IS THE ONLY RECORD OF WHAT A WRITE RUN DID, so it must survive a reboot. A missing
 * dir, or one under a temp root (macOS clears /private/tmp at boot), refuses --apply before a
 * single request is made. `volatileRoots` are absolute (the caller passes /tmp, /private/tmp and
 * os.tmpdir(), resolved); the check is on path segments, so '/tmpfoo' is not '/tmp'.
 */
export function nhatotJournalDirProblem(absDir: string | null, volatileRoots: string[]): string | null {
  if (!absDir) return '--apply needs --journal-dir <durable dir> (upload manifest, created-row and retire journals)'
  const clean = (p: string) => p.replace(/\/+$/, '') || '/'
  const d = clean(absDir)
  for (const root of volatileRoots.map(clean)) {
    if (d === root || d.startsWith(root + '/')) return `--journal-dir ${absDir} is under ${root}, which is cleared on reboot — use a durable directory`
  }
  return null
}

// ─── Liveness (the --retire pass) ────────────────────────────────────────────────────────────────

export type NhatotLivenessVerdict = 'live' | 'gone' | 'inactive' | 'unknown'
/** One detail-endpoint answer, reduced to what retirement needs. ⛔ Nothing else is ever kept. */
export type NhatotLiveness = { list_id: number; verdict: NhatotLivenessVerdict; http: number; status: string | null }
const SOURCE_STATUS = /^[a-z][a-z_]{0,31}$/

/**
 * The detail endpoint's answer → live / gone / inactive / unknown, from a POSITIVE signal only.
 *  - 404 with Chợ Tốt's own "entity not found - no ad found" body → gone (measured 2026-09-24);
 *  - 410 → gone;
 *  - 200 whose `ad.list_id` is this id: `ad.status === 'active'` → live, any other status word → inactive;
 *  - EVERYTHING ELSE → unknown, and unknown never retires anything. ⚠️ That includes the gateway's
 *    OTHER 404, `{"message":"no Route matched with those values"}` — a moved or mistyped endpoint,
 *    which would otherwise read as "every ad is gone".
 * ⛔ The response carries the poster's `phone`, name and body: this returns four named fields and
 * nothing read from the body except `ad.list_id` and `ad.status`.
 */
export function classifyNhatotLiveness(listId: number, http: number, body: unknown): NhatotLiveness {
  const out = (verdict: NhatotLivenessVerdict, status: string | null = null): NhatotLiveness => ({ list_id: listId, verdict, http, status })
  if (http === 410) return out('gone')
  if (http === 404) {
    const msg = isObj(body) && typeof body.message === 'string' ? body.message : ''
    return /entity not found|no ad found/i.test(msg) ? out('gone') : out('unknown')
  }
  if (http !== 200 || !isObj(body) || !isObj(body.ad) || body.ad.list_id !== listId) return out('unknown')
  const status = typeof body.ad.status === 'string' ? body.ad.status.trim().toLowerCase() : ''
  if (status === 'active') return out('live', 'active')
  return SOURCE_STATUS.test(status) ? out('inactive', status) : out('unknown')
}

/** Re-apply the liveness whitelist to a record read back from a status file (hand edits included). */
export function stageNhatotLiveness(raw: unknown): NhatotLiveness | null {
  if (!isObj(raw)) return null
  const id = raw.list_id, http = raw.http, verdict = raw.verdict
  if (!listIdOk(id)) return null
  if (typeof http !== 'number' || !Number.isInteger(http) || http < 0 || http > 599) return null
  if (verdict !== 'live' && verdict !== 'gone' && verdict !== 'inactive' && verdict !== 'unknown') return null
  const status = typeof raw.status === 'string' && SOURCE_STATUS.test(raw.status) ? raw.status : null
  /** A verdict must agree with the evidence it was drawn from — a hand-set 'gone' on a 200 is refused. */
  const again = verdict === 'gone' ? (http === 404 || http === 410)
    : verdict === 'inactive' ? (http === 200 && status !== null && status !== 'active')
    : verdict === 'live' ? (http === 200 && status === 'active')
    : true   // 'unknown' retires nothing, whatever its evidence
  if (!again) return null
  return { list_id: id, verdict, http, status }
}

/** Retire on these verdicts, and only these. */
export const nhatotShouldRetire = (l: NhatotLiveness) => l.verdict === 'gone' || l.verdict === 'inactive'
