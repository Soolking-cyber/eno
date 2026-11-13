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

/**
 * ⛔ ONE SHORT DISPLAY GRAMMAR FOR EVERY CARD AND ROW TITLE (UI climb batch 87, 2026-11-13 — round 13 "every fact once",
 * part d2a; blind A/B, Opus 7.03 → 7.29, trust +0.2; owner, 2026-11-13: "minimal wording only whats necessary"). Runs after
 * the shortening below, on every card but a teacher's (a name is a name):
 *   · a title SHOUTED in capitals (8+ letters, 70%+ upper case) reads in title case (unshout) — "NEKTAR LX25+ 25 KEY USB
 *     CONTROLLER" → "Nektar LX25+ 25 Key USB Controller". A token with a digit keeps its form (PS5, LX25+, 25W), an acronym
 *     stays (a known one, or 2–4 letters with no vowel: USB, LG, HCM), CASE_KEEP spells brands and model words (iPhone,
 *     Pro Max); every word goes up, in either language, a contraction as one word ("Don't");
 *   · a JOB drops its leading "[Job Opening]" / "[Tuyển dụng]" kind of tag and a "[Hanoi]" tag where the info line prints
 *     that city — never "[Urgent]", and never text after a " | " (commit review: that is where pay and visa live);
 *   · a trailing "." or "!" goes — never an ellipsis or an abbreviation's full stop.
 * ⛔ DISPLAY ONLY, like the shortening: the stored title, the h3's `title`, the photo's alt and the listing page keep every
 * character. Anything that would leave no word keeps the title as it was.
 */
export function cardTitle(input: CardTitleInput): string {
  return lineGrammar(cardTitleBase(input), input)
}

/**
 * The grammar ALONE, for a list ROW's title (compact-listing-row.tsx): a row keeps its stored title — none of the card's
 * shortening above (commit review) — but reads in the same grammar as the card beside it (batch 87).
 */
export function rowTitle(input: CardTitleInput): string {
  return lineGrammar(input.title, input)
}

function lineGrammar(base: string, input: CardTitleInput): string {
  if (input.listingType === 'teacher' || input.categorySlug === 'teachers') return base
  // NFC first (commit review, round 3): in a decomposed title the tone marks are not letters, so "BÁN" split into "BA" + "N".
  const out = titleGrammar(base.normalize('NFC'), input)
  return /[\p{L}\p{N}]/u.test(out) ? out : base
}

const CAPS_MIN_LETTERS = 8
const CAPS_SHARE = 0.7
/** Brands, exam names and model words a sentence-cased title spells as they are spelled. Matched on the lower-cased word. */
const CASE_KEEP: Readonly<Record<string, string>> = {
  iphone: 'iPhone', ipad: 'iPad', imac: 'iMac', macbook: 'MacBook', airpods: 'AirPods', playstation: 'PlayStation', youtube: 'YouTube',
  samsung: 'Samsung', sony: 'Sony', dell: 'Dell', belkin: 'Belkin', yamaha: 'Yamaha', honda: 'Honda', apple: 'Apple', xiaomi: 'Xiaomi',
  oppo: 'Oppo', vivo: 'Vivo', nikon: 'Nikon', canon: 'Canon', fujifilm: 'Fujifilm', lenovo: 'Lenovo', asus: 'Asus', acer: 'Acer',
  nintendo: 'Nintendo', toyota: 'Toyota', vinfast: 'VinFast', vinhomes: 'Vinhomes', vinuni: 'VinUni', nektar: 'Nektar', ikea: 'IKEA',
  english: 'English', vietnam: 'Vietnam', vietnamese: 'Vietnamese', hanoi: 'Hanoi', saigon: 'Saigon', korean: 'Korean',
  japanese: 'Japanese', chinese: 'Chinese', french: 'French',
  // model words, not acronyms: "PRO MAX" → "Pro Max"
  pro: 'Pro', max: 'Max', plus: 'Plus', ultra: 'Ultra', lite: 'Lite', air: 'Air',
}
/**
 * ⛔ AN ACRONYM IS KNOWN OR HAS NO VOWEL (commit review, 2026-11-13: a stop-word list guessed, and left "SOFA BED" shouting
 * while lowering "LG" and "RAM" in a Vietnamese title). A capitals word stays as typed when it is in this list, or is 2–4
 * letters (A–Z or Đ) with no vowel (LG, PD, TV, HCM, SSD, BĐS); every other shouted word goes to title case.
 * ⚠️ KNOWN, ACCEPTED: an abbreviation with a vowel that is not listed reads in title case ("Ngo" for a shouted "NGO") — one
 * word in ordinary case, nothing lost; add it here when one shows up.
 */
