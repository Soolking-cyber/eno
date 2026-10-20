import { describe, expect, it } from 'vitest'
import { detectChatLang } from './chat-lang'
import { EN_VI_PHRASES, markedKey, phrasebook, phraseKey, VI_EN_PHRASES } from './chat-phrasebook'

describe('phrasebook — the lines the model gets wrong are looked up', () => {
  it.each([
    ['Bạn khỏe không', 'How are you?'], // the model: "You are well."
    ['ban khoe khong', 'How are you?'],
    ['Xin chào', 'Hello'], // the model: "Hello to"
    ['Dạ', 'Yes'], // the model: "and"
    ['còn phòng không?', 'Is the room still available?'], // the model: "There is room."
    ['Cảm ơn bạn nhiều!', 'Thank you very much'],
  ])('vi %s → %s', (vi, en) => expect(phrasebook(vi, 'vi', 'en')).toBe(en))

  it.each([
    ['How are you?', 'Bạn khỏe không?'],
    ['Thank you so much!', 'Cảm ơn bạn rất nhiều'],
    ["You're welcome", 'Không có gì'],
    ['Is the room still available?', 'Phòng còn trống không?'],
  ])('en %s → %s', (en, vi) => expect(phrasebook(en, 'en', 'vi')).toBe(vi))

  it('looks up whole lines only, and only Vietnamese ⇄ English', () => {
    expect(phrasebook('Bạn khỏe không, phòng còn không', 'vi', 'en')).toBeUndefined()
    expect(phrasebook('Xin chào', 'vi', 'ko')).toBeUndefined()
  })

  it('one key for every way of writing a line', () => {
    expect(phraseKey('CẢM ƠN BẠN!!')).toBe('cam on ban')
    expect(phraseKey("you're  welcome :)")).toBe('youre welcome')
  })
})


describe('marks are meaning — a line written with them is matched with them', () => {
  it.each(['Vàng', 'Đã', 'Đá', 'Dâu'])('%s is not "Yes" or anything else', (vi) => expect(phrasebook(vi, 'vi', 'en')).toBeUndefined())
  it('both tone-placement styles are one entry', () => {
    expect(phrasebook('Bạn khoẻ không', 'vi', 'en')).toBe('How are you?')
    expect(markedKey('Khoẻ')).toBe(markedKey('Khỏe'))
  })
  it('a line typed with no marks at all still finds its phrase', () => {
    expect(phrasebook('da vang', 'vi', 'en')).toBe('Yes')
  })
  it('trailing emoji ride along', () => {
    expect(phrasebook('thank you 🙏', 'en', 'vi')).toBe('Cảm ơn bạn 🙏')
  })
  // The new phrases' look-alikes: a marked line is its own word, never the phrase it shares a bare form with.
  it.each([
    ['Rơi', 'rồi'], ['Chùa', 'chưa'], ['Đuốc', 'được'], ['Chột', 'chốt'], ['Khoé', 'khỏe'], ['Tuyết', 'tuyệt'],
    ['Cho chút', 'chờ chút'], ['Mái nhà', 'mai nha'], ['Hà', 'hả'],
  ])('%s is not %s', (vi) => expect(phrasebook(vi, 'vi', 'en')).toBeUndefined())
  // Typed with COMBINING marks (a decomposed 'Rơi' is R o ◌̛ i — some keyboards, pasted text), still its own word:
  // read as unmarked, 'Rơi' (fell) came back "OK" and 'Chùa' (pagoda) "Not yet" (review, 2026-10-21).
  it.each(['Rơi', 'Chùa', 'Tuyết', 'Xông', 'Mái nhà', 'Có à', 'Rồi à', 'Chột', 'Khoé', 'Vàng'])(
    'decomposed, %s is still not a phrase',
    (vi) => expect(phrasebook(vi.normalize('NFD'), 'vi', 'en')).toBeUndefined(),
  )
  it('a decomposed phrase still finds itself', () => {
    expect(phrasebook('Chốt'.normalize('NFD'), 'vi', 'en')).toBe('Deal')
    expect(phrasebook('Rồi ạ'.normalize('NFD'), 'vi', 'en')).toBe('Yes') // marked-only: never found bare
  })
})


