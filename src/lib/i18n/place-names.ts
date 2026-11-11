import { DISTRICTS, PROVINCES } from '@/components/marketplace/listings-explorer.constants'
import { VN_PROVINCES } from '@/lib/vn-areas'
import { HANOI_DISTRICTS } from '@/lib/teachers/district-hanoi'

/**
 * ⛔ A VIETNAMESE PLACE NAME IS NEVER MACHINE-TRANSLATED — it is spelled, in Vietnamese with its marks and in every
 * other language without them (owner, 2026-11-11: "the translation of locations like districts are wrong, example thu
 * duc is german general in english — make sure all app doesnt have this kinda silly translations for addresses").
 *
 * MEASURED on the live /api/translate the same day. Vietnamese → English: a name ALONE is guessed at ("Thủ Đức" → "The
 * German leader", "Quận 7, TP.HCM" → "District 7, HCMC HCMC"), while in a line or a sentence the engine spells it right
 * ("Căn hộ Thủ Đức" → "Thu Duc Apartment", "Bán xe máy ở Thủ Đức" → "Motorbike for sale in Thu Duc"). English →
 * Vietnamese: a name alone stays English ("Thu Duc, Ho Chi Minh City"); in a sentence it comes back unmarked or half-
 * marked ("Thao Dien", "Bình Thanh"). So, inside translateBatch (every caller — listings, locations, chat, notifications,
 * the warm cron), a text that is ONLY place names (and punctuation) is spelled for an English or Vietnamese reader and
 * never reaches an engine or the cache (placeOnlyTranslation).
 * ⛔ NOTHING INSIDE A SENTENCE IS REWRITTEN (2026-11-11). A token shield (eight review rounds) and then a respelling of
 * the Vietnamese output (three) were each withdrawn as every round found a new way to change a seller's words — brands,
 * people's names ("My name is An Phu"), everyday phrases ("Hai Phòng Ngủ"), lost tokens. A miss there is yesterday's
 * behaviour; a false rewrite is silent.
 *
 * ⚠️ PROPER NAMES ONLY, MATCHED CASE-SENSITIVELY, EVERY SYLLABLE CAPITALISED. "hòa bình" (peace) is a word; "Hòa Bình"
 * is a province. A one-word English spelling is matched only from SAFE_SINGLE_EN ("Hue" is also a colour word). Wards
 * are NOT taken wholesale from data/vn-units.json: its 3,321 names include everyday phrases ("Thống Nhất", "Độc Lập",
 * "Hạnh Phúc") that a description uses as words; only the well-known areas in EXTRA are added.
 */

export type PlaceTerm = { vi: string; en: string }

