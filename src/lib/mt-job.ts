import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { detectContentLang, mayBeVietnamese, readsAsVietnamese, VI_DIACRITIC, vietnameseWordShare } from '@/lib/detect-lang'
import { LANGS, type Lang } from '@/lib/i18n/langs'
import { scopedListingWhere } from '@/lib/edition-scope'
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
    // What a visitor of THIS edition can open (publicListingWhere, scoped: eno.vn never sends its hidden visa desk's text), sold ones
    // aside: no text of a held or unverified listing leaves. Teacher profiles included: their pages show in every language too.
    where: await scopedListingWhere({ ...publicListingWhere(), status: 'active' }, { teachers: true }),
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
/**
 * Currencies other than the dong, in the site's languages ("1억 5천만원" is won, not dong). ⛔ FAIL CLOSED: a currency word is refused
 * wherever it appears, except inside the ordinary words measured to hold it. The first daily run (2026-11-14) refused 539 good
 * translations, and every one re-translated (409) was one of these: "ドル" in ベッドルーム (bedroom) and ヌードル (noodle), "원" in
 * "20m² 원룸" (studio; NFKC turns ² into 2) and "иен" in names (Бай Хиен, Тиен, Биен) and ориентир. A word missing from an exception
 * list costs a refusal, retried the next day; a currency missing from a rule would write a wrong price for good (codex + Opus, 11-14).
 * So an exception is a word seen in the data, or the letters before a currency word that no number or currency name can end in
 * (ミドル, ハンドル); exceptions after a currency word or guessed inside one (円滑, บทบาท, 자유로운, ドルチェ) opened holes a reviewer found
 * ("100アメリカドルチェーン", "1万円満額", "100여유로"), so they are gone, and those words are refused (retried the next day).
 * The digits are ASCII here (asciiDigits).
 */
