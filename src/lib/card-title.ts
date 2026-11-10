import { isImportSeller } from './import-sellers'
import { isHcmc } from './city-short'
import { PROVINCES } from '@/components/marketplace/listings-explorer.constants'

/**
 * THE TITLE A LISTING CARD PRINTS ON ITS ONE LINE — a DISPLAY shortening, never a stored change.
 *
 * Measured 2026-10-04 (quality-02): 48 of 48 Vietnamese rental cards on /c/rentals showed only
 * "Cho thuê Căn hộ / Chun…". The card's title is ONE truncating line (owner, 2026-09-13), and every
 * imported rental spends that line on the importer's boilerplate: the category already says "Cho
 * thuê", the price row already says "/ tháng", and the template's own category label is the longest
 * words in the title. What the buyer scans for — rooms, m², the ward — sat past the ellipsis.
 *
 * ⛔ ONLY THE IMPORTERS' OWN TEMPLATES, PINNED BY SELLER ID. A member who titles a post "Cho thuê xe
 * máy giá rẻ" chose those words, and stripping them would leave "giá rẻ" (plan review, 2026-10-04).
 * The importer templates are fixed strings their code writes (batdongsan/nhatot/muaban/rever:
 * "Cho thuê <Loại> …", honeycomb: "Cho thuê căn hộ …", mioto/bonboncar: "Cho thuê xe tự lái …",
 * the motorbike shops: "Cho thuê xe máy …" — src/lib/vehicle-rental-listing.ts), so the rule keys on
 * the SELLER, by id, never on the text or on `seller.unrated`: a legacy guest storefront is unrated
 * too, and its title is a person's.
 * ⚠️ IDS, NEVER NAMES — `Seller.name` is user-settable (src/lib/import-sellers.ts). The vehicle ids
 * are spelled out here rather than imported because vehicle-rental-listing.ts pulls the taxonomy and
 * the search folding into whatever imports it, and this runs in every card; card-title.test.ts pins
 * the list to VEHICLE_SELLERS so the two cannot drift.
 *
 * ⚠️ GOODS: a leading bracket tag goes ONLY WHEN IT REPEATS THE INFO LINE, and only on a SALE listing.
 * "[Like New] Dell XPS…" (448 live rows from one shop) says what "Đã dùng" already says, and "[HCM]"
 * what "TP.HCM" says — so an ALLOWLIST of condition and city tags is dropped, and only when the
 * listing's own condition / location is the one the info line prints (a "[HCM]" on a Hà Nội row is
 * information, not repetition). Everything else a member puts in brackets is kept, because it is
 * usually the one word that changes the meaning: "[Cần mua]" (a wanted post), "[Cho thuê]" (not a
 * sale), "[Hỏng màn]" / "[Xác]" (broken — the info line would only say Used), "[Rep 1:1]" (a
 * replica), "[Order]" (not in stock), "[Trao đổi]" (a swap). ⛔ "[New…]" / "[Brand New…]" / "[Mới…]"
 * are never dropped: on a row filed as used they are the only visible sign the condition is wrong.
 * Jobs and teacher profiles are exempt by category as well as by type — a recently-viewed card stored
 * before `listingType` reached the payload has none.
 *
 * ⛔ A SHORTENING THAT LEAVES FEWER THAN TWO WORDS IS NOT A TITLE — the original is kept.
 * The shortened line is also the card link's accessible name (WCAG 2.5.3 Label in Name — listing-card.tsx);
 * the full title stays the h3's `title` and the photo's alt, and the PDP is untouched. Stored titles do not
 * change (D6).
 */
export const VEHICLE_IMPORT_SELLER_IDS: readonly string[] = [
  'vehicle-import-seller-mioto',
  'vehicle-import-seller-bonboncar',
  'vehicle-import-seller-janmotorbike',
  'vehicle-import-seller-theextramile',
  'vehicle-import-seller-dungmotorbikes',
  'vehicle-import-seller-tuanmotorbike',
  'vehicle-import-seller-rentabikevn',
]