// What the live box model answered on 2026-10-21 (157 short lines through the whole pipeline) is in the comments.
describe('the short lines the model got wrong on the live box are looked up', () => {
  it.each([
    ['Cảm ơn ạ', 'Thank you'], // the model: "thanks to"
    ['cam on a', 'Thank you'],
    ['Cám ơn!', 'Thank you'],
    ['Em cảm ơn ạ 🙏', 'Thank you 🙏'], // the model: "I thank you."
    ['Chị ơi', 'Hi'], // the model: "My sister."
    ['Anh ơi', 'Hi'], // the model: "brother"
    ['ban oi', 'Hi'],
    ['Dạ em chào chị', 'Hello'], // the model: "I greet you."
    ['Cho em hỏi', 'Can I ask something?'], // the model: "ask me to ask."
    ['Cho mình hỏi chút', 'Can I ask something?'], // the model: "Ask me a little."
    ['cho em hoi', 'Can I ask something?'],
    ['Đợi chút', 'One moment, please'], // the model: "Wait a little."
    ['CHỜ XÍU', 'One moment, please'], // the model: "Waiting for a little."
    ['Mai nhé!', 'Tomorrow, then'], // the model: "tomorrow to"
    ['Sao vậy?', 'What happened?'], // the model: "What about?"
    ['Gì vậy?', 'What is it?'], // the model: "What is?"
    ['sao vay?', 'What happened?'],
    ['Thật hả?', 'Really?'], // the model: "is true?"
    ['Vậy à.', 'Oh, really?'], // the model: "So is"
    ['Vậy à?', 'Oh, really?'],
    ['Ủa?', 'Huh?'], // the model: "The"
    ['Hả?', 'Huh?'], // the model: "and?"
    ['hả', 'Huh?'],
    ['Ok nha 👍', 'OK 👍'], // the model: "OK to"
    ['Dạ được', 'Yes, sure'], // the model: "can be"
    ['Được!', 'OK'], // the model: "well"
    ['duoc', 'OK'],
    ['Rồi.', 'Yes'], // the model: "and then"
    ['roi', 'Yes'],
    ['dc', 'OK'],
    ['Khoẻ', 'Fine'], // the model: "well" — and the old-style tone placement
    ['Tốt!', 'Good'], // the model: "good good"
    ['tot', 'Good'],
    ['Ở đâu?', 'Where?'], // the model: "Where is?"
    ['bao nhieu', 'How much?'], // the model: "How many"
    ['Bao nhiêu?', 'How much?'],
    ['A lô', 'Hello'], // the model: "A to"
    ['Có ship không ạ?', 'Do you deliver?'],
    ['Xong rồi!', 'Done'],
    ['Chốt nhé', "It's a deal"],
  ])('vi %s → %s', (vi, en) => expect(phrasebook(vi, 'vi', 'en')).toBe(en))

  it.each([
    ['hey', 'Chào bạn'], // the model: "hhhhhhhh…" — refused, then re-run six times in 90 s
    ['Hey!', 'Chào bạn'], // the model: "Hạ !"
    ['Hey 👋', 'Chào bạn 👋'], // the model, for "Hey": "☆ ☆ ☆"
    ['hey there', 'Chào bạn'], // the model: "Hạ ơi"
    ['Hi there!', 'Chào bạn'], // the model: "Hi Hi Đâu"
    ["What's up?", 'Có gì không bạn?'], // the model: "cái gì lên"
    ['whats up', 'Có gì không bạn?'], // the model: "whats lên"
    ['How’s it going?', 'Dạo này thế nào?'],
    ['Morning!', 'Buổi sáng'], // the model: "Sáng sớm"
    ['See you', 'Hẹn gặp lại'], // the model: "Xem bạn"
    ['see ya!', 'Hẹn gặp lại'], // the model: "xem có"
    ['Sure!', 'Được chứ'], // the model: "chắc chắn !"
    ['nice', 'Tuyệt quá'], // the model: "đẹp"
    ['Yeah', 'Vâng'], // the model: "Có"
    ['How are you doing?', 'Bạn khỏe không?'], // the model: "Bạn làm thế nào?"
    ["I'm fine", 'Tôi ổn'], // the model: "Tôi ổn"
    ['Fine, thanks', 'Ổn, cảm ơn bạn'], // the model: "Cảm ơn tốt"
    ['Are you there?', 'Bạn có đó không?'],
    ['any update?', 'Có tin gì mới không?'], // the model: "Update nào?"
    ['Call me', 'Gọi cho tôi nhé'], // the model: "gọi tôi"
    ['Wait.', 'Chờ chút nhé'], // the model: "chờ đợi"
    ['one sec', 'Chờ một chút'], // the model: "1 sec"
    ['On my way!', 'Tôi đang đến'], // the model: "Trên con đường của tôi"
    ["I'm on my way 🚗", 'Tôi đang đến 🚗'],
    ['Done.', 'Xong rồi'], // the model: "làm"
    ['Sounds good!', 'Được đấy'], // the model: "nghe tốt"
    ['Where?', 'Ở đâu?'], // the model: "đâu rồi?"
    ['Have a nice day!', 'Chúc bạn một ngày tốt lành'],
    ['THANKS SO MUCH', 'Cảm ơn bạn rất nhiều'],
  ])('en %s → %s', (en, vi) => expect(phrasebook(en, 'en', 'vi')).toBe(vi))
})


