import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BIO_MAX_WORDS, acceptTeacherBio, teacherBioRequest, ungroundedClaims } from '@/lib/teachers/bio-context'
import { importTextRefused } from '@/lib/teachers/import-map'
import { ABOUT_WORDS_FLOOR, wordCount } from '@/lib/teachers/search-floor'

// "Improve with AI" on the About text (owner, 2026-10-21) — the pure halves, on the real modules: WHAT the model is sent
// (the form's answers read field by field into English "Label: value" lines, the teacher's own text minus contact
// details — and nothing the notice says never leaves), what a claim in the answer may rest on, and when the answer is a
// bio Publish accepts. The call itself: bio-ai.test.ts; the wire: api/teachers/me/bio-rewrite/route.test.ts.

/** Every answer the form holds — including each one the request must NEVER carry (name, phone, media, pay, start, cover, opt-ins). */
const FULL = {
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: '', currentProvince: '', jobTypes: ['fulltime', 'private'], relocate: 'some',
  teachAreas: ['ho-chi-minh-city', 'online', 'ha-noi'], teachAreasConfirmed: true,
  availableFrom: '2026-12-01', expectedSalaryM: 47,
  subjects: ['ielts', 'general-english', 'other-language'], teachLanguages: ['Korean'], ageGroups: ['teens', 'adults'], experienceBand: '5-10-years',
  experience: [{ role: 'IELTS Teacher', employer: 'ILA Vietnam', city: 'Ho Chi Minh City', from: '2019-01', to: '' }],
  degreeLevel: 'master', degreeMajor: 'Applied Linguistics', degreeInstitution: 'University of Leeds', degreeYear: 2015,
  certificates: [
    { type: 'celta', hours: 120, provider: 'International House', year: 2016 },
    { type: 'other-cert', hours: null, provider: '', year: null },
    { type: 'teaching-license', hours: null, provider: '', year: null },
  ],
  fullName: 'Thomas Reed', nationality: 'GB', englishLevel: 'native', languages: ['French', 'Vietnamese'], headline: 'IELTS & Business English teacher',
  bio: 'I have taught IELTS since 2019 and I love it.',
  coverOpen: true, coverSlots: ['mon-am', 'sat-pm'], coverRateVnd: 350_000, coverConsent: true,
  photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/thomas-photo.webp',
  videoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/thomas-intro.mp4', videoOnRequest: true,
  phone: '+84 901 234 567', matchEmailOptIn: true, staffContactOptIn: true,
}

/** A part-time kids' teacher in Hanoi — the answers the answer-side tests rest on. */
const KIDS = {
  livesIn: 'city', currentCity: 'ha-noi', jobTypes: ['parttime'], teachAreas: ['ha-noi'], teachAreasConfirmed: true,
  subjects: ['general-english'], ageGroups: ['kids'], experienceBand: '3-5-years',
  experience: [{ role: 'English Teacher', employer: 'Apax English', city: 'Hanoi', from: '2021-03', to: '' }],
  degreeLevel: 'bachelor', degreeMajor: 'Education', degreeInstitution: '', degreeYear: null,
  certificates: [{ type: 'tefl', hours: 120, provider: '', year: null }],
  nationality: 'GB', englishLevel: 'native', languages: [], headline: 'TEFL-certified teacher for kids',
  bio: 'I teach kids with games and songs, and I love phonics.',
}
/** A clean, grounded answer for KIDS — 64 words, two paragraphs. */
const GOOD = 'I teach General English to young children in Hanoi, and I hold a TEFL certificate with 120 hours of training. At Apax English I use games, songs and phonics to keep my lessons active and easy to follow.\n\n'
  + 'I have a Bachelor’s degree in Education. I am looking for part-time work in Hanoi, with classes for kids in small groups or at a centre.'
/** Nothing answered, a few words of the teacher's own: what an unbacked claim is checked against. */
const BARE = teacherBioRequest({ teachAreas: [], bio: 'I teach kids.' }).grounds

