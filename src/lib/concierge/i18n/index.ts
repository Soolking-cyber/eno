import { TRUST_CLAIMS as CLAIM_SOURCES } from './claims'
import { EN_SPEECH_BAN, LEXICON } from './lexicon'
import type { GuideLines, LexiconEntry } from './types'

export type { GuideLines, LexiconEntry } from './types'

/**
 * THE GUIDE IN THE VISITOR'S LANGUAGE (owner, 2026-10-28: "concierge language support ex if the visitors app in vn
 * language concierge should speak in vn same for all 11 languages look which ones we can support" → "drop khmer"). Soniox
 * listens and speaks ten of eno.vn's eleven languages; Khmer is not one, so a Khmer visitor's guide speaks English.
 *
 * The lines and lists (lexicon.ts) are GENERATED from the 2026-10-28 workflow: drafted per language, then attacked by an
 * independent verifier with its own sentences (lexicon-cases.ts — 1,076 of them, all passing) and fixed. The English and
 * Vietnamese rules of guards.ts stay as they are and still run on every sentence and every ask; these are added beside them.
 *
 * ⚠️ MATCHING: norm() KEEPS combining marks (a Hindi or Thai vowel sign is a mark — guards.ts plain() would cut "वीज़ा" to
 * "व ज"), and a boundary is a Unicode lookaround, never JS `\b` (ASCII only: `\bвиза\b` matches nothing).
 */
export const SPOKEN_LANGUAGES = ['en', 'vi', 'zh', 'ko', 'ja', 'ru', 'ms', 'th', 'fr', 'hi'] as const
export type SpokenLanguage = (typeof SPOKEN_LANGUAGES)[number]
type Other = Exclude<SpokenLanguage, 'en'>
const OTHER = SPOKEN_LANGUAGES.filter((l): l is Other => l !== 'en')

/**
 * The app's language as the guide speaks it: its primary subtag, Soniox's code — ⛔ eno's Chinese is `zh-Hans`
 * (src/lib/languages.ts), Soniox's is `zh` — and one Soniox cannot speak (Khmer), or none, is English.
 */
export function spokenLanguage(lang: string | null | undefined): SpokenLanguage {
  const base = (lang ?? '').trim().toLowerCase().split('-')[0]
  return (SPOKEN_LANGUAGES as readonly string[]).includes(base) ? (base as SpokenLanguage) : 'en'
}

/** For the brain's per-turn instruction ("Answer in Vietnamese.") — English names: the brief is English. */
export const LANGUAGE_NAMES: Record<SpokenLanguage, string> = {
  en: 'English', vi: 'Vietnamese', zh: 'Simplified Chinese', ko: 'Korean', ja: 'Japanese', ru: 'Russian', ms: 'Malay',
  th: 'Thai', fr: 'French', hi: 'Hindi',
}

/** English, as the lines were written (turn.ts, guards.ts and start.ts still export each under its old name). */
export const EN_LINES: GuideLines = {
  refused: "Sorry, I couldn't open that. Could you say it another way?",
  partial: "Here's the closest I could open, not every detail is a filter here. Want to change anything?",
  moved: 'Here you go. Anything you want to narrow down?',
  empty: 'Nothing matches that yet. Want me to widen it a little?',
  emptyAfter: 'Nothing matches that just yet, so I can widen it whenever you like.',
  emptyChip: 'Yes, widen it',
  rateEmpty: 'None of these list a cover rate within that budget yet. Want me to raise it a little?',
  rateFallback: "Here are all the teachers. I couldn't match the rates just now, want me to try again?",
  looking: ['Let me look.', 'One moment, let me check.', 'Let me find that.'],
  opening: "Hi! I'm eno's guide. Tell me what you're looking for, and I'll show you.",
  notOffered: "eno.vn doesn't provide that service itself. Licensed providers can list in Services, and eno checks their licence first. Want me to open that section?",
  noTrips: "eno.vn doesn't plan trips. I can help you find places to stay, vehicles to rent, or tickets — what do you need?",
  noPayments: "eno.vn takes no payments. You pay the seller directly, after you've seen the item.",
  offerYes: 'Yes, open it',
  offerNo: 'No, thanks',
  offerTaken: 'Here are the licensed providers. Message one in the chat to ask your questions.',
}
/** The offer's yes, answered (not in the 2026-10-28 drafts: written with them, screened by the same tests — i18n.test.ts). */
const OFFER_TAKEN: Record<Other, string> = {
  vi: 'Đây là các đơn vị có giấy phép. Bạn nhắn tin cho một đơn vị trong phần chat để hỏi nhé.',
  zh: '这些是有执照的服务商。您可以在聊天里给其中一家发消息咨询。',
  ko: '허가를 받은 업체들이에요. 채팅으로 한 곳에 메시지를 보내 문의해 보세요.',
  ja: 'こちらが許可を受けた事業者です。チャットでいずれかにメッセージを送って質問してください。',
  ru: 'Вот компании с лицензией. Напишите одной из них в чате, чтобы задать вопросы.',
  ms: 'Ini penyedia yang berlesen. Hantar mesej kepada salah satu dalam chat untuk bertanya.',
  th: 'นี่คือผู้ให้บริการที่มีใบอนุญาต ส่งข้อความหาหนึ่งในนั้นทางแชทเพื่อสอบถามได้เลย',
  fr: "Voici les prestataires agréés. Écrivez à l'un d'eux dans le chat pour poser vos questions.",
  hi: 'ये लाइसेंस वाले सेवा प्रदाता हैं। सवाल पूछने के लिए चैट में इनमें से किसी को संदेश भेजें।',
}
export const linesFor = (l: SpokenLanguage): GuideLines => (l === 'en' ? EN_LINES : { ...LEXICON[l].lines, offerTaken: OFFER_TAKEN[l] })

