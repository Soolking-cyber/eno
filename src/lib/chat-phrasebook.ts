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
 * Measured again 2026-10-21, 157 short lines through the live pipeline: ~40 of the model's ACCEPTED answers were wrong
 * — 'see you' → "Xem bạn", 'on my way' → "Trên con đường của tôi", 'done' → "làm", 'cảm ơn ạ' → "thanks to",
 * 'chị ơi' → "My sister.", 'cho em hỏi' → "ask me to ask." — and 'hey' came back "hhhhhhhh…": refused by the gate,
 * then re-run (and re-billed) six times in 90 s. So the set now covers how people open, answer and close a chat.
 *
 * ⚠️ A LINE WRITTEN WITH ITS MARKS IS MATCHED WITH ITS MARKS. Stripped of marks, 'Vàng' (gold), 'Đã' (already) and
 * 'Đá' (stone) are all 'vang'/'da' — "Yes". So marked input is looked up against the marked phrases, and only input
 * typed without any marks falls back to the unmarked form (reviewers, 2026-10-20).
 *
 * ⚠️ A LINE TYPED WITHOUT MARKS IS MATCHED BY ITS BARE FORM ALONE, so two phrases that share one must mean the same
 * ('cảm ơn' / 'cám ơn'). Bare input is ambiguous by nature, so the table answers the reading a whole one-line message
 * most plausibly has, and a phrase is matched only as written with its marks (MARKED_ONLY) when its bare form is ALSO
 * a common message on its own: 'ha' is a laugh (which the detector names Vietnamese), not 'hả' ("Huh?"); 'ua' is ừa
 * ("yeah") as much as ủa; 'roi a' is rồi à ("Already?") as much as rồi ạ (review, 2026-10-21).
 * ⚠️ A RARER READING IS LOST EITHER WAY, so it is not a reason to go marked-only: 'chua' (sour), 'duoc a' (được à,
 * "is that OK?"), 'mai nha' (mái nhà, roof). Without the table the mark restorer sends the model the common reading
 * too ('chua' → chưa, 'duoc a' → được ạ), and the model gets these short lines wrong — marked-only would only swap the
 * answer for the model's version of it. A typed '?' still makes the answer a question ("OK?"). The tests pin these.
 *
 * ⚠️ A LINE TYPED AS A QUESTION GETS A QUESTION. The lookup reads no punctuation, so 'Chốt?' finds 'chốt' — and "Deal"
 * for 'Chốt?' shows the other person agreeing to a price they only asked about (review, 2026-10-21). So the answer
 * takes the '?' ("Deal?", "Xong rồi?"), unless the question is not the statement asked — then the line goes to the
 * model: an answer that names its speaker ('Em khỏe?' / 'Mình khỏe?' ask "are YOU well?", never "I'm fine?"), and
 * 'Rồi?' ("and then?" / "already?", not "Yes?").
 *
 * ⚠️ A LINE REACHES THIS TABLE ONLY ONCE THE DETECTOR NAMES ITS LANGUAGE (the route's chatPlan, src/lib/chat-lang.ts).
 * A lone word with too little to go on — 'xong', 'đc', 'alo', 'congrats' — is shown as written, unsent, and its entry
 * waits for the detector; the tests here call the lookup directly (review, 2026-10-21).
 */
export const VI_EN_PHRASES: Readonly<Record<string, string>> = {
  'xin chào': 'Hello', 'chào bạn': 'Hi', 'chào anh': 'Hi', 'chào chị': 'Hi', 'chào em': 'Hi', 'chào cô': 'Hello',
  'chào thầy': 'Hello', 'chào buổi sáng': 'Good morning', 'chúc ngủ ngon': 'Good night',
  'a lô': 'Hello', 'alô': 'Hello', 'alo': 'Hello', 'chào ad': 'Hi', 'chào shop': 'Hi', 'chào anh ạ': 'Hello',
  'chào chị ạ': 'Hello', 'chào cô ạ': 'Hello', 'chào thầy ạ': 'Hello', 'em chào anh': 'Hello', 'em chào chị': 'Hello',
  'em chào cô': 'Hello', 'em chào thầy': 'Hello', 'dạ chào anh': 'Hello', 'dạ chào chị': 'Hello',
  'dạ em chào anh': 'Hello', 'dạ em chào chị': 'Hello',
  'bạn ơi': 'Hi', 'anh ơi': 'Hi', 'chị ơi': 'Hi', 'em ơi': 'Hi', 'cô ơi': 'Hi', 'thầy ơi': 'Hi', 'ad ơi': 'Hi',
  'shop ơi': 'Hi',
  'bạn khỏe không': 'How are you?', 'anh khỏe không': 'How are you?', 'chị khỏe không': 'How are you?',
  'em khỏe không': 'How are you?', 'cô khỏe không': 'How are you?', 'thầy khỏe không': 'How are you?',
  // Vietnamese leaves the subject out: 'Khỏe ạ' answers "How is your son?" as often as "How are you?".
  'khỏe': 'Fine', 'khỏe ạ': 'Fine', 'mình khỏe': "I'm fine", 'tôi khỏe': "I'm fine", 'em khỏe': "I'm fine",
  'em khỏe ạ': "I'm fine", 'tốt': 'Good', 'tốt quá': 'Great', 'tuyệt': 'Great', 'tuyệt vời': 'Great',
  'cảm ơn': 'Thank you', 'cảm ơn bạn': 'Thank you', 'cảm ơn anh': 'Thank you', 'cảm ơn chị': 'Thank you',
  'cảm ơn em': 'Thank you', 'cảm ơn cô': 'Thank you', 'cảm ơn thầy': 'Thank you', 'cảm ơn nhiều': 'Thanks a lot',
  'cảm ơn bạn nhiều': 'Thank you very much', 'cảm ơn anh nhiều': 'Thank you very much', 'cảm ơn chị nhiều': 'Thank you very much',
  'cảm ơn ạ': 'Thank you', 'cám ơn': 'Thank you', 'cám ơn ạ': 'Thank you', 'em cảm ơn': 'Thank you',
  'em cảm ơn ạ': 'Thank you', 'mình cảm ơn': 'Thank you', 'tôi cảm ơn': 'Thank you', 'cảm ơn bạn nhé': 'Thank you',
  'cảm ơn bạn nha': 'Thank you', 'cảm ơn nhé': 'Thanks', 'cảm ơn nha': 'Thanks',
  'không có gì': 'No problem', 'vâng': 'Yes', 'dạ': 'Yes', 'dạ vâng': 'Yes', 'vâng ạ': 'Yes', 'không': 'No',
  'dạ vâng ạ': 'Yes', 'có ạ': 'Yes', 'dạ có': 'Yes', 'dạ có ạ': 'Yes', 'dạ không': 'No', 'không ạ': 'No',
  'dạ không ạ': 'No', 'chưa': 'Not yet', 'chưa ạ': 'Not yet', 'dạ chưa': 'Not yet', 'dạ chưa ạ': 'Not yet',
  // A lone 'Rồi' is most often the YES to '…chưa?' ("sent the contract yet?"): "OK" would read as "OK, I will".
  'được': 'OK', 'được ạ': 'OK', 'được rồi': 'OK', 'đc': 'OK', 'rồi': 'Yes', 'rồi ạ': 'Yes', 'dạ được': 'Yes, sure',
  'dạ được ạ': 'Yes, sure', 'ok ạ': 'OK', 'ok nha': 'OK', 'ok nhé': 'OK', 'oke ạ': 'OK', 'oke nha': 'OK',
  'oke nhé': 'OK', 'ừ nha': 'OK', 'ừ nhé': 'OK', 'xong': 'Done', 'xong rồi': 'Done', 'chốt': 'Deal',
  'chốt nhé': "It's a deal", 'không có gì ạ': 'No problem', 'không sao ạ': 'No problem',
  'tạm biệt': 'Goodbye', 'hẹn gặp lại': 'See you later', 'xin lỗi': 'Sorry', 'không sao': 'No problem',
  'tạm biệt nhé': 'Goodbye', 'hẹn mai nhé': 'See you tomorrow', 'mai gặp nhé': 'See you tomorrow',
  'mai nhé': 'Tomorrow, then', 'mai nha': 'Tomorrow, then', 'xin lỗi ạ': 'Sorry', 'xin lỗi nhé': 'Sorry',
  'em xin lỗi': 'Sorry', 'mình xin lỗi': 'Sorry', 'chúc mừng': 'Congratulations',
  'không sao đâu': 'No problem', 'còn phòng không': 'Is the room still available?', 'phòng còn trống không': 'Is the room still available?',
  'còn phòng không ạ': 'Is the room still available?', 'còn không': 'Is it still available?', 'còn hàng không': 'Is it still available?',
  'còn không ạ': 'Is it still available?', 'bao nhiêu tiền': 'How much is it?', 'giá bao nhiêu': 'How much is it?',
  'còn hàng không ạ': 'Is it still available?', 'bao nhiêu': 'How much?', 'bao nhiêu ạ': 'How much is it?',
  'giá bao nhiêu ạ': 'How much is it?', 'bao nhiêu tiền ạ': 'How much is it?', 'có ship không': 'Do you deliver?',
  'có ship không ạ': 'Do you deliver?', 'địa chỉ ở đâu': 'What is the address?',
  'địa chỉ ở đâu ạ': 'What is the address?', 'ở đâu': 'Where?',
  'bạn ở đâu': 'Where are you?', 'anh ở đâu': 'Where are you?', 'chị ở đâu': 'Where are you?', 'em ở đâu': 'Where are you?',
  'tôi hiểu rồi': 'I understand', 'em hiểu rồi': 'I understand', 'mình hiểu rồi': 'I understand', 'hiểu rồi': 'Understood',
  'được không': 'Is that OK?', 'đúng rồi': "That's right", 'mấy giờ': 'What time?', 'lúc mấy giờ': 'What time?',
  'đợi chút': 'One moment, please', 'đợi xíu': 'One moment, please', 'đợi tí': 'One moment, please',
  'chờ chút': 'One moment, please', 'chờ xíu': 'One moment, please', 'chờ tí': 'One moment, please',
  'chờ chút nha': 'One moment, please', 'chờ chút nhé': 'One moment, please', 'đợi em chút': 'One moment, please',
  'chờ em chút': 'One moment, please', 'đợi mình chút': 'One moment, please', 'chờ mình chút': 'One moment, please',
  // 'hả' only with its marks (MARKED_ONLY): bare, 'ha' is a laugh — see the bare-form note above.
  'hả': 'Huh?',
  // 'Sao vậy?' answers news ("I can't come tomorrow") as often as a mood: "What's wrong?" assumes the mood.
  'sao vậy': 'What happened?', 'sao thế': 'What happened?', 'gì vậy': 'What is it?', 'gì thế': 'What is it?',
  'ủa': 'Huh?', 'thật hả': 'Really?', 'thật không': 'Really?', 'thật à': 'Really?',
  // Usually typed 'Vậy à?': "Oh, I see" would come back "Oh, I see?" — "Oh, really?" reads right either way.
  'vậy à': 'Oh, really?', 'thế à': 'Oh, really?', 'vậy hả': 'Oh, really?',
  'cho em hỏi': 'Can I ask something?', 'cho mình hỏi': 'Can I ask something?', 'cho tôi hỏi': 'Can I ask something?',
  'cho em hỏi chút': 'Can I ask something?', 'cho mình hỏi chút': 'Can I ask something?',
  'cho em hỏi với': 'Can I ask something?', 'cho mình hỏi với': 'Can I ask something?',
  'cho em hỏi xíu': 'Can I ask something?', 'cho mình hỏi xíu': 'Can I ask something?',
}
// Keys as phraseKey reads them: lower case, no apostrophes ('whats up' is "What's up?").
export const EN_VI_PHRASES: Readonly<Record<string, string>> = {
  'how are you': 'Bạn khỏe không?', 'thank you': 'Cảm ơn bạn', 'thanks': 'Cảm ơn bạn', 'thank you so much': 'Cảm ơn bạn rất nhiều',
  'thank you very much': 'Cảm ơn bạn rất nhiều', 'thanks a lot': 'Cảm ơn bạn rất nhiều', 'ok thanks': 'Vâng, cảm ơn bạn',
  'thanks so much': 'Cảm ơn bạn rất nhiều', 'many thanks': 'Cảm ơn bạn rất nhiều', 'no thanks': 'Không, cảm ơn bạn',
  'my pleasure': 'Không có gì',
  'youre welcome': 'Không có gì', 'yes': 'Vâng', 'no': 'Không', 'sorry': 'Xin lỗi', 'no problem': 'Không sao',
  'yeah': 'Vâng', 'sure': 'Được chứ', 'sure thing': 'Được chứ', 'of course': 'Tất nhiên rồi', 'nice': 'Tuyệt quá',
  'sounds good': 'Được đấy', 'sounds great': 'Tuyệt vời', 'i agree': 'Tôi đồng ý', 'agreed': 'Đồng ý',
  'good luck': 'Chúc may mắn', 'congratulations': 'Chúc mừng bạn', 'congrats': 'Chúc mừng bạn',
  'good morning': 'Chào buổi sáng', 'good afternoon': 'Chào buổi chiều', 'good evening': 'Chào buổi tối',
  'hey': 'Chào bạn', 'hey there': 'Chào bạn', 'hi there': 'Chào bạn', 'hello there': 'Xin chào',
  // Alone, 'Morning' answers "when can you view it?" as often as it greets: the time of day reads right as both.
  'morning': 'Buổi sáng', 'evening': 'Buổi tối',
  // Mostly the answer to being called ('Anh ơi' — "Hi"): "Yes? What is it?" — not "How have you been lately?".
  'whats up': 'Có gì không bạn?',
  'hows it going': 'Dạo này thế nào?', 'how is it going': 'Dạo này thế nào?', 'how are you doing': 'Bạn khỏe không?',
  // 'I'm good' is as often a polite no ("Need delivery?") and 'Good, thanks!' a thank-you for a job done: ổn / tốt
  // read both ways, khỏe (in good health) only as the answer to "How are you?".
  'im fine': 'Tôi ổn', 'im good': 'Tôi ổn', 'fine thanks': 'Ổn, cảm ơn bạn',
  'good thanks': 'Tốt, cảm ơn bạn', 'and you': 'Còn bạn thì sao?',
  'good night': 'Chúc ngủ ngon', 'goodbye': 'Tạm biệt', 'see you later': 'Hẹn gặp lại', 'see you tomorrow': 'Hẹn gặp bạn ngày mai',
  'see you': 'Hẹn gặp lại', 'see ya': 'Hẹn gặp lại', 'see you soon': 'Hẹn sớm gặp lại',
  'see you then': 'Hẹn gặp bạn lúc đó nhé', 'talk soon': 'Nói chuyện sau nhé', 'talk to you later': 'Nói chuyện sau nhé',
  'take care': 'Giữ gìn sức khỏe nhé',
  'have a nice day': 'Chúc bạn một ngày tốt lành', 'have a good day': 'Chúc bạn một ngày tốt lành',
  'have a good weekend': 'Chúc bạn cuối tuần vui vẻ',
  'is it still available': 'Còn không ạ?', 'is the room still available': 'Phòng còn trống không?',
  'how much is it': 'Giá bao nhiêu?', 'where are you': 'Bạn đang ở đâu?', 'i understand': 'Tôi hiểu rồi',
  'what time': 'Mấy giờ?', 'great': 'Tuyệt vời', 'perfect': 'Tuyệt vời', 'nice to meet you': 'Rất vui được gặp bạn',
  'wait': 'Chờ chút nhé', 'hold on': 'Chờ chút nhé', 'one sec': 'Chờ một chút', 'one second': 'Chờ một chút',
  'one moment': 'Chờ một chút', 'just a moment': 'Chờ một chút', 'done': 'Xong rồi', 'all done': 'Xong hết rồi',
  'on my way': 'Tôi đang đến', 'im on my way': 'Tôi đang đến', 'be right there': 'Tôi đến ngay',
  'call me': 'Gọi cho tôi nhé', 'any update': 'Có tin gì mới không?', 'any news': 'Có tin gì mới không?',
  'are you there': 'Bạn có đó không?', 'where': 'Ở đâu?',
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

// Matched only as written with marks — see the bare-form note above.
const MARKED_ONLY = new Set(['rồi ạ', 'hả', 'ủa'])
const VI_MARKED = new Map(Object.entries(VI_EN_PHRASES).map(([k, v]) => [markedKey(k), v]))
const VI_BARE = new Map(
  Object.entries(VI_EN_PHRASES).filter(([k]) => !MARKED_ONLY.has(k)).map(([k, v]) => [phraseKey(k), v]),
)
const EN_MAP = new Map(Object.entries(EN_VI_PHRASES).map(([k, v]) => [phraseKey(k), v]))

// Emoji and symbols at the end ride along: 'good 👍' must not come back as just the word.
const TRAILING_SYMBOLS = /[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+$/u
// The line asks: a '?' (or a full-width '？') in its closing punctuation, before any emoji — 'Chốt?', 'Done?!'.
const ASKS = /[?？][\p{P}\s]*$/u
// Asked, these are not their statement with a '?' (see the question note above), so they go to the model.
const NAMES_SPEAKER = /^(?:I\b|Tôi\s)/u
const ASKS_SOMETHING_ELSE = new Set(['rồi', 'rồi ạ'].flatMap((k) => [markedKey(k), phraseKey(k)]))

/** A fixed translation of `text` from `source` into `target`, or undefined. Vietnamese ⇄ English only. */
export function phrasebook(text: string, source: string, target: string): string | undefined {
  // Composed first: typed with combining marks, 'Rơi' (R o ◌̛ i) has no letter VI_MARK knows and was read as 'rồi'.
  const line = text.normalize('NFC')
  const marked = source === 'vi' && VI_MARK.test(line)
  const key = marked ? markedKey(line) : phraseKey(line)
  let hit: string | undefined
  if (source === 'vi' && target === 'en') hit = (marked ? VI_MARKED : VI_BARE).get(key)
  else if (source === 'en' && target === 'vi') hit = EN_MAP.get(key)
  if (!hit) return undefined
  const tail = line.match(TRAILING_SYMBOLS)?.[0] ?? ''
  if (ASKS.test(line.slice(0, line.length - tail.length)) && !hit.endsWith('?')) {
    if (NAMES_SPEAKER.test(hit) || ASKS_SOMETHING_ELSE.has(key)) return undefined
    hit += '?'
  }
  return tail.trim() ? `${hit} ${tail.trim()}` : hit
}
