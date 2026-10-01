import { fold } from './fold'

/**
 * ── GOODS THAT MAY NOT BE ADVERTISED IN VIETNAM ─────────────────────────────────────────────────
 *
 * Advertising Law 16/2012/QH13 Art 7 forbids ADVERTISING (not merely selling) of:
 *   · Art 7.2/7.3 — cigarettes and tobacco; spirits of 15° (15% ABV) or more
 *   · Art 7.4    — breast-milk substitutes for children under 24 months, feeding bottles and teats
 *   · Art 7.5    — prescription drugs (and, here, the veterinary prescription products named below)
 * plus e-cigarettes / heated tobacco, which Resolution 173/2024/QH15 made banned GOODS outright.
 *
 * A listing on eno.vn is an advertisement in the Advertising Law's sense, so an imported catalogue
 * row for "Rượu HALICO 30°" or "Bình sữa Wesser" must not go live — whoever wrote it.
 *
 * ⚠️ THIS IS A CLASSIFIER WITH THREE ANSWERS, NOT A WORD LIST WITH TWO. A word list cannot tell
 * "Rượu vang 13.5%" (wine — allowed) from "Rượu HALICO 30°" (spirit — banned), "Sữa cho bé 2-6
 * tuổi" (allowed) from "Sữa Meiji 1-3" (banned), or "Bình sữa Wesser" (banned) from "Nước rửa
 * bình sữa" (bottle detergent — allowed). So it PARSES strength and age, finds the head noun of a
 * title, and answers:
 *   · 'ban'    — high confidence. Importers never create it and hide an already-live one (journaled,
 *                src/lib/import-screen.ts); scripts/hide-ad-banned.ts may hide it.
 *   · 'review' — a signal it cannot settle (a soju with no strength, a stage-2 formula with no age,
 *                a generic "rượu" with nothing else, a spirit brand on something that may not be a
 *                drink). Importers never create it and list it in a review file; an already-live one
 *                is refreshed, never hidden. ⛔ AMBIGUOUS NEVER AUTO-BANS.
 *   · 'ok'     — no signal, or a signal an exclusion explains (a toy, a book or a sticker that HEADS
 *                the title — not one given away with the product — an accessory, a strength under
 *                15%, an age of 24 months or more).
 *
 * ⚠️ HOW IT READS TEXT:
 *   · Every match is on the accent-FOLDED text with WORD BOUNDARIES ("rượu" → "ruou"), so titles
 *     typed without accents match too and "Samsung" never reads as "súng".
 *   · A few words collide only once the accents are gone and are read on the RAW text instead:
 *     "ti giả" (pacifier) vs "tỉ giá" (exchange rate) both fold to "ti gia"; "sách" (book) vs
 *     "sạch" (clean) both fold to "sach"; "bé"/"trẻ" (baby/child) fold to everyday syllables.
 *   · TITLE vs DESCRIPTION. A product is what its title says. A strong term only in the description
 *     (a gift hamper whose description lists a Chivas) is 'review', never 'ban'; generic terms only
 *     in the description ("không mùi thuốc lá", "có ngăn để bình sữa") are ignored.
 *   · THE HEAD NOUN. Vietnamese names the product first ("Nước rửa bình sữa" = bottle detergent),
 *     English usually last ("Baby bottle cleanser") or with "for" ("Tumblers for liquor"). The FIRST
 *     hit of a rule in each title decides whether that title is about the regulated thing or an
 *     accessory for it: a Vietnamese accessory word up to four words BEFORE it, or an English one up
 *     to four words before / three words after it, makes it an accessory. When the two languages of
 *     one listing disagree, the answer is capped at 'review'.
 *
 * Pure (no I/O) apart from `fold`: unit-tested in ad-banned.test.ts, run by every importer through
 * src/lib/import-screen.ts and by scripts/hide-ad-banned.ts. NOT bundled into the post wizard —
 * user posts are screened by the narrower word list in publish-guard.ts (see the note there).
 */

export type AdBanRule = 'spirits' | 'tobacco' | 'vape' | 'infant_formula' | 'feeding_bottle' | 'teat' | 'rx_drug' | 'vet_drug'
export type AdBanVerdict = 'ban' | 'review' | 'ok'
export type AdBanResult = { verdict: AdBanVerdict; rule: AdBanRule | null; matched: string | null }

export type AdBanInput = {
  /** The listing title. Pass BOTH language variants an import has (title + titleVi). */
  title?: string | null
  titleVi?: string | null
  description?: string | null
  descriptionVi?: string | null
  /** Category slug (src/lib/taxonomy.ts), e.g. 'books-stationery', 'baby-kids', 'pets'. */
  category?: string | null
  /** Subcategory slug, e.g. 'toys'. */
  subcategory?: string | null
  /** The storefront / source merchant name. Context only (a baby store makes "bé" unnecessary). */
  merchant?: string | null
}

export const AD_BAN_RULES: readonly AdBanRule[] = ['spirits', 'tobacco', 'vape', 'infant_formula', 'feeding_bottle', 'teat', 'rx_drug', 'vet_drug']

const OK: AdBanResult = { verdict: 'ok', rule: null, matched: null }
const RANK: Record<AdBanVerdict, number> = { ok: 0, review: 1, ban: 2 }

// ── Text preparation ────────────────────────────────────────────────────────────────────────────