const ACRONYMS = new Set('USB RAM ROM CPU GPU HDMI LED LCD OLED UHD FHD HD AC DC ABS GPS SUV MPV BMW KTM ESL EFL IELTS TOEIC TOEFL TESOL TEFL CELTA DELTA STEM IGCSE IB IT HR PE VN VNA HCMC TPHCM IKEA NFC ANC USA UK EU VIP COD MBA SIM SEO MSI DJI AMD LTE CEO CFO CTO KOL KDC CHDV BĐS SĐT ĐH AB ATM VAT OK EV UBND'.split(' '))
// Đ counts as a consonant letter (commit review, round 4): BĐS, SĐT, ĐH are Vietnamese abbreviations, not words.
const isAcronym = (w: string) => ACRONYMS.has(w) || (/^[A-ZĐ]{2,4}$/.test(w) && !/[AEIOUY]/.test(w))
/**
 * ⛔ A SHORT WORD STAYS IN CAPITALS UNLESS IT IS KNOWN TO BE A WORD (commit review, round 5: "IOS", "API", "EV", "UX" read
 * "Ios", "Api"…). A shouted word of 1–3 Latin letters that is neither an acronym above nor in these lists keeps its capitals:
 * a missed word then stays loud, which is a matter of polish — a missed acronym would be misspelled, which is wrong. The
 * list holds English short words. A VIETNAMESE title (accents, or two common words typed without them) treats every short
 * word as a syllable unless it is a real acronym above — "Ai cần…" (who), "An Phú" — while an English one keeps "AI", "IOS".
 */
const SHORT_WORDS = new Set(('A AN THE AND OR FOR TO IN ON AT OF BY AS IS ARE BE WAS NEW OLD USE BIG BED CAR BOX SET KEY TOP HOT ONE TWO SIX TEN ' +
  'DAY NOW GET BUY ALL ANY OUT OFF OUR YOU HIS HER ITS MY WE US NO NOT JOB FUN MAN MEN BOY KID PET DOG CAT LOT FEW YES WAY ' +
  'AM IF UP GO HOW WHO WHY HAS HAD DID GOT LET SEE RUN OWN VIA PER FAR TOO TRY ASK AGE ART BAG BAR BUS CUP EYE FIT FIX GYM ' +
  'HAT LEG MAP MIX NET OIL PAY PEN RED SUN TEA TOY VAN WEB WET ZOO MAX LOW ODD RAW DRY ICE APP ' +
  'BAN XE NHA CHO CAN MOI CU GIA RE DEP TOT HO SO MAY DO TU BO QUA VE O CON MUA BAO CHI HAI BA BON NAM SAU TAM CHIN MUOI').split(' '))
const VIETNAMESE_ACCENT = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/iu
/** Words that mark a title typed in Vietnamese WITHOUT accents ("CHO THUE CAN HO AN PHU QUAN 2"): two of them make it Vietnamese. */
// ⚠️ No word that is also English (CAN, MAY, BAN, HO — commit review, round 6): "YOU CAN BUY IN MAY" must stay an English title.
const VIETNAMESE_PLAIN = new Set(('CHO THUE NHA PHONG XE QUAN PHUONG DUONG HUYEN GIA DEP MOI TIM VIEC LAM TUYEN DUNG GIAO VIEN TIENG CHINH CHU THANH PHO TRO MAT BANG DAT ' +
  // place and family-name syllables that are never English words
  'PHU THU DUC BINH TAN HOA NAM BAC TRUNG THAO DIEN NHUAN CHANH VAP KHANH NGUYEN TRAN PHAM HOANG HUYNH NGO QUOC VIET SAI GON HANOI').split(' '))
// HALF THE WORDS OR MORE (commit review, round 7): an English title naming one accented district ("IOS DEVELOPER IN THẢO
// ĐIỀN") stays English, so its acronyms stay.
const isVietnameseTitle = (s: string) => {
  const words = s.match(/\p{L}+/gu) ?? []
  const vietnamese = words.filter((w) => VIETNAMESE_ACCENT.test(w) || VIETNAMESE_PLAIN.has(w.toUpperCase())).length
  return words.length > 0 && vietnamese / words.length >= 0.5
}
/** In a Vietnamese title a short word is a syllable unless it is a real acronym; in an English one it is an acronym unless known. */
const keepsCapitals = (w: string, vietnamese: boolean) =>
  isAcronym(w) || (!vietnamese && /^[A-Z]{1,3}$/.test(w) && !SHORT_WORDS.has(w))