// The lookup reads no punctuation, so before this every statement also answered its line typed as a question:
// 'Chốt?' (deal?) showed "Deal" — agreement to a price that was only asked about (review, 2026-10-21).
describe('a line typed as a question gets a question', () => {
  it.each([
    ['Chốt?', 'Deal?'], ['Chốt? 🤝', 'Deal? 🤝'], ['Chốt？', 'Deal?'], ['Chốt ?', 'Deal?'], ['Chốt?!', 'Deal?'],
    ['Được?', 'OK?'], ['duoc?', 'OK?'], ['Xong rồi?', 'Done?'], ['Chưa?', 'Not yet?'], ['Dạ?', 'Yes?'],
    ['Hiểu rồi?', 'Understood?'], ['Khỏe?', 'Fine?'], ['khoe?', 'Fine?'], ['Khỏe ạ?', 'Fine?'],
    ['Sao vậy?', 'What happened?'], ['Bạn khỏe không?', 'How are you?'], // already questions: as they are
  ])('vi %s → %s', (vi, en) => expect(phrasebook(vi, 'vi', 'en')).toBe(en))

  it.each([
    ['Done?', 'Xong rồi?'], ['Agreed?', 'Đồng ý?'], ['Sure?', 'Được chứ?'], ['Sounds good?', 'Được đấy?'],
    ['Call me?', 'Gọi cho tôi nhé?'], ['Morning?', 'Buổi sáng?'], ['Good, thanks?', 'Tốt, cảm ơn bạn?'],
  ])('en %s → %s', (en, vi) => expect(phrasebook(en, 'en', 'vi')).toBe(vi))

  // Asked, these are not their statement: 'Em khỏe?' / 'Mình khỏe?' ask "are YOU well?" — "I'm fine?" turns it
  // around — and 'Rồi?' asks "and then?" / "already?". They go to the model.
  it.each(['Em khỏe?', 'Mình khỏe?', 'Em khỏe ạ?', 'Em hiểu rồi?', 'Rồi?', 'roi?', 'Rồi ạ?'])(
    'vi %s → the model',
    (vi) => expect(phrasebook(vi, 'vi', 'en')).toBeUndefined(),
  )
  it.each(["I'm fine?", "I'm good?", 'I agree?', 'Be right there?'])('en %s → the model', (en) => {
    expect(phrasebook(en, 'en', 'vi')).toBeUndefined()
  })

  it('no phrase in either table answers its line typed as a question with a statement', () => {
    const asked = (line: string, source: string, target: string) => [line, phrasebook(`${line}?`, source, target)]
    const vi = Object.keys(VI_EN_PHRASES).flatMap((k) => [asked(k, 'vi', 'en'), asked(phraseKey(k), 'vi', 'en')])
    const en = Object.keys(EN_VI_PHRASES).map((k) => asked(k, 'en', 'vi'))
    expect([...vi, ...en].filter(([, hit]) => hit !== undefined && !hit.endsWith('?'))).toEqual([])
  })
})