/** After a number in Thai, which is written without spaces: digits, a number word or เงิน (money). Not anywhere: งูเยน is Nguyen, ขวงวอน a ward. */
const TH_AMOUNT = String.raw`(?<=\d\s*|เงิน|ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ร้อย|พัน|หมื่น|แสน|ล้าน)`
/** After a number in Korean: digits or 십 백 천 만 억, any spaces, and 여 ("100여원", about 100 won). */
const KO_AMOUNT = String.raw`(?<=[\d십백천만억]\s*(?:여\s*)?)`
const FOREIGN_CURRENCIES: [string, RegExp][] = [
  // 원 only after a number: it is also inside words (지원 support, 회원 member); after an area it starts 원룸 (studio).
  // Not after 일, 이, 사, 구, 조…: 일원 (member), 보조원 (assistant), 사원 (employee), 조원.
  ['won', new RegExp(String.raw`${KO_AMOUNT}(?<!m2\s*)원|원화|(?<!\p{L})(?:wons?|krw)(?!\p{L})|₩|ウォン|韩元|韓元|${TH_AMOUNT}วอน`, 'iu')],
  // иен inside a name (Бай Хиен, Биен) or ориентир. Only after a number: 엔, and never in 엔진 ("2.0 엔진" engine) or 백엔드 (backend); йен and येन, which are also the place
  // name Yên (Йен Хоа, येन होआ) and inside नगुयेन (Nguyen); ⚠️ so "сто йен", "सौ येन" (spelled numbers) pass, as before this rule.
  ['yen', new RegExp(String.raw`円|(?<!\p{L})(?:yens?|jpy)(?!\p{L})|엔화|${KO_AMOUNT}엔(?!진|드)|日元|(?<=\d\s*)йен|(?<!\p{L})иен|${TH_AMOUNT}เยน|(?<=\d\s*)येन`, 'iu')],
  // 元, 块, 币 after a number only (单元 flat, 一块 a piece of…), "100多元" included; 越南盾 is the dong.
  ['yuan', new RegExp(String.raw`(?<=[\d〇一二三四五六七八九十百千万亿億]\s*[多余]?)(?:元|块钱|币)|(?<=\d\s*[多余]?)块|港元|港币|台币|新币|人民币|人民幣|(?<!\p{L})(?:yuans?|rmb|cny)(?!\p{L})|위안|юан|${TH_AMOUNT}หยวน|(?<![\p{L}\p{M}])युआन(?![\p{L}\p{M}])`, 'iu')],
  // ドル inside ベッドルーム (bedroom) and ヌードル (noodle), measured, and after the katakana that end ミドル (middle school), ハンドル,
  // アイドル, キャンドル, ハードル, サドル, プードル, バンドル: no currency name ends in them, and nothing can sit between them and ドル.
  // 불 is the Korean dollar after a number ("100불"); долл. and у.е. are Russian price shorthand.
  ['dollar', new RegExp(String.raw`\$|(?<!\p{L})(?:usd|dollars?|dolar)(?!\p{L})|달러|${KO_AMOUNT}불|(?<!ベッ|ヌー|ミ|ハン|アイ|キャン|ハー|サ|プー|バン)ドル|美元|美金|(?<!\p{L})долл|у\.\s?е\.|ดอลลาร์|डॉलर|เหรียญสหรัฐ|(?<=\d\s*)เหรียญ`, 'iu')],
  ['baht', /฿|(?<!\p{L})(?:bahts?|thb)(?!\p{L})|บาท|바트|バーツ|泰铢/iu],
  // The site's other languages' own money: roubles, rupees, ringgit (none in the 24,952 translations measured).
  ['rouble', /₽|(?<!\p{L})(?:roubles?|rubles?)(?!\p{L})|(?<!\p{L})руб(?:л\p{L}*|\.)?(?!\p{L})/iu],
  ['rupee', /₹|(?<!\p{L})(?:inr|rupees?|roupies?)(?!\p{L})|(?<!\p{L})rs\.?\s?\d|(?<![\p{L}\p{M}])रुप(?:य|ए)/iu],
  ['ringgit', /(?<!\p{L})(?:ringgit|myr)(?!\p{L})/iu],
  ['ringgit', /(?<![\p{L}\d])RM\s?\d/u], // capitals only: "rm" is not money
  // евро wherever it is ("100-евровый"), but not евроремонт (European-style renovation) or Европа.
  ['euro', new RegExp(String.raw`€|(?<!\p{L})(?:euros?|eur)(?!\p{L})|유로|ユーロ|欧元|евро(?!ремонт|п)|${TH_AMOUNT}ยูโร|(?<![\p{L}\p{M}])यूरो(?![\p{L}\p{M}])`, 'iu')],
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

/** English's commonest little words: a text with none of them is not English prose ("cho thue can ho Quận 7", "BÁN XE HONDA WAVE"). */
const EN_GLUE = new Set('a an the of on in at to for from with and or by is are this that your you our we it be per has have will into also'.split(' '))
/**
 * …and those of them that are not also a Vietnamese word written without its marks, as a an (an ninh) the (thẻ) on (ổn) in at to that
 * (thật) it (ít) be (bé) are: "cho thue nha to ở Quận 7, an ninh tot" is Vietnamese (Opus, 11-14). One of these is needed.
 */
const EN_ONLY = new Set([...EN_GLUE].filter((w) => !'a an the on in at to that it be'.split(' ').includes(w)))
/**
 * English with Vietnamese names in it: Latin letters only, not Vietnamese by the dominance test, English's little words in it (one in
 * twelve words), and every Vietnamese-marked word a capitalised name ("Bạch Đằng", "Hà Nội"). The dong sign ("300,000 đ/day") is not a
 * word, and "số" before a number is part of a street's name ("Đường số 15"). Measured on the 586 texts Haiku sent back unchanged for
 * English on 2026-11-14: 576 pass, every one English; the 10 refused read as Vietnamese. ⚠️ ACCEPTED RISK: a mostly English text with a
 * capitalised Vietnamese phrase in it that Haiku sends back unchanged passes ("Bán Xe Honda Wave Đời Mới, for sale in the center…").
 */
const VI_LISTING_WORDS = new Set('phòng trọ giá rẻ thuê căn hộ gấp tuyển dụng đẹp'.split(' '))
/** …and the same words written without their marks, none an English word: two in lower case make a text Vietnamese ("cho thue … for rent in Quận 7"). */
const VI_UNMARKED = new Set('cho thue gia re nha phong tro lien gan moi dep quan tien dat xe chinh chu'.split(' '))
function englishWithVietnameseNames(text: string): boolean {
  const t = text.normalize('NFC').replace(/(?<!\p{L})đ(?!\p{L})|(?<!\p{L})số(?=\s*\d)/gu, ' ')
  if (readsAsVietnamese(t) || !letters(t).every((c) => /\p{Script=Latin}/u.test(c))) return false
  const words = t.split(/\s+/).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')).filter(Boolean)
  const glue = words.filter((w) => EN_GLUE.has(w)).length // lower case only: "A", "ON" in a shouted title are not prose
  if (glue < 2 || !words.some((w) => EN_ONLY.has(w)) || glue * 12 < words.length) return false
  if (words.filter((w) => VI_UNMARKED.has(w)).length >= 2) return false
  // The marked words are names: capitalised, and none a listing's own word ("Phòng Trọ Giá Rẻ for rent" is Vietnamese). Not tháng,
  // quận, nhà, cần, đất, bán: they are in names too (Cách Mạng Tháng Tám, Quận Gò Vấp, Nhà Bè, Cần Thơ, Đất Đỏ, Lũy Bán Bích). An
  // English text whose only mark is the dong sign has no marked word at all ("Rent 1-2 days: 300,000 đ/day"). And they are few: under a
  // fifth of the words, as readsAsVietnamese draws its line, but counting French-looking marks too ("Bán Nhà Xây for sale in the center").
  const marked = words.filter((w) => VI_DIACRITIC.test(w))
  return marked.length * 5 < words.length && marked.every((w) => /^\p{Lu}/u.test(w) && !VI_LISTING_WORDS.has(w.toLowerCase()))
}

/** Every word of the source (two or more, of two letters or more) is in the translation as written: it was copied, whatever was added. */
function copiesEveryWord(src: string, out: string): boolean {
  const words = src.normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => letters(w).length >= 2)
  const got = new Set(out.normalize('NFC').split(/[^\p{L}\p{N}]+/u))
  return words.length >= 2 && words.every((w) => got.has(w))
}

