import { EN_WORDS, VI_WEIGHT } from './chat-lang-data'

/**
 * What language is a CHAT line in? Isomorphic and dependency-free: the translate strip asks it in the browser and
 * the translate route asks it again on the server, so both make the same call.
 *
 * ⛔ WHY NOT detectContentLang. That one names Vietnamese only from letters English never has (ơ ư ă đ …), so it
 * returned null — "assume English" — for 59 of 66 real Vietnamese chat lines (2026-10-20): every line typed without
 * marks ('xin chao', 'ban khoe khong', the way many people chat), and short marked ones like 'Xin chào' or 'Không',
 * whose marks English loanwords share. An English reader then got the raw Vietnamese back. Off-the-shelf language-ID
 * libraries were measured too and got 0–38 of 50 unaccented lines right.
 *
 * How it decides: every word scores toward Vietnamese or English —
 *  · a letter only Vietnamese has (ơ ư ă đ ĩ ũ + the dotted/hooked vowels) is near-proof of Vietnamese;
 *  · a word that cannot be a Vietnamese syllable (Vietnamese is ONE syllable per written word, from a closed set of
 *    onsets and rhymes — isViSyllable) leans English, more so if it is a common English word;
 *  · a word that could be either is weighed by how often it is Vietnamese vs English in eno's own text
 *    (chat-lang-data.ts), with the overlap ('an', 'to', 'do', 'me', 'can' …) hand-checked;
 *  · fixed two-word phrases settle what single words cannot ('cam on' is two English words; 'can do' two Vietnamese);
 *  · a Capitalised word mid-sentence (a name, a place: "I live in Thao Dien") counts a quarter.
 * A message made only of greetings both sides know ('ok', 'hi', 'hello', 'haha') is 'und': nothing to translate.
 * Too close to call ⇒ null: the caller shows the original rather than guess.
 *
 * Measured on 104 labelled chat lines (the prototype): 102 right from the text alone, 0 confidently wrong.
 */
export type ChatLang = 'vi' | 'en' | 'fr' | 'ms' | 'latin' | 'ko' | 'ja' | 'zh' | 'ru' | 'th' | 'km' | 'hi' | 'ar' | 'und' | null
export type ChatLangResult = {
  lang: ChatLang
  /** For 'vi': share of Vietnamese words carrying their marks — 'none' / 'partial' lines are restored before MT. */
  marks: 'none' | 'partial' | 'full'
}

/** Strip every diacritic, and đ → d. */
export function deaccent(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
}

// ── Can this unaccented token be ONE Vietnamese syllable? ────────────────────────────────────────────────────────
const RHYMES = new Set(
  `a ac ach ai am an ang anh ao ap at au ay e ec ech em en eng enh eo ep et eu i ia ich iec iem ien ieng iep iet ieu im in
   inh ip it iu o oa oac oach oai oam oan oang oanh oao oap oat oay oc oe oem oen oeo oet oi om on ong ooc oong op ot u ua
   uan uang uat uay uc ue uech uenh ui um un ung uo uoc uoi uom uon uong uop uot uou up ut uu uy uya uych uyen uyet uynh
   uyp uyt uyu y yem yen yet yeu`.split(/\s+/),
)
// Longest first, so 'ngh' wins over 'ng' over 'n'.
const ONSETS = ['ngh', 'ng', 'gh', 'gi', 'kh', 'nh', 'ph', 'qu', 'th', 'tr', 'ch', 'b', 'c', 'd', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'x', '']
// gì / gìn / giữ … — the gi onset swallows a following i.
const GI_EXTRA = new Set(['', 'n', 'm', 't', 'p', 'ch', 'nh', 'ng'])

function onsetFits(onset: string, rhyme: string): boolean {
  switch (onset) {
    case 'k': return /^[eiy]/.test(rhyme) // ke ki ky — never ka ko ku
    case 'c': return !/^[eiy]/.test(rhyme)
    case 'gh': case 'ngh': return /^[ei]/.test(rhyme)
    case 'g': case 'ng': return !/^[ei]/.test(rhyme)
    case 'qu': return !/^(u|oa|oe)/.test(rhyme) // qu already carries the medial
    case 'gi': return !/^i/.test(rhyme)
    default: return true
  }
}