// "Now" decides a job's computed years ("from 2019-01 to now") — frozen, or the expectations age out by themselves.
beforeEach(() => { vi.setSystemTime(new Date('2026-10-21T03:00:00Z')) })
afterEach(() => { vi.useRealTimers() })

describe('teacherBioRequest — what the model is sent', () => {
  it('every answer as its ENGLISH label, field by field: subjects (a taught language named), ages, band, jobs, degree, certificates, nationality, levels, places, work, headline', () => {
    expect(teacherBioRequest(FULL).facts).toEqual([
      'Subjects: General English, IELTS, Korean (as a language)',
      'Age groups: Teens, Adults',
      'Teaching experience: 5–10 years',
      'Teaching job: IELTS Teacher at ILA Vietnam, Ho Chi Minh City, from 2019-01 to now',
      "Degree: Master's, Applied Linguistics, University of Leeds, 2015",
      'Certificate: CELTA, 120 hours, International House, 2016',
      'Certificate: another teaching certificate',
      'Certificate: a teaching licence',
      'Nationality: United Kingdom',
      'English: native speaker',
      'Other languages spoken: French, Vietnamese',
      'Lives in: Ho Chi Minh City',
      'Can teach in: Online, Ho Chi Minh City',
      'Would move to: Hanoi',
      'Looking for: Full-time, Private tutoring',
      'Headline: IELTS & Business English teacher',
    ])
  })

  it('⛔ NEVER the name, the phone, the photo or video, the salary, the start month, the cover lessons or an opt-in — whatever the body carries', () => {
    const r = teacherBioRequest(FULL)
    const sent = JSON.stringify({ facts: r.facts, ownBio: r.ownBio })
    expect(sent).not.toMatch(/Thomas|Reed|\+84|901|234 567|thomas-photo|thomas-intro|\.webp|\.mp4|47|2026-12|December|350|mon-am|sat-pm|cover|opt.?in|consent|email/i)
    // …nor what a claim may rest on: a salary is never a number the answer may state.
    for (const n of ['47', '350000', '901', '234', '567', '84']) expect(r.grounds.numbers.has(n)).toBe(false)
    // Only these lines, ever — an allowlist, not a denylist.
    const LABELS = ['Subjects', 'Age groups', 'Teaching experience', 'Teaching job', 'Degree', 'Certificate', 'Nationality', 'English', 'Other languages spoken', 'Lives in', 'Lives outside Vietnam', 'Can teach in', 'Would move to', 'Looking for', 'Headline']
    for (const f of r.facts) expect(LABELS).toContain(f.split(':')[0])
  })

  it('normalised as a save keeps it: an answer to a question the other answers hide is never sent (the English level of a Korean-only teacher; a part-timer’s salary)', () => {
    const r = teacherBioRequest({
      livesIn: 'city', currentCity: 'ha-noi', jobTypes: ['parttime'], teachAreas: ['ha-noi', 'online'], expectedSalaryM: 35, availableFrom: '2026-11-01',
      subjects: ['other-language'], teachLanguages: ['Korean'], englishLevel: 'native', bio: 'Tôi dạy tiếng Hàn cho người lớn.',
    })
    expect(r.facts).toEqual(['Subjects: Korean (as a language)', 'Lives in: Hanoi', 'Can teach in: Online, Hanoi', 'Looking for: Part-time'])
    expect(r.grounds.native).toBe(false) // the dropped English answer grounds no "native English speaker" either
    expect(r.grounds.numbers.has('35')).toBe(false)
  })

  it('a teacher abroad is "outside Vietnam" — never a place they do not live in; "no degree" sends no degree line', () => {
    expect(teacherBioRequest({ livesIn: 'abroad', relocate: 'online-only', teachAreas: ['online'], subjects: ['general-english'], degreeLevel: 'no-degree', degreeMajor: 'Maths', bio: 'Hello there.' }).facts)
      .toEqual(['Subjects: General English', 'Lives outside Vietnam', 'Can teach in: Online'])
  })

  it('⛔ a free text with contact details is dropped, field by field — an email in an employer, a phone in a role, a link, a handle, a headline; a job with nothing left is skipped', () => {
    const r = teacherBioRequest({
      teachAreas: [],
      experience: [
        { role: 'Teacher, call 0901 234 567', employer: 'VUS', city: 'Ho Chi Minh City', from: '2020-02', to: '2022-06' },
        { role: 'Tutor', employer: 'mail tutor@example.com', city: '', from: '', to: '' },
        { role: 'zalo 0912345678', employer: 'see https://x.example', city: 'Hanoi', from: '2018-01', to: '2019-01' },
      ],
      degreeLevel: 'bachelor', degreeMajor: 'English', degreeInstitution: 'Hanoi University, www.hanu.vn',
      certificates: [{ type: 'tesol', hours: 140, provider: '@tesol_vn', year: 2021 }],
      headline: 'Teacher - book me at me@example.com',
      bio: 'Hello there.',
    })
    expect(r.facts).toEqual([
      'Teaching job: VUS, Ho Chi Minh City, from 2020-02 to 2022-06',
      'Teaching job: Tutor',
      'Degree: Bachelor\'s, English',
      'Certificate: TESOL, 140 hours, 2021',
    ])
  })

  it('⛔ the teacher’s own text goes AS WRITTEN — minus every sentence with an email, a link, a Zalo id or a phone-length run of digits', () => {
    const own = 'Tôi dạy từ năm 2016, năm 2019 chuyển sang luyện thi IELTS. Email: co.lan@example.com cho tôi. Xem thêm tại https://example.com/lan nhé. '
      + 'Zalo: lan.ielts88. Gọi 0901234567 nhé. Tôi thích dạy học sinh cấp 3.'
    expect(teacherBioRequest({ teachAreas: [], bio: own }).ownBio).toBe('Tôi dạy từ năm 2016, năm 2019 chuyển sang luyện thi IELTS. Tôi thích dạy học sinh cấp 3.')
    // …which Publish's own screen would NOT keep ("năm" is also five: its phone reader sees a number) — why the way in
    // screens contact details alone, and the ANSWER gets the whole screen (acceptTeacherBio).
    expect(importTextRefused('Tôi dạy từ năm 2016, năm 2019 chuyển sang luyện thi IELTS.')).toBe(true)
    // Nothing left is an empty text, never a hole in one.
    expect(teacherBioRequest({ teachAreas: [], bio: 'Zalo me on 0901 234 567.' }).ownBio).toBe('')
  })

  it('⛔ …and what publish-guard\'s reader does not know: a .vn / .edu.vn domain, a t.me link, a messenger with a handle after a space, Skype (gate review, 2026-10-21)', () => {
    const kept = 'I teach IELTS to adults.'
    for (const leak of [
      'More about me at thomasenglish.vn.', 'Book a lesson at thomas-ielts.edu.vn.', 'Telegram t.me/thomasreed for lessons.',
      'Add me on WhatsApp thomasreed88.', 'Skype: live:thomas.reed.',
    ]) expect(teacherBioRequest({ teachAreas: [], bio: `${kept} ${leak}` }).ownBio, leak).toBe(kept)
    // An ordinary sentence with a dotted word or a messenger's NAME alone stays.
    expect(teacherBioRequest({ teachAreas: [], bio: 'I use Facebook. I have a B.Ed. and teach e.g. phonics.' }).ownBio).toBe('I use Facebook. I have a B.Ed. and teach e.g. phonics.')
  })

  it('⛔ a span of years is never a phone number — "VUS 2016-2019 (3 years)" stays, and a run across a sentence end no longer cuts every sentence after it; a phone still goes (gate review, opus 2026-10-22)', () => {
    for (const s of ['I taught at VUS 2016-2019 (3 years).', 'IELTS 8.0 (2019 - 2020) with adults.', 'I taught ages 6-12 (2019-2021) at ILA.', 'TOEIC 990 (2019-2021) and IELTS 8.5.'])
      expect(teacherBioRequest({ teachAreas: [], bio: s }).ownBio, s).toBe(s)
    const four = 'I taught at VUS 2016-2019. 3 years were with teenagers. I love phonics. I teach online too.'
    expect(teacherBioRequest({ teachAreas: [], bio: four }).ownBio).toBe(four)
    for (const leak of ['Call 0901 234 567 for lessons.', 'Call (+84) 901-234-567.', 'Phone: 0901.234.567.', 'Call 0912 2019 88 after six.'])
      expect(teacherBioRequest({ teachAreas: [], bio: `I teach IELTS. ${leak}` }).ownBio, leak).toBe('I teach IELTS.')
  })

  it('⛔ a missing space after a full stop is a typo, not a domain — "kids.Online", "English.Me" stay; a domain still goes (gate review, opus 2026-10-22)', () => {
    for (const s of ['I teach kids.Online classes too.', 'I love English.Me and my students sing songs.'])
      expect(teacherBioRequest({ teachAreas: [], bio: s }).ownBio, s).toBe(s)
    expect(teacherBioRequest({ teachAreas: [], bio: 'I teach IELTS. See Thomas-IELTS.edu.vn for more.' }).ownBio).toBe('I teach IELTS.')
  })
})

