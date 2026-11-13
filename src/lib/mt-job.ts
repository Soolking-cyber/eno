import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { detectContentLang, mayBeVietnamese, readsAsVietnamese, vietnameseWordShare } from '@/lib/detect-lang'
import { LANGS, type Lang } from '@/lib/i18n/langs'
import { publicListingWhere } from '@/lib/storefront-gone'
import { spelledPlace } from '@/lib/translate'

/**
 * ⛔ THE DAILY LISTING TRANSLATION, DONE BY CLAUDE HAIKU IN eno REACH (owner, 2026-11-14: "remove gemma go back to haiku daily
 * translation … 20 agents take on all languages daily cron on reach app so app translation show if it ran every day and success
 * rate", "so reach app can trigger translation and monitor"). Reach runs the model on the owner's Claude subscription; it cannot
 * reach this database (its firewall blocks every local address), so it asks GET /api/mt/todo for the work and sends the result to
 * POST /api/mt/rows. This module is both ends' rules, and the routes are thin.
 *
 * ⛔ REACH IS NOT TRUSTED WITH WHAT IT WRITES. It also runs agents that read strangers' web pages, and a listing's own text can
 * carry instructions to the model. So every row is checked HERE again, whatever Reach checked: the hash must be a live listing's
 * text, the language one this text still needs, the length in bounds, a non-Latin language in its own script. A row that fails
 * is refused and the old text stays.
 *
 * WHAT IS TRANSLATED: the title and description of every active, verified listing (not its location: place names are spelled, never
 * translated — spelledPlace), into every language the site shows, except where the site already shows the text as it is:
 *  - no Vietnamese row for a text a Vietnamese reader is shown as it is (readsAsVietnamese), or whose listings all carry the
 *    reviewed Vietnamese column (titleVi / descriptionVi, the importers' own translation);
 *  - no English row for a text an English reader is shown as it is (nothing Vietnamese in it, no other script);
 *  - no row in a language whose script the text is mostly written in already.
 * A text is DONE for a language when its row was written on purpose: by this job (id 'haiku1_…'), the 2026-11-13 Haiku redo
 * ('mtfix1113_…') or a person's fix (doneKeys). A machine's row — the box model's, Azure's, Gemini's, the removed Gemma job's — is redone once.
 */

export const HAIKU_ROW_PREFIX = 'haiku1_'
/** Rows per POST: a batch of whole texts (every language of a text in one request), so a page is refreshed once per text. */
export const MAX_ROWS_PER_POST = 200
/** A batch of whole texts: Reach keeps each under 400 KB (long descriptions × 10 languages × 3 bytes a character). */
export const MT_POST_BODY_CAP = 1024 * 1024

export type MtSource = { hash: string; text: string; targets: Lang[]; listings: number }

const SCRIPT: Partial<Record<Lang, RegExp>> = {
  'zh-Hans': /\p{Script=Han}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  th: /\p{Script=Thai}/u,
  km: /\p{Script=Khmer}/u,
  hi: /\p{Script=Devanagari}/u,
}
const DETECTED: Record<string, Lang> = { ko: 'ko', ja: 'ja', zh: 'zh-Hans', ru: 'ru', th: 'th' }

const letters = (s: string) => Array.from(s).filter((c) => /\p{L}/u.test(c))
/** The share of a text's letters written in a language's own script (0 when it has no letters). */
export function scriptShare(text: string, lang: Lang): number {
  const re = SCRIPT[lang]
  if (!re) return 0
  const ls = letters(text)
  return ls.length ? ls.filter((c) => re.test(c)).length / ls.length : 0
}

export const mtHash = (text: string) => createHash('sha1').update(text).digest('hex')
export const mtRowId = (hash: string, target: string) =>
  HAIKU_ROW_PREFIX + createHash('sha1').update(`${hash}|${target}`).digest('hex').slice(0, 25)

/** The languages a text needs rows in (see the header). `allHaveViTwin`: every listing showing it has its reviewed Vietnamese column. */
export function targetsFor(text: string, allHaveViTwin: boolean): Lang[] {
  const own = DETECTED[detectContentLang(text) ?? '']
  return LANGS.filter((l) => {
    if (l === 'vi') return !allHaveViTwin && !readsAsVietnamese(text)
    if (l === 'en') return mayBeVietnamese(text) || detectContentLang(text) != null
    if (own === l && scriptShare(text, l) >= 0.5) return false
    return true
  })
}

