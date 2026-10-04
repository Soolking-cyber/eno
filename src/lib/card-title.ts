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
}

export function cardTitle({ title, lang, sellerId, categorySlug, listingType, condition, location }: CardTitleInput): string {
  const src = title.normalize('NFC')
  let out = src
  if (categorySlug === 'rentals') {
    if (lang !== 'vi' || !isTemplateTitleSeller(sellerId) || !RENT_PREFIX.test(src)) return title
    out = src.replace(RENT_PREFIX, '').replace(VEHICLE_WORD, '')
    for (const [re, short] of LABEL_PAIRS) out = out.replace(re, short)
    // Honeycomb writes the category in lower case ("Cho thuê căn hộ 3PN…"); a title starts with a capital.
    out = out.charAt(0).toLocaleUpperCase('vi') + out.slice(1)
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
 * THE JOB CARD'S PRICE SLOT WHEN THERE IS NO đồng FIGURE (rentals-09): "Toàn thời gian · Hà Nội"
 * instead of the 25 identical "Lương: xem chi tiết". The type is the jobs `jobtype` facet (taxonomy.ts,
 * the jobs category — labels pinned by card-title.test.ts); the city is the stored `Listing.city`.
 * Returns null when there is no known job type, so the caller keeps today's label.
 * ⚠️ `tr()` CALLS, NOT A DATA MAP, so scripts/gen-ui-strings.mjs harvests the labels for the nine
 * machine-translated languages like every other piece of copy.
 */
export function jobCardMeta(
  jobType: string | null | undefined,
  city: string | null | undefined,
  lang: string,
  tr: (en: string, vi: string) => string,
): string | null {
  const type = jobType === 'fulltime' ? tr('Full-time', 'Toàn thời gian')
    : jobType === 'parttime' ? tr('Part-time', 'Bán thời gian')
    : jobType === 'contract' ? tr('Contract', 'Hợp đồng')
    : jobType === 'freelance' ? tr('Freelance', 'Tự do')
    : jobType === 'temporary' ? tr('Temporary', 'Thời vụ')
    : jobType === 'remote' ? tr('Remote', 'Từ xa')
    : null
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