export function isViSyllable(token: string): boolean {
  const t = deaccent(token).toLowerCase()
  if (!/^[a-z]{1,7}$/.test(t)) return false
  for (const onset of ONSETS) {
    if (!t.startsWith(onset)) continue
    const rhyme = t.slice(onset.length)
    if (onset === 'gi' && GI_EXTRA.has(rhyme)) return true
    if (rhyme && RHYMES.has(rhyme) && onsetFits(onset, rhyme)) {
      // a y- rhyme starts a syllable only bare (yên, yêu) or after qu (quyết) — not 'dyen'
      if (/^y[a-z]/.test(rhyme) && onset !== '' && onset !== 'qu') continue
      return true
    }
  }
  return false
}

// ── Word lists ───────────────────────────────────────────────────────────────────────────────────────────────────
const EN_WORD = new Set(EN_WORDS.split(' '))
// A message made ONLY of these needs no translation either way — both readers know them.
const NEUTRAL = new Set(['ok', 'okay', 'oke', 'okie', 'okela', 'hi', 'hello', 'helo', 'bye', 'haha', 'hihi', 'hehe', 'kk', 'kkk'])
// Loanwords Vietnamese chat uses as freely as English: no evidence either way.
const LOAN = new Set(['wifi', 'game', 'video', 'facebook', 'fb', 'zalo', 'laptop', 'gym', 'room', 'check', 'online', 'offline', 'ship',
  'shop', 'size', 'sale', 'deal', 'email', 'mail', 'app', 'link', 'inbox', 'team', 'studio', 'villa', 'penthouse', 'duplex', 'sofa',
  'tivi', 'internet', 'camera', 'file', 'zoom', 'free', 'full', 'book', 'tour', 'visa', 'grab', 'iphone', 'samsung', 'honda',
  'yamaha', 'vinhomes', 'masteri', 'apartment', 'condo', 'pool', 'bar', 'cafe', 'coffee', 'ok', 'okay', 'oke', 'ielts', 'toeic'])
// Vietnamese chat shorthand that is not a syllable. 2 = unambiguous; 1 = also shorthand elsewhere.
const VI_TEEN: Record<string, number> = {
  ko: 2, k0: 2, hok: 2, hong: 1, dc: 2, dk: 1, sdt: 2, ntn: 2, trc: 2, mn: 2, hnay: 2, nma: 2, cx: 2, bh: 1,
  ns: 1, j: 1, z: 1, r: 1, vs: 1, ng: 1, ms: 1, uk: 1, ak: 1, ib: 1, k: 0.5,
}
// Pairs of individually ambiguous words that settle the language.
const VI_BIGRAMS = new Set([
  'cam on', 'xin chao', 'chao ban', 'chao anh', 'chao chi', 'chao em', 'chao co', 'chao thay', 'bao nhieu', 'the nao', 'nhu the',
  'o dau', 'di dau', 'lam gi', 'an com', 'con hang', 'con phong', 'ban oi', 'em oi', 'anh oi', 'chi oi', 'co oi', 'co the',
  'khong a', 'duoc khong', 'bao gio', 'luc nao', 'hom nay', 'ngay mai', 'toi nay', 'can ho', 'phong ngu', 'dat coc', 'hop dong',
  'tieng anh', 'giao vien', 'hoc phi', 'ban cong', 'xe may', 'so dien', 'dien thoai', 'tam biet', 'hen gap', 'gap lai',
  'khong sao', 'da vang', 'vang a', 'ok em', 'ok anh', 'ok chi', 'ok ban', 'hi ban', 'hi anh', 'hi em', 'nha minh', 'con minh',
  'be nha', 'may gio', 'quan may', 'bao lau', 'con khong', 'co khong', 'dang ban', 'roi a', 'nhe ban', 'ban nhe', 'anh nhe',
  'em nhe', 'that a', 'that khong', 'ok nhe', 'ok a', 'da a', 'vay a', 'sao vay', 'gi vay', 'phu huynh', 'hoc sinh', 'lop hoc',
])
// English pairs made only of Vietnamese-shaped words.
const EN_BIGRAMS = new Set(['can do', 'to me', 'to do', 'to be', 'me too', 'so so', 'an hour', 'in the', 'on the', 'at the', 'to the',
  'the same', 'than me', 'can be', 'may be', 'go to', 'in my', 'on my', 'at my', 'to my', 'no no', 'so long', 'so am', 'me to',
  'it is', 'i am', 'i can', 'can i', 'do it', 'not me', 'on it', 'no man'])