describe('teacherBioRequest — what a claim may rest on', () => {
  it('every number the input states, one spelling each — and the years a job’s own dates make, as of now', () => {
    const n = teacherBioRequest(FULL).grounds.numbers
    for (const x of ['5', '10', '2019', '1', '2015', '120', '2016']) expect(n.has(x)).toBe(true)
    // From 2019-01 to now, in October 2026: 7 years, or 8 counted inclusively.
    expect(n.has('7')).toBe(true)
    expect(n.has('8')).toBe(true)
    vi.setSystemTime(new Date('2027-03-01T03:00:00Z'))
    const later = teacherBioRequest(FULL).grounds.numbers
    expect(later.has('8')).toBe(true)
    expect(later.has('9')).toBe(true)
  })

  it('the number words of the teacher’s own text count — "two" and "hai" are 2', () => {
    expect([...teacherBioRequest({ teachAreas: [], bio: 'I have taught for two years.' }).grounds.numbers]).toEqual(['2'])
    expect(teacherBioRequest({ teachAreas: [], bio: 'Tôi đã dạy được hai năm.' }).grounds.numbers.has('2')).toBe(true)
  })

  it('"native", a degree and "certified" are the teacher’s to claim — from an answer, or from their own words', () => {
    expect(teacherBioRequest(KIDS).grounds).toMatchObject({ native: true, degree: true, certified: true })
    expect(BARE).toMatchObject({ native: false, degree: false, certified: false })
    expect(teacherBioRequest({ teachAreas: [], bio: 'I am a native speaker of English with a BA in History.' }).grounds).toMatchObject({ native: true, degree: true })
    expect(teacherBioRequest({ teachAreas: [], bio: 'Tôi có chứng chỉ TESOL.' }).grounds.certified).toBe(true)
  })

  it('⛔ "non-native", "not a native speaker", "không phải người bản ngữ" ground no "native" — a teacher who says they are one still does (gate review, opus 2026-10-22)', () => {
    for (const own of ["I'm a non-native speaker with C2 English.", 'I am not a native speaker, but I hold IELTS 8.5.', 'Tôi không phải người bản ngữ nhưng có IELTS 8.0.', 'As a nonnative teacher I know the traps.'])
      expect(teacherBioRequest({ teachAreas: [], bio: own }).grounds.native, own).toBe(false)
    expect(teacherBioRequest({ teachAreas: [], bio: 'I am a native speaker from Leeds.' }).grounds.native).toBe(true)
    // A bare "native" is no claim about English: it grounds none (gate review, opus 2026-10-22).
    for (const own of ['I teach native Vietnamese kids.', 'My native language is Korean.']) expect(teacherBioRequest({ teachAreas: [], bio: own }).grounds.native, own).toBe(false)
    expect(teacherBioRequest({ teachAreas: [], bio: 'Tôi là người bản ngữ.' }).grounds.native).toBe(true)
  })
})