/** Is this a text the job translates at all: letters, not only place names. */
function translatable(text: string | null | undefined): text is string {
  if (!text || !text.trim() || !/\p{L}/u.test(text)) return false
  return spelledPlace(text, 'en') == null && spelledPlace(text, 'vi') == null
}

type SourceMap = Map<string, { text: string; listingIds: string[]; twinAll: boolean }>

/** Every active listing's title and description, by hash. */
async function liveSources(): Promise<SourceMap> {
  const rows = await db.listing.findMany({
    // What a visitor can open (publicListingWhere), sold ones aside: no text of a held or unverified listing leaves.
    where: { ...publicListingWhere(), status: 'active' },
    select: { id: true, title: true, description: true, titleVi: true, descriptionVi: true },
    orderBy: { createdAt: 'desc' },
  })
  const map: SourceMap = new Map()
  for (const r of rows) {
    for (const [text, twin] of [[r.title, r.titleVi], [r.description, r.descriptionVi]] as const) {
      if (!translatable(text)) continue
      const h = mtHash(text)
      const s = map.get(h) ?? { text, listingIds: [], twinAll: true }
      s.listingIds.push(r.id)
      s.twinAll &&= !!twin?.trim()
      map.set(h, s)
    }
  }
  return map
}

// One read of 5,800 listings serves the day's run: Reach asks once for the work and then posts ~150 batches against it.
const CACHE_MS = 10 * 60_000
let cached: { at: number; map: SourceMap } | null = null
async function sources(now = Date.now()): Promise<SourceMap> {
  if (cached && now - cached.at < CACHE_MS) return cached.map
  const map = await liveSources()
  cached = { at: now, map }
  return map
}
export function resetMtJobCacheForTests() { cached = null }

/**
 * The (hash, target) pairs not to redo: every row that is not a machine's. The live chain (translate.ts) and the box model create rows with
 * Prisma's default id (a cuid: "c" and 24 more), the removed Gemma job with 'gemma1_'; any other id was written on purpose — by this job
 * ('haiku1_'), the 2026-11-13 Haiku redo ('mtfix1113_') or a person's fix — and is kept. One read of the table, once a day.
 */
async function doneKeys(): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ hash: string; target: string }[]>`
    select hash, target from "Translation" where id !~ '^c[a-z0-9]{24}$' and id not like 'gemma1\_%'`
  return new Set(rows.map((r) => `${r.hash}|${r.target}`))
}

/** The work: every live text with the languages it still needs, newest listings first. */
export async function mtTodo(): Promise<{ sources: MtSource[]; pairs: number; live: number }> {
  const map = await sources()
  const done = await doneKeys()
  const out: MtSource[] = []
  let pairs = 0
  for (const [hash, s] of map) {
    const targets = targetsFor(s.text, s.twinAll).filter((t) => !done.has(`${hash}|${t}`))
    if (!targets.length) continue
    out.push({ hash, text: s.text, targets, listings: s.listingIds.length })
    pairs += targets.length
  }
  return { sources: out, pairs, live: map.size }
}

/**
 * ⛔ A TRANSLATION SAYS ONLY WHAT ITS SOURCE SAYS (ported from the Gemma job, 2026-11-13). A listing can ask the model, in its own text, to
 * add things, and a compromised writer can add them itself. eno.vn's moderation reads the source, not the translation, so a row is refused
 * when it has what its source does not:
 *  - an amount or a phone number its source does not have (newNumbers): another price, or another phone number, which sends buyers to a
 *    stranger; a currency other than the dong that its source does not name;
 *  - a link, an email, a messenger handle (zalo.me/…, t.me/…, "zalo 0901…", "@name");
 *  - visa, itinerary or PayPal wording its source has none of, in any of the site's languages: eno.vn may not offer them (CLAUDE.md, the
 *    licensing boundary). By kind: a source with visa wording (an e-Visa listing) may be translated with it; "Visa" the card is not visa
 *    wording on either side.
 */