/**
 * TRADITIONAL CHINESE AS THE LISTS READ IT (commit review, opus: "簽證" is a visa too): each character of the Chinese lists
 * that Traditional writes differently, as its Simplified form (and 証, the variant Taiwan also writes). Applied to the text
 * AND to every list — a Japanese list that writes 過 or 時 is mapped the same way, so it still matches its own text.
 */
const T2S = new Map(['簽签', '證证', '証证', '註注', '約约', '協协', '議议', '電电', '訂订', '寶宝', '續续', '勞劳', '動动', '傭佣', '遊游',
  '務务', '學学', '親亲', '單单', '兩两', '個个', '許许', '臨临', '時时', '記记', '綠绿', '滯滞', '過过', '邊边', '轉转', '長长', '們们',
  '間间', '擔担', '請请', '觀观', '計计', '劃划', '規规', '線线', '綫线', '貝贝', '幫帮', '給给', '為为', '爲为', '設设', '製制', '車车',
  '國国', '師师', '資资', '應应', '輸输', '紹绍', '經经', '紀纪', '獵猎', '頭头', '牽牵', '對对', '連连', '職职', '尋寻', '業业', '辦办',
  '張张', '贊赞', '讚赞', '崗岗', '機机', '構构', '費费', '錢钱', '價价', '顧顾', '問问', '嗎吗', '還还', '處处', '課课', '薦荐', '這这',
  '會会', '條条', '幾几', '維维', '薩萨', '儲储', '賬账', '帳账', '買买', '達达', '銀银', '聯联', '結结', '語语', '漢汉', '暫暂', '萬万',
  '麼么', '賣卖', '實实', '認认', '驗验', '審审', '譜谱', '東东', '鋪铺', '舖铺', '絕绝'].map((p) => [p[0], p[1]] as const))
const T2S_CHARS = new RegExp(`[${[...T2S.keys()].join('')}]`, 'gu')
const simplified = (s: string): string => s.replace(T2S_CHARS, (c) => T2S.get(c) ?? c)
/** For the scratchpad checks and tests that compile a pattern the way the guard does. */
export const simplifiedForTest = simplified

/**
 * A turn about TEACHERS in the nine languages (turn.ts adds it to its English and Vietnamese words): the counsel words are
 * out of its speech, and the teacher ladder applies. ⚠️ 先生 is "teacher" in Japanese but "Mr." in Chinese (commit review,
 * opus: "房东王先生" is a landlord, and a rentals turn lost its words to the counsel list) — a teacher only beside kana.
 */
const TEACHER_WORDS = new RegExp(simplified('老师|教师|家教|外教|선생님|강사|과외|講師|家庭教師|教師|учител|репетитор|преподавател|ครู|ติวเตอร์|शिक्षक|ट्यूटर|अध्यापक|टीचर|(?<!\\p{L})(?:guru|professeur|prof|enseignante?|tuteur|tutrice)(?!\\p{L})'), 'iu')
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
export function isTeacherTalkI18n(transcript: string): boolean {
  const t = simplified(transcript.normalize('NFC'))
  return TEACHER_WORDS.test(t) || (t.includes('先生') && KANA.test(t))
}

