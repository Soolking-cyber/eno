import { describe, expect, it } from 'vitest'
import { detectChatLang, foreignTo, isViSyllable, threadLanguage, writesForeign } from './chat-lang'

// Real chat lines, the shape eno's parents, teachers, renters and owners write. The owner's own test thread
// (2026-10-20) is the first block: 'xin chao' came back to an English reader untranslated, because the old detector
// read unaccented Vietnamese as English.
const lang = (t: string) => detectChatLang(t).lang

describe('chat language — the owner\'s test thread', () => {
  it.each([
    ['xin chao', 'vi'],
    ['Bạn khỏe không', 'vi'],
    ['Good', 'en'],
    ['good', 'en'],
    ['hi', 'und'], // a greeting both readers know: nothing to translate
  ])('%s → %s', (text, want) => expect(lang(text)).toBe(want))
})

describe('Vietnamese typed WITHOUT marks is Vietnamese', () => {
  it.each([
    'chao ban', 'ban khoe khong', 'cam on', 'bao nhieu tien', 'con phong khong', 'em oi', 'anh oi con hang khong',
    'ban o dau', 'toi muon thue can ho 2 phong ngu', 'minh can tim giao vien tieng anh cho con', 'hoc phi bao nhieu mot thang',
    'dat coc may thang', 'the nao', 'an com chua', 'co wifi khong', 'room nay con khong', 'ko', 'dc', 'ok anh',
  ])('%s', (text) => expect(lang(text)).toBe('vi'))

  it('says the marks are missing, so the server restores them before translating', () => {
    expect(detectChatLang('ban khoe khong').marks).toBe('none')
    expect(detectChatLang('Bạn khỏe không').marks).toBe('full')
  })
})

describe('Vietnamese WITH marks — including the short lines the old detector missed', () => {
  it.each(['Xin chào', 'Không', 'Vâng', 'Ừ', 'Tôi là giáo viên', 'Giá bao nhiêu tiền', 'Phòng còn trống không ạ?'])('%s', (text) =>
    expect(lang(text)).toBe('vi'))
})

describe('English — including English made of Vietnamese-looking words', () => {
  it.each([
    'thanks', 'me too', 'can do', 'to me', 'an hour', 'long time no see', 'do you have parking', 'ok thanks',
    'I live in Thao Dien', 'my address is 12 Nguyen Van Huong', 'Is the room still available?', "I'm a teacher from Canada",
  ])('%s', (text) => expect(lang(text)).toBe('en'))
})

describe('nothing to translate, or not sure', () => {
  it.each(['ok', '👍', '12000000', 'https://eno.vn/listings/abc', 'hello', 'haha'])('%s → und', (text) => expect(lang(text)).toBe('und'))
  it.each(['k', 'hei', 'sup'])('%s → undecided (null): the original is shown rather than a guess', (text) => expect(lang(text)).toBeNull())
})

describe('other scripts', () => {
  it.each([['안녕하세요', 'ko'], ['こんにちは', 'ja'], ['你好', 'zh'], ['Привет', 'ru'], ['สวัสดี', 'th']])('%s → %s', (text, want) =>
    expect(lang(text)).toBe(want))
})

describe('foreignTo — what counts as another language for this reader', () => {
  it('only a confident language counts', () => {
    expect(foreignTo('vi', 'en')).toBe(true)
    expect(foreignTo('en', 'vi')).toBe(true)
    expect(foreignTo('vi', 'vi')).toBe(false)
    expect(foreignTo('und', 'vi')).toBe(false)
    expect(foreignTo(null, 'en')).toBe(false)
    expect(foreignTo('zh', 'zh-Hans')).toBe(false)
  })
  it('an unnamed Latin language is foreign to a Vietnamese reader, undecidable for a Latin one', () => {
    expect(foreignTo('latin', 'vi')).toBe(true)
    expect(foreignTo('latin', 'en')).toBe(false)
    expect(foreignTo('latin', 'ko')).toBe(true)
  })
})

describe('isViSyllable — one Vietnamese syllable, written without marks', () => {
  it.each(['khong', 'nghieng', 'quyen', 'gi', 'giu', 'truong', 'nguoi', 'uyen', 'ke', 'ghe'])('%s is a syllable', (t) =>
    expect(isViSyllable(t)).toBe(true))
  it.each(['good', 'thanks', 'street', 'ka', 'ce', 'ge', 'ngi', 'quu', 'dyen'])('%s is not', (t) => expect(isViSyllable(t)).toBe(false))
})