const PHONE = /\d[\d .,\-()/\u00a0]{6,}\d/g
const CONTACT = new RegExp(
  String.raw`https?://[^\s)]+|www\.[^\s)]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?:zalo\.me|t\.me|wa\.me)/[^\s)]+|(?<![\w@])@[A-Za-z0-9_.]{3,}` +
  String.raw`|(?<!\p{L})(?:zalo|wechat|telegram|kakao|whatsapp|카카오톡?|잘로|라인|微信号?|电报|ザロ|ライン|телеграм|ватсап|вацап|вотсап|зало)\W{0,3}[A-Za-z0-9_.+-]{3,}` +
  // "line" is also an English word ("online", "line format"): only "Line: …" or "Line ID …" is the messenger.
  String.raw`|(?<!\p{L})line\s*(?:id\s*[:：]?|[:：])\s*[A-Za-z0-9_.+-]{3,}` +
  String.raw`|(?<!\p{L})(?:viber|signal|instagram|insta|ig|facebook|fb)\s*[:：]\s*[A-Za-z0-9_.+-]{3,}|(?:fb|facebook|instagram|m\.me)\.(?:com|me)/[^\s)]+` +
  // A bare domain ("deals-hcm.vn"): letters or digits, a dot, one of the endings people type.
  // A named list of endings, not any: "TP.HCM" is a city, not a site.
  String.raw`|(?<![\w.@/-])[a-z0-9][a-z0-9-]{1,62}\.(?:vn|com|net|org|io|me|co|info|biz|xyz|shop|store|online|site|asia|top|link|ru|cn|kr|jp|tk|ly|app|dev|` +
  String.raw`us|uk|in|th|my|kh|sg|ph|id|cc|ws|to|gg|live|club|pro|life|world|today|tv|fm|ai|page|website|space|fun|vip|cloud)(?![\w.-])`, 'giu')
const VISA_FAMILIES: [string, RegExp][] = [
  ['visa', /(?<![\p{L}\p{N}])e?-?visas?(?![\p{L}\p{N}])|(?<!\p{L})виз(?:а|ы|у|е|ой|ами|ах|ов\p{L}*)?(?!\p{L})|thị thực|비자|사증|签证|簽證|ビザ|査証|วีซ่า|वीज़ा|वीजा|ទិដ្ឋាការ|वीसा/iu],
  // Travel-itinerary words only: "route", "journey" and "schedule" are everyday words (a bus route, a class schedule).
  ['itinerary', /itin[ée]rai?r\p{L}*|lịch trình|hành trình|여행\s*일정|行程安排|行程表|行程单|旅程表|旅行日程|jadual\s+perjalanan|programme\s+de\s+voyage|กำหนดการเดินทาง|туристическ\p{L}*\s+маршрут\p{L}*|маршрут\p{L}*\s+поездки|แผนการเดินทาง|यात्रा\s*कार्यक्रम|कार्यक्रम\s*यात्रा/iu],
  ['paypal', /paypal|pay\s*pal|페이\s*팔|ペイパル|贝宝|貝寶|пейпал|เพย์พาล|पेपैल/iu],
]
/** Currencies other than the dong, in the site's languages ("1억 5천만원" is won, not dong). */
const FOREIGN_CURRENCIES: [string, RegExp][] = [
  // 원 only after a number: it is also inside words (지원 support, 회원 member, 원룸 studio).
  ['won', /(?<=[\d만억천]\s?)원|원화|(?<!\p{L})(?:won|krw)(?!\p{L})|₩|ウォン|韩元|韓元/iu],
  ['yen', /円|(?<!\p{L})(?:yen|jpy)(?!\p{L})|엔화|日元|иен/iu],
  ['yuan', /人民币|人民幣|(?<!\p{L})(?:yuan|rmb|cny)(?!\p{L})|위안|юан/iu],
  ['dollar', /\$|(?<!\p{L})(?:usd|dollars?)(?!\p{L})|달러|ドル|美元|доллар|ดอลลาร์|डॉलर/iu],
  ['baht', /฿|(?<!\p{L})(?:baht|thb)(?!\p{L})|บาท|바트|バーツ|泰铢/iu],
  ['euro', /€|(?<!\p{L})(?:euros?|eur)(?!\p{L})|유로|ユーロ|欧元|евро/iu],
]
/** "Journey" in a source ("your learning journey") lets its Vietnamese say "hành trình" — that word only, no other itinerary wording. */
const JOURNEY = /journey|voyage/iu
const HANH_TRINH = /hành trình/giu
/** "Visa" the card brand, in the site's languages: not visa wording on either side ("Visa cards accepted" → "비자 카드 가능"). */
const CARD = /(?:visa|비자|ビザ|维萨|виза)[\s/-]*(?:cards?|debit|credit|master\p{L}*|카드|カード|卡|карт\p{L}*|kad|บัตร|कार्ड)|(?:thẻ|carte|kad|карт\p{L}*|บัตร|card|master\p{L}*)[\s/-]*(?:visa|виза)/giu
/** A number as written, by its digits: "0901 234 567" → "0901234567" (the leading zero kept: it is part of a phone number). */
const digitsOf = (m: string) => m.replace(/\D/g, '')