/**
 * ⛔ INVISIBLE FORMAT CHARACTERS OUT before anything reads a sentence (commit review round 3, codex: "签\u200B证" read as
 * "签 证" and no list matched; "vi\u200Bsa" passes EDITION_BANNED the same way): zero-width spaces and joiners, the
 * soft hyphen, bidi marks, the BOM — every \p{Cf}. What is SPOKEN is unchanged; only what is screened.
 */
export const stripInvisible = (s: string): string => s.replace(/\p{Cf}/gu, '')

/**
 * Text as the lists read it: NFC, invisible format characters out, lower case, Traditional Chinese as Simplified, every run of anything but letters, marks and
 * digits one space — and no space between two Thai letters (speech-to-text may put one between every Thai word; the Thai
 * lists are written joined).
 */
export function norm(s: string): string {
  return simplified(stripInvisible(s.normalize('NFC')).toLowerCase()).replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
    .replace(/(?<=[฀-๿]) (?=[฀-๿])/g, '')
}
/**
 * "Not a letter, mark or digit" — and on norm()ed text, the only thing that is not one is a space: so a boundary is `[^ ]`,
 * EXACTLY `[\p{L}\p{M}\p{N}]` there (every list runs on norm()ed text only) at a seventh of the compile (measured
 * 2026-10-28, all 384 lists: 411 ms → 88 ms; a Unicode property class is built anew in every regex that names it).
 */
const LETTER = '[^ ]'
const wrap = (e: LexiconEntry): string => {
  const p = simplified(e.pattern)
  return e.boundary === 'word' ? `(?<!${LETTER})(?:${p})(?!${LETTER})` : e.boundary === 'start' ? `(?<!${LETTER})(?:${p})` : `(?:${p})`
}
/**
 * ⚡ ONE REGEX PER ENTRY, NO `i` FLAG (measured 2026-10-28, commit review): one alternation of a few hundred entries with
 * lookbehinds took ~1.8 ms a sentence and seconds to compile; per entry it is ~0.16 ms, half the compile without `i` —
 * the text is norm()ed to lower case, and i18n.test.ts keeps every pattern free of upper-case literals.
 */
const compileEach = (entries: LexiconEntry[], flags = 'u'): RegExp[] => entries.map((e) => new RegExp(wrap(e), flags))
/** One entry as the guard compiles it — for the lists' tests (and the scratchpad runner that drafts them). */
export const entryRegex = (e: LexiconEntry): RegExp => new RegExp(wrap(e), 'u')
const anyOf = (rs: readonly RegExp[], t: string): boolean => rs.some((r) => r.test(t))
/**
 * "Visa" in languages the guide does not speak, should a model drift into one (commit review round 5, opus: a Khmer page is
 * spoken in English, but a Khmer speaker can pull the model into Khmer): Khmer ទិដ្ឋាការ, Spanish / Portuguese / Italian
 * visado / visto de / visto per, German Visum, Arabic تأشيرة, Indonesian / Tagalog "visa" is English's already.
 */
const UNSPOKEN_VISA = /ទិដ្ឋាការ|(?<![^ ])(?:visado|visados|visum|visa?s? de (?:turista|trabajo|estudiante)|visto (?:de|per) (?:turista|trabalho|lavoro|estudante|studio))(?![^ ])|تأشيرة/u
/** The trust claims (claims.ts), through the same Traditional → Simplified map as the text they read. */
const TRUST_CLAIMS = CLAIM_SOURCES.map((r) => new RegExp(simplified(r.source), r.flags))

/** Every language's lists at once: a guide that drifts into the person's language is screened all the same (commit
 *  review, codex + opus — an English page, a Japanese speaker, "アライバルビザ"). English's own (EN_SPEECH_BAN — the guide
 *  offering to plan a trip or arrange a tour, which guards.ts EDITION_BANNED never covered) runs beside them. */
const BAN = compileEach([...EN_SPEECH_BAN, ...OTHER.flatMap((l) => LEXICON[l].speechBan)])
const COUNSEL = compileEach(OTHER.flatMap((l) => LEXICON[l].counselWords))
const asksOf = (k: 'visa' | 'trip' | 'pay' | 'card') => OTHER.flatMap((l) => LEXICON[l].asks[k])
const ASK = { visa: compileEach(asksOf('visa')), trip: compileEach(asksOf('trip')), pay: compileEach(asksOf('pay')) }
const CARD = compileEach(asksOf('card'), 'gu')