/** An importer's storefront, by id — the only rows whose title is a template rather than a person's words. */
export function isTemplateTitleSeller(sellerId: string): boolean {
  return isImportSeller(sellerId) || VEHICLE_IMPORT_SELLER_IDS.includes(sellerId)
}

/**
 * GoPlus's prod storefront id. It is deliberately in neither import list (import-sellers.ts: the rooms are a partner's own), but its
 * titles ARE a template ("Duplex 20 m² · An Phu Dong Ward, District 12"), so only the location tail below applies to it.
 */
const GOPLUS_SELLER_ID = '1f82663d-0bf3-4da0-9adf-91b1ae6a82a8'
/**
 * GOPLUS'S LOCATION TAIL (2026-11-05). The card's info line right under it already prints the area, and this tail is what the one line
 * lost its end to: "Duplex 20 m² · An Phu D…". Facebook, Airbnb and Mercari print the item in the title and the place under it.
 * ⛔ GOPLUS ONLY. Other importers' tails can hold what the info line does not ("Căn hộ 3PN — Masteri An Phu, P. Thảo Điền": a building), so
 * they keep theirs. GoPlus's template is type · ward, district, so the last segment is only ever the place.
 */
const GOPLUS_LOCATION_TAIL = /\s*·\s*(?:[^·,]+ (?:Ward|Commune)|(?:Phường|Xã) [^·,]+)(?:, [^·]+)?$/u
/**
 * GOPLUS'S BEDROOM COUNT, SHORT (2026-11-10). "2-bedroom apartment 45 m²" is 25 characters and a phone card's line holds about 22, so
 * the one template that names its rooms was the one that lost its size: 5 of 48 cards on /c/rentals read "1-bedroom apartment 2…",
 * and behind the 2-bedroom filter nearly every card ended the same way (both blind judges, benchmark 2026-11-10: "the title is cut
 * exactly where listings differ"). "2-bed apartment 45 m²" and "Căn hộ 2PN 45 m²" fit at 360px; "PN" is how the other rental
 * importers already write it ("Căn hộ 3PN"). ⛔ GoPlus's own template only, at the start of the title, like the tail below.
 */
const GOPLUS_BEDROOMS_EN = /^(\d{1,2})-bedroom apartment(?=\s|$)/u
const GOPLUS_BEDROOMS_VI = /^Căn hộ (\d{1,2}) phòng ngủ(?=\s|$)/u
/** The stored location names a district or ward, so the info line under the title really prints the area. */
const NAMES_AN_AREA = /^(?:Quận|Huyện|Phường|Xã|TP\.|Thành phố)\s/iu

/** Its listing date is the importer's run, not somebody listing something: the "Just in" pill on these rows said nothing (nearly every
 *  rental card wore it). Their age stays on the info line. */
export function hasImportDate(sellerId: string): boolean {
  return isTemplateTitleSeller(sellerId) || sellerId === GOPLUS_SELLER_ID
}

const RENT_PREFIX = /^cho thuê\s+/iu
const VEHICLE_WORD = /^(?:xe máy|xe tự lái|ô tô)\s+/iu
/** The two category labels that are a pair of synonyms; the first word of each is the one a buyer reads.
 *  ⚠️ A LOOKAHEAD, NOT `\b`: JavaScript's `\b` is ASCII-only even under `u`, so it never matches after "ư". */
const LABEL_PAIRS: [RegExp, string][] = [
  [/^căn hộ\s*\/\s*chung cư(?=\s|$)/iu, 'Căn hộ'],
  [/^nhà phố\s*\/\s*biệt thự(?=\s|$)/iu, 'Nhà phố'],
]
const BRACKET = /^\[([^\]]{1,20})\]\s*/u
/** Never dropped, whatever the lists below hold (see the header). Matched on the lower-cased tag. */
const NEW_TAG = /^(?:new|brand[\s-]*new|mới)/u
/** Condition tags that say "used" — compared ACCENTED and lower-cased, because folding would make
 *  "cũ" (used) equal "củ". Dropped only when the listing's condition is 'used' (the info line's "Đã dùng"). */