/**
 * ⛔ AMOUNTS ARE COMPARED BY VALUE, WITH THEIR UNIT WORDS. Languages write the same price differently: "8.000.000", "8 triệu", "8 million",
 * "800만" (Korean counts in ten-thousands), "8,000,000"; "1 tỷ 500 triệu" is "15억" and "1억 5천만". So each amount is read as a value — the
 * number times its unit word, a run of unit-worded numbers summed — and a translation's amount must be one of its source's. "800.000đ" for
 * "8 triệu" (a tenth), "8,000,000,000" for it (a thousand times) and "999만" are refused. Amounts under 100 are left alone ("7군", "2개").
 */
const UNIT_WORDS: [string, number][] = [ // whole words: "30 km" is not 30 thousand metres
  ['nghìn', 1e3], ['ngàn', 1e3], ['thousand', 1e3], ['mille', 1e3], ['ribu', 1e3], ['k', 1e3], ['тысяч', 1e3], ['тысячи', 1e3], ['тыс', 1e3],
  ['triệu', 1e6], ['tr', 1e6], ['millions', 1e6], ['million', 1e6], ['mil', 1e6], ['juta', 1e6], ['миллионов', 1e6], ['миллиона', 1e6],
  ['миллион', 1e6], ['млн', 1e6], ['lakh', 1e5], ['crore', 1e7],
  ['tỷ', 1e9], ['tỉ', 1e9], ['billions', 1e9], ['billion', 1e9], ['bn', 1e9], ['milliards', 1e9], ['milliard', 1e9], ['bilion', 1e9],
  ['миллиардов', 1e9], ['миллиарда', 1e9], ['миллиард', 1e9], ['млрд', 1e9],
]
const UNIT_SIGNS: [string, number][] = [ // no word boundary: "800만원", "1億5千万円"
  ['천만', 1e7], ['백만', 1e6], ['만', 1e4], ['억', 1e8], ['천', 1e3], ['千万', 1e7], ['百万', 1e6], ['万', 1e4], ['萬', 1e4], ['億', 1e8], ['亿', 1e8],
  ['千', 1e3], ['พันล้าน', 1e9], ['ล้าน', 1e6], ['แสน', 1e5], ['หมื่น', 1e4], ['พัน', 1e3], ['हज़ार', 1e3], ['हजार', 1e3], ['लाख', 1e5],
  ['करोड़', 1e7], ['करोड', 1e7], ['ពាន់', 1e3], ['លាន', 1e6],
]
const UNIT_WORD = new RegExp(`^\\s?(${UNIT_WORDS.map(([w]) => w).join('|')})(?![\\p{L}\\p{M}])`, 'iu')
function unitAt(tail: string): { mult: number; len: number } | null {
  const sp = /^\s?/.exec(tail)![0].length
  for (const [w, mult] of UNIT_SIGNS) if (tail.startsWith(w, sp)) return { mult, len: sp + w.length }
  const m = UNIT_WORD.exec(tail)
  return m ? { mult: UNIT_WORDS.find(([w]) => w === m[1].toLowerCase())?.[1] ?? 1, len: m[0].length } : null
}
const AMOUNT = /\d{1,3}(?:[.,\u00a0 ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g
/** "8.000.000" and "8,000,000" → 8000000 (groups of three are thousands); "1.5" → 1.5; "7.0" → 7. */
function valueOf(n: string): number {
  if (/^\d{1,3}(?:[.,\u00a0 ]\d{3})+$/.test(n)) return Number(digitsOf(n))
  const g = /^(\d{1,3}(?:[.,\u00a0 ]\d{3})+)[.,](\d+)$/.exec(n)
  if (g) return Number(`${digitsOf(g[1])}.${g[2]}`)
  return Number(n.replace(',', '.'))
}
type Amount = { value: number; digits: string; parts: number[] }
/** The amounts of a text, in order: each number times its unit word, and a run of unit-worded numbers ("1억 5천만") summed into one. */
function amountsOf(text: string): Amount[] {
  const out: Amount[] = []
  let prevEnd = -1, prevUnit = false
  const re = new RegExp(AMOUNT.source, 'g')
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const unit = unitAt(text.slice(m.index + m[0].length))
    const v = valueOf(m[0]) * (unit?.mult ?? 1)
    if (unit && prevUnit && out.length && /^\s*$/.test(text.slice(prevEnd, m.index))) {
      const last = out[out.length - 1]
      last.value += v; last.parts.push(v); last.digits += digitsOf(m[0])
    } else out.push({ value: v, digits: digitsOf(m[0]), parts: [v] })
    prevEnd = m.index + m[0].length + (unit?.len ?? 0); prevUnit = !!unit
    re.lastIndex = prevEnd
  }
  return out
}
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1)