/** Areas, cities and wards readers type that are not in the district/province tables. Append-only. */
const EXTRA: readonly PlaceTerm[] = [
  // HCMC areas and wards that listings name
  { vi: 'Thảo Điền', en: 'Thao Dien' },
  { vi: 'An Phú', en: 'An Phu' },
  { vi: 'An Khánh', en: 'An Khanh' },
  { vi: 'Thủ Thiêm', en: 'Thu Thiem' },
  { vi: 'Phú Mỹ Hưng', en: 'Phu My Hung' },
  { vi: 'Bến Thành', en: 'Ben Thanh' },
  { vi: 'Bến Nghé', en: 'Ben Nghe' },
  { vi: 'Đa Kao', en: 'Da Kao' },
  { vi: 'Tân Định', en: 'Tan Dinh' },
  { vi: 'Phạm Ngũ Lão', en: 'Pham Ngu Lao' },
  { vi: 'Bùi Viện', en: 'Bui Vien' },
  { vi: 'Cát Lái', en: 'Cat Lai' },
  { vi: 'Sài Gòn', en: 'Saigon' },
  // English: "HCM City", the house spelling (city-short.ts adminPlaceEn); "HCMC" is read as the same place.
  { vi: 'TP.HCM', en: 'HCM City' },
  { vi: 'TP. HCM', en: 'HCM City' },
  { vi: 'TPHCM', en: 'HCM City' },
  { vi: 'TP.HCM', en: 'HCMC' },
  // Da Nang
  { vi: 'Hải Châu', en: 'Hai Chau' },
  { vi: 'Sơn Trà', en: 'Son Tra' },
  { vi: 'Ngũ Hành Sơn', en: 'Ngu Hanh Son' },
  { vi: 'Thanh Khê', en: 'Thanh Khe' },
  { vi: 'Liên Chiểu', en: 'Lien Chieu' },
  { vi: 'Cẩm Lệ', en: 'Cam Le' },
  { vi: 'Mỹ Khê', en: 'My Khe' },
  { vi: 'An Thượng', en: 'An Thuong' },
  // Cities and destinations
  { vi: 'Hội An', en: 'Hoi An' },
  { vi: 'Nha Trang', en: 'Nha Trang' },
  { vi: 'Đà Lạt', en: 'Da Lat' },
  { vi: 'Phú Quốc', en: 'Phu Quoc' },
  { vi: 'Vũng Tàu', en: 'Vung Tau' },
  { vi: 'Hạ Long', en: 'Ha Long' },
  { vi: 'Sa Pa', en: 'Sapa' },
  { vi: 'Quy Nhơn', en: 'Quy Nhon' },
  { vi: 'Mũi Né', en: 'Mui Ne' },
  { vi: 'Phan Thiết', en: 'Phan Thiet' },
  { vi: 'Biên Hòa', en: 'Bien Hoa' },
  { vi: 'Thủ Dầu Một', en: 'Thu Dau Mot' },
  { vi: 'Dĩ An', en: 'Di An' },
  { vi: 'Thuận An', en: 'Thuan An' },
  { vi: 'Buôn Ma Thuột', en: 'Buon Ma Thuot' },
  { vi: 'Côn Đảo', en: 'Con Dao' },
  { vi: 'Cam Ranh', en: 'Cam Ranh' },
  { vi: 'Tuy Hòa', en: 'Tuy Hoa' },
  { vi: 'Pleiku', en: 'Pleiku' },
  { vi: 'Đồng Hới', en: 'Dong Hoi' },
  { vi: 'Mộc Châu', en: 'Moc Chau' },
  { vi: 'Tam Cốc', en: 'Tam Coc' },
]

/** One-word English spellings safe to match on their own (an English word could not be one of them). */
const SAFE_SINGLE_EN = new Set(['Hanoi', 'Saigon', 'Sapa', 'Pleiku', 'HCMC'])

/** "TP Thủ Đức" → "Thủ Đức", "Tỉnh X" → "X", "Binh Thanh District" → "Binh Thanh", "X (Y)" → "X". */
function core(name: string, lang: 'vi' | 'en'): string {
  let s = name.replace(/\s*\(.*\)\s*$/, '').trim()
  if (lang === 'vi') s = s.replace(/^(TP\.?|Thành phố|Tỉnh)\s+/u, '')
  else s = s.replace(/\s+(District|City|Province)$/u, '')
  return s.trim()
}

/** Old and new tone-mark placement both occur: "Khánh Hoà" / "Khánh Hòa", "Thuỵ" / "Thụy". */
const TONE_SWAPS: readonly [string, string][] = [
  ['oà', 'òa'], ['oá', 'óa'], ['oả', 'ỏa'], ['oã', 'õa'], ['oạ', 'ọa'],
  ['oè', 'òe'], ['oé', 'óe'], ['oẻ', 'ỏe'], ['oẽ', 'õe'], ['oẹ', 'ọe'],
  ['uỳ', 'ùy'], ['uý', 'úy'], ['uỷ', 'ủy'], ['uỹ', 'ũy'], ['uỵ', 'ụy'],
]
function toneVariants(s: string): string[] {
  const out = new Set([s])
  for (const [a, b] of TONE_SWAPS) {
    if (s.includes(a)) out.add(s.split(a).join(b))
    if (s.includes(b)) out.add(s.split(b).join(a))
  }
  return [...out]
}

/** Every syllable capitalised (a proper name), at least two letters. */
const isProperName = (s: string) => s.length >= 2 && s.split(/\s+/).filter((w) => !/^[-–—]$/.test(w)).every((w) => /^[\p{Lu}\p{N}]/u.test(w))