// A Latin line that is not English: French and Malay — both UI languages here — named by their own letters or
// everyday function words; anything else stays 'latin' (unnamed).
const FRENCH = /[éèêëàâçùûôîïœ]|\b(je|vous|nous|est|les|des|une|pour|avec|pas|merci|bonjour|bonsoir|salut|oui|très|appartement)\b/iu
const MALAY = /\b(saya|anda|awak|tidak|boleh|dengan|untuk|yang|terima|kasih|ini|itu|sudah|belum|bilik|rumah)\b/iu

// Letters only Vietnamese writes, among Latin-script languages.
const VI_SPECIFIC = /[ĂăĐđĨĩŨũƠơƯưẠ-ỹ]/u
// Marks Vietnamese shares with French and others — evidence only on a Vietnamese-shaped word.
const SHARED_MARK = /[àáâãèéêìíòóôõùúýÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝ]/u
const SCRIPTS: Array<[RegExp, Exclude<ChatLang, null>]> = [
  [/[가-힣ᄀ-ᇿ㄰-㆏]/u, 'ko'],
  [/[぀-ヿ]/u, 'ja'], // kana before Han: Japanese writes both
  [/[一-鿿]/u, 'zh'],
  [/[Ѐ-ӿ]/u, 'ru'],
  [/[฀-๿]/u, 'th'],
  [/[ក-៿]/u, 'km'],
  [/[ऀ-ॿ]/u, 'hi'],
  [/[؀-ۿ]/u, 'ar'],
]

