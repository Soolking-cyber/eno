import { deaccent } from './chat-lang'

/**
 * Fixed translations for the commonest short chat lines, Vietnamese ⇄ English — answered with no model at all.
 *
 * ⛔ WHY. The box model is fine on a full sentence ('Mình muốn thuê căn hộ 2 phòng ngủ ở Quận 2' → "I want to rent a
 * 2 bedroom apartment in District 2.") and wrong on exactly the lines people send most, measured 2026-10-20:
 * 'Bạn khỏe không' → "You are well.", 'Xin chào' → "Hello to", 'Dạ' → "and", 'còn phòng không' → "There is room."
 * — a question turned into a statement, which is worse than no translation. These lines are a closed, well-known
 * set, so they are looked up, not generated.
 *
 * ⚠️ A LINE WRITTEN WITH ITS MARKS IS MATCHED WITH ITS MARKS. Stripped of marks, 'Vàng' (gold), 'Đã' (already) and
 * 'Đá' (stone) are all 'vang'/'da' — "Yes". So marked input is looked up against the marked phrases, and only input
 * typed without any marks falls back to the unmarked form (reviewers, 2026-10-20).
 */
const VI_EN_PHRASES: Record<string, string> = {
  'xin chào': 'Hello', 'chào bạn': 'Hi', 'chào anh': 'Hi', 'chào chị': 'Hi', 'chào em': 'Hi', 'chào cô': 'Hello',
  'chào thầy': 'Hello', 'chào buổi sáng': 'Good morning', 'chúc ngủ ngon': 'Good night',
  'bạn khỏe không': 'How are you?', 'anh khỏe không': 'How are you?', 'chị khỏe không': 'How are you?',
  'em khỏe không': 'How are you?', 'cô khỏe không': 'How are you?', 'thầy khỏe không': 'How are you?',
  'cảm ơn': 'Thank you', 'cảm ơn bạn': 'Thank you', 'cảm ơn anh': 'Thank you', 'cảm ơn chị': 'Thank you',
  'cảm ơn em': 'Thank you', 'cảm ơn cô': 'Thank you', 'cảm ơn thầy': 'Thank you', 'cảm ơn nhiều': 'Thanks a lot',
  'cảm ơn bạn nhiều': 'Thank you very much', 'cảm ơn anh nhiều': 'Thank you very much', 'cảm ơn chị nhiều': 'Thank you very much',
  'không có gì': 'No problem', 'vâng': 'Yes', 'dạ': 'Yes', 'dạ vâng': 'Yes', 'vâng ạ': 'Yes', 'không': 'No',
  'tạm biệt': 'Goodbye', 'hẹn gặp lại': 'See you later', 'xin lỗi': 'Sorry', 'không sao': 'No problem',
  'không sao đâu': 'No problem', 'còn phòng không': 'Is the room still available?', 'phòng còn trống không': 'Is the room still available?',
  'còn phòng không ạ': 'Is the room still available?', 'còn không': 'Is it still available?', 'còn hàng không': 'Is it still available?',
  'còn không ạ': 'Is it still available?', 'bao nhiêu tiền': 'How much is it?', 'giá bao nhiêu': 'How much is it?',
  'bạn ở đâu': 'Where are you?', 'anh ở đâu': 'Where are you?', 'chị ở đâu': 'Where are you?', 'em ở đâu': 'Where are you?',
  'tôi hiểu rồi': 'I understand', 'em hiểu rồi': 'I understand', 'mình hiểu rồi': 'I understand', 'hiểu rồi': 'Understood',
  'được không': 'Is that OK?', 'đúng rồi': "That's right", 'mấy giờ': 'What time?', 'lúc mấy giờ': 'What time?',
}
const EN_VI_PHRASES: Record<string, string> = {
  'how are you': 'Bạn khỏe không?', 'thank you': 'Cảm ơn bạn', 'thanks': 'Cảm ơn bạn', 'thank you so much': 'Cảm ơn bạn rất nhiều',
  'thank you very much': 'Cảm ơn bạn rất nhiều', 'thanks a lot': 'Cảm ơn bạn rất nhiều', 'ok thanks': 'Vâng, cảm ơn bạn',
  'youre welcome': 'Không có gì', 'yes': 'Vâng', 'no': 'Không', 'sorry': 'Xin lỗi', 'no problem': 'Không sao',
  'good morning': 'Chào buổi sáng', 'good afternoon': 'Chào buổi chiều', 'good evening': 'Chào buổi tối',
  'good night': 'Chúc ngủ ngon', 'goodbye': 'Tạm biệt', 'see you later': 'Hẹn gặp lại', 'see you tomorrow': 'Hẹn gặp bạn ngày mai',
  'is it still available': 'Còn không ạ?', 'is the room still available': 'Phòng còn trống không?',
  'how much is it': 'Giá bao nhiêu?', 'where are you': 'Bạn đang ở đâu?', 'i understand': 'Tôi hiểu rồi',
  'what time': 'Mấy giờ?', 'great': 'Tuyệt vời', 'perfect': 'Tuyệt vời', 'nice to meet you': 'Rất vui được gặp bạn',
}

const VI_MARK = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/iu
// Old- and new-style tone placement are both in everyday use (khoẻ / khỏe, hoà / hòa, thuý / thúy): fold to one.
const TONE_FOLD: Array<[RegExp, string]> = [
  [/oẻ/gu, 'ỏe'], [/oè/gu, 'òe'], [/oé/gu, 'óe'], [/oẽ/gu, 'õe'], [/oẹ/gu, 'ọe'],
  [/oả/gu, 'ỏa'], [/oà/gu, 'òa'], [/oá/gu, 'óa'], [/oã/gu, 'õa'], [/oạ/gu, 'ọa'],
  [/uỷ/gu, 'ủy'], [/uỳ/gu, 'ùy'], [/uý/gu, 'úy'], [/uỹ/gu, 'ũy'], [/uỵ/gu, 'ụy'],
]
const words = (t: string) => t.replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** The line in lower case with its marks, one tone-placement style, and no punctuation, emoji or extra spaces. */
export function markedKey(text: string): string {
  let t = text.normalize('NFC').toLowerCase()
  for (const [re, to] of TONE_FOLD) t = t.replace(re, to)
  return words(t)
}
/** The same with every mark removed — for a line typed without any. */
export function phraseKey(text: string): string {
  return words(deaccent(text).toLowerCase())
}

const VI_MARKED = new Map(Object.entries(VI_EN_PHRASES).map(([k, v]) => [markedKey(k), v]))
const VI_BARE = new Map(Object.entries(VI_EN_PHRASES).map(([k, v]) => [phraseKey(k), v]))
const EN_MAP = new Map(Object.entries(EN_VI_PHRASES).map(([k, v]) => [phraseKey(k), v]))

// Emoji and symbols at the end ride along: 'good 👍' must not come back as just the word.
const TRAILING_SYMBOLS = /[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+$/u

/** A fixed translation of `text` from `source` into `target`, or undefined. Vietnamese ⇄ English only. */
export function phrasebook(text: string, source: string, target: string): string | undefined {
  let hit: string | undefined
  if (source === 'vi' && target === 'en') hit = VI_MARK.test(text) ? VI_MARKED.get(markedKey(text)) : VI_BARE.get(phraseKey(text))
  else if (source === 'en' && target === 'vi') hit = EN_MAP.get(phraseKey(text))
  if (!hit) return undefined
  const tail = text.match(TRAILING_SYMBOLS)?.[0].trim()
  return tail ? `${hit} ${tail}` : hit
}
