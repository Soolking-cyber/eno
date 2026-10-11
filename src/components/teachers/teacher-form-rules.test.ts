/**
 * The teacher form's own derivations (teacher-form-rules.ts): one answer re-deriving the next, what an edit would drop,
 * the headline suggestion, and the teacher.eno.vn hand-off — table-tested here, drawn by the steps.
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_TEACHER, normalizeTeacherInput, type TeacherInput } from '@/lib/teachers/profile'
import {
  CAMPAIGN_TAG_MAX, DRAFT_FIELDS, campaignQuery, decodeHandoff, draftPart, draftResumeStep, droppedAnswers, encodeHandoff, handoffPart,
  mergeReview, nothingToSave, HANDOFF_FIELDS, forDraft, homeDefaultAreas, nextMonths, startChoice,
  suggestHeadline, withJobTypes, withRelocate, withSituation,
} from './teacher-form-rules'

const base = (o: Partial<TeacherInput> = {}): TeacherInput => ({ ...EMPTY_TEACHER, ...o })
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')

describe('the home pre-selection (homeDefaultAreas)', () => {
  it('a city → that city; HCMC → "Anywhere in HCMC"; somewhere else → the province; abroad → nothing', () => {
    expect(homeDefaultAreas({ livesIn: 'city', currentCity: 'ha-noi', currentProvince: '', currentDistrictKey: '' })).toEqual(['ha-noi'])
    expect(homeDefaultAreas({ livesIn: 'city', currentCity: 'ho-chi-minh-city', currentProvince: '', currentDistrictKey: 'd7' })).toEqual(['ho-chi-minh-city'])
    expect(homeDefaultAreas({ livesIn: 'elsewhere', currentCity: '', currentProvince: '52', currentDistrictKey: '' })).toEqual(['p-52'])
    expect(homeDefaultAreas({ livesIn: 'abroad', currentCity: '', currentProvince: '', currentDistrictKey: '' })).toEqual([])
  })
  it('came for cover: HCMC opens on the home district (or nothing to pre-select without one)', () => {
    expect(homeDefaultAreas({ livesIn: 'city', currentCity: 'ho-chi-minh-city', currentProvince: '', currentDistrictKey: 'd7' }, true)).toEqual(['d7'])
    expect(homeDefaultAreas({ livesIn: 'city', currentCity: 'ho-chi-minh-city', currentProvince: '', currentDistrictKey: '' }, true)).toEqual([])
    expect(homeDefaultAreas({ livesIn: 'city', currentCity: 'ha-noi', currentProvince: '', currentDistrictKey: '' }, true)).toEqual(['ha-noi'])
  })
})

describe('withSituation — a new answer to "Where are you now?"', () => {
  it('the first answer pre-selects the home, UNCONFIRMED', () => {
    const t = withSituation(base(), { livesIn: 'city', currentCity: 'ha-noi' })
    expect(t).toMatchObject({ livesIn: 'city', currentCity: 'ha-noi', teachAreas: ['ha-noi'], teachAreasConfirmed: false })
  })
  it('the first answer KEEPS what an old draft carried (pruned by the answer), plus the pre-selection', () => {
    const t = withSituation(base({ teachAreas: ['online', 'da-nang', 'ha-noi'], jobTypes: ['fulltime'] }), { livesIn: 'city', currentCity: 'ha-noi' })
    expect(t.teachAreas).toEqual(['online', 'ha-noi', 'da-nang']) // a full-time seeker may list another city
    const tutor = withSituation(base({ teachAreas: ['online', 'da-nang'], jobTypes: ['private'] }), { livesIn: 'city', currentCity: 'ha-noi' })
    expect(tutor.teachAreas).toEqual(['online', 'ha-noi']) // a private tutor works where they live
  })
  it('a NEW home re-derives the list (Online kept), unconfirmed, and asks "Would you move?" again', () => {
    const before = withRelocate(withSituation(base({ jobTypes: ['fulltime'] }), { livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7' }), 'some')
    const picked = { ...before, teachAreas: ['online', 'd7', 'ha-noi'], teachAreasConfirmed: true }
    const moved = withSituation(picked, { livesIn: 'city', currentCity: 'da-nang' })
    expect(moved).toMatchObject({ currentCity: 'da-nang', currentDistrictKey: '', teachAreas: ['online', 'da-nang'], teachAreasConfirmed: false, relocate: '' })
  })
  it('the parts the answer does not ask go: a district outside HCMC, a province when not "somewhere else"', () => {
    const t = withSituation(base({ livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7' }), { livesIn: 'elsewhere', currentProvince: '52' })
    expect(t).toMatchObject({ currentCity: '', currentDistrictKey: '', currentProvince: '52', teachAreas: ['p-52'] })
    expect(withSituation(t, { livesIn: 'abroad' })).toMatchObject({ currentProvince: '', teachAreas: [] })
  })
  it('only the HCMC district changing moves an UNTOUCHED cover pre-selection with it — never a confirmed list', () => {
    const t = withSituation(base(), { livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7' }, true)
    expect(t.teachAreas).toEqual(['d7'])
    expect(withSituation(t, { currentDistrictKey: 'd1' }, true).teachAreas).toEqual(['d1'])
    expect(withSituation({ ...t, teachAreasConfirmed: true }, { currentDistrictKey: 'd1' }, true).teachAreas).toEqual(['d7'])
  })

  it('came for cover, the chip FIRST and the district after (as the form asks them): the district is pre-selected', () => {
    const chip = withSituation(base(), { livesIn: 'city', currentCity: 'ho-chi-minh-city' }, true)
    expect(chip.teachAreas).toEqual([])
    expect(withSituation(chip, { currentDistrictKey: 'd7' }, true).teachAreas).toEqual(['d7'])
    // Online picked meanwhile stays, and the district joins it.
    expect(withSituation({ ...chip, teachAreas: ['online'] }, { currentDistrictKey: 'd7' }, true).teachAreas).toEqual(['online', 'd7'])
    // A list the teacher confirmed (or edited, which confirms it) never takes the district.
    expect(withSituation({ ...chip, teachAreasConfirmed: true }, { currentDistrictKey: 'd7' }, true).teachAreas).toEqual([])
  })
})

describe('withJobTypes / withRelocate', () => {
  const hcmcSeeker = () => withSituation(base({ jobTypes: ['fulltime'] }), { livesIn: 'city', currentCity: 'ho-chi-minh-city' })
  it('dropping the last full-/part-time job type takes the move answer and the places away from home', () => {
    const t = { ...withRelocate(hcmcSeeker(), 'some'), teachAreas: ['ho-chi-minh-city', 'ha-noi'] }
    expect(withJobTypes(t, ['private'])).toMatchObject({ jobTypes: ['private'], relocate: '', teachAreas: ['ho-chi-minh-city'] })
    expect(withJobTypes(t, ['fulltime', 'parttime']).teachAreas).toEqual(['ho-chi-minh-city', 'ha-noi'])
  })
  it('"No" takes other cities away; "Anywhere" is one key standing for all of them; "Online only" IS the list', () => {
    const some = { ...withRelocate(hcmcSeeker(), 'some'), teachAreas: ['online', 'ho-chi-minh-city', 'ha-noi', 'da-nang'] }
    expect(withRelocate(some, 'no').teachAreas).toEqual(['online', 'ho-chi-minh-city'])
    expect(withRelocate(some, 'anywhere').teachAreas).toEqual(['online', 'ho-chi-minh-city', 'anywhere'])
    expect(withRelocate(withRelocate(some, 'anywhere'), 'some').teachAreas).toEqual(['online', 'ho-chi-minh-city'])
    const abroad = withSituation(base({ jobTypes: ['private'] }), { livesIn: 'abroad' })
    expect(withRelocate(abroad, 'online-only').teachAreas).toEqual(['online'])
  })
})

describe('droppedAnswers — what an edit would throw away', () => {
  const saved = normalizeTeacherInput({
    ...base(), livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', jobTypes: ['fulltime'], relocate: 'no',
    teachAreas: ['d7', 'd4'], teachAreasConfirmed: true, expectedSalaryM: 30, availableFrom: '2026-11-01',
    subjects: ['general-english', 'other-language'], teachLanguages: ['Korean'], englishLevel: 'native',
    coverOpen: true, coverConsent: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, matchEmailOptIn: true,
  })
  it('removing Full-time: the salary and the start month (and the opt-ins, with no job goal left)', () => {
    expect(droppedAnswers(saved, withJobTypes(saved, []))).toEqual({ fields: ['expectedSalaryM', 'availableFrom', 'optIns'], places: [] })
    expect(droppedAnswers(saved, withJobTypes(saved, ['parttime'])).fields).toEqual(['expectedSalaryM'])
  })
  it('moving abroad: the district, cover and the home places', () => {
    const d = droppedAnswers(saved, withSituation(saved, { livesIn: 'abroad' }))
    expect(d.fields).toEqual(expect.arrayContaining(['currentDistrictKey', 'cover']))
    expect(d.places).toEqual(['d4', 'd7'])
  })
  it('a subject that hid a question: the taught languages; no English-medium subject left: the English level', () => {
    expect(droppedAnswers(saved, { ...saved, subjects: ['general-english'] }).fields).toEqual(['teachLanguages'])
    expect(droppedAnswers(saved, { ...saved, subjects: ['other-language'] }).fields).toEqual(['englishLevel'])
  })
  it('a change that drops nothing reports nothing', () => {
    expect(droppedAnswers(saved, withJobTypes(saved, ['fulltime', 'parttime']))).toEqual({ fields: [], places: [] })
  })
})

describe('the headline suggestion', () => {
  it('from step 3: the best certificate, up to two subjects, the experience', () => {
    expect(suggestHeadline({ subjects: ['ielts', 'general-english'], teachLanguages: [], certificates: [{ type: 'tefl', hours: null, provider: '', year: null }, { type: 'celta', hours: null, provider: '', year: null }], experienceBand: '5-10-years' }, 'en'))
      .toBe('CELTA-certified IELTS & General English teacher · 5–10 years')
    expect(suggestHeadline({ subjects: ['other-language'], teachLanguages: ['Korean'], certificates: [], experienceBand: null }, 'en')).toBe('Korean teacher')
    expect(suggestHeadline({ subjects: ['ielts'], teachLanguages: [], certificates: [], experienceBand: '1-3-years' }, 'vi')).toBe('Giáo viên IELTS · 1–3 năm')
  })
  it('nothing to suggest without a subject', () => {
    expect(suggestHeadline({ subjects: [], teachLanguages: [], certificates: [], experienceBand: '1-3-years' }, 'en')).toBe('')
  })
})

describe('the teacher.eno.vn hand-off (#d=)', () => {
  const full = normalizeTeacherInput({
    ...base(), livesIn: 'city', currentCity: 'ha-noi', jobTypes: ['parttime'], relocate: 'no', teachAreas: ['ha-noi'], teachAreasConfirmed: true,
    subjects: ['ielts'], ageGroups: ['adults'], experienceBand: '1-3-years', fullName: 'Jane', nationality: 'GB', englishLevel: 'native',
    headline: 'IELTS teacher in Hanoi', phone: '+84901234567', photoUrl: 'https://x/p.webp', coverOpen: true, coverConsent: true,
    coverSlots: ['mon-am'], coverRateVnd: 300_000, matchEmailOptIn: true, staffContactOptIn: true,
  })
  it('v2 carries the fields of the step the host shows only — ⛔ never what a tab kept behind it, a consent, the cover, a phone or an upload — and round-trips', () => {
    const value = encodeHandoff(full)
    const raw = JSON.parse(Buffer.from(value, 'base64url').toString())
    expect(raw.v).toBe(2)
    // the v2 shape (every draft field), the steps the host does not show EMPTY
    expect(Object.keys(raw.t).sort()).toEqual([...DRAFT_FIELDS].sort())
    for (const k of DRAFT_FIELDS) if (!HANDOFF_FIELDS.includes(k)) expect(raw.t[k]).toEqual(EMPTY_TEACHER[k])
    expect(raw.t.fullName).toBe('') // a previous visitor's name on a shared tab (commit gate, round 10)
    const back = decodeHandoff(value)!
    for (const k of HANDOFF_FIELDS) expect(back[k]).toEqual(full[k])
    expect(back).toMatchObject({ fullName: '', bio: '', phone: '', photoUrl: null, coverOpen: false, coverConsent: false, coverSlots: [], matchEmailOptIn: false, staffContactOptIn: false })
  })
  it('⛔ a four-step v2 fragment (a host tab opened before, or a crafted link) is READ as step 1 — never a name or a bio', () => {
    const back = decodeHandoff(b64({ v: 2, t: draftPart(full) }))!
    for (const k of HANDOFF_FIELDS) expect(back[k]).toEqual(full[k])
    expect(back).toMatchObject({ fullName: '', headline: '', bio: '', subjects: [] })
  })
  it('⛔ a CRAFTED v2 fragment carrying consents arrives without them', () => {
    const back = decodeHandoff(b64({ v: 2, t: { ...full, situationVersion: 9, teachAreasConfirmedAt: 'x' } }))!
    expect(back).toMatchObject({ coverOpen: false, coverConsent: false, matchEmailOptIn: false, staffContactOptIn: false, phone: '', photoUrl: null })
  })
  it('a v1 fragment (the old TeacherInput) is mapped at the boundary; garbage is null', () => {
    const v1 = { currentCity: 'ha-noi', preferredCities: ['ha-noi', 'da-nang'], openToOnline: true, nativeSpeaker: true, yearsExperience: 2, coverConsent: true, fullName: 'Jane' }
    // mapped at the boundary, then step 1 only: the teaching areas it implies, never the name or the old answers behind it
    expect(decodeHandoff(b64(v1))).toMatchObject({ livesIn: null, teachAreas: ['online', 'ha-noi', 'da-nang'], englishLevel: EMPTY_TEACHER.englishLevel, experienceBand: EMPTY_TEACHER.experienceBand, coverConsent: false, fullName: '' })
    expect(decodeHandoff('%%%')).toBeNull()
    expect(decodeHandoff(b64([1, 2]))).toBeNull()
  })
  it('a draft never keeps an upload, the cover switch or a consent — the periods and rate stay', () => {
    expect(forDraft(full)).toMatchObject({ photoUrl: null, videoUrl: null, coverOpen: false, coverConsent: false, matchEmailOptIn: false, staffContactOptIn: false, coverSlots: ['mon-am'], coverRateVnd: 300_000, phone: '+84901234567' })
  })
})

describe('the campaign tags the hand-off carries (campaignQuery)', () => {
  it('⛔ carries the three tags attribution.ts reads — and nothing else in the address', () => {
    expect(campaignQuery('?utm_content=reel_v3&utm_campaign=teacher_profiles&fbclid=IwAR0x&utm_medium=paid_social&gclid=g1&utm_source=meta&utm_term=t&utm_id=1&utm_source_platform=x&step=about&d=abc'))
      .toBe('?utm_source=meta&utm_medium=paid_social&utm_campaign=teacher_profiles')
  })
  it('no tags: no query at all, so the address stays exactly /teachers/join#d=…', () => {
    expect(campaignQuery('')).toBe('')
    expect(campaignQuery('?fbclid=IwAR0x&step=about&utm_content=x')).toBe('')
    expect(campaignQuery('?utm_source=&utm_medium=%20')).toBe('')
  })
  it('the first value of each, trimmed, and encoded — a crafted address cannot inject a fragment or a second parameter', () => {
    expect(campaignQuery('?utm_source=a&utm_source=b')).toBe('?utm_source=a')
    expect(campaignQuery('?utm_campaign=%20spring%20')).toBe('?utm_campaign=spring')
    expect(campaignQuery('?utm_source=' + encodeURIComponent('a#d=evil&step=finish'))).toBe('?utm_source=a%23d%3Devil%26step%3Dfinish')
    expect(campaignQuery('?UTM_SOURCE=a&utm_Source=b')).toBe('')
  })
  it('⛔ bounded however it is encoded: a value that serializes past the cap is dropped, never cut — plain, non-Latin or reserved', () => {
    expect(campaignQuery(`?utm_campaign=${'x'.repeat(CAMPAIGN_TAG_MAX)}&utm_source=meta`)).toBe('?utm_source=meta')
    const worst = ['é'.repeat(100), '日'.repeat(100), "!'()~".repeat(40), '😀'.repeat(60)]
    for (const v of worst) {
      const q = campaignQuery(`?utm_source=${encodeURIComponent(v)}&utm_medium=${encodeURIComponent(v)}&utm_campaign=${encodeURIComponent(v)}`)
      expect(q.length).toBeLessThanOrEqual(1 + 3 * CAMPAIGN_TAG_MAX + 2)
    }
    // …and one that fits is kept whole, whatever its script. The edge, on a two-byte letter (6 characters serialized):
    // `utm_source=` + 31 × 6 = 197 is kept, 32 × 6 = 203 is dropped.
    expect(campaignQuery(`?utm_campaign=${encodeURIComponent('giáo viên')}`)).toBe('?utm_campaign=gi%C3%A1o+vi%C3%AAn')
    expect(campaignQuery(`?utm_source=${encodeURIComponent('é'.repeat(31))}`)).toBe(`?utm_source=${'%C3%A9'.repeat(31)}`)
    expect(campaignQuery(`?utm_source=${encodeURIComponent('é'.repeat(32))}`)).toBe('')
    // All three at their largest: the whole query stays under 3 × the cap.
    const full = campaignQuery(`?utm_source=${'%C3%A9'.repeat(31)}&utm_medium=${'%C3%A9'.repeat(31)}&utm_campaign=${'%C3%A9'.repeat(31)}`)
    expect(new URLSearchParams(full).get('utm_campaign')).toBe('é'.repeat(31))
    expect(full.length).toBe(1 + 197 + 1 + 197 + 1 + 199)
    expect(full.length).toBeLessThanOrEqual(1 + 3 * CAMPAIGN_TAG_MAX + 2)
  })
})

describe('the start month', () => {
  const now = new Date(2026, 9, 8) // 8 October 2026, the device's calendar
  it('none / now (this month or earlier) / a later month', () => {
    expect(startChoice(null, now)).toEqual({ kind: 'none' })
    expect(startChoice('2026-10-01', now)).toEqual({ kind: 'now' })
    expect(startChoice('2026-03-01', now)).toEqual({ kind: 'now' })
    expect(startChoice('2027-01-01', now)).toEqual({ kind: 'month', month: '2027-01' })
  })
  it('offers the next months, across a year end', () => {
    expect(nextMonths(4, now)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })
})

describe('draftResumeStep — where a saved draft reopens, and the dashboard\'s "Step X of Y" (2026-10-11)', () => {
  const full = (o: Record<string, unknown> = {}) => forDraft(normalizeTeacherInput({
    livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', jobTypes: ['fulltime'], relocate: 'no',
    teachAreas: ['d7'], teachAreasConfirmed: true, expectedSalaryM: 40, subjects: ['general-english'], ageGroups: ['kids'],
    experienceBand: '5-10-years', fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', headline: 'CELTA-certified English teacher',
    ...o,
  }))
  it('where the teacher was, when nothing before it fails', () => {
    expect(draftResumeStep(full(), 'teaching')).toEqual({ step: 'teaching', index: 3, total: 6 })
  })
  it('⛔ never past the first failing step — a draft has no photo, so one left on Photo & publish reopens there; an incomplete step before it wins', () => {
    expect(draftResumeStep(full(), 'finish')).toEqual({ step: 'finish', index: 6, total: 6 })
    expect(draftResumeStep(full({ teachAreas: [], teachAreasConfirmed: false }), 'finish')).toEqual({ step: 'where', index: 2, total: 6 })
  })
  it('no saved step (or one this teacher does not see): the first failing step', () => {
    expect(draftResumeStep(full({ subjects: [] }), null)).toMatchObject({ step: 'teaching' })
    expect(draftResumeStep(base(), 'nonsense')).toMatchObject({ step: 'plans', index: 1 })
  })
})

describe('nothing to save (commit gate, opus round 12)', () => {
  it('an answer set the account would keep nothing of is never sent: a phone alone, uploads, switches', () => {
    expect(nothingToSave({ ...EMPTY_TEACHER })).toBe(true)
    expect(nothingToSave({ ...EMPTY_TEACHER, phone: '+84901234567', photoUrl: 'https://x/p.webp', coverOpen: true, matchEmailOptIn: true })).toBe(true)
    expect(nothingToSave({ ...EMPTY_TEACHER, livesIn: 'abroad' })).toBe(false)
  })
})

describe('"Review these answers in my profile" / "Use the answers I just gave instead" (commit gate, rounds 14-16)', () => {
  const full = normalizeTeacherInput({
    ...base(), livesIn: 'city', currentCity: 'ha-noi', jobTypes: ['parttime'], relocate: 'no', teachAreas: ['ha-noi'], teachAreasConfirmed: true,
    subjects: ['ielts'], ageGroups: ['adults'], experienceBand: '1-3-years', fullName: 'Jane', nationality: 'GB', englishLevel: 'native',
    headline: 'IELTS teacher in Hanoi', bio: 'Ten years in Hanoi.',
  })
  it('⛔ a step-1 hand-off over a saved profile changes step 1 — never a blank over the name, the bio or the subjects', () => {
    const merged = mergeReview(base({ ...full }), handoffPart(base({ ...full, jobTypes: ['fulltime'] })))
    expect(merged).toMatchObject({ jobTypes: ['fulltime'], fullName: full.fullName, bio: full.bio, subjects: full.subjects })
  })
  it('the same step 1 naming no teaching areas keeps the confirmed ones', () => {
    const merged = mergeReview(base({ ...full }), base({ ...full, teachAreas: [], teachAreasConfirmed: false }))
    expect(merged.teachAreas).toEqual(full.teachAreas)
    expect(merged.teachAreasConfirmed).toBe(true)
  })
  it('⛔ a NEW home brings its own areas — never the old city\'s confirmed ones beside it', () => {
    const moved = base({ ...full, currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', teachAreas: [], teachAreasConfirmed: false })
    const merged = mergeReview(base({ ...full }), moved)
    expect(merged).toMatchObject({ currentCity: 'ho-chi-minh-city', teachAreas: [], teachAreasConfirmed: false, fullName: full.fullName })
  })
  it('this account\'s own fuller copy brings its later answers too', () => {
    expect(mergeReview(base({ ...full }), base({ ...full, headline: 'A new headline' })).headline).toBe('A new headline')
  })
})