describe('ungroundedClaims — what the answer states that the input does not', () => {
  it('a certificate or exam named only in the answer — in any case', () => {
    expect(ungroundedClaims('I hold a CELTA.', BARE)).toEqual(['named'])
    expect(ungroundedClaims('I hold a Celta.', BARE)).toEqual(['named'])
    const kids = teacherBioRequest(KIDS).grounds
    expect(ungroundedClaims('I hold a TEFL certificate.', kids)).toEqual([])
    expect(ungroundedClaims('I hold a TEFL and a CELTA.', kids)).toEqual(['named'])
  })

  it('DELTA the certificate — never the Mekong Delta', () => {
    expect(ungroundedClaims('I live in the Mekong Delta.', BARE)).toEqual([])
    expect(ungroundedClaims('I hold the DELTA.', BARE)).toEqual(['delta'])
    expect(ungroundedClaims('I have a Delta qualification.', BARE)).toEqual(['delta'])
    const delta = teacherBioRequest({ teachAreas: [], certificates: [{ type: 'delta', hours: null, provider: '', year: null }], bio: 'Hello there.' }).grounds
    expect(ungroundedClaims('I hold the DELTA.', delta)).toEqual([])
  })

  it('"native English speaker" needs the English answer "native" or the teacher’s own "native" — "native Korean speaker" is no claim about English', () => {
    expect(ungroundedClaims('I am a native English speaker.', BARE)).toEqual(['native'])
    expect(ungroundedClaims('I am a native English speaker.', teacherBioRequest(KIDS).grounds)).toEqual([])
    expect(ungroundedClaims('I am a native English speaker.', teacherBioRequest({ teachAreas: [], bio: 'I am a native speaker.' }).grounds)).toEqual([])
    expect(ungroundedClaims('I am a native Korean speaker.', BARE)).toEqual([])
    // "Non-native" in the answer is no claim — and one in the input grounds none (gate review, opus 2026-10-22).
    const nonNative = teacherBioRequest({ teachAreas: [], bio: "I'm a non-native speaker with C2 English." }).grounds
    expect(ungroundedClaims('I am a native English speaker.', nonNative)).toEqual(['native'])
    expect(ungroundedClaims('As a non-native English speaker, I know where learners get stuck.', nonNative)).toEqual([])
  })

  it('a degree — "Bachelor’s degree", "MA", "thạc sĩ" — needs one in the input', () => {
    for (const claim of ['I have a Bachelor’s degree.', "I have a Bachelor's degree.", 'I have an MA.', 'Tôi có bằng thạc sĩ.']) {
      expect(ungroundedClaims(claim, BARE)).toEqual(['degree'])
      expect(ungroundedClaims(claim, teacherBioRequest(KIDS).grounds)).toEqual([])
    }
  })

  it('"certified" needs a certificate', () => {
    expect(ungroundedClaims('I am a certified teacher.', BARE)).toEqual(['certified'])
    expect(ungroundedClaims('I am a certified teacher.', teacherBioRequest(KIDS).grounds)).toEqual([])
  })

  it('a number the input does not state — but "IELTS 8.0" when it says 8.0 (one spelling per number: 8 and 8.0 are one)', () => {
    expect(ungroundedClaims('I have taught 300 students.', BARE)).toEqual(['number'])
    const ielts = teacherBioRequest({ teachAreas: [], bio: 'My IELTS score is 8.0 overall.' }).grounds
    expect(ungroundedClaims('I scored IELTS 8.0.', ielts)).toEqual([])
    expect(ungroundedClaims('I scored IELTS 8.', ielts)).toEqual([])
    expect(ungroundedClaims('I scored IELTS 8.5.', ielts)).toEqual(['number'])
  })

  it('a thousands-grouped number is ONE number — "2,000" / "2.000" / "2000" grounded both ways; an invented "5,000" is not (gate review, 2026-10-21)', () => {
    const many = teacherBioRequest({ teachAreas: [], bio: 'I have helped more than 2000 students.' }).grounds
    for (const said of ['more than 2,000 students', 'more than 2.000 students', 'more than 2000 students', 'hơn 2.000 học viên']) expect(ungroundedClaims(`I have taught ${said}.`, many), said).toEqual([])
    expect(ungroundedClaims('I have taught more than 5,000 lessons and 10,000 hours.', many)).toEqual(['number'])
    // A decimal stays a decimal: 7,5 is 7.5, never 75 or 7500.
    const band = teacherBioRequest({ teachAreas: [], bio: 'IELTS 7,5 overall.' }).grounds
    expect(ungroundedClaims('My IELTS score is 7.5.', band)).toEqual([])
  })

  it('a number WORD in the answer is a number too — "over ten years" for a 3–5 year teacher; never "one-to-one", "năm" or "hai"', () => {
    const kids = teacherBioRequest(KIDS).grounds
    expect(ungroundedClaims('I have over ten years of experience.', kids)).toEqual(['number'])
    expect(ungroundedClaims('Tôi có hơn mười năm kinh nghiệm.', kids)).toEqual(['number'])
    expect(ungroundedClaims('I teach three to five classes a week.', kids)).toEqual([])
    expect(ungroundedClaims('I give one-to-one feedback, one of my favourite parts of teaching.', kids)).toEqual([])
    expect(ungroundedClaims('Tôi dạy ở Hai Bà Trưng hai năm nay.', kids)).toEqual([])
  })

  it('a job the model was not shown (nothing left of it after the contact screen) grounds no computed years; a certificate row with no type grounds no "certified"', () => {
    const g = teacherBioRequest({ teachAreas: [], experience: [{ role: 'mail me at a@b.com', employer: 'zalo: x.y.z', city: '', from: '2010-01', to: '' }], certificates: [{ type: '', hours: null, provider: '', year: null }], bio: 'I teach kids.' }).grounds
    expect(ungroundedClaims('I have taught for 16 years.', g)).toEqual(['number'])
    expect(ungroundedClaims('I am a certified teacher.', g)).toEqual(['certified'])
  })
})