/**
 * The translation's numbers its source does not have. A phone-shaped run its source has passes whole ("0901.234.567" for "0901 234 567");
 * eight digits or more that are not the source's numbers are a phone number however they are grouped ("09 01 23 45 67"); a leading zero (a
 * phone number, a code) must be the same digits; any other amount of 100 or more must be one of the source's by value.
 */
function newNumbers(src: string, out: string): string[] {
  const srcAmounts = amountsOf(src)
  const values = srcAmounts.flatMap((a) => [a.value, ...a.parts])
  const digitRuns = new Set([...(src.match(PHONE) ?? []).map(digitsOf), ...srcAmounts.map((a) => a.digits)])
  const knownAmount = (a: Amount) => (/^0/.test(a.digits) ? digitRuns.has(a.digits) : values.some((v) => near(v, a.value)))
  const bad: string[] = []
  const rest = out.replace(PHONE, (run) => {
    const d = digitsOf(run)
    if (digitRuns.has(d)) return ' '
    const parts = amountsOf(run)
    if (d.length >= 8 && !parts.every(knownAmount)) { bad.push(d); return ' ' }
    return run
  })
  for (const a of amountsOf(rest)) {
    if (/^0/.test(a.digits) ? a.digits.length >= 3 && !digitRuns.has(a.digits) : a.value >= 100 && !knownAmount(a)) bad.push(a.digits)
  }
  return bad
}
/** Null when the translation says nothing its source does not; else what it adds. */
/** Khmer, Thai, Devanagari and Arabic-Indic digits as ASCII, so a number in another script is read like any other. */
const asciiDigits = (t: string) => t.replace(/[០-៩๐-๙०-९٠-٩۰-۹]/g, (c) => {
  const cp = c.codePointAt(0)!
  for (const zero of [0x17e0, 0x0e50, 0x0966, 0x0660, 0x06f0]) if (cp >= zero && cp <= zero + 9) return String(cp - zero)
  return c
})
export function addsToItsSource(src: string, out: string): string | null {
  const s = asciiDigits(src.normalize('NFKC')), o = asciiDigits(out.normalize('NFKC'))
  if (newNumbers(s, o).length) return 'a number its source does not have'
  const lower = s.toLowerCase()
  if ((o.match(CONTACT) ?? []).some((c) => !lower.includes(c.toLowerCase().replace(/[.,;:!?]+$/, '')))) return 'a contact its source does not have'
  // By kind: a source that sells e-visas (eno.vn's e-Visa aisle, the owner's exception) may say "visa" in any number of ways; a source with
  // none of a kind gets none of it.
  // A price stays in its currency: dong is eno.vn's own and may always be named; another currency only if the source names it.
  for (const [, re] of FOREIGN_CURRENCIES) if (re.test(o) && !re.test(s)) return 'a currency its source does not have'
  // A source with none of a kind gets none of it. The card brand is neither side's visa wording (CARD).
  const so = o.replace(CARD, ' '), ss = s.replace(CARD, ' ')
  for (const [kind, re] of VISA_FAMILIES) {
    const said = kind === 'itinerary' && JOURNEY.test(ss) ? so.replace(HANH_TRINH, ' ') : so
    if (!re.test(said) || re.test(ss)) continue
    return 'visa, itinerary or PayPal wording its source does not have'
  }
  return null
}

// Words listings use: a title made of them is not a name, however it is capitalised ("Studio Apartment District 7").
const LISTING_WORDS = new Set(('apartment studio room rooms house villa flat condo office shop land rent rental sale for new used teacher tutor english job jobs ' +
  'school class course district ward city street bedroom bedrooms bike motorbike car phone laptop cleaning service services coffee robusta green full ' +
  'time part kids cream home the and with in of near view cheap luxury modern cozy spacious private penthouse riverside garden pool balcony furnished ' +
  // …and the Vietnamese ones: "CHO THUÊ NHÀ QUẬN 7" is a listing, not a name
  'cho thuê bán nhà phòng căn hộ quận phường giá tháng tuyển dụng gấp mới cần xe máy đất mặt tiền chung cư trọ').split(' '))