/**
 * English words a Title Case title is made of that are not names ("Spacious Sunny Penthouse Overlooking Saigon River"): copied, they are
 * the untranslated title. Measured on the first run's 24,543 rows, what Haiku keeps in Latin letters is names (GoPlus 5,600, ward and
 * street names, Dwight, Honda), never these — nor English's little words ("Cheap Room For Rent Near The Airport"). ⚠️ ACCEPTED RISK: a
 * common word missing from these lists still counts as a name, so a title half copied in such words passes ("모던 Duplex Courtyard Loft").
 * Not seen once in the 24,952 translations measured; copiedEverydayRun is the backstop for longer copies.
 */
const TITLE_WORDS = new Set(('sunny bright beautiful lovely nice big large small huge tiny quiet peaceful clean fresh great best top amazing perfect ' +
  'charming stunning gorgeous elegant stylish brand fully high low central convenient affordable available family overlooking facing ' +
  'opposite next close walking minutes walk minute floor rooftop terrace river lake sea park street ready move urgent hot good').split(' '))
/**
 * The longest run of words in a row the translation copied from its source that are everyday English (listing, title or little words):
 * "저렴한 방 For Rent Near The Airport" is the source left untranslated, whatever its capitals. In the first run's 24,543 rows and 409
 * re-translations the longest such run was 3, and each was a name ("Nguyen Sieu Secondary and High School"), so 4 refuses.
 */