describe('acceptTeacherBio — the answer as a bio Publish accepts, or why it is not one', () => {
  const kids = teacherBioRequest(KIDS)

  it('a clean, grounded answer of about 60 words → ok, unchanged — paragraphs kept', () => {
    expect(wordCount(GOOD)).toBe(64)
    expect(acceptTeacherBio(GOOD, kids)).toEqual({ ok: true, bio: GOOD })
  })

  it('markdown, list markers and HTML entities are cleaned to plain text (the page prints the bio as typed)', () => {
    const v = acceptTeacherBio('**I teach** General English to young children in Hanoi &amp; I hold a TEFL certificate with 120 hours of training.\n\n'
      + '- At Apax English I use games, songs and phonics to keep lessons active.\n* I have a Bachelor&#39;s degree in Education.\n• I am looking for part-time work in Hanoi.', kids)
    expect(v).toEqual({
      ok: true,
      bio: 'I teach General English to young children in Hanoi & I hold a TEFL certificate with 120 hours of training.\n\n'
        + 'At Apax English I use games, songs and phonics to keep lessons active. I have a Bachelor\'s degree in Education. I am looking for part-time work in Hanoi.',
    })
  })

  it('⛔ a sentence Publish would refuse — a phone, a visa — is dropped and the rest kept', () => {
    const flat = GOOD.replace('\n\n', ' ')
    expect(acceptTeacherBio(`${flat} Call me on 0901 234 567 any time.`, kids)).toEqual({ ok: true, bio: flat })
    expect(acceptTeacherBio(`${flat} I already have a work visa.`, kids)).toEqual({ ok: true, bio: flat })
    // …and when nothing is left, there is no bio.
    expect(acceptTeacherBio('Call me on 0901 234 567.', kids)).toEqual({ ok: false, reason: 'empty' })
  })

  it('a placeholder — a bracketed slot, a template brace, the data block’s own headings echoed', () => {
    for (const text of [GOOD.replace('in Hanoi,', 'in [city],'), `${GOOD} Ask for {name}.`, `PROFILE ANSWERS: ${GOOD}`, GOOD.replace('I have a', 'OWN ABOUT TEXT: I have a'), `TEACHER DATA ${GOOD}`]) {
      expect(acceptTeacherBio(text, kids)).toEqual({ ok: false, reason: 'placeholder' })
    }
  })

  it('under the search floor is thin; past BIO_MAX_WORDS is long — asked again, never cut', () => {
    const thin = 'I teach General English to young children in Hanoi.'
    expect(wordCount(thin)).toBeLessThan(ABOUT_WORDS_FLOOR)
    expect(acceptTeacherBio(thin, kids)).toEqual({ ok: false, reason: 'thin' })
    const long = Array.from({ length: 4 }, () => GOOD).join('\n\n')
    expect(wordCount(long)).toBeGreaterThan(BIO_MAX_WORDS)
    expect(acceptTeacherBio(long, kids)).toEqual({ ok: false, reason: 'long' })
    // …and past LIMITS.bio in characters, under the word cap (long words): refused, never cut to fit (gate review, 2026-10-22).
    const wide = `${GOOD} ${'Internationalisation-certificated '.repeat(60).trim()}.`
    expect(wordCount(wide)).toBeLessThan(BIO_MAX_WORDS)
    expect(wide.length).toBeGreaterThan(2_000)
    expect(acceptTeacherBio(wide, kids)).toEqual({ ok: false, reason: 'long' })
  })

  it('⛔ the teacher’s own text handed back — whatever its spacing, case or punctuation — is no rewrite → same (gate review, codex 2026-10-22)', () => {
    const own = teacherBioRequest({ ...KIDS, bio: GOOD })
    expect(acceptTeacherBio(GOOD, own)).toEqual({ ok: false, reason: 'same' })
    expect(acceptTeacherBio(GOOD.replace(/\. /g, '.  ').toLowerCase(), own)).toEqual({ ok: false, reason: 'same' })
    // A word changed is a rewrite.
    expect(acceptTeacherBio(GOOD.replace('I teach', 'Today I teach'), own).ok).toBe(true)
  })

  it('a Vietnamese answer passes as an English one does — and loses only what Publish would refuse (a list of years: "năm" is also five)', () => {
    const vi = teacherBioRequest({ ...KIDS, bio: 'Tôi dạy trẻ em bằng trò chơi và bài hát, và tôi thích phonics.' })
    const answer = 'Tôi dạy tiếng Anh tổng quát cho trẻ em ở Hà Nội và có chứng chỉ TEFL 120 giờ. Tại Apax English, tôi dùng trò chơi, bài hát và phonics để giờ học sinh động, dễ theo dõi.\n\n'
      + 'Tôi có bằng cử nhân ngành Giáo dục. Tôi đang tìm việc bán thời gian ở Hà Nội, dạy lớp nhỏ hoặc tại trung tâm.'
    expect(acceptTeacherBio(answer, vi)).toEqual({ ok: true, bio: answer })
    expect(acceptTeacherBio(`${answer} Tôi dạy từ năm 2021, năm 2023 chuyển sang lớp nhỏ.`, vi)).toEqual({ ok: true, bio: answer })
  })

  it('a claim the input does not support → ungrounded', () => {
    expect(acceptTeacherBio(GOOD.replace('120 hours', '150 hours'), kids)).toEqual({ ok: false, reason: 'ungrounded' })
    expect(acceptTeacherBio(GOOD.replace('a TEFL certificate', 'a CELTA certificate'), kids)).toEqual({ ok: false, reason: 'ungrounded' })
  })
})