/**
 * A text that reads the same in every Latin-script language: a name or a code ("Nguyễn Văn An", "iPhone 15 Pro", a teacher's "lina mejri").
 * At most 60 characters and three words (six when each is capitalised), none a listing word. Anything else returned unchanged is an untranslated echo, and writing it would
 * mark it done for good (ported from the Gemma job; measured on the 491 rows of 2026-11-13, where 33 were teachers' names, many lower case).
 */
function nameLike(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean)
  const named = words.filter((w) => /^\p{L}/u.test(w))
  // Longer names are written capitalised ("Jose Paolo Rumbawa Aguilon", "TEFL TESOL CELTA IELTS"): up to six words then.
  const max = named.every((w) => /^\p{Lu}/u.test(w)) ? 6 : 3
  // Vietnamese in capitals is a listing shouted, not a name: names are written "Nguyễn Phạm Oanh", never "NGUYỄN PHẠM OANH" on eno.vn.
  const shouted = readsAsVietnamese(text) && text === text.toUpperCase()
  // …and Vietnamese with a lower-case word is a phrase ("Gia sư Toán", "Dạy tiếng Hàn"), not a name.
  const phrase = mayBeVietnamese(text) && !named.every((w) => /^\p{Lu}/u.test(w))
  return text.length <= 60 && named.length <= max && !shouted && !phrase && !words.some((w) => LISTING_WORDS.has(w.toLowerCase().replace(/[.,:;!?()]/g, '')))
}