// ⚠️ NO "like new" here: it is the seller's QUALITY claim, finer than the info line's plain "Đã dùng" — dropping it
// would erase a signal buyers filter on (commit-gate review 2026-10-04). Only tags that say exactly "used" go.
const USED_TAGS = new Set(['used', '2nd', '2nd hand', '2hand', 'second hand', 'second-hand', 'secondhand', 'cũ', 'đồ cũ', 'hàng cũ', 'đã qua sử dụng', 'đã sử dụng'])
/** City tags — compared FOLDED (no tone marks, no dots): "[TP.HCM]", "[Sài Gòn]", "[HN]". Dropped only
 *  when the listing's location is that city, i.e. when the info line prints it. */
const HCMC_TAGS = new Set(['hcm', 'hcmc', 'tphcm', 'tp hcm', 'sai gon', 'saigon', 'ho chi minh', 'tp ho chi minh'])
const HANOI_TAGS = new Set(['hn', 'ha noi', 'hanoi', 'tp ha noi'])

/** No tone marks, no đ, no case — the key two spellings of one place meet on (see cardCity). */
const unaccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
const fold = (s: string) => unaccent(s).toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim()
const isHanoi = (location: string | null | undefined) => !!location && /^(?:(?:thanh pho|tp)\s+)?ha noi$/.test(fold(location))

/** Does this bracket tag only repeat what the card's info line already prints — its condition or its city? */
function repeatsInfoLine(tag: string, condition: string | null | undefined, location: string | null | undefined): boolean {
  const t = tag.normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim()
  if (NEW_TAG.test(t)) return false
  if (USED_TAGS.has(t)) return condition === 'used'
  const f = fold(t)
  if (HCMC_TAGS.has(f)) return isHcmc(location)
  if (HANOI_TAGS.has(f)) return isHanoi(location)
  return false
}

const words = (s: string) => s.trim().split(/\s+/u).filter(Boolean).length

export type CardTitleInput = {
  title: string
  lang: string
  sellerId: string
  categorySlug?: string | null
  listingType?: string | null
  /** The listing's stored condition ('used' | 'new' | …) — what the info line leads with. */
  condition?: string | null
  /** The listing's stored location — what the info line prints as the place. */
  location?: string | null
  /**
   * A no-pay LINKED job's employer, when the card's price slot prints it (listing-card.tsx `jobMeta`, UI climb 2026-11-09).
   * The importer titles such a job "<role> — <employer>" (job-listing.ts), so the tail would only repeat the slot above
   * it and push the role past the ellipsis on a phone — it goes, and only an exact " — <employer>" tail.
   */
  employer?: string | null
}

export function cardTitle({ title, lang, sellerId, categorySlug, listingType, condition, location, employer }: CardTitleInput): string {
  const src = title.normalize('NFC')
  let out = src
  if (employer && listingType === 'job') {
    const tail = ` — ${employer.normalize('NFC')}`
    // ⚠️ Cut first, compare after: lower-casing can change a string's length (İ → i̇), so comparing lowered strings and then
    // cutting by the employer's length could cut into the role (commit review).
    const end = src.slice(-tail.length)
    if (src.length <= tail.length || end.toLocaleLowerCase() !== tail.toLocaleLowerCase()) return title
    out = src.slice(0, src.length - tail.length).trimEnd()
  } else if (categorySlug === 'rentals') {
    if (sellerId === GOPLUS_SELLER_ID) {
      const rooms = src.replace(GOPLUS_BEDROOMS_EN, '$1-bed apartment').replace(GOPLUS_BEDROOMS_VI, 'Căn hộ $1PN')
      // A bare city or province ("Hồ Chí Minh", "Bình Dương") is all the info line would print, so the tail stays: it names the district.
      if (!location || isHcmc(location) || !NAMES_AN_AREA.test(location.normalize('NFC').trim())) return rooms === src ? title : rooms
      out = rooms.replace(GOPLUS_LOCATION_TAIL, '')
      if (out === src) return title
    } else {
      if (lang !== 'vi' || !isTemplateTitleSeller(sellerId) || !RENT_PREFIX.test(src)) return title
      out = src.replace(RENT_PREFIX, '').replace(VEHICLE_WORD, '')
      for (const [re, short] of LABEL_PAIRS) out = out.replace(re, short)
      // Honeycomb writes the category in lower case ("Cho thuê căn hộ 3PN…"); a title starts with a capital.
      out = out.charAt(0).toLocaleUpperCase('vi') + out.slice(1)
    }
  } else if (listingType === 'sell' && categorySlug !== 'jobs' && categorySlug !== 'teachers') {
    // Up to three leading tags ("[Like New] [HCM] Dell XPS…"), each only if it repeats the info line.
    let dropped = 0
    for (let m = BRACKET.exec(out); m && dropped < 3 && repeatsInfoLine(m[1], condition, location); m = BRACKET.exec(out)) {
      out = out.slice(m[0].length)
      dropped++
    }
    if (!dropped) return title
  } else {
    return title
  }
  return words(out) >= 2 ? out : title
}