/**
 * Compile every list before anyone speaks (V8 compiles a regex on its first use — measured 2026-10-29: ~0.5 s for all of
 * them, the largest offer lists ~60–105 ms each): the config read calls this, and it runs in slices of at most WARM_SLICE_MS,
 * each its own task — ⛔ never one long task on the server both editions share (commit review, codex + opus: a synchronous
 * loop stalls every request for its length; one regex is the smallest slice V8 allows). Once per process; never throws.
 */
const WARM_SLICE_MS = 8
let warmed = false
export function warmLanguageLists(): void {
  if (warmed) return
  warmed = true
  const all = [...BAN, ...COUNSEL, ...ASK.visa, ...ASK.trip, ...ASK.pay, ...CARD]
  let i = 0
  const slice = () => {
    const t0 = performance.now()
    while (i < all.length && performance.now() - t0 < WARM_SLICE_MS) {
      const r = all[i++]
      try { r.lastIndex = 0; r.test('x') } catch { /* each regex is checked by i18n.test.ts */ }
    }
    if (i < all.length) setTimeout(slice, 0)
  }
  setTimeout(slice, 0)
}

/**
 * What the person ASKED for that eno.vn does not offer, in any of the nine languages — the person may speak another than
 * the app's. Null for anything else, a mention included ("a teaching job with visa sponsorship" in each language). The
 * card network is taken out first ("pay with Visa" is a payment question, never a visa).
 */
export function i18nAsk(transcript: string): 'visa' | 'trip' | 'pay' | null {
  let t = norm(transcript)
  for (const r of CARD) t = t.replace(r, ' card ')
  if (anyOf(ASK.visa, t)) return 'visa'
  if (anyOf(ASK.trip, t)) return 'trip'
  if (anyOf(ASK.pay, t)) return 'pay'
  return null
}

/**
 * May the guide NOT say this sentence, by the nine languages' lists? The licensing words of EVERY language (whatever the
 * turn's — a model can drift into the person's), on a teacher turn every language's counsel words, and a web address or
 * email read aloud with any language's words ("arobase … point com"). English is EDITION_BANNED's (guards.ts), which
 * screens every sentence anyway; numbers read aloud are guards.ts's too (digitize, below, feeds its phone check).
 */