function copiedEverydayRun(src: string, out: string): number {
  const own = new Set(src.normalize('NFC').split(/[^\p{L}\p{N}]+/u))
  let run = 0, max = 0
  for (const t of out.normalize('NFC').split(/\s+/u)) {
    const w = t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    if (w && own.has(w) && [LISTING_WORDS, TITLE_WORDS, EN_GLUE].some((set) => set.has(w.toLowerCase()))) max = Math.max(max, ++run)
    else run = 0
  }
  return max
}

/** A translation without the names it copied from its source: capitalised words written exactly as there, other than listing words. */
function withoutCopiedNames(src: string, out: string): string {
  const own = new Set(src.normalize('NFC').split(/[^\p{L}\p{N}]+/u))
  return out.normalize('NFC').split(/([^\p{L}\p{N}]+)/u)
    .filter((w) => !(own.has(w) && /^\p{Lu}/u.test(w) && ![LISTING_WORDS, TITLE_WORDS, EN_GLUE].some((set) => set.has(w.toLowerCase()))))
    .join('')
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
  // Haiku's own note on Japanese room codes: "1LDKではなく1ベッドルームのアパート" ("a 1-bedroom, not a 1LDK") for "1-bedroom apartment", in 7
  // of 90 short Japanese titles re-translated on 2026-11-14 (none of the 24,543 rows written that morning).
  if (target === 'ja' && /(?:LDK|DK|ワンルーム)(?:ではなく|じゃなく)/.test(v) && !/ldk/i.test(src)) return 'a note its source does not have'
  // A name reads the same in every language, scripts included (the prompt keeps names as written): written as it is, done.
  if (v === src.trim() && nameLike(v)) return null
  // English already: an English text that names Vietnamese streets ("Studio of 20 m² on Bạch Đằng, Tan Hoa Ward") is asked for in
  // English (mayBeVietnamese is broad on purpose) and comes back as it is. That IS its English: written, so it is done and not asked
  // again every day (586 a day on the first run). Only when every Vietnamese-marked word is a capitalised name: "iPhone 14 cũ" is not.
  if (target === 'en' && v === src.trim() && englishWithVietnameseNames(v)) return null
  const re = SCRIPT[target]
  if (re) {
    const ls = letters(v)
    // Brand, school and building names stay in Latin letters ("MYP 수학 교사 — Dwight School Hanoi"), so the share is taken without the
    // names the translation copied from its source: a fifth of the rest in the language's own script, and at least one letter overall.
    // The rest is judged whatever its length: dropping the names must not leave a copied title with one letter of the script to pass on
    // ("롯데 Beautiful Family Home" for "Beautiful Family Home" keeps "Home", a listing word, and is refused).
    // A Vietnamese source is written in Title Case, so its capitals are not names: "아파트 Cao Cấp Sang Trọng Full Nội Thất" is a copy,
    // with or without its marks ("Can Ho Cao Cap Quan 7 Gia Re": two of its words unmarked and no English little word).
    const srcWords = src.normalize('NFC').toLowerCase().split(/[^\p{L}]+/u)
    const viSource = readsAsVietnamese(src) || (srcWords.filter((w) => VI_UNMARKED.has(w)).length >= 2 && !srcWords.some((w) => EN_ONLY.has(w)))
    const rest = letters(viSource ? v : withoutCopiedNames(src, v))
    const share = (xs: string[]) => xs.filter((c) => re.test(c)).length / xs.length
    if (!ls.some((c) => re.test(c)) || (ls.length >= 12 && ((rest.length && share(rest) < 0.2) || (copiesEveryWord(src, v) && share(ls) < 0.2))) ||
      copiedEverydayRun(src, v) >= 4) {
      return 'not in the target script'
    }
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