/** Folded, lower-case, accent-free; punctuation → space except the characters numbers need. */
export function prepAdText(s: string | null | undefined): string {
  if (!s) return ''
  return fold(s.replace(/&amp;/gi, '&').replace(/º/g, '°').replace(/[–—~]/g, '-'))
    .replace(/[^a-z0-9%°.,+\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const rawLower = (s: string | null | undefined) => (s ? s.normalize('NFC').toLowerCase() : '')

/** `\b(?:a|b c)\b` — NON-global (safe to `.test()` repeatedly); spaces match any whitespace. */
function words(terms: string[]): RegExp {
  const src = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|')
  return new RegExp(`\\b(?:${src})\\b`)
}
const any = (...res: RegExp[]) => new RegExp(res.map((r) => r.source).join('|'))
const asGlobal = (re: RegExp) => new RegExp(re.source, 'g')
/** Raw-text (diacritic-sensitive) whole-word test — `\b` is ASCII-only, so letters are spelled out. */
const rawWord = (word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${word}(?=$|[^\\p{L}\\p{N}])`, 'u')

type Hit = { text: string; index: number; end: number }
function findHits(re: RegExp, text: string): Hit[] {
  const out: Hit[] = []
  if (!text) return out
  const g = asGlobal(re)
  for (let m = g.exec(text); m; m = g.exec(text)) {
    out.push({ text: m[0], index: m.index, end: m.index + m[0].length })
    if (m[0].length === 0) g.lastIndex++
  }
  return out
}
const wordsBefore = (text: string, at: number, n: number) => text.slice(0, at).trim().split(' ').slice(-n).join(' ')
const wordsAfter = (text: string, at: number, n: number) => text.slice(at).trim().split(' ').slice(0, n).join(' ')

/** An accessory vocabulary for one rule: Vietnamese words precede the item, English ones surround it. */
type Accessories = { vi: RegExp; en: RegExp }
/** Is this hit an ACCESSORY for the regulated thing rather than the thing itself? */
function accessoryHit(text: string, h: Hit, acc: Accessories | null): boolean {
  if (!acc) return false
  const pre = wordsBefore(text, h.index, 4)
  // The Vietnamese test sees the hit too, so a phrase like "tủ rượu" (wine cabinet) is one unit.
  if (acc.vi.test(`${pre} ${h.text}`) || acc.en.test(pre) || acc.en.test(wordsAfter(text, h.end, 3))) return true
  // A Vietnamese title whose HEAD is an accessory, however far the drink word trails behind it:
  // "Bộ 6 ly thủy tinh chịu nhiệt cao cấp dùng uống nước hoặc rượu" is a set of glasses.
  const head = text.split(' ').slice(0, 4).join(' ')
  return h.index >= head.length && acc.vi.test(head)
}
/** A negated or incidental mention ("không hút thuốc lá", "cai thuốc lá", "no vaping"). */
const negatedHit = (text: string, h: Hit, neg: RegExp) => neg.test(wordsBefore(text, h.index, 2))

// ── Whole-listing exclusions ────────────────────────────────────────────────────────────────────

/** Not goods at all — a job, a flat, a teacher. Nothing in them advertises a product. */
const NON_GOODS_CATEGORIES = new Set(['jobs', 'rentals', 'property', 'teachers'])
/** What the listing IS when it heads the title: a book, a toy, a sticker. */
const BOOK_NOUN = words(['book', 'books', 'novel', 'manga', 'comic', 'comics', 'truyen tranh', 'tieu thuyet'])
/** A BOOK'S FORMAT — never a gift, never a product of its own, so it counts wherever it stands. */
const BOOK_FORMAT = words(['ebook', 'audiobook', 'tai ban', 'nxb', 'bia mem', 'bia cung', 'paperback', 'hardcover', 'reprint', 'ehon'])
// ⚠️ NOT "vol N": "Rượu JING 35 Vol 520ml" is a strength and a bottle size, not volume 520.
// "Phần 1" (part 1 of a series) too — but not "thành phần" (ingredients).
const BOOK_VOLUME = /\b(?:tap|quyen|volume|(?<!thanh )phan)\s*\d{1,3}\b/
const TOY = words(['do choi', 'toy', 'toys', 'bup be', 'doll', 'dolls', 'mo hinh', 'playset', 'lego'])
const STICKER = words(['sticker', 'stickers', 'decal', 'decals', 'hinh dan', 'poster', 'moc khoa', 'keychain', 'nam cham', 'magnet'])
const RAW_SACH = rawWord('sách')

/**
 * ⛔ AN EXCLUSION NOUN EXCUSES THE LISTING ONLY WHEN IT IS THE LISTING (2026-10-01, review). It used to
 * fire on the word anywhere in the title, and VN e-commerce titles end in a free gift: "Sữa bột Friso
 * Gold số 1 800g - Tặng đồ chơi", "Bình sữa Pigeon 240ml tặng kèm móc khóa", "Rượu Vodka Hà Nội 29.5%
 * tặng kèm decal" all read as a toy / a sticker and passed. So a toy, sticker or book NOUN counts only
 * in the title's HEAD (it starts within the first four words) and only when no gift word stands up to
 * three words before it. A book's FORMAT ("NXB Trẻ", "Bìa mềm", "Tập 08") is never a gift and is not
 * a product of its own, so it counts anywhere — still not after a gift word ("tặng sách tập 1").
 * ⚠️ "combo" right before the noun is a combo OF it ("Combo đồ chơi bình sữa búp bê" is toys); with
 * anything between ("Combo sữa Aptamil + đồ chơi") the noun is the add-on.
 */
const HEAD_WORDS = 4
const GIFT_WINDOW = 3
const GIFT_WORD = /^(?:tang|kem|qua|free|gift|gifts|bonus|freebie)$/
function giftBefore(before: string[]): boolean {
  const win = before.slice(-GIFT_WINDOW)
  return win.some((w) => GIFT_WORD.test(w)) || win.slice(0, -1).includes('combo')
}
/** The words of `text` before character `at` (folded text, space-separated). */
const wordsUpTo = (text: string, at: number) => text.slice(0, at).trim().split(' ').filter(Boolean)
/** A hit that heads the title (and is not a gift): see the note above. */
const headHit = (text: string, re: RegExp) =>
  findHits(re, text).some((h) => { const before = wordsUpTo(text, h.index); return before.length < HEAD_WORDS && !giftBefore(before) })
const anywhereHit = (text: string, re: RegExp) => findHits(re, text).some((h) => !giftBefore(wordsUpTo(text, h.index)))
/** The raw-text "sách" (book) at the head — raw because "sạch" (clean) folds to the same "sach". */
function rawHeadSach(raw: string): boolean {
  const m = RAW_SACH.exec(raw)
  if (!m) return false
  const before = raw.slice(0, m.index + m[1].length).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => fold(w))
  return before.length < HEAD_WORDS && !giftBefore(before)
}

function wholeListingExclusion(titles: string[], rawTitles: string[], category: string, subcategory: string): string | null {
  if (NON_GOODS_CATEGORIES.has(category)) return `category:${category}`
  if (category === 'books-stationery') return 'category:books'
  if (subcategory === 'toys') return 'subcategory:toys'
  for (const t of titles) {
    if (headHit(t, BOOK_NOUN) || anywhereHit(t, BOOK_FORMAT) || anywhereHit(t, BOOK_VOLUME)) return 'book'
    if (headHit(t, TOY)) return 'toy'
    if (headHit(t, STICKER)) return 'sticker'
  }
  if (rawTitles.some(rawHeadSach)) return 'book'
  return null
}

/**
 * Is this listing a BOOK (by category, a book noun heading the title, or a book's format)? Exported for
 * the import screen (src/lib/import-screen.ts): a book about weapons, opium or prostitution — "Bách
 * Khoa Thư Các Loại Vũ Khí", "Các Ty Độc Quyền Thuốc Phiện…", the novel "Làm Đĩ" — is a lawful book,
 * not the illegal goods the banned-word list is about. Same head/gift rules as the exclusion above.
 */
export function isBookListing(input: Pick<AdBanInput, 'title' | 'titleVi' | 'category'>): boolean {
  if ((input.category || '').toLowerCase() === 'books-stationery') return true
  const raw = [input.title, input.titleVi].filter((s): s is string => !!s && !!s.trim())
  const titles = raw.map(prepAdText)
  return titles.some((t) => headHit(t, BOOK_NOUN) || anywhereHit(t, BOOK_FORMAT) || anywhereHit(t, BOOK_VOLUME))
    || raw.map(rawLower).some(rawHeadSach)
}

// ── Strength (ABV) parsing ──────────────────────────────────────────────────────────────────────

/**
 * A percentage right after one of these is a discount, never a strength ("giảm 20%", "-20%").
 * ⚠️ NOT "còn" (it is also "cồn", alcohol: "độ cồn 40%") and NOT "mới" ("Rượu Nếp Mới 29.5%" is a
 * product name); conditions like "mới 99%" are already out of range.
 */
const DISCOUNT_BEFORE = /(?:\b(?:giam|sale|off|khuyen mai|km|chiet khau|tiet kiem|uu dai|discount|save|up to|toi da|len den|hoan tien|cashback|voucher|coupon|like new)\b[^\d]{0,6}|-)$/
/** Degrees that are not a strength: a temperature, an angle ("cầm nghiêng một góc 45 độ"). */
const TEMPERATURE_BEFORE = /\b(?:nhiet do|temperature|temp|goc|nghieng|angle)\b/
const NUM = '(\\d{1,2}(?:[.,]\\d{1,2})?)'
const ABV_TRAILING = [
  new RegExp(`\\b${NUM}\\s*(?:%|°)(?!\\s*[cf]\\b)`, 'g'),
  new RegExp(`\\b${NUM}\\s*do\\b(?!\\s*[cf]\\b)`, 'g'),
  new RegExp(`\\b${NUM}\\s*(?:v|vol|abv|alc)\\b`, 'g'),
]
// `(?!\\d)`: "30% ABV 500ml" must not read the bottle size as "ABV 50".
const ABV_LEADING = new RegExp(`\\b(?:nong do|abv|alc|alcohol|do con|do ruou)\\s*:?\\s*${NUM}(?![\\d.,]?\\d)`, 'g')

/**
 * The highest alcohol strength the text states, in % ABV, or null. Accepts `40%`, `40% vol`, `40°`,
 * `40 độ`, `30v`, `35 vol`, `nồng độ 35`, `ABV 40`, `alc. 13.5`. Rejects discounts ("giảm 20%"),
 * temperatures ("5-18 độ C", "nhiệt độ 12 độ") and anything above 75 ("mới 99%").
 * Only meaningful once the listing is known to be about a drink — callers check that first.
 */
export function parseAbv(text: string, opts: { needsDrinkWord?: boolean } = {}): number | null {
  if (!text) return null
  let best: number | null = null
  const take = (raw: string, at: number, generic = false) => {
    const n = Number(raw.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0.5 || n > 75) return
    // In a DESCRIPTION a bare "%" or "độ"/"°" is usually something else ("45% polyester", "a 45-degree
    // angle"): it counts only with a drink word just before it. vol, ABV, "nồng độ", "độ cồn" are
    // strengths wherever they appear.
    if (generic && opts.needsDrinkWord && !ALCOHOL_CTX.test(text.slice(Math.max(0, at - 40), at))) return
    if (DISCOUNT_BEFORE.test(text.slice(Math.max(0, at - 18), at).trimEnd())) return
    if (TEMPERATURE_BEFORE.test(text.slice(Math.max(0, at - 26), at))) return
    best = best === null ? n : Math.max(best, n)
  }
  ABV_TRAILING.forEach((proto, i) => {
    const re = asGlobal(proto)
    for (let m = re.exec(text); m; m = re.exec(text)) take(m[1], m.index, i < 2)
  })
  const lead = asGlobal(ABV_LEADING)
  for (let m = lead.exec(text); m; m = lead.exec(text)) take(m[1], m.index + m[0].length - m[1].length)
  return best
}

// ── Age / stage parsing (infant formula) ────────────────────────────────────────────────────────

export type InfantAge = { loMonths: number; kind: 'explicit' | 'bare' } | null

const RANGE = '(\\d{1,2})\\s*(?:-|den|to)\\s*(\\d{1,2})'
const MONTHS = '(?:thang|th|m|months?|mos?)'
const YEARS = '(?:tuoi|years?|yrs?|y|yo)'
const FROM = '(?:tu|from|tren|over|above|aged?|for|cho)'
const AGE_PATTERNS: [RegExp, number][] = [
  [new RegExp(`\\b${RANGE}\\s*${MONTHS}\\b`, 'g'), 1],
  [new RegExp(`\\b${RANGE}\\s*${YEARS}\\b`, 'g'), 12],
  [new RegExp(`\\b${FROM}\\s*(\\d{1,2})\\s*${MONTHS}\\b`, 'g'), 1],
  [new RegExp(`\\b${FROM}\\s*(\\d{1,2})\\s*${YEARS}\\b`, 'g'), 12],
  [new RegExp(`\\b(\\d{1,2})\\s*${MONTHS}\\s*(?:\\+|tro len|and up|plus)`, 'g'), 1],
  [new RegExp(`\\b(\\d{1,2})\\s*\\+\\s*${MONTHS}\\b`, 'g'), 1],
  [new RegExp(`\\b(\\d{1,2})\\s*(?:\\+\\s*)?${YEARS}\\s*(?:\\+|tro len|and up|plus|old)`, 'g'), 12],
  [new RegExp(`\\b(\\d{1,2})\\s*\\+\\s*${YEARS}\\b`, 'g'), 12],
]
/** A unit-less range ("Meiji 1-3", "0-1") — not a weight, a volume or a size. */
const BARE_RANGE = /\b(\d)\s*-\s*(\d{1,2})\b(?!\s*(?:[.,]\d|(?:kg|g|gr|ml|l|cm|mm|m|lon|hop|x|thang|tuoi|years?|months?)\b|%))/

/**
 * The YOUNGEST age a formula says it is for, in months. `explicit` when a unit was given
 * ("0-6 tháng", "1-3 tuổi", "từ 1 tuổi trở lên", "2-6 years", "6m+", "sơ sinh"); `bare` for a
 * unit-less range like Meiji's "1-3" (years by that brand's convention — read conservatively).
 */
export function parseInfantAge(text: string): InfantAge {
  if (!text) return null
  const explicit: number[] = []
  for (const [proto, mult] of AGE_PATTERNS) {
    const re = asGlobal(proto)
    for (let m = re.exec(text); m; m = re.exec(text)) explicit.push(Number(m[1]) * mult)
  }
  if (/\b(?:so sinh|newborn|new born|nhu nhi)\b/.test(text)) explicit.push(0)
  if (explicit.length) return { loMonths: Math.min(...explicit), kind: 'explicit' }
  const bare = BARE_RANGE.exec(text)
  return bare ? { loMonths: Number(bare[1]) * 12, kind: 'bare' } : null
}

const STAGE = /\b(?:so|step|stage|buoc|giai doan|gold|plus|optipro|infinipro|neuropro|iq|grow|gain|premium|organic|a2|hmo|alpha|pro|kid|aptamil|similac|friso|frisolac|enfamil|enfagrow|nan|meiji|morinaga|optimum|dielac|hipp|kendamil|bellamy|colosbaby)\s*([0-6])\b(?!\s*(?:[.,]\d|(?:kg|g|gr|ml|l|lon|hop|x|tuoi|years?|thang|months?)\b|-|\+|%))/
/** The formula's stage number ("số 0", "số 1", "Step 4", "Neuropro 4", "Similac 2"), or null.
 *  Stage 0 is the newborn tier (Meiji "số 0" = 0-1 year) — under 24 months like stage 1. */
export function parseStage(text: string): number | null {
  const m = STAGE.exec(text)
  return m ? Number(m[1]) : null
}

// ── Per-rule detectors ──────────────────────────────────────────────────────────────────────────

type Ctx = {
  titles: string[] // folded title variants
  rawTitles: string[] // raw lower-case title variants, same order
  desc: string // folded description variants, joined
  category: string
  merchant: string // folded
}

const res = (verdict: AdBanVerdict, rule: AdBanRule, matched: string): AdBanResult => ({ verdict, rule, matched })

type Reading = { kind: 'none' | 'product' | 'accessory' | 'mixed'; matched: string }
/**
 * For each title variant, the FIRST hit decides product vs accessory (the head-noun rule above).
 * 'product' if every variant with a hit reads as the product, 'accessory' if every one reads as an
 * accessory, 'mixed' when they disagree.
 */
function titleReading(titles: string[], re: RegExp, acc: Accessories | null, neg?: RegExp): Reading {
  let product = false, accessory = false, matched = ''
  for (const t of titles) {
    const first = findHits(re, t).find((h) => !neg || !negatedHit(t, h, neg))
    if (!first) continue
    if (accessoryHit(t, first, acc)) { accessory = true; matched ||= first.text }
    // "…có thể lắp núm ty", "fits Avent teats": the item takes the regulated thing but is not it —
    // not settled either way, so both flags (→ 'mixed' → review).
    else if (COMPATIBLE.test(wordsBefore(t, first.index, 4))) { product = true; accessory = true; matched = first.text }
    else { product = true; matched = first.text }
  }
  return { kind: product && accessory ? 'mixed' : product ? 'product' : accessory ? 'accessory' : 'none', matched }
}
const COMPATIBLE = /\b(?:lap|lap vua|lap duoc|tuong thich|phu hop voi|dung voi|dung duoc|vua voi|fits|fit|compatible|works with)\b/
const capMixed = (r: Reading, v: AdBanVerdict): AdBanVerdict => (r.kind === 'mixed' && v === 'ban' ? 'review' : v)

// ---- Spirits ≥ 15% ABV ------------------------------------------------------------------------

/** A drink is being talked about — the gate for reading any number as a strength. */
// ⛔ NO BARE "rum" OR "gin": "giòn rụm" (crispy) folds to "gion rum" and "gìn giữ" (to preserve) to
// "gin giu" — the first dry run flagged a spring-roll pack and a self-help book. They count only as
// phrases (SPIRIT_TYPES: "ruou rum", "dry gin", …).
const ALCOHOL_CTX = words(['ruou', 'bia', 'beer', 'wine', 'vang do', 'vang trang', 'vang ngot', 'whisky', 'whiskey', 'vodka', 'tequila', 'cognac', 'brandy', 'soju', 'sake', 'liquor', 'liqueur', 'champagne', 'mezcal', 'baijiu', 'cider', 'lager', 'shochu', 'makgeolli', 'ruou rum', 'ruou gin', 'dry gin', 'london dry', 'gin tonic', 'dark rum', 'white rum', 'spiced rum'])
/** Brands that only make spirits ≥ 15% (or the variants of one that are). */
const SPIRIT_BRANDS = words([
  'hennessy', 'chivas', 'johnnie walker', 'jack daniel', 'jack daniels', 'jose cuervo', 'absolut', 'smirnoff',
  'ballantine', 'ballantines', 'macallan', 'glenfiddich', 'glenlivet', 'jameson', 'remy martin', 'martell', 'bacardi',
  'captain morgan', 'jim beam', 'jagermeister', 'jgermeister', 'grey goose', 'royal salute', 'dalmore', 'courvoisier',
  'wild turkey', 'beluga vodka', 'moutai', 'mao dai', 'halico', 'label 5', 'dewars', 'monkey shoulder', 'hibiki', 'nikka',
  'jinro fresh', 'chamisul', 'jinro is back', 'ilpoom', 'baileys', 'kahlua',
])
// ⚠️ NOT "Camus" (a cognac house, and the author of every "Albert Camus" book Tiki sells) — measured.
/** Words that name a spirit (always ≥ 15%) — banned unless a stated strength says otherwise. */
const SPIRIT_TYPES = words([
  'whisky', 'whiskey', 'vodka', 'tequila', 'mezcal', 'baijiu', 'liquor', 'ruou manh', 'ruou de', 'ruou trang', 'ruou ngo',
  'ruou thuoc', 'ruou sam', 'ruou nhan sam', 'ruou ngam', 'ruou tam', 'ruou dong trung', 'ruou ba kich', 'ruou tao meo',
  'ruou mo', 'ruou chuoi hot', 'ruou gao', 'ruou nep cai hoa vang', 'shochu', 'absinthe',
  'ruou rum', 'ruou gin', 'dry gin', 'london dry gin', 'dark rum', 'white rum', 'spiced rum', 'gold rum',
])
const SPIRIT_STRONG = any(SPIRIT_BRANDS, SPIRIT_TYPES)
/** Words that USUALLY mean a spirit but collide or vary in strength — 'review' without a strength. */
const SPIRIT_WEAK = words(['ruou', 'soju', 'ruou sake', 'cognac', 'brandy', 'liqueur', 'jinro'])
/** Wine and beer: allowed unless a stated strength is ≥ 15%. */
const WINE_BEER = words(['ruou vang', 'vang do', 'vang trang', 'vang ngot', 'wine', 'bia', 'beer', 'champagne', 'cider', 'lager', 'makgeolli'])
/** Not a drink at all: "màu đỏ rượu" (wine red), "Brandy Melville", a cognac-coloured bag. */
const SPIRIT_FALSE = words(['do ruou', 'mau ruou', 'mau ruou vang', 'wine red', 'brandy melville', 'mau cognac', 'cognac leather', 'cognac color', 'cognac colour', 'rum raisin', 'kem rum', 'whiskey lake', 'whisky lake'])
const ALC_ACC: Accessories = {
  vi: /\b(?:tu ruou|tu vang|tu uop|tu lam mat|tu trung bay|tu bao quan|tu dung|ke ruou|ke trung bay|ke de|gia treo|gia de|gia ruou|ly|coc|chen|binh rot|binh dung|binh chiet|may rot|voi rot|khui|mo nut|mo chai|nut chai|xo da|xo uop|thung da|da uop|hop dung|tui dung|dung cu|nhiet ke|ban bar|quay bar)\b/,
  en: /\b(?:glass|glasses|cup|cups|tumbler|tumblers|goblet|goblets|cabinet|cabinets|rack|racks|cooler|coolers|fridge|refrigerator|dispenser|decanter|opener|corkscrew|stones|bucket|chiller|holder|pourer|aerator|stopper|display)\b/,
}

/**
 * ⛔ A SPIRIT WORD IN A TITLE IS NOT YET A BOTTLE OF SPIRITS (2026-10-01, review). A brand or a spirit
 * type anywhere used to auto-ban unless an accessory word preceded it, so a T-shirt, a cap, a phone
 * case, a perfume, a chocolate, a rum cake, a whisky-flavoured coffee, a herbal BATH "rượu", a foot
 * soak and a set of whisky stones were all 'ban' — breaking "ambiguous → review, never auto-ban", and
 * a 'ban' leaves no trail in an importer's review file. A 'ban' now needs BOTH:
 *   · the title says it is a drink — its HEAD is the drink word (only pack words like "combo", "chai",
 *     "hộp quà", "chính hãng" or a count may come first), or it carries a drink signal: a strength, a
 *     volume (700ml, 0.7L), "chai", "thùng", "bottle";
 *   · and nothing says it is something else — a non-drink head BEFORE the drink word (áo, mũ, ốp lưng,
 *     nước hoa, tinh dầu, bánh, kẹo, socola, cà phê, đá viên, shirt, perfume…), a flavour word right
 *     before it ("hương whisky", "mùi rượu"), or a non-drinking use anywhere ("rượu tắm" — read on the
 *     RAW text, since "rượu tăm" is a real liquor — "ngâm chân", "xoa bóp", a sauce), or a WEIGHT
 *     ("553g": drinks are sold by volume).
 * Otherwise the answer is capped at 'review': a human decides, and nothing is hidden on it.
 */
const DRINK_ANY = any(ALCOHOL_CTX, SPIRIT_BRANDS, SPIRIT_TYPES, SPIRIT_WEAK)
const DRINK_LEAD_WORD = /^(?:combo|set|bo|hop|qua|thung|chai|binh|lo|can|lon|ket|box|pack|gift|x?\d+[a-z]*|x|sale|hot|new|moi|chinh|hang|nhap|khau|genuine|authentic|original|imported|premium|cao|cap|[-+|.,&])$/
const DRINK_SIGNAL = /\b\d+(?:[.,]\d+)?\s*(?:ml|cl|l|lit|litre|litres|liter|liters)\b|\b(?:chai|thung|bottle|bottles)\b/
const NON_DRINK_HEAD = words([
  'ao', 'ao thun', 'mu', 'non', 'op', 'op lung', 'nuoc hoa', 'tinh dau', 'banh', 'keo', 'socola', 'chocolate', 'ca phe',
  'coffee', 'da vien', 'stones', 'shirt', 't-shirt', 'tshirt', 'tee', 'hoodie', 'case', 'cover', 'perfume',
  'cologne', 'fragrance', 'candle', 'nen thom', 'xa phong', 'soap', 'sua tam', 'cake', 'candy', 'sticker',
])
// ⚠️ NOT "cap" (folds from "cấp": "Hộp quà cao cấp Chivas"), "hat" ("hạt") or a bare "nen" ("nên").
const FLAVOUR_BEFORE = /\b(?:huong|mui|vi|flavor|flavour|flavored|flavoured|scent|scented|aroma|taste)\b/
const NON_DRINK_USE = words(['ngam chan', 'xoa bop', 'bath', 'massage', 'foot soak', 'ngoai da', 'sauce', 'sot', 'bbq', 'barbecue'])
/** Drinks are sold by volume; a WEIGHT ("553g", "1kg") is food, a candle, a cosmetic. */
const WEIGHT = /\b\d+(?:[.,]\d+)?\s*(?:g|gr|gram|grams|kg)\b/
const RAW_BATH = rawWord('tắm')

/** Is the first drink word of this title its head (only pack words before it)? */
function drinkHead(t: string): boolean {
  const first = findHits(DRINK_ANY, t)[0]
  return !!first && wordsUpTo(t, first.index).every((w) => DRINK_LEAD_WORD.test(w))
}
/** Does anything in this title say it is something other than a drink? */
function nonDrink(t: string, raw: string): boolean {
  if (NON_DRINK_USE.test(t) || WEIGHT.test(t) || RAW_BATH.test(raw)) return true
  const first = findHits(DRINK_ANY, t)[0]
  if (!first) return false
  const before = t.slice(0, first.index)
  return NON_DRINK_HEAD.test(before) || FLAVOUR_BEFORE.test(wordsBefore(t, first.index, 2))
}

function spirits(ctx: Ctx): AdBanResult {
  const titles = ctx.titles.map((t) => t.replace(asGlobal(SPIRIT_FALSE), ' '))
  const sure = titles.some((t) => findHits(DRINK_ANY, t).length > 0 && (drinkHead(t) || DRINK_SIGNAL.test(t) || parseAbv(t) !== null))
    && !titles.some((t, i) => nonDrink(t, ctx.rawTitles[i] ?? ''))
  /** Every 'ban' below goes through here: without a sure drink it is a 'review'. */
  const settle = (v: AdBanVerdict): AdBanVerdict => (v === 'ban' && !sure ? 'review' : v)
  const anyAlcohol = titles.some((t) => ALCOHOL_CTX.test(t) || SPIRIT_BRANDS.test(t))
  if (!anyAlcohol) {
    // A spirit BRAND named only in the description (a gift hamper's contents) — never more than a
    // review. Brands only: a description's bare "whiskey" was an Intel CPU ("Whiskey Lake") on
    // every refurbished laptop the dry run flagged.
    const d = ctx.desc.replace(asGlobal(SPIRIT_FALSE), ' ')
    const hit = findHits(SPIRIT_BRANDS, d)[0]
    if (hit) {
      const abv = parseAbv(d, { needsDrinkWord: true })
      if (abv === null || abv >= 15) return res('review', 'spirits', `description: ${hit.text}`)
    }
    return OK
  }
  const strong = titleReading(titles, SPIRIT_STRONG, ALC_ACC)
  const weak = titleReading(titles, SPIRIT_WEAK, ALC_ACC)
  const wine = titleReading(titles, WINE_BEER, ALC_ACC)
  const readings = [strong, weak, wine]
  if (readings.every((r) => r.kind === 'none')) return OK
  // Strength: the title first; the description only when the title states none.
  const abv = parseAbv(titles.join(' | ')) ?? parseAbv(ctx.desc, { needsDrinkWord: true })
  const accessory = readings.every((r) => r.kind === 'none' || r.kind === 'accessory')
  const mixed = readings.some((r) => r.kind === 'mixed')
  const label = strong.matched || weak.matched || wine.matched
  if (abv !== null) {
    if (abv < 15) return OK // wine, beer, a 13% fruit soju, a 4.5% RTD — the law draws the line at 15
    if (accessory) return res('review', 'spirits', `${label} ${abv}% (accessory?)`)
    return res(settle(mixed ? 'review' : 'ban'), 'spirits', `${label} ${abv}%`)
  }
  if (accessory) return OK // a whisky glass, a wine cabinet, a branded tumbler
  if (strong.kind === 'product' || strong.kind === 'mixed') return res(settle(capMixed(strong, 'ban')), 'spirits', strong.matched)
  // Only weak words (or wine/beer) are left. Wine and beer with no strength pass; a bare "rượu", a
  // soju or a sake with no strength cannot be settled from the text.
  if (weak.kind === 'product' || weak.kind === 'mixed') {
    const plainWine = wine.kind === 'product' && weak.matched === 'ruou'
    if (!plainWine) return res('review', 'spirits', weak.matched)
  }
  return OK
}

// ---- Tobacco ------------------------------------------------------------------------------------

const TOBACCO_BRANDS = words(['marlboro', 'vinataba', 'cohiba', 'mevius', 'lucky strike', 'craven a'])
const TOBACCO_PRODUCTS = any(TOBACCO_BRANDS, words(['xi ga', 'cigar', 'cigars', 'cigarette', 'cigarettes', 'thuoc la dieu', 'thuoc lao', 'shisha', 'hookah', 'thuoc tau', 'goi thuoc la', 'bao thuoc la', 'cay thuoc la']))
const TOBACCO_GENERIC = words(['thuoc la', 'tobacco'])
const TOBACCO_NEG = /\b(?:khong|cam|chong|cai|ngan|ngua|hut|mui|khoi|bui|no|non|anti|quit|stop|smoke|free)\b/
const TOBACCO_ACC: Accessories = {
  vi: /\b(?:gat tan|bat lua|hop dung|tau|dieu|ong dieu|dao cat|keo cat|may cuon|hop giu am|tu giu am|dieu bat)\b/,
  en: /\b(?:smoke|smoking|lighter|lighters|case|holder|filter|filters|pants|jeans|trousers|cutter|humidor|ashtray|scent|vanille|vanilla|fragrance|perfume|parfum|edp|edt)\b/,
}

function tobacco(ctx: Ctx): AdBanResult {
  const product = titleReading(ctx.titles, TOBACCO_PRODUCTS, TOBACCO_ACC, TOBACCO_NEG)
  if (product.kind === 'product' || product.kind === 'mixed') return res(capMixed(product, 'ban'), 'tobacco', product.matched)
  if (product.kind === 'accessory') return OK
  const generic = titleReading(ctx.titles, TOBACCO_GENERIC, TOBACCO_ACC, TOBACCO_NEG)
  if (generic.kind === 'product' || generic.kind === 'mixed') return res('review', 'tobacco', generic.matched)
  const d = findHits(TOBACCO_BRANDS, ctx.desc)[0]
  return d ? res('review', 'tobacco', `description: ${d.text}`) : OK
}

// ---- E-cigarettes, vapes, heated tobacco (banned goods since 1 Jan 2025) ------------------------

const VAPE = words([
  'vape', 'vapes', 'vaping', 'pod vape', 'vape pod', 'pod system', 'pod chill', 'tinh dau pod', 'tinh dau vape',
  'tinh dau thuoc la', 'thuoc la dien tu', 'thuoc la nung nong', 'thuoc la the he moi', 'e-cigarette', 'e-cigarettes',
  'e cigarette', 'e cigarettes', 'ecig', 'e-cig', 'e-cigs', 'e-liquid', 'eliquid', 'e-juice', 'salt nic', 'saltnic',
  'juice vape', 'heated tobacco', 'heat-not-burn', 'iqos', 'heets', 'terea', 'relx', 'vaporesso', 'voopoo', 'geekvape',
  'smok', 'uwell', 'caliburn', 'elf bar', 'elfbar', 'lost mary', 'juul', 'oxva', 'lil hybrid', 'lil solid', 'glo hyper',
  'ploom', 'nicotine pouch', 'nicotine pouches', 'nicotine pod', 'nicotine pods',
])
const VAPE_NEG = /\b(?:khong|cam|chong|cai|no|non|anti|quit|stop|free)\b/

function vape(ctx: Ctx): AdBanResult {
  const t = titleReading(ctx.titles, VAPE, null, VAPE_NEG)
  if (t.kind !== 'none') return res('ban', 'vape', t.matched)
  const d = findHits(VAPE, ctx.desc).find((h) => !negatedHit(ctx.desc, h, VAPE_NEG))
  return d ? res('review', 'vape', `description: ${d.text}`) : OK
}

// ---- Breast-milk substitutes for children under 24 months ----------------------------------------

const MILK = words([
  'sua bot', 'sua cong thuc', 'sua nuoc', 'sua pha san', 'sua non', 'formula', 'formula milk', 'milk powder', 'powdered milk',
  'powder milk', 'growing up milk', 'growing-up milk', 'follow on', 'follow-on', 'sua tang chieu cao', 'ready-to-drink milk',
])
/** Brands that make formula / growing-up milk for young children. */
const FORMULA_BRANDS = words([
  'aptamil', 'aptakid', 'enfamil', 'enfagrow', 'similac', 'friso', 'frisolac', 'morinaga', 'nan optipro', 'nan infinipro',
  'nan supreme', 'nestle nan', 'pediasure', 'abbott grow', 'dielac', 'optimum gold', 'colosbaby', 'kendamil', 'hipp',
  'bellamy', 'bellamys', 'a2 platinum', 'hikid', 'meiji', 'glico icreo', 'icreo', 'nutren junior', 'grow plus', 'metacare',
  'vinamilk optimum', 'yoko gold', 'nuti iq', 'alula',
])
// ⚠️ NOT "Nutricare": the house brand is mostly ADULT medical nutrition ("Lean Pro … cho bệnh nhân");
// its children's line is Metacare, listed above.
const MILK_OR_BRAND = any(MILK, FORMULA_BRANDS)
/** These names also sell chocolate, snacks and yoghurt — formula only next to a milk word. */
const NEEDS_MILK = /\b(?:meiji|glico icreo|icreo|morinaga)\b/
const ANY_MILK_WORD = /\b(?:sua|milk|formula)\b/
const INFANT_CTX = words(['em be', 'so sinh', 'tre em', 'tre nho', 'nhu nhi', 'baby', 'babies', 'infant', 'infants', 'toddler', 'toddlers', 'newborn', 'kid', 'kids', 'children', 'child', 'junior', 'thang tuoi', 'months old', 'growing up', 'cho be'])
const RAW_INFANT = /(^|[^\p{L}\p{N}])(bé|trẻ|nhũ nhi|sơ sinh)(?=$|[^\p{L}\p{N}])/u
const BABY_MERCHANT = /\b(?:kids?|baby|bebe|me va be|me be|con cung|bibo|tutti frutti)\b/
/** Formula for the MOTHER or for adults — not a breast-milk substitute. */
const NOT_INFANT_MILK = words(['mum', 'frisomum', 'mom', 'mama', 'me bau', 'ba bau', 'mang thai', 'pregnancy', 'pregnant', 'cho me', 'lactation', 'nguoi lon', 'nguoi gia', 'elderly', 'adult', 'adults', 'tieu duong', 'diabetic', 'diabetes'])
const FORMULA_ACC: Accessories = {
  vi: /\b(?:may|binh dun|binh ham|am dun|coc|hop dung|tui dung|thia|muong|dung cu|binh chia|hop chia)\b/,
  en: /\b(?:heater|warmer|maker|kettle|dispenser|container|containers|scoop|scoops|blender|mixer|machine|sterilizer|steriliser|pitcher|storage)\b/,
}

function infantFormula(ctx: Ctx): AdBanResult {
  // A NEEDS_MILK brand with no milk word anywhere (Meiji chocolate, Glico snacks) is not a hit.
  const titles = ctx.titles.map((t) => (NEEDS_MILK.test(t) && !ANY_MILK_WORD.test(t) ? t.replace(asGlobal(NEEDS_MILK), ' ') : t))
  const reading = titleReading(titles, MILK_OR_BRAND, FORMULA_ACC)
  if (reading.kind === 'none' || reading.kind === 'accessory') return OK
  const titleText = titles.join(' | ')
  const descAge = parseInfantAge(ctx.desc)
  const age = parseInfantAge(titleText) ?? (descAge?.kind === 'explicit' ? descAge : null)
  const stage = parseStage(titleText)
  const infant = FORMULA_BRANDS.test(titleText) || INFANT_CTX.test(titleText) || ctx.rawTitles.some((t) => RAW_INFANT.test(t))
    || BABY_MERCHANT.test(ctx.merchant) || age !== null || stage !== null
  if (!infant) return OK // Ensure, Anlene, Glucerna: milk powder for adults
  if (!age && NOT_INFANT_MILK.test(titleText)) return OK // Frisomum, "cho mẹ bầu"
  const m = reading.matched
  if (age?.kind === 'explicit') return age.loMonths < 24 ? res(capMixed(reading, 'ban'), 'infant_formula', `${m} · from ${age.loMonths} months`) : OK
  if (age?.kind === 'bare') {
    // "1-3" is under 24 months whether it means years or months; "2-6" is not settled without a unit.
    return age.loMonths < 24 ? res(capMixed(reading, 'ban'), 'infant_formula', `${m} · ${age.loMonths / 12}-…`) : res('review', 'infant_formula', `${m} · age without a unit`)
  }
  if (stage !== null) {
    if (stage <= 1) return res(capMixed(reading, 'ban'), 'infant_formula', `${m} · stage ${stage}`)
    if (stage <= 3) return res('review', 'infant_formula', `${m} · stage ${stage}`)
    return OK // stage 4+ is the 2-6 years tier at every major brand
  }
  return res('review', 'infant_formula', `${m} · no age`)
}

// ---- Feeding bottles -----------------------------------------------------------------------------

const BOTTLE = words(['binh sua', 'binh bu', 'binh ti', 'feeding bottle', 'feeding bottles', 'baby bottle', 'baby bottles', 'nursing bottle', 'nursing bottles'])
const BOTTLE_BRANDS = /\b(?:wesser|pigeon|avent|comotomo|hegen|dr\.? brown|moyuum|nuk|tommee tippee|chuchu|upass|kuku|mam baby|chicco|lansinoh|medela|munchkin|nanobebe)\b/
const BOTTLE_ACC: Accessories = {
  vi: /\b(?:nuoc rua|nuoc giat|co rua|ban chai|dung cu|ve sinh|may ham|may tiet trung|may say|may|tay cam|quai cam|nap|gia up|gia phoi|ke up|ke phoi|tui|hop dung|ong hut|day deo|kep|phu kien|khan|boc|vo boc|ham)\b/,
  en: /\b(?:cleanser|cleaner|cleaning|wash|soap|detergent|liquid|brush|brushes|warmer|heater|sterili[sz]er|dryer|drying|rack|handle|handles|holder|bag|bags|case|cover|straw|straws|clip|strap|tongs|insulated|cooler|tote|organizer)\b/,
}

// ⚠️ A BOTTLE BRAND DOES NOT MAKE A BARE "bottle" A BABY BOTTLE: Wesser also sells shower gel, and
// "Set of 2 Bottles Wesser 2in1 Shower Gel" read as two feeding bottles in the first dry run. Every
// live feeding bottle says "bình sữa" or "baby/feeding bottle".
function feedingBottle(ctx: Ctx): AdBanResult {
  const r = titleReading(ctx.titles, BOTTLE, BOTTLE_ACC)
  return r.kind === 'product' || r.kind === 'mixed' ? res(capMixed(r, 'ban'), 'feeding_bottle', r.matched) : OK
}

// ---- Teats and pacifiers -------------------------------------------------------------------------

const TEAT = words(['num ti', 'num ty', 'ti ngam', 'ty ngam', 'pacifier', 'pacifiers', 'soother', 'soothers', 'teat', 'teats'])
/** "ti giả" (pacifier) on the RAW text — the folded "ti gia" is also "tỉ giá" (exchange rate). */
const RAW_TI_GIA = rawWord('t[iy] giả')
/** Fold-only "ti giả" (no accents typed) — a teat only with a baby context. */
const TI_GIA_FOLDED = words(['ti gia', 'ty gia'])
/**
 * "núm vú" / "nipple" are also anatomy — a teat only with a FEEDING context (a bottle, a neck size).
 * ⚠️ Not a brand context: Medela makes breast pumps AND nipple cream ("Kem Purelan … đầu ty khô,
 * nứt" was a 'ban' in the first dry run).
 */
const NIPPLE_WORDS = words(['num vu', 'nipple', 'nipples'])
const BABY_FEEDING_CTX = /\b(?:binh|bottle|bottles|co hep|co rong|narrow neck|wide neck|slow flow|fast flow)\b/
const NIPPLE_CARE = /\b(?:kem|cream|balm|lanolin|purelan|breast|nut ne|cracked|dau ti|dau ty)\b/
const EXCHANGE_RATE = words(['ti gia ngoai te', 'ti gia usd', 'ti gia hom nay', 'ti gia ngan hang', 'exchange rate', 'ty gia'])
const TEAT_ACC: Accessories = {
  vi: /\b(?:hop dung|hop|tui dung|tui|day deo|kep|moc|nap|dung cu|tiet trung|mieng dan|dan)\b/,
  en: /\b(?:case|box|storage|clip|clips|holder|chain|strap|cover|leash|pasties|shield)\b/,
}

function teat(ctx: Ctx): AdBanResult {
  const titles = ctx.titles.map((t, i) => {
    const raw = ctx.rawTitles[i] ?? ''
    // The pacifier spelled with its accents is a teat whatever surrounds it.
    let out = RAW_TI_GIA.test(raw) ? t.replace(/\bt[iy] gia\b/g, 'ti ngam') : t
    const baby = BOTTLE_BRANDS.test(out) || INFANT_CTX.test(out) || BABY_FEEDING_CTX.test(out) || RAW_INFANT.test(raw)
    out = out.replace(asGlobal(TI_GIA_FOLDED), baby && !EXCHANGE_RATE.test(out) ? 'num ti' : ' ')
    const feeding = BABY_FEEDING_CTX.test(out) && !NIPPLE_CARE.test(out)
    return out.replace(asGlobal(NIPPLE_WORDS), feeding ? 'num ti' : ' ')
  })
  const r = titleReading(titles, TEAT, TEAT_ACC)
  return r.kind === 'product' || r.kind === 'mixed' ? res(capMixed(r, 'ban'), 'teat', r.matched) : OK
}

// ---- Prescription and veterinary drugs -------------------------------------------------------------

/** Veterinary prescription parasiticides — the brands named in the brief. */
const VET_RX = /\b(?:bravecto\d*|nexgard|simparica|credelio)\b/
/** Veterinary products that are not settled by name alone. */
const VET_OTHER = words(['milbemax', 'drontal', 'frontline plus', 'bayticol', 'fungikur', 'revolution plus', 'thuoc thu y'])
/**
 * Prescription medicines by name. ⚠️ NOT bare "kháng sinh": "kháng sinh tự nhiên" (natural
 * antibiotic) is how honey and garlic are sold. "thuốc kháng sinh" (antibiotic MEDICINE) is.
 */
const RX = words([
  'thuoc ke don', 'prescription drug', 'prescription drugs', 'prescription only', 'rx only', 'thuoc khang sinh',
  'amoxicillin', 'amoxicilin', 'augmentin', 'azithromycin', 'cefuroxime', 'cephalexin', 'cefixime', 'ciprofloxacin',
  'levofloxacin', 'doxycycline', 'metronidazole', 'clindamycin', 'clarithromycin', 'sildenafil', 'tadalafil', 'viagra', 'cialis',
  'isotretinoin', 'accutane', 'ozempic', 'semaglutide', 'wegovy', 'mounjaro', 'tirzepatide', 'saxenda', 'liraglutide',
  'misoprostol', 'mifepristone', 'clenbuterol', 'prednisolone', 'prednisone', 'dexamethasone', 'methylprednisolone', 'medrol',
  'finasteride', 'tramadol', 'codeine', 'diazepam', 'alprazolam', 'xanax',
])
const PET_CTX = /\b(?:cho|meo|dog|dogs|cat|cats|puppy|kitten|pet|pets|thu cung|thu y|vet|veterinary)\b/

function drugs(ctx: Ctx): AdBanResult {
  const titleText = ctx.titles.join(' | ')
  const vet = findHits(VET_RX, titleText)[0]
  if (vet) return res('ban', 'vet_drug', vet.text)
  const rx = findHits(RX, titleText)[0]
  if (rx) return res('ban', ctx.category === 'pets' || PET_CTX.test(titleText) ? 'vet_drug' : 'rx_drug', rx.text)
  const vetOther = findHits(VET_OTHER, titleText)[0]
  if (vetOther) return res('review', 'vet_drug', vetOther.text)
  const dVet = findHits(VET_RX, ctx.desc)[0]
  if (dVet) return res('review', 'vet_drug', `description: ${dVet.text}`)
  const dRx = findHits(RX, ctx.desc)[0]
  return dRx ? res('review', 'rx_drug', `description: ${dRx.text}`) : OK
}

// ── The classifier ──────────────────────────────────────────────────────────────────────────────

const DETECTORS = [vape, tobacco, spirits, infantFormula, feedingBottle, teat, drugs]

/**
 * Classify one listing. The most severe answer across the rules wins; on a tie, the first rule in
 * DETECTORS order. See the header for what each verdict means and who acts on it.
 */
export function classifyAdBanned(input: AdBanInput): AdBanResult {
  const rawTitleList = [input.title, input.titleVi].filter((s): s is string => !!s && !!s.trim())
  if (!rawTitleList.length && !input.description && !input.descriptionVi) return OK
  const titles = rawTitleList.map(prepAdText)
  const rawTitles = rawTitleList.map(rawLower)
  const category = (input.category || '').toLowerCase()
  if (wholeListingExclusion(titles, rawTitles, category, (input.subcategory || '').toLowerCase())) return OK
  const ctx: Ctx = {
    titles,
    rawTitles,
    desc: [input.description, input.descriptionVi].map(prepAdText).filter(Boolean).join(' | '),
    category,
    merchant: prepAdText(input.merchant),
  }
  let best: AdBanResult = OK
  for (const detect of DETECTORS) {
    const r = detect(ctx)
    if (RANK[r.verdict] > RANK[best.verdict]) best = r
    if (best.verdict === 'ban') break
  }
  return best
}