export function i18nUnspeakable(sentence: string, ctx: { lang: SpokenLanguage; teacherTurn: boolean }): boolean {
  const t = norm(sentence)
  if (anyOf(BAN, t) || anyOf(TRUST_CLAIMS, t) || UNSPOKEN_VISA.test(t)) return true
  if (ctx.teacherTurn && anyOf(COUNSEL, t)) return true
  return SPOKEN_ADDRESS?.test(sentence.normalize('NFC').toLowerCase()) ?? false
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** English's own "dot" and "at" are guards.ts's (containsContactInfo reads "name at gmail dot com"): only each language's. */
const nativeWords = (words: string[]) => words.filter((w) => !/^(?:dot|at)$/i.test(w.trim())).map((w) => escape(w.toLowerCase()))
const TLD = '(?:com|net|org|vn|io|me|co|info|forum)(?![a-z])'
const SPOKEN_ADDRESS: RegExp | null = (() => {
  const dot = [...new Set(OTHER.flatMap((l) => nativeWords(LEXICON[l].contact.dotWords)))]
  const at = [...new Set(OTHER.flatMap((l) => nativeWords(LEXICON[l].contact.atWords)))]
  if (!dot.length) return null
  // Not a function word before "point" / "titik" (commit review, opus: "ce point me semble…", "un point info" are French,
  // not addresses — "zalo point me" still is one).
  const notWord = '(?<![a-z0-9-])(?!(?:ce|cet|cette|un|une|le|la|les|du|de|des|au|aux|en|et|ou|mon|ton|son|ma|ta|sa|ses|ces|chaque|quel|quelle|satu|ini|itu|dan|di)\\s)'
  const domain = `${notWord}[a-z0-9-]{2,}\\s*(?:${dot.join('|')})\\s*${TLD}`
  const email = at.length ? `|[a-z0-9._-]{2,}\\s*(?:${at.join('|')})\\s*[a-z0-9-]{2,}\\s*(?:${dot.join('|')})` : ''
  return new RegExp(`${domain}${email}`, 'iu')
})()

/** A script's own numerals (Thai, Devanagari, CJK) as ASCII digits — from every language's list, plus 零, 两 and 幺. */
const NUMERAL = new Map<string, string>([['零', '0'], ['两', '2'], ['幺', '1']])
for (const l of OTHER) {
  LEXICON[l].contact.nativeDigits.forEach((chars, d) => { for (const c of chars) if (!/[0-9]/.test(c)) NUMERAL.set(c, String(d)) })
}
/**
 * Spelled digits, as whole words — EVERY space-separated language's, whatever the turn's (commit review, codex: a guide that
 * drifts reads "zéro neuf zéro un…" on an English turn). Thai and CJK digit words are substrings of everyday words: below.
 */
const SPACED: readonly Other[] = ['vi', 'ko', 'ru', 'ms', 'fr', 'hi']
const DIGIT_WORD = new Map<string, string>()
for (const l of SPACED) LEXICON[l].contact.digitWords.forEach((words, d) => { for (const w of words) DIGIT_WORD.set(norm(w), String(d)) })

const HAN = /\p{Script=Han}/u
/**
 * A script's own numerals as ASCII digits. A Thai or Devanagari digit is a digit wherever it stands, as an ASCII one is; a
 * Han numeral is also an everyday word ("一下", "第一郡", "一千二百万") — `han: false` leaves it to the run scan below.
 */
const numerals = (sentence: string, han: boolean): string => {
  let s = ''
  for (const c of simplified(sentence.normalize('NFC'))) { const d = NUMERAL.get(c); s += d !== undefined && (han || !HAN.test(c)) ? d : c }
  return s
}
/**
 * A whole word of THREE or more Korean digit syllables ("공일공", "일이삼사") — a number's group (commit review round 5, codex:
 * a 3-3-4 reading went out in parts). An everyday word made only of digit syllables ("이삼일", two or three days) holds the
 * answer a moment; only eight or more, together, drop anything.
 */
const koreanDigits = (tok: string): string | null => {
  const w = norm(tok)
  if ([...w].length < 3 || ![...w].every((c) => KOREAN_SYLLABLE_DIGIT.has(c))) return null
  return [...w].map((c) => KOREAN_SYLLABLE_DIGIT.get(c)).join(' ')
}
/** Each whitespace-separated word that is a digit word as its digit — only in runs of `min` or more such words. */
function spacedDigitRuns(s: string, min: number): string {
  // Separators a number is written with count as spaces (commit review round 6, codex: "zéro-neuf-zéro-un-…" was one word).
  const toks = s.split(/([\s\-–—./·,]+)/)
  const digitOf = toks.map((tok, k) => (k % 2 ? null : DIGIT_WORD.get(norm(tok)) ?? (min > 1 ? koreanDigits(tok) : null)))
  let k = 0
  while (k < toks.length) {
    if (k % 2 || digitOf[k] === null) { k += 1; continue }
    let end = k
    while (end + 2 < toks.length && digitOf[end + 2] !== null) end += 2
    // A run's length is the DIGITS it holds: a Korean group ("일이삼사") is one word but four digits.
    let digits = 0
    for (let j = k; j <= end; j += 2) digits += (digitOf[j] as string).split(' ').length
    if (digits >= min) for (let j = k; j <= end; j += 2) toks[j] = digitOf[j] as string
    k = end + 1
  }
  return toks.join('')
}

/**
 * The sentence with every numeral a person could read a phone number in turned into an ASCII digit — a script's own
 * numerals, in a space-separated language its digit words, in Thai and kana runs of eight — so guards.ts's run counter sees
 * "०९०१…", "零九零一…" or "không chín không một …" as the number it is. Everything else is left as it was; only RUNS count
 * there (digit words are everyday words too: "năm", "un", "ba").
 */
export function digitize(sentence: string): string {
  // A number spelled in an UNSPACED script's digit words ("ศูนย์เก้าศูนย์หนึ่ง…", "ゼロきゅうゼロいち…", "공일공일…") — only
  // a run of eight or more becomes digits: a digit word inside an everyday word stays as it is (commit review, opus).
  return spacedDigitRuns(unspacedDigitRuns(numerals(sentence, true), 8, UNSPACED_WORDS), 1)
}

/**
 * For a WHOLE TURN'S digits (brain.ts — the digit hold and the turn's total, which see a number spread over sentences): a
 * script's own numerals, and digit words where THREE OR MORE follow one another, spaced or not ("không chín không một",
 * "ศูนย์เก้าศูนย์") — one or two are everyday words ("…không?", "năm nay", "สองสามวัน"), never what someone reads out
 * (commit review, codex: "không chín không một." · "hai ba bốn." · "năm sáu bảy." was voiced in parts).
 */
export function digitizeRuns(text: string): string {
  return spacedDigitRuns(unspacedDigitRuns(numerals(text, false), 3, RUN_WORDS), 3)
}

/** Digit words of the scripts written without spaces between them (Thai, Japanese kana) and Korean read as one block. */
const UNSPACED_DIGIT = new Map<string, string>()
for (const l of ['th', 'ja', 'ko'] as const) {
  LEXICON[l].contact.digitWords.forEach((words, d) => { for (const w of words) UNSPACED_DIGIT.set(w.toLowerCase(), String(d)) })
}
for (const [c, d] of NUMERAL) if (HAN.test(c)) UNSPACED_DIGIT.set(c, d)
/** Longest first, so "ศูนย์" is never read as a shorter word inside it. */
const longestFirst = (ws: Iterable<string>) => [...ws].sort((a, b) => b.length - a.length)
const UNSPACED_WORDS = longestFirst([...UNSPACED_DIGIT.keys()].filter((w) => !(w.length === 1 && HAN.test(w))))
/**
 * The TURN's scan (digitizeRuns): Thai and kana digit words and the Han numerals (零九零一…) — ⛔ never the Korean syllables:
 * 일 이 삼 사 오 구 공 are everyday syllables ("이삼 일", "강남구 이사" — commit review round 3, opus); a Korean number read
 * out whole is still the per-sentence check's (digitize, runs of eight).
 */
const KOREAN_DIGIT = new Set(LEXICON.ko.contact.digitWords.flat().map((w) => w.toLowerCase()))
/** Korean single-syllable digit words (공 일 이 삼 …) → their digit — for koreanDigits above (commit review round 4, codex:
 *  "공일공. 일이삼사. 오육칠팔." was voiced in parts once Korean left the turn's scan). */
const KOREAN_SYLLABLE_DIGIT = new Map<string, string>()
LEXICON.ko.contact.digitWords.forEach((words, d) => { for (const w of words) if ([...w].length === 1) KOREAN_SYLLABLE_DIGIT.set(w, String(d)) })
const RUN_WORDS = longestFirst([...UNSPACED_DIGIT.keys()].filter((w) => !KOREAN_DIGIT.has(w)))
/**
 * Kana digit words that are also a particle or an honorific (に, ご, さん, く, し — "オーナーさんにご連絡ください" is no
 * number — commit review round 3, opus): a run made of these alone is not counted; a number read aloud has an unambiguous
 * word in it (ゼロ, いち, きゅう, よん…: a Vietnamese number starts with 0).
 */
const AMBIGUOUS_KANA = new Set(['に', 'ニ', 'ご', 'ゴ', 'さん', 'サン', 'く', 'ク', 'し', 'シ'])
const SEPARATOR = /[\s\-・、,.]/
/**
 * Runs of `min` or more digit words (separators allowed between them) as their digits — a plain scan, linear in the text
 * (a regex of nested repeats over words that share prefixes can backtrack without end).
 */
function unspacedDigitRuns(s: string, min: number, words: readonly string[]): string {
  const wordAt = (k: number) => words.find((w) => s.startsWith(w, k)) ?? null
  let out = ''
  let i = 0
  while (i < s.length) {
    let j = i
    let digits = ''
    let n = 0
    let plain = false
    for (;;) {
      let k = j
      if (n) while (k < s.length && SEPARATOR.test(s[k])) k += 1
      const w = wordAt(k)
      if (!w) break
      digits += UNSPACED_DIGIT.get(w)
      if (!AMBIGUOUS_KANA.has(w)) plain = true
      n += 1
      j = k + w.length
    }
    if (n >= min && plain) { out += digits; i = j } else { out += s[i]; i += 1 }
  }
  return out
}

const YES = new Set(OTHER.flatMap((l) => LEXICON[l].yes.map(norm)))
const NO = new Set(OTHER.flatMap((l) => LEXICON[l].no.map(norm)))
/** A whole short "yes" to the licensed-providers offer in one of the nine languages (the chip included); never a "no". */
export const isI18nYes = (transcript: string): boolean => { const t = norm(transcript); return YES.has(t) && !NO.has(t) }