describe('writesForeign — thread-level evidence that the other person writes another language', () => {
  it('a Vietnamese landlord\'s one "Thanks" does not make a Vietnamese thread a translation thread', () => {
    expect(writesForeign(['Phòng còn trống anh nhé', 'Giá 5 triệu một tháng', 'Thanks'], 'vi')).toBe(false)
    expect(writesForeign(['ok thanks'], 'vi')).toBe(false)
  })
  it('two foreign lines, or one of four words or more, is enough', () => {
    expect(writesForeign(['good', 'see you at the gate'], 'vi')).toBe(true)
    expect(writesForeign(['Is the room still available?'], 'vi')).toBe(true)
    expect(writesForeign(['xin chao', 'ban khoe khong'], 'en')).toBe(true)
  })
  it('greetings and undecided lines are not evidence either way', () => {
    expect(writesForeign(['hi', 'ok', 'sup'], 'vi')).toBe(false)
  })
  it('Chinese is foreign to a Japanese reader (kanji-only Japanese may be asked about too — it comes back unchanged)', () => {
    expect(foreignTo(detectChatLang('我想租这个房子').lang, 'ja')).toBe(true)
  })
})

describe('the shipped tables (chat-lang-data.ts) — what they may contain', () => {
  // They ship to every browser. The generator only lets a word in when eno's UI copy has it or 8+ different sellers
  // write it; these pin the SHAPE, so nothing like a handle, an email or a phone fragment can ride along.
  it('every weighted word is one Vietnamese syllable written without marks', async () => {
    const { VI_WEIGHT } = await import('./chat-lang-data')
    const bad = Object.keys(VI_WEIGHT).filter((w) => !isViSyllable(w))
    expect(bad).toEqual([])
    expect(Object.values(VI_WEIGHT).every((v) => [-2, -1, 0, 1, 2].includes(v))).toBe(true)
  })
  it('every English word is plain lower-case letters and cannot be a Vietnamese syllable', async () => {
    const { EN_WORDS } = await import('./chat-lang-data')
    const bad = EN_WORDS.split(' ').filter((w) => !/^[a-z]{1,20}$/.test(w) || isViSyllable(w))
    expect(bad).toEqual([])
  })
})

describe('the generated modules export data and nothing else', () => {
  it('chat-lang-data exports exactly its two tables', async () => {
    expect(Object.keys(await import('./chat-lang-data')).sort()).toEqual(['EN_WORDS', 'VI_WEIGHT'])
  })
  it('a French reader keeps the strip when a French-stored counterpart writes French (unnamed Latin is not "mine")', () => {
    expect(threadLanguage(['Bonjour, merci beaucoup', 'Je voudrais visiter demain'], 'en').mine).toBe(false)
  })
})

describe('the generated module files hold data and nothing else', () => {
  it.each(['chat-lang-data.ts', 'vi-restore-data.ts'])('%s: comments, an optional server-only import, and const exports of literals only', async (file) => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    const lines = text.split('\n').filter((l) => l.trim())
    const allowed = (l: string) =>
      l.startsWith('//') || l === "import 'server-only'" ||
      /^export const [A-Z_]+(?:: Record<string, (?:number|string)>)? = (?:\{.*\}|".*")$/.test(l)
    expect(lines.filter((l) => !allowed(l))).toEqual([])
  })
})

describe('French and Malay are named, not guessed from a stored language', () => {
  it.each([
    ['Bonjour, merci beaucoup', 'fr'],
    ['Je voudrais visiter l\'appartement demain', 'fr'],
    ['Terima kasih, bilik ini masih ada?', 'ms'],
    ['Kindly revert regarding the aircon', 'latin'], // English with weak evidence: unnamed, sent as English
  ])('%s → %s', (text, want) => expect(lang(text)).toBe(want))
})

describe('one word can name French or Malay', () => {
  it.each([['Merci', 'fr'], ['Bonjour', 'fr'], ['terima kasih', 'ms']])('%s → %s', (text, want) => expect(lang(text)).toBe(want))
  it('but a lone English or Vietnamese word is never read as French', () => {
    expect(lang('Thanks')).toBe('en')
    expect(lang('Cảm ơn')).toBe('vi')
  })
})