/**
 * THE JOB TYPE AS A CARD PRINTS IT — "Full-time" / "Toàn thời gian" — or null for no known type. Since the 2026-11-07
 * audit it follows the place on a job card's info line (the newest fact, so the one an ellipsis takes); the price slot
 * holds pay only. The type is the jobs `jobtype` facet (taxonomy.ts, the jobs category — labels pinned by
 * card-title.test.ts).
 * ⚠️ `tr()` CALLS, NOT A DATA MAP, so scripts/gen-ui-strings.mjs harvests the labels for the nine
 * machine-translated languages like every other piece of copy.
 */
export function jobTypeLabel(jobType: string | null | undefined, tr: (en: string, vi: string) => string): string | null {
  return jobType === 'fulltime' ? tr('Full-time', 'Toàn thời gian')
    : jobType === 'parttime' ? tr('Part-time', 'Bán thời gian')
    : jobType === 'contract' ? tr('Contract', 'Hợp đồng')
    : jobType === 'freelance' ? tr('Freelance', 'Tự do')
    : jobType === 'temporary' ? tr('Temporary', 'Thời vụ')
    : jobType === 'remote' ? tr('Remote', 'Từ xa')
    : null
}

/**
 * Type · city — "Toàn thời gian · Hà Nội" (rentals-09), what a job card's price slot printed from 2026-10-04 until the
 * 2026-11-07 audit gave the slot back to pay. No card calls it now; it stays, tested, beside cardCity. The city is the
 * stored `Listing.city`. Null when there is no known job type.
 */
export function jobCardMeta(
  jobType: string | null | undefined,
  city: string | null | undefined,
  lang: string,
  tr: (en: string, vi: string) => string,
): string | null {
  const type = jobTypeLabel(jobType, tr)
  if (!type) return null
  const place = cardCity(city, lang, tr)
  return place ? `${type} · ${place}` : type
}

/**
 * The city as a card prints it: HCMC as the app's own short pair ("HCM" / "TP.HCM", city-short.ts),
 * any other province in the reader's language — the English name from the explorer's PROVINCES list
 * ("Hanoi", "Da Nang") for every non-Vietnamese reader, the stored Vietnamese name for a Vietnamese one.
 * ⚠️ MATCHED WITHOUT TONE MARKS. A job's `city` is the post-2025 vn-units name its importer writes
 * (job-listing.ts PLACES): "Khánh Hoà" and "Thanh Hoá" put the mark on another letter than the
 * explorer list's "Khánh Hòa" / "Thanh Hóa", so an exact (even NFC) comparison missed them and an
 * English card printed the Vietnamese name. A unit the old 63-province list does not have ("Huế")
 * prints unaccented ("Hue"), which is how English writes every one of these names.
 */
export function cardCity(city: string | null | undefined, lang: string, tr: (en: string, vi: string) => string): string | null {
  const c = city?.trim().normalize('NFC')
  if (!c) return null
  if (isHcmc(c)) return tr('HCM', 'TP.HCM')
  if (lang === 'vi') return c
  const key = unaccent(c).toLowerCase()
  const p = PROVINCES.find((x) => unaccent(x.name).toLowerCase() === key || x.nameEn.toLowerCase() === key)
  return p ? p.nameEn : unaccent(c)
}