// A fixed answer must be right for every way the line is used — it is shown with no model to weigh the context.
describe('an answer holds for every reading of its line', () => {
  it.each([
    ['Rồi', 'Yes'], // "sent the contract yet?" — "Rồi": yes, already. "OK" reads as "OK, I will".
    ['Rồi ạ', 'Yes'],
    ['Khỏe ạ', 'Fine'], // "How is your son?" — "Khỏe ạ": he is, not "I'm fine"
    ['Sao vậy?', 'What happened?'], // "I can't come tomorrow" — "Sao vậy?": why, not "What's wrong?"
  ])('vi %s → %s', (vi, en) => expect(phrasebook(vi, 'vi', 'en')).toBe(en))

  it("typed bare, 'roi a' is rồi à (Already?) as much as rồi ạ: it goes to the model, as the restorer reads it", () => {
    expect(phrasebook('roi a', 'vi', 'en')).toBeUndefined()
    expect(phrasebook('roi a?', 'vi', 'en')).toBeUndefined()
  })

  // Also được à (is that OK?), but the restorer reads được ạ: the model would be sent the same statement (see the note).
  it.each([['duoc a', 'OK'], ['duoc a?', 'OK?'], ['khong a', 'No'], ['khong a?', 'No?']])(
    "typed bare, '%s' is answered as the restorer reads it → %s",
    (bare, en) => expect(phrasebook(bare, 'vi', 'en')).toBe(en),
  )

  it.each([
    ['Evening', 'Buổi tối'], // "mornings or evenings?" — a time, not "Chào buổi tối" (good evening)
    ['Morning', 'Buổi sáng'],
    ['Good evening', 'Chào buổi tối'], // the greeting, only ever one
    ["I'm good", 'Tôi ổn'], // "Need delivery?" — "I'm good": a polite no, not "Tôi khỏe" (I'm in good health)
    ['Good, thanks!', 'Tốt, cảm ơn bạn'], // "I've emailed the contract" — "Good, thanks!"
    ["What's up?", 'Có gì không bạn?'], // "Anh ơi" — "What's up?": yes, what is it — not a catch-up question
    ['See you then', 'Hẹn gặp bạn lúc đó nhé'], // a time just agreed — not just "see you again"
  ])('en %s → %s', (en, vi) => expect(phrasebook(en, 'en', 'vi')).toBe(vi))
})


describe('the tables stay unambiguous', () => {
  it('phrases that share a bare form mean the same — a line typed without marks cannot tell them apart', () => {
    const byBare = new Map<string, string[]>()
    for (const k of Object.keys(VI_EN_PHRASES)) byBare.set(phraseKey(k), [...(byBare.get(phraseKey(k)) ?? []), k])
    const clashes = [...byBare.values()].filter((ks) => new Set(ks.map((k) => VI_EN_PHRASES[k])).size > 1)
    expect(clashes).toEqual([])
  })

  it('every phrase is written the way the lookup reads it, once', () => {
    const vi = Object.keys(VI_EN_PHRASES)
    expect(vi.filter((k) => markedKey(k) !== k)).toEqual([]) // lower case, NFC, new-style tone placement
    const en = Object.keys(EN_VI_PHRASES)
    expect(en.filter((k) => phraseKey(k) !== k)).toEqual([]) // lower case, no apostrophe or punctuation
    expect(new Set(en.map(phraseKey)).size).toBe(en.length)
  })

  it.each([
    ["What's up?", 'whats up'], ['How’s it going?', 'hows it going'], ["I'm fine", 'im fine'],
    ["I'm on my way!", 'im on my way'], ["You're welcome", 'youre welcome'],
  ])('an English writer types %s — the key %s', (typed, key) => {
    expect(phraseKey(typed)).toBe(key)
    expect(EN_VI_PHRASES[key]).toBeDefined()
  })

  // One-word bare forms the detector names Vietnamese, reviewed one by one: each is Vietnamese typed without its
  // marks, never an English chat word. 'ha' is not here — a laugh in both languages — so 'hả' is matched only marked.
  const VI_AS_TYPED = new Set(['vang', 'da', 'khong', 'duoc', 'dc', 'roi', 'tot', 'tuyet', 'chua'])
  const oneWordBare = [...new Set(Object.keys(VI_EN_PHRASES).map(phraseKey))].filter((b) => /^[a-z]+$/.test(b))
  it.each(oneWordBare)('a lone "%s" reaches the Vietnamese table only if it is Vietnamese typed bare', (bare) => {
    expect(detectChatLang(bare).lang !== 'vi' || phrasebook(bare, 'vi', 'en') === undefined || VI_AS_TYPED.has(bare)).toBe(true)
  })

  it.each([
    ['ha', undefined], // a laugh, and the detector names it Vietnamese: not "Huh?"
    ['tot', 'Good'], ['roi', 'Yes'], ['chua', 'Not yet'], ['duoc', 'OK'], ['dc', 'OK'],
    ['alo', 'Hello'], ['xong', 'Done'], // the detector leaves a lone one undecided today; right if it ever names it
  ])('a lone "%s" → %s', (bare, en) => expect(phrasebook(bare, 'vi', 'en')).toBe(en))

  it('a lone "ua" is not "Huh?": ủa (huh?) and ừa (yeah) are both typed ua', () => {
    expect(phrasebook('ua', 'vi', 'en')).toBeUndefined() // marked-only
    expect(detectChatLang('ua').lang).not.toBe('vi') // and undecided as well
  })
})