const isUpperLetter = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase()

/**
 * A SHOUTED title in TITLE CASE — "BÁN XE SUZUKI RAIDER" → "Bán Xe Suzuki Raider", "CHO THUÊ CĂN HỘ MASTERI THẢO ĐIỀN" →
 * "Cho Thuê Căn Hộ Masteri Thảo Điền". ⛔ NOT SENTENCE CASE (commit review, two rounds): lowering every word cannot know a
 * name, so brands, projects, streets and wards ("masteri thảo điền", "suzuki raider") and English "I" lost their capitals,
 * and the card then spelled a name differently from its own page. Title case ends the shouting and never lowers a name.
 */
function unshout(s: string): string {
  const letters = s.match(/\p{L}/gu) ?? []
  if (letters.length < CAPS_MIN_LETTERS || letters.filter(isUpperLetter).length / letters.length < CAPS_SHARE) return s
  // ⚠️ EVERY WORD UP, NO "small words" (commit review, round 3): Vietnamese typed without accents reads as English to any
  // test, and "AN PHU" lost its capital to an English "an". A word runs through an apostrophe ("Don't", "I'm").
  const vietnamese = isVietnameseTitle(s)
  return s.split(/(\s+)/).map((tok) => {
    if (!/\S/.test(tok)) return tok
    if (/\d/.test(tok)) return tok // PS5, LX25+, 25W, 3.0
    if (/^[A-Z]{1,4}(?:\/[A-Z]{1,4})+$/.test(tok)) return tok // VN/A, B/W
    return tok.replace(/\p{L}+(?:['’]\p{L}+)*/gu, (w) => {
      const keep = CASE_KEEP[w.toLowerCase()]
      if (keep) return keep
      if (w !== w.toUpperCase() || keepsCapitals(w, vietnamese)) return w
      const lower = w.toLocaleLowerCase('vi')
      return lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1)
    })
  }).join('')
}

/** A trailing "." or "!" goes — never an ellipsis, and never the full stop of an abbreviation ("Co., Ltd.", "etc."). */
const KEPT_FULL_STOP = /(?:^|[\s,(])(?:co|ltd|inc|corp|jsc|etc|st|dr|mr|mrs|ms|no|vs|tp|p|q)\.$/iu
function dropTrailingMark(s: string): string {
  if (/(?:\.\.\.|…)$/u.test(s) || KEPT_FULL_STOP.test(s)) return s
  return s.replace(/\s*[.!]+$/u, '')
}

/** A job title's leading kind-of-posting tag — never information the card lacks. ⛔ Not "[Urgent]" / "[Tuyển gấp]": for a
 *  listing without the urgent flag the tag is the only place that says so (commit review). */
const JOB_KIND_TAG = /^\[(?:job opening|job openings|hiring|we are hiring|we're hiring|tuyển dụng|tuyen dung|tuyển)\]\s*/iu

function titleGrammar(title: string, { listingType, categorySlug, location }: CardTitleInput): string {
  let s = title.replace(/\s+/g, ' ').trim()
  if (listingType === 'job' || categorySlug === 'jobs') {
    for (let i = 0; i < 3; i++) {
      const kind = JOB_KIND_TAG.exec(s)
      if (kind) { s = s.slice(kind[0].length); continue }
      const tag = BRACKET.exec(s)
      if (tag && repeatsInfoLine(tag[1], null, location)) { s = s.slice(tag[0].length); continue }
      break
    }
  }
  return dropTrailingMark(unshout(s)).trim()
}

function cardTitleBase({ title, lang, sellerId, categorySlug, listingType, condition, location, employer }: CardTitleInput): string {
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
 * The job type a card or row prints (UI climb batch 87, 2026-11-13): every type but FULL-TIME, the default most jobs are,
 * so "HCM · Full-time" on nearly every row said nothing — "Part-time", "Contract", "Remote"… still tell the reader something.
 */
export function cardJobType(jobType: string | null | undefined, tr: (en: string, vi: string) => string): string | null {
  return jobType === 'fulltime' ? null : jobTypeLabel(jobType, tr)
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
