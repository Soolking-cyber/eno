import { describe, expect, it } from 'vitest'
import { teacherRefusedWords, teacherTextRefusal } from './text-screen'
import { teacherVisaMention } from './visa-mention'

// Owner, 2026-10-21: a teacher in Hội An was refused three times — "contains a word we do not allow" — with no way to
// know which word, and published his complaint as his bio. The fix SHOWS the words; the decision stays EXACTLY the one it
// was (commit gate, codex + opus, four rounds: every narrowing tried opened a publishable path).

describe('teacherTextRefusal — ⛔ the decision it always was', () => {
  const bio = (s: string) => teacherTextRefusal('bio', s)
  it('a visa mention, every spelling and typo — one accent elsewhere changes nothing', () => {
    for (const s of [
      'I hold a valid work visa.', 'Business visa until March.', 'Need e-visa help?', 'v.i.s.a sponsorship', 'Visa-sponsored role wanted', '#visa',
      'Tôi cần xin thị thực lao động.', 'xin thị thực ra sao', 'can xin thi thuc lao dong', 'Tôi hướng dẫn xin thi thuc ra sao cho giáo viên',
      'Mình ở Đà Nẵng, hỗ trợ xin thi thuc lao động', 'Based in Hội An, can arrange thi thuc', 'xin thị thức lao động', 'hỗ trợ thí thực', 'can thi thuc ra nhanh',
      'Мне нужна виза.', 'Помогаю с визами.', 'Помогаю с визаранами в Камбоджу.', 'Делаю визаран.', '비자 문제 상담', '비자발급 도와드려요', '我需要工作签证。', '需要簽證', 'ビザ申請',
    ]) expect(bio(s), s).toBe('banned_words')
  })
  it('illegal goods on the folded letters — unaccented, accented, or wrongly accented', () => {
    for (const s of [
      'I sell cocaine', 'I sell heroin', 'escort services available', 'I provide money laundering services', 'RELX pods for sale', 'vape juice cheap',
      'ban ma tuy', 'chat no gia re', 'bang lai gia', 'the cao lau', 'bán ma túy', 'bán ma tuý', 'chất nổ giá rẻ', 'chât nô', 'thẻ cào lậu',
    ]) expect(bio(s), s).toBe('banned_words')
  })
  it('⛔ a NAME is screened like every other text: contact details, banned words, a visa', () => {
    expect(teacherTextRefusal('fullName', 'jane@example.com')).toBe('contact_in_name')
    expect(teacherTextRefusal('fullName', 'Jane 0901 234 567')).toBe('contact_in_name')
    for (const n of ['Visa Help Vietnam', 'Thị Thực Express', 'Cocaine Plug']) expect(teacherTextRefusal('fullName', n), n).toBe('banned_words')
  })
  it('contact details', () => {
    expect(bio('Call me on 0901 234 567')).toBe('contact_in_text')
    expect(bio('Email me: jane@example.com')).toBe('contact_in_text')
  })
  it('what never held a term still passes', () => {
    for (const s of ['TESOL qualified Native English speaker available now in Hoi An, full or part time.', 'I love Hoi An and its cao lầu.', 'Western Visayas',
      'improvisation', 'advisable', 'escorted', 'methodology', 'siêu thị thực phẩm']) expect(bio(s), s).toBeNull()
  })
})

describe('teacherVisaMention — unchanged', () => {
  it('never what it was written to let through', () => {
    for (const s of ['Western Visayas', 'Visayas State University', 'Visakha Sharma', 'Revisa Academy', 'siêu thị thực phẩm']) expect(teacherVisaMention(s), s).toBe(false)
  })
})

describe('teacherRefusedWords — the teacher\'s OWN words, as typed', () => {
  it('points at the refused words, never the whole text', () => {
    expect(teacherRefusedWords('banned_words', ['I hold a valid work visa and a TRC, so I can start now.'])).toEqual(['visa'])
    expect(teacherRefusedWords('banned_words', ['Tôi cần xin thị thực lao động.'])).toEqual(['thị thực'])
    expect(teacherRefusedWords('banned_words', ['Thẻ cào lậu giá rẻ'])).toEqual(['Thẻ cào lậu'])
  })
  it('⛔ the refusals a teacher may find wrong are the ones they most need to see', () => {
    expect(teacherRefusedWords('banned_words', ['My favourite dish is the cao lau from Hoi An.'])).toEqual(['the cao lau'])
    expect(teacherRefusedWords('banned_words', ['My classes are relaxed: we can chat no problem about anything.'])).toEqual(['chat no'])
    expect(teacherRefusedWords('banned_words', ['I am happy to escort students on school trips.'])).toEqual(['escort'])
    expect(teacherRefusedWords('banned_words', ['Nếu bạn đam mê tiếng Anh, hãy học cùng mình.'])).toEqual(['bạn đam'])
    expect(teacherRefusedWords('banned_words', ['Tiền gia sư được tính theo buổi.'])).toEqual(['Tiền gia'])
    expect(teacherRefusedWords('banned_words', ['Luyện đề thi thực tế mỗi tuần.'])).toEqual(['thi thực'])
    // A misreading the visa screen has always made (unchanged — narrowing it opened visa paths, review rounds 2-3): shown,
    // and a name gets the human route (steps/shared.tsx).
    expect(teacherRefusedWords('banned_words', ['Nguyễn Thị Thục Anh'])).toEqual(['Thị Thục'])
    // …and a word that only HOLDS a visa word: "импровизацию" (improvisation) holds "виза" — the whole word is shown.
    expect(teacherRefusedWords('banned_words', ['Преподаю английский через импровизацию и игры.'])).toEqual(['импровизацию'])
  })
  it('each word it shows is in the text, and taking them out clears it', () => {
    for (const [code, text] of [
      ['banned_words', 'Experienced teacher. I hold a valid business visa until March. Available now.'],
      ['banned_words', "I don't smoke or vape, and I'm always on time."],
      ['contact_in_text', 'Message me on WhatsApp +44 7700 900123 any time.'],
      ['contact_in_text', 'Write to jane.doe@example.com for a trial lesson.'],
    ] as const) {
      const words = teacherRefusedWords(code, [text])
      expect(words.length, text).toBeGreaterThan(0)
      let rest: string = text
      for (const w of words) { expect(text, w).toContain(w); rest = rest.replace(w, ' ') }
      expect(teacherTextRefusal('bio', rest), rest).toBeNull()
    }
  })
  it('a job row: the words of the part that trips, from role, employer and city', () => {
    expect(teacherRefusedWords('banned_words', ['English teacher', 'Visa help desk', 'Hanoi'])).toEqual(['Visa'])
  })
  it('nothing to point at: no words, and the form keeps its general line', () => {
    expect(teacherRefusedWords('banned_words', ['I teach young learners.'])).toEqual([])
    expect(teacherRefusedWords('required', ['visa'])).toEqual([])
    expect(teacherRefusedWords(undefined, ['visa'])).toEqual([])
  })
})