export function detectChatLang(raw: string): ChatLangResult {
  const none: ChatLangResult = { lang: 'und', marks: 'none' }
  const text = raw.normalize('NFC')
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/gi, ' ') // links and emails carry no language
    .replace(/[@#]\S+/g, ' ')
  const letters = text.match(/\p{L}/gu) ?? []
  if (!letters.length) return none
  for (const [re, code] of SCRIPTS) {
    if (letters.filter((c) => re.test(c)).length / letters.length >= 0.5) return { lang: code, marks: 'none' }
  }
  const words = text.match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? []
  if (!words.length) return none
  const tokens = words.map((w) => w.toLowerCase())
  if (tokens.every((t) => NEUTRAL.has(t))) return none

  // A Capitalised word that does not open a sentence, in a text that has lower-case words too, is most likely a name.
  const hasLower = words.some((w) => /^\p{Ll}/u.test(w))
  const opensSentence = new Set<number>([0])
  {
    let n = 0
    for (const m of text.matchAll(/\p{L}+(?:['’]\p{L}+)*|[.!?]/gu)) {
      if (/^[.!?]$/.test(m[0])) opensSentence.add(n)
      else n++
    }
  }

  let vi = 0
  let en = 0
  let viWords = 0
  let markedViWords = 0
  // For telling English from another Latin language: words that scored as English, out of the words that are not
  // names, greetings or loanwords.
  let englishWords = 0
  let countedWords = 0
  const bases = tokens.map((t) => deaccent(t))
  tokens.forEach((t, i) => {
    const b = bases[i]
    const w = hasLower && !opensSentence.has(i) && /^\p{Lu}\p{Ll}/u.test(words[i]) ? 0.25 : 1
    const counted = w === 1 && !NEUTRAL.has(b) && !LOAN.has(b)
    if (counted) countedWords++
    const english = () => { if (counted) englishWords++ }
    if (/['’]/.test(t)) { en += 2 * w; english(); return } // don't, I'm — Vietnamese never writes an apostrophe
    if (VI_SPECIFIC.test(t)) { vi += (isViSyllable(b) ? 3 : 1) * w; viWords++; markedViWords++; return }
    if (SHARED_MARK.test(t)) {
      if (isViSyllable(b)) { vi += 2.5 * w; viWords++; markedViWords++ } else en += 2 * w // café, crème
      return
    }
    if (NEUTRAL.has(b) || LOAN.has(b)) return
    if (b in VI_TEEN && !(b in VI_WEIGHT)) { vi += VI_TEEN[b] * w; viWords++; return }
    if (!isViSyllable(b)) {
      en += (EN_WORD.has(b) ? 2 : 1) * w
      if (EN_WORD.has(b)) english()
      return
    }
    const s = VI_WEIGHT[b]
    if (s === undefined) { vi += 0.5 * w; viWords++; return }
    if (s > 0) { vi += s * w; viWords++ } else if (s < 0) { en += -s * w; english() }
  })
  for (let i = 0; i + 1 < bases.length; i++) {
    const pair = `${bases[i]} ${bases[i + 1]}`
    if (VI_BIGRAMS.has(pair)) vi += 2.5
    if (EN_BIGRAMS.has(pair)) { en += 2.5; englishWords += 2 }
  }
  const marks: ChatLangResult['marks'] = markedViWords === 0 ? 'none' : markedViWords * 2 < viWords ? 'partial' : 'full'
  if (vi >= 2 && vi >= 1.5 * en) return { lang: 'vi', marks }
  if (en >= 2 && en >= 1.5 * vi) {
    // Non-Vietnamese Latin. English only when English words carry it; otherwise French or Malay when the line says
    // so, else an unnamed Latin language.
    if (englishWords * 2 >= countedWords) return { lang: 'en', marks: 'none' }
    return { lang: FRENCH.test(text) ? 'fr' : MALAY.test(text) ? 'ms' : 'latin', marks: 'none' }
  }
  // Too little to call English or Vietnamese, but one word can still name French or Malay: 'Merci', 'Bonjour'.
  if (vi < 2 && englishWords === 0) {
    if (FRENCH.test(text)) return { lang: 'fr', marks: 'none' }
    if (MALAY.test(text)) return { lang: 'ms', marks: 'none' }
  }
  return { lang: null, marks }
}

/**
 * Is a line in `lang` foreign to a reader whose app is in `readerLang`? Only a CONFIDENT language counts: 'und' and
 * null never trigger a translation. 'latin' (a Latin-script language that is not Vietnamese and not clearly English)
 * is foreign to a Vietnamese reader, and undecidable for a Latin-script reader.
 */
export function foreignTo(lang: ChatLang, readerLang: string): boolean {
  if (!lang || lang === 'und') return false
  const reader = readerLang.split('-')[0]
  if (lang === 'latin') return reader === 'vi' || !['en', 'fr', 'ms'].includes(reader)
  return lang !== reader
}

/**
 * Which language does the OTHER person write in, for this reader? Thread-level evidence, never one line:
 *  · `foreign` — most of their confidently-classified lines are foreign to me AND there is enough of it (two such
 *    lines, or one of 4+ words). In a Vietnamese↔Vietnamese chat a landlord's 'Thanks' or 'ok thanks' must not turn
 *    the thread into a translation thread (and, in the apps, raise the notice that messages go to a translation
 *    service).
 *  · `mine` — most of their lines are in my language, two at least: a stored language that says otherwise is stale.
 *  · `some` — more foreign lines than mine, one is enough: for a counterpart whose language nothing records (an
 *    unowned desk, an account that never saved one), where one 'xin chao' is all the evidence there will be.
 */
export function threadLanguage(bodies: string[], readerLang: string): { foreign: boolean; mine: boolean; some: boolean } {
  let foreign = 0
  let mine = 0
  let strong = false
  const latinReader = ['en', 'fr', 'ms'].includes(readerLang.split('-')[0])
  for (const b of bodies) {
    const { lang } = detectChatLang(b)
    if (!lang || lang === 'und') continue
    // An unnamed Latin line (French? Malay?) is undecidable for a Latin-script reader — evidence of neither side.
    if (lang === 'latin' && latinReader) continue
    if (foreignTo(lang, readerLang)) {
      foreign++
      if ((b.match(/\p{L}+/gu)?.length ?? 0) >= 4) strong = true
    } else mine++
  }
  return { foreign: foreign > mine && (foreign >= 2 || strong), mine: mine > foreign && mine >= 2, some: foreign > mine }
}

export const writesForeign = (bodies: string[], readerLang: string): boolean => threadLanguage(bodies, readerLang).foreign