/** Why a translation is refused, or null. Checked here whatever Reach checked (the header). */
export function refusal(src: string, value: unknown, target: Lang): string | null {
  if (typeof value !== 'string') return 'not text'
  const v = value.trim()
  if (!v) return 'empty'
  if (v.length > src.length * 3 + 200) return 'too long'
  if (src.length > 80 && v.length < src.length * 0.15) return 'too short'
  if (/<unk>|```/.test(v)) return 'model artefact'
  // A NUL would fail the whole batch's insert (Postgres text cannot hold one); an invisible character can hide a word from the checks
  // below ("Pay\u200bPal").
  if (v.includes('\u0000')) return 'control characters'
  if (/[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/.test(v) && !/[\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/.test(src)) return 'invisible characters'
  const adds = addsToItsSource(src, v)
  if (adds) return adds
  // A name reads the same in every language, scripts included (the prompt keeps names as written): written as it is, done.
  if (v === src.trim() && nameLike(v)) return null
  const re = SCRIPT[target]
  if (re) {
    const ls = letters(v)
    // Brand and building names stay in Latin letters ("Vinhomes Central Park"), so a short title can be mostly Latin: a fifth
    // of the letters in the language's own script, and at least one.
    if (!ls.some((c) => re.test(c)) || (ls.length >= 12 && scriptShare(v, target) < 0.2)) return 'not in the target script'
  } else if (v === src.trim()) {
    return 'returned untranslated'
  }
  if (target === 'en' && readsAsVietnamese(v)) return 'still Vietnamese'
  // Vietnamese marks most words; a long answer with almost none is English (or the source) sent back. Brand names may fill the rest
  // ("Giáo viên Toán — Nord Anglia Education").
  if (target === 'vi' && letters(v).length > 30 && vietnameseWordShare(v) < 0.1) return 'not Vietnamese'
  return null
}

export type MtRowIn = { hash?: unknown; target?: unknown; value?: unknown }
export type MtWriteResult = { written: number; rejected: { hash: string; target: string; why: string }[]; listingIds: string[] }

/**
 * Write the rows that pass. One statement: every row of the batch lands or none does. A row for a text no longer live, or a
 * language it does not need, is refused. A repeat of a (hash, target) in the batch keeps the last.
 */
export async function mtWrite(input: MtRowIn[]): Promise<MtWriteResult> {
  let map = await sources()
  // A text the snapshot does not know may be a listing posted or edited since: read the listings again, at most once a minute.
  const known = (h: unknown) => typeof h === 'string' && map.has(h)
  if (input.some((r) => r && typeof r === 'object' && !known((r as MtRowIn).hash)) && cached && Date.now() - cached.at > 60_000) {
    cached = null
    map = await sources()
  }
  const rejected: MtWriteResult['rejected'] = []
  const keep = new Map<string, { hash: string; target: Lang; value: string }>()
  for (const raw of input) {
    const r: MtRowIn = raw && typeof raw === 'object' ? raw : {}
    const hash = typeof r.hash === 'string' ? r.hash : ''
    const target = typeof r.target === 'string' ? r.target : ''
    const s = /^[0-9a-f]{40}$/.test(hash) ? map.get(hash) : undefined
    if (!s) { rejected.push({ hash: hash.slice(0, 40), target: target.slice(0, 8), why: 'not a live listing text' }); continue }
    // A language the text needs (done or not: writing a done row again is the job redoing it, which only it can ask for).
    if (!(LANGS as string[]).includes(target) || !targetsFor(s.text, s.twinAll).includes(target as Lang)) {
      rejected.push({ hash, target: target.slice(0, 8), why: 'not a language this text needs' }); continue
    }
    const why = refusal(s.text, r.value, target as Lang)
    if (why) { rejected.push({ hash, target, why }); continue }
    keep.set(`${hash}|${target}`, { hash, target: target as Lang, value: (r.value as string).trim() })
  }
  // A row written on purpose by anyone but this job (a person's fix, the 2026-11-13 redo) is kept, whatever is sent for it.
  if (keep.size) {
    const hashes = [...new Set([...keep.values()].map((r) => r.hash))]
    const existing = await db.translation.findMany({ where: { hash: { in: hashes } }, select: { id: true, hash: true, target: true } })
    for (const e of existing) {
      const k = `${e.hash}|${e.target}`
      if (keep.has(k) && !/^c[a-z0-9]{24}$/.test(e.id) && !e.id.startsWith('gemma1_') && !e.id.startsWith(HAIKU_ROW_PREFIX)) {
        keep.delete(k)
        rejected.push({ hash: e.hash, target: e.target, why: 'a hand-written translation is kept' })
      }
    }
  }
  const rows = [...keep.values()]
  const listingIds = [...new Set(rows.flatMap((r) => map.get(r.hash)?.listingIds ?? []))]
  if (rows.length) {
    // The rows and their pages' refresh in one transaction, as the Gemma job did: a row marked done always has its pages told. A page's
    // tombstone (cache-handler.cjs: `eno:isrtag:` + the page's implicit tag, both language variants) makes its next view render it again
    // with the new text, in every process that reads the shared cache.
    const tags = listingIds.flatMap((id) => ['en', 'vi'].map((l) => `eno:isrtag:_N_T_/${l}/listings/${id}`))
    await db.$transaction([
      // ⚠️ THE ID CHANGES ON CONFLICT ON PURPOSE: it is what marks the row as done by this job.
      db.$executeRaw`
        insert into "Translation" (id, hash, target, value, "createdAt")
        select u.id, u.hash, u.target, u.value, now()
        from unnest(${rows.map((r) => mtRowId(r.hash, r.target))}::text[], ${rows.map((r) => r.hash)}::text[],
                    ${rows.map((r) => r.target)}::text[], ${rows.map((r) => r.value)}::text[]) as u(id, hash, target, value)
        on conflict (hash, target) do update set value = excluded.value, id = excluded.id, "createdAt" = excluded."createdAt"`,
      db.$executeRaw`
        insert into next_cache_tag (tag, stamp, expires_at)
        select t, ${Date.now()}::bigint, now() + interval '35 days' from unnest(${tags}::text[]) as t
        on conflict (tag) do update set stamp = greatest(next_cache_tag.stamp, excluded.stamp),
          expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at)`,
    ])
  }
  return { written: rows.length, rejected, listingIds }
}

/** The job's own token. Off (null) until MT_JOB_TOKEN is set, at least 32 characters. */
export function mtJobToken(env: Record<string, string | undefined> = process.env): string | null {
  const t = env.MT_JOB_TOKEN
  return t && t.length >= 32 ? t : null
}
const digest = (s: string) => createHash('sha256').update(s).digest()
/** Fixed-size digests, so the comparison takes the same time whatever was sent. */
export function mtJobAuthorized(header: string | null, token: string): boolean {
  const got = (header ?? '').replace(/^Bearer\s+/i, '')
  return !!got && timingSafeEqual(digest(got), digest(token))
}