function buildTerms(): PlaceTerm[] {
  const raw: PlaceTerm[] = []
  for (const d of DISTRICTS) {
    if (d.slug === 'all' || /^d\d+$/.test(d.slug)) continue // numbered districts are the NUMBERED rule below
    raw.push({ vi: core(d.name, 'vi'), en: core(d.nameEn, 'en') })
  }
  for (const p of PROVINCES) raw.push({ vi: core(p.name, 'vi'), en: core(p.nameEn, 'en') })
  for (const p of VN_PROVINCES) raw.push({ vi: core(p.name, 'vi'), en: core(p.nameEn, 'en') })
  for (const h of HANOI_DISTRICTS) raw.push({ vi: h.vi, en: h.en })
  raw.push(...EXTRA)
  // The first spelling registered for a Vietnamese name is its English form ("Hanoi" from PROVINCES before VN_PROVINCES'
  // "Ha Noi"); every English spelling still maps back to the Vietnamese one.
  const seen = new Set<string>()
  const out: PlaceTerm[] = []
  for (const t of raw) {
    if (!t.vi || !t.en || !isProperName(t.vi) || !isProperName(t.en)) continue
    const k = `${t.vi}\u0000${t.en}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

export const PLACE_TERMS: readonly PlaceTerm[] = buildTerms()

/** One place, many spellings: HCMC's abbreviations and old name are the same place as "Hồ Chí Minh". */
const SAME_PLACE: Record<string, string> = { 'TP.HCM': 'Hồ Chí Minh', 'TP. HCM': 'Hồ Chí Minh', TPHCM: 'Hồ Chí Minh', 'Sài Gòn': 'Hồ Chí Minh' }
const placeId = (vi: string) => SAME_PLACE[vi] ?? vi

/**
 * Unambiguous names matched in ANY case ("thủ đức", "THU DUC", "go vap"): sellers type addresses lowercase and without
 * marks. ⛔ Only names no everyday phrase shares — "nhà bè" (a floating house), "cần giờ" ("need time"), "hòa bình"
 * (peace), "thanh xuân" (youth) stay capitalised-only.
 */
const ANY_CASE = new Set([
  'Thủ Đức', 'Gò Vấp', 'Bình Thạnh', 'Phú Nhuận', 'Tân Bình', 'Tân Phú', 'Bình Tân', 'Bình Chánh', 'Hóc Môn', 'Củ Chi',
  'Thảo Điền', 'Phú Mỹ Hưng', 'Thủ Thiêm', 'Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Nha Trang', 'Đà Lạt', 'Vũng Tàu',
  'Phú Quốc', 'Hải Phòng', 'Cần Thơ', 'Thủ Dầu Một', 'Cầu Giấy', 'Hoàn Kiếm', 'Ba Đình', 'Đống Đa', 'Long Biên',
  // ⛔ NOT "Hội An" ("xã hội an toàn", "hiệp hội an ninh" — review) and NOT "Biên Hòa" (unmarked "bien hoa" is "biến hóa").
])

/**
 * ⛔ THE MARK-LESS SPELLING IS MATCHED ONLY ON MARK-LESS TEXT, AND ONLY FOR THESE (review, 2026-11-11). Vietnamese tells
 * words apart by their marks: folded, "hai phòng" (two rooms) is "Hải Phòng", "đa năng" (multi-purpose) is "Đà Nẵng",
 * "học môn" is "Hóc Môn", "nhà trắng" is "Nha Trang", "tân binh" (a recruit) is "Tân Bình", "đá lát" is "Đà Lạt". So a span
 * that carries ANY mark must match a marked spelling exactly; and an unmarked "thu duc" is read as a place only for the
 * names below, whose unmarked spelling no everyday phrase shares ("hai phong ngu" is two bedrooms, so Hải Phòng is not here).
 */
const FOLD_SAFE = new Set([
  'Thủ Đức', 'Gò Vấp', 'Bình Thạnh', 'Phú Nhuận', 'Bình Chánh', 'Củ Chi', 'Thảo Điền', 'Phú Mỹ Hưng', 'Thủ Thiêm',
  'Hồ Chí Minh', 'Hà Nội', 'Vũng Tàu', 'Phú Quốc', 'Thủ Dầu Một', 'Cầu Giấy', 'Hoàn Kiếm',
])

/** Run-together English spellings that are matched as names too (the cache check accepts every run-together form). */
const RUN_TOGETHER_EN = new Set(['Dalat', 'Danang'])

/**
 * English spellings never turned into Vietnamese: brand names carry them ("Bia Saigon", "Saigon Co.op", "Saigon Centre").
 * The Vietnamese "Sài Gòn" still becomes "Saigon" in English.
 */
const NO_EN_TO_VI = new Set(['Saigon'])

/**
 * ⛔ PLACE NAMES THAT ARE ALSO EVERYDAY PHRASES — "Hòa Bình" (peace), "Thanh Xuân" (youth), "Long An" (+ "an toàn"),
 * "Cao Bằng" (as tall as), and unmarked "Hai Phong" (two rooms), "Da Nang" (multi-purpose)… Vietnamese listing titles are
 * often Title Case ("Tôi Yêu Hòa Bình", "Can Ho Hai Phong Ngu"), so inside a run of capitalised words these count as a place
 * only beside an administrative word (Tỉnh/TP./Quận/Huyện … City/District/Province). In ordinary sentence case a capitalised
 * name stands out and is taken.
 */
// Ambiguous however written (the marked spelling IS the everyday phrase).
const AMBIGUOUS = new Set(['Hòa Bình', 'Thanh Xuân', 'Thái Bình', 'Long An', 'Cao Bằng', 'Hà Nam', 'An Giang', 'Cần Giờ', 'Nhà Bè', 'Hoàng Mai', 'Nha Trang', 'Hội An'])
// Ambiguous only unmarked: "Hải Phòng" cannot be "hai phòng", but "Hai Phong" can be "hai phong" (two rooms).
const AMBIGUOUS_UNMARKED = new Set(['Hải Phòng', 'Đà Nẵng', 'Hóc Môn', 'Tân Bình', 'Đà Lạt', 'Đống Đa', 'Bình Tân'])
const capitalised = (w: string | undefined) => !!w && /^[\p{Lu}]/u.test(w)
/** Words that put a place after them: an ambiguous name right after one of these is the place ("ở Hòa Bình", "in Da Nang"). */
const LOCATIVES = new Set(['ở', 'tại', 'gần', 'từ', 'đến', 'về', 'đi', 'quê', 'in', 'at', 'near', 'from', 'to', 'around'])
/** A form of address before a name makes it a PERSON ("chị Thanh Xuân", "anh Bình Dương", "Mr Long An"), never a place. */
const HONORIFICS = new Set(['anh', 'chị', 'em', 'cô', 'chú', 'bác', 'ông', 'bà', 'bạn', 'thầy', 'cậu', 'dì', 'mr', 'mrs', 'ms', 'miss'])
/** English words that sit beside a place name in a title without making it a Title-Case run ("Da Nang Beach"). */
const EN_PLACE_WORDS = new Set([
  'Beach', 'Bay', 'Island', 'Islands', 'Airport', 'City', 'Street', 'St', 'Road', 'Rd', 'River', 'Bridge', 'Market', 'Center',
  'Centre', 'Hotel', 'Resort', 'Mall', 'Tower', 'Towers', 'Park', 'Lake', 'Hills', 'Mountain', 'Mountains', 'Port', 'Station',
  'Downtown', 'Area', 'Vietnam', 'Old', 'Town', 'Province', 'District', 'Apartment', 'Apartments', 'Villa', 'House', 'Room',
  'Studio', 'In', 'Near', 'To', 'From', 'Trip', 'Tour', 'Tours', 'Guide', 'Bus', 'Train', 'Flight', 'Hostel', 'Homestay',
])

/** Phrases that contain a place name but are not that place: "Thái Bình Dương" is the Pacific Ocean, not Thái Bình. */
const NOT_PLACES = /(?<![\p{L}\p{M}\p{N}])(?:Thái Bình Dương|Đại Tây Dương|Ấn Độ Dương)(?![\p{L}\p{M}\p{N}])/giu

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

type Canon = PlaceTerm & { id: string }
/** Exact-case spellings, and folded spellings for the any-case names. */
const BY_SPELLING = new Map<string, Canon>()
const BY_FOLDED = new Map<string, Canon>()

for (const t of PLACE_TERMS) {
  const id = placeId(t.vi)
  const canonical: Canon = { vi: t.vi, en: PLACE_TERMS.find((x) => x.vi === t.vi)!.en, id }
  for (const v of toneVariants(t.vi)) if (!BY_SPELLING.has(v)) BY_SPELLING.set(v, canonical)
  const enIsSafe = (t.en.includes(' ') || SAFE_SINGLE_EN.has(t.en)) && !NO_EN_TO_VI.has(t.en)
  if (enIsSafe && !BY_SPELLING.has(t.en)) BY_SPELLING.set(t.en, { vi: t.vi, en: t.en, id })
  // "Da Lat" → "Dalat" (the usual run-together spelling: one capital, not "DaLat").
  const joined = t.en.replace(/\s+/g, '')
  const runTogether = joined.charAt(0) + joined.slice(1).toLowerCase()
  if (RUN_TOGETHER_EN.has(runTogether) && !BY_SPELLING.has(runTogether)) BY_SPELLING.set(runTogether, { vi: t.vi, en: runTogether, id })
  if (FOLD_SAFE.has(t.vi) && !BY_FOLDED.has(fold(t.en))) BY_FOLDED.set(fold(t.en), { vi: t.vi, en: t.en, id })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const B = '(?<![\\p{L}\\p{M}\\p{N}])'
const E = '(?![\\p{L}\\p{M}\\p{N}])'
const alternation = (keys: Iterable<string>) => [...keys].sort((a, b) => b.length - a.length).map(escapeRe).join('|')
// Longest first, so "Nam Từ Liêm" wins over a shorter name inside it.
const NAMES_RE = new RegExp(`${B}(?:${alternation(BY_SPELLING.keys())})${E}`, 'gu')
// The any-case names in their MARKED spellings, matched in any case but with their marks exactly ("THỦ ĐỨC", "thủ đức").
const ANY_KEYS = new Set<string>()
// Only spellings that carry a mark: an unmarked one ("Nha Trang") matched in any case would be the folded match by another
// name ("nha trang dep" — a white house), so those stay exact-case.
for (const t of PLACE_TERMS) if (ANY_CASE.has(t.vi)) for (const v of toneVariants(t.vi)) if (fold(v) !== v.toLowerCase()) ANY_KEYS.add(v)
const BY_MARKED_LOWER = new Map<string, Canon>()
for (const k of ANY_KEYS) { const c = BY_SPELLING.get(k); if (c) BY_MARKED_LOWER.set(k.toLowerCase(), c) }
const ANY_RE = new RegExp(`${B}(?:${alternation(ANY_KEYS)})${E}`, 'giu')
// The mark-less spellings of FOLD_SAFE names, matched only where the text itself carries no mark ("thu duc", "THU DUC").
const FOLDED_RE = new RegExp(`${B}(?:${alternation(BY_FOLDED.keys())})${E}`, 'giu')
// Numbered administrative units: "Quận 7" ↔ "District 7", "Phường 12" → "Ward 12". ⛔ NOT an English "Ward 3" — in English
// that is as often a hospital ward ("near Ward 3, Chợ Rẫy hospital").
// Any case ("quận 7", "phường 3"), and the written-short "Q.7" / "Q. 7" (with its dot: a bare "Q7" is also an Audi).
const NUMBERED_RE = /(?<![\p{L}\p{M}\p{N}])(Quận|District|Phường|Q\.)\s*(\d{1,2})(?![\p{L}\p{M}\p{N}])/giu

type Found = { start: number; end: number; term: PlaceTerm; id: string }

/**
 * The administrative word beside a name travels with it: "TP. Hồ Chí Minh" ↔ "Ho Chi Minh City", "Quận Bình Thạnh" →
 * "Binh Thanh District", "Tỉnh Long An" ↔ "Long An Province". An English "<name> District" comes back into Vietnamese as
 * the bare name: whether it is a Quận or a Huyện is not in the English.
 */
const ADMIN_BEFORE = /(?:^|[^\p{L}\p{M}\p{N}])(TP\.\s?|TP\s|Thành phố\s|Tỉnh\s|Quận\s|Huyện\s)$/u
const ADMIN_AFTER = /^\s(City|District|Province)(?![\p{L}\p{M}\p{N}])/u
function withAdmin(term: PlaceTerm, before: string | undefined, after: string | undefined): PlaceTerm {
  const b = before?.trim().replace(/\s+/g, ' ')
  if (b === 'TP.' || b === 'TP' || b === 'Thành phố' || after === 'City') return { vi: `TP. ${term.vi}`, en: `${term.en} City` }
  if (b === 'Tỉnh' || after === 'Province') return { vi: `Tỉnh ${term.vi}`, en: `${term.en} Province` }
  if (b === 'Quận') return { vi: `Quận ${term.vi}`, en: `${term.en} District` }
  if (b === 'Huyện') return { vi: `Huyện ${term.vi}`, en: `${term.en} District` }
  if (after === 'District') return { vi: term.vi, en: `${term.en} District` }
  return term
}

/**
 * `numbered`: whether "Quận 7" / "District 7" count. Only for English and Vietnamese readers — every other engine renders a
 * numbered district well in its own language ("第7郡", "7군"), better than a Latin "District 7".
 */
function findPlaces(text: string, numbered = true): Found[] {
  const found: Found[] = []
  // Not a place: an ocean ("Thái Bình Dương"), and anything inside braces — a template placeholder ("{Hanoi}") is an
  // identifier, never respelled.
  const excluded: [number, number][] = []
  for (const m of text.matchAll(NOT_PLACES)) excluded.push([m.index!, m.index! + m[0].length])
  for (const m of text.matchAll(/[{｛][^{}｛｝]*[}｝]/g)) excluded.push([m.index!, m.index! + m[0].length])
  excluded.sort((p, q) => p[0] - q[0])
  // Binary search over the sorted spans (they do not overlap in practice), so many exclusions stay cheap.
  const inExcluded = (a: number, b: number) => {
    let lo = 0
    let hi = excluded.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const [x, y] = excluded[mid]
      if (y <= a) lo = mid + 1
      else if (x >= b) hi = mid - 1
      else return true
    }
    return false
  }
  // ⛔ In a text that carries Vietnamese marks, an UNMARKED spelling is a person, not the province: "anh Quang Nam" is
  // a name (the province is "Quảng Nam"), "Thanh Hoa" a name (the province "Thanh Hóa"). Only FOLD_SAFE names are taken
  // unmarked there (sellers do type "Thu Duc" inside Vietnamese).
  // Letters only Vietnamese writes: "café" or "José" is not a Vietnamese text.
  const textHasMarks = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/iu.test(text)
  const add = (start: number, end: number, canon: Canon) => {
    if (inExcluded(start, end)) return
    // Context is read from a short window only (a long prefix would make these anchored regexes quadratic).
    const before = text.slice(Math.max(0, start - 64), start)
    const after = text.slice(end, end + 64)
    const pre = ADMIN_BEFORE.exec(before)
    const post = ADMIN_AFTER.exec(after)
    const span = text.slice(start, end)
    const unmarked = fold(span) === span.toLowerCase()
    const adjacentPrevWord = /([\p{L}\p{M}]+)\.?\s+$/u.exec(before)?.[1]?.toLowerCase()
    if (!pre && !post && adjacentPrevWord && HONORIFICS.has(adjacentPrevWord)) return
    const afterLocative = !!adjacentPrevWord && LOCATIVES.has(adjacentPrevWord)
    // An administrative word beside it ("Da Nang City", "TP. Da Nang") or a locative before it ("ở Da Nang") settles that it
    // is the place.
    if (!pre && !post && !afterLocative && unmarked && textHasMarks && /[\p{L}]/u.test(span) && fold(canon.vi) !== canon.vi.toLowerCase() && !FOLD_SAFE.has(canon.vi)) return
    // ⛔ A name that IS an everyday phrase however written ("Hòa Bình" — peace): mid-sentence its capitals make it a
    // proper noun ("Du lịch Hội An"), but at a sentence's START followed by lowercase words ("Hòa Bình cho mọi người") the
    // capital is only the sentence's — a word, unless a locative or an administrative word says place.
    if (AMBIGUOUS.has(canon.vi) && !pre && !post) {
      const prev = /([\p{L}\p{M}]+)[^\p{L}\p{M}.!?…\n]*$/u.exec(before)?.[1]
      const next = /^\s+([\p{L}\p{M}]+)/u.exec(after)?.[1]
      const sentenceStart = !prev
      if (sentenceStart && next && !capitalised(next)) return
      // …and inside a Title-Case run ("Xã Hội An Toàn", "Tôi Yêu Hòa Bình") its capitals prove nothing either.
      const adjacentPrev = /([\p{L}\p{M}]+)\s+$/u.exec(before)?.[1]
      if (!LOCATIVES.has((adjacentPrev ?? '').toLowerCase())) {
        const titleRun = (w: string | undefined) => capitalised(w) && !EN_PLACE_WORDS.has(w!)
        if (titleRun(adjacentPrev) || titleRun(next)) return
      }
    }
    if (unmarked && AMBIGUOUS_UNMARKED.has(canon.vi) && !pre && !post) {
      // Only the words right beside it, across a space (a comma ends the run: "Hai Phong, Da Nang" is two places), and not
      // the English words a destination title puts there ("Da Nang Beach").
      const prevWord = /([\p{L}\p{M}]+)\s+$/u.exec(before)?.[1]
      const nextWord = /^\s+([\p{L}\p{M}]+)/u.exec(after)?.[1]
      const titleRun = (w: string | undefined) => capitalised(w) && !EN_PLACE_WORDS.has(w!)
      if (titleRun(prevWord) || titleRun(nextWord)) return
    }
    if (pre) start -= pre[1].length
    if (post) end += post[0].length
    found.push({ start, end, term: withAdmin(canon, pre?.[1], post?.[1]), id: canon.id })
  }
  for (const m of text.matchAll(NAMES_RE)) {
    const canon = BY_SPELLING.get(m[0])
    if (canon) add(m.index!, m.index! + m[0].length, canon)
  }
  for (const m of text.matchAll(ANY_RE)) {
    const canon = BY_MARKED_LOWER.get(m[0].toLowerCase())
    if (canon) add(m.index!, m.index! + m[0].length, canon)
  }
  for (const m of text.matchAll(FOLDED_RE)) {
    // ⛔ Only a span with no mark at all: "hai phòng" is two rooms, never a city (FOLD_SAFE says why).
    if (fold(m[0]) !== m[0].toLowerCase()) continue
    const canon = BY_FOLDED.get(m[0].toLowerCase())
    if (canon) add(m.index!, m.index! + m[0].length, canon)
  }
  for (const m of numbered ? text.matchAll(NUMBERED_RE) : []) {
    const n = m[2]
    // "Quận"/"District" need a space before the number ("Quận7" is not how anyone writes it); "Q." may be tight.
    if (!/^q\.$/i.test(m[1]) && !/\s/.test(m[0].slice(m[1].length))) continue
    const ward = m[1].toLowerCase() === 'phường'
    const term = ward ? { vi: `Phường ${n}`, en: `Ward ${n}` } : { vi: `Quận ${n}`, en: `District ${n}` }
    if (!inExcluded(m.index!, m.index! + m[0].length)) found.push({ start: m.index!, end: m.index! + m[0].length, term, id: term.vi })
  }
  // Overlaps: keep the earliest, then the longest.
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Found[] = []
  for (const f of found) if (!out.length || f.start >= out[out.length - 1].end) out.push(f)
  return out
}

/** The spelling a reader of `target` sees: Vietnamese with its marks; every other language the unaccented form. */
export function placeFor(term: PlaceTerm, target: string): string {
  return target === 'vi' ? term.vi : term.en
}

/** Does this text name a place? */
export function hasPlaceName(text: string): boolean {
  return findPlaces(text.normalize('NFC')).length > 0
}

/**
 * A text that is nothing but place names and punctuation ("Thủ Đức", "Thảo Điền, Thủ Đức", "Quận 7 - Phú Mỹ Hưng"),
 * spelled for `target` with no engine. Null when anything else is in it — that text goes to the engine.
 */
export function placeOnlyTranslation(text: string, target: string): string | null {
  // English and Vietnamese only (the owner's scope): every other engine writes a place in its own script ("河内").
  if (target !== 'en' && target !== 'vi') return null
  // A location line is short; a description never is place-only, and is not scanned.
  if (text.length > 120) return null
  const s = text.normalize('NFC')
  const found = findPlaces(s)
  if (!found.length) return null
  // ⛔ A name that is also something else is a place ON ITS OWN only with an administrative word ("Huyện Cần Giờ") —
  // beside another place it is one ("Nhà Bè, TP.HCM", "Hòa Bình, Long An"). Alone, it may be an everyday phrase ("Cần
  // Giờ?" — need time?, "Hòa Bình" — peace, an unmarked "Da Nang" — đa năng, multi-purpose) or a title ("District 9").
  if (found.length === 1) {
    const f = found[0]
    const span = s.slice(f.start, f.end)
    const noAdmin = f.term.vi === f.id && !/ (District|City|Province)$/.test(f.term.en)
    const unmarked = fold(span) === span.toLowerCase()
    if (noAdmin && (AMBIGUOUS.has(f.id) || (unmarked && AMBIGUOUS_UNMARKED.has(f.id)) || /^District\s/i.test(span))) return null
  }
  const parts: string[] = []
  let last = 0
  for (const f of found) {
    if (/[\p{L}\p{N}]/u.test(s.slice(last, f.start))) return null
    const span = s.slice(f.start, f.end)
    // ⛔ An unmarked name gets its marks only when its letters have ONE reading: "Thanh Hoa" alone may be a woman's name,
    // not the province Thanh Hóa — that text goes to the engine. Numbered units ("District 7") are always "Quận 7".
    if (target === 'vi' && fold(span) === span.toLowerCase() && !/^(Quận|Phường) \d/.test(f.id) && !ONE_READING_VI.has(f.id)) return null
    parts.push(s.slice(last, f.start), placeFor(f.term, target))
    last = f.end
  }
  if (/[\p{L}\p{N}]/u.test(s.slice(last))) return null
  parts.push(s.slice(last))
  return parts.join('')
}

/**
 * ⛔ AN UNMARKED NAME GETS ITS MARKS ONLY WHERE ITS LETTERS HAVE ONE READING. "Thu Duc" is Thủ Đức whatever was meant;
 * "Thanh Hoa" is not (the province Thanh Hóa, or a woman named Thanh Hoa), nor "Quang Nam", "Hoa Binh", "Thanh Xuan", "An
 * Phu". These are the well-known districts, areas and cities whose unmarked spelling is that place.
 */
const ONE_READING_VI = new Set([
  ...FOLD_SAFE, 'Tân Bình', 'Tân Phú', 'Bình Tân', 'Nhà Bè', 'Hóc Môn', 'Cần Giờ', 'Tây Hồ', 'Đống Đa', 'Ba Đình',
  'Hai Bà Trưng', 'Long Biên', 'Nam Từ Liêm', 'Bắc Từ Liêm', 'Đà Nẵng', 'Nha Trang', 'Đà Lạt', 'Hội An', 'Hải Phòng',
  'Cần Thơ', 'Biên Hòa', 'Bến Thành', 'Sơn Trà', 'Ngũ Hành Sơn', 'Hạ Long', 'Mũi Né', 'Quy Nhơn', 'Phan Thiết',
])
