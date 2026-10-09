import { describe, expect, it } from 'vitest'
import {
  AI_NOTICE_VERSION, BAND_FLOOR, CITY_PROVINCE, DRAFT_STEPS, EMPTY_TEACHER, EXPERIENCE_BANDS, TEACHER_FORM_OPTIONS, TEACHER_OPTIONS,
  TEACHER_STEP_FIELDS, aiMatchConsented, coverIsPublic, deriveRelocate, experienceBucket, fromLegacyTeacher, hasTeachingGoal,
  isLegacyTeacherBody, legacyDistrictKey, normalizeForSave, normalizeTeacherInput, splitGoalErrors, teacherFacetTokens,
  teacherFreeTextFields, teacherFreeTexts, teacherSteps, teacherSubcategory, validateTeacherInput, visibleFields,
} from './profile'
import { HUBS } from './places'
import { CATEGORY_BY_SLUG } from '@/lib/taxonomy'
import { facetValues, parseFacetTokens } from '@/lib/facet-tokens'

/** A complete v2 body: an HCMC full-time job seeker who teaches in two districts and would move to Hanoi. */
const body = (o: Record<string, unknown> = {}) => ({
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: '', jobTypes: ['fulltime'], relocate: 'some',
  teachAreas: ['online', 'd7', 'd4', 'ha-noi'], teachAreasConfirmed: true, availableFrom: '2026-11-01', expectedSalaryM: 40,
  subjects: ['general-english', 'ielts'], teachLanguages: [], ageGroups: ['kids', 'adults'], experienceBand: '5-10-years',
  experience: [{ role: 'Teacher', employer: 'ILA', city: 'HCMC', from: '2020-01', to: '2024-06' }],
  degreeLevel: 'bachelor', degreeMajor: 'Linguistics', degreeInstitution: 'Leeds', degreeYear: 2018,
  certificates: [{ type: 'celta', hours: 120, provider: 'Cambridge', year: 2019 }],
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', languages: ['French'],
  headline: 'CELTA-certified English teacher, 6 years with kids', bio: 'I love phonics.',
  coverOpen: false, coverSlots: [], coverRateVnd: null, coverConsent: false,
  photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', videoUrl: null, videoOnRequest: false,
  phone: '+84 901 234 567', matchEmailOptIn: true, staffContactOptIn: false,
  ...o,
})
const t = (o: Record<string, unknown> = {}) => normalizeTeacherInput(body(o))
const saved = (o: Record<string, unknown> = {}) => normalizeForSave(t(o))
const coverOn = { coverOpen: true, coverSlots: ['mon-eve', 'sat-am'], coverRateVnd: 300_000, coverConsent: true }

/** The plan's personas (2026-10-08), each a complete, valid answer set. */
const PERSONAS: Record<string, Record<string, unknown>> = {
  'HCMC job seeker with districts': {},
  'Hanoi teacher who stays': { currentCity: 'ha-noi', currentDistrictKey: '', jobTypes: ['parttime'], relocate: 'no', teachAreas: ['ha-noi'], expectedSalaryM: null },
  'Bình Dương resident (HCMC districts are near home)': { currentCity: 'binh-duong', currentDistrictKey: '', relocate: 'no', teachAreas: ['binh-duong', 'd7'] },
  'Gia Lai teacher': { livesIn: 'elsewhere', currentCity: '', currentDistrictKey: '', currentProvince: '52', jobTypes: ['parttime'], relocate: 'no', teachAreas: ['online', 'p-52'], expectedSalaryM: null },
  'teacher abroad who only teaches online': { livesIn: 'abroad', currentCity: '', currentDistrictKey: '', jobTypes: ['private'], relocate: 'online-only', teachAreas: ['online'], expectedSalaryM: null, availableFrom: null },
  'HCMC teacher who wants only cover': { jobTypes: [], relocate: '', teachAreas: ['d1', 'd3'], matchEmailOptIn: false, expectedSalaryM: null, availableFrom: null, ...coverOn },
}

describe('the personas', () => {
  it('each validates, and survives a save unchanged (normalizeForSave keeps every visible answer)', () => {
    for (const [name, o] of Object.entries(PERSONAS)) {
      const x = t(o)
      expect(validateTeacherInput(normalizeForSave(x)), name).toEqual({})
      expect(normalizeForSave(x), name).toEqual(x)
    }
  })
  it('see the step rail the plan promises: HCMC 6 · a province with no cover 5 · abroad online only 4 · teacher.eno.vn 4', () => {
    const steps = (name: string, draftHost = false) => teacherSteps(t(PERSONAS[name]), { draftHost })
    expect(steps('HCMC job seeker with districts')).toEqual(['plans', 'where', 'teaching', 'about', 'cover', 'finish'])
    expect(steps('Gia Lai teacher')).toEqual(['plans', 'where', 'teaching', 'about', 'finish'])
    expect(steps('teacher abroad who only teaches online')).toEqual(['plans', 'teaching', 'about', 'finish'])
    expect(steps('HCMC job seeker with districts', true)).toEqual(['plans', 'where', 'teaching', 'about'])
  })
  it('re-read their relocation answer from the stored list (it is never stored itself)', () => {
    for (const [name, o] of Object.entries(PERSONAS)) {
      const x = saved(o)
      expect(deriveRelocate(x), name).toBe(x.relocate)
    }
  })
})

describe('normalizeTeacherInput', () => {
  it('drops unknown keys, wrong types and values outside the vocabularies', () => {
    const x = normalizeTeacherInput({
      ...body(), fullName: '  Jane   Doe ', nationality: 'gb', subjects: ['ielts', 'ielts', 'juggling'], evil: '<script>',
      certificates: [{ type: 'fake-cert' }], experience: [{ from: '2020-13' }], livesIn: 'moon', englishLevel: 'perfect',
      experienceBand: '99-years', currentDistrictKey: 'atlantis', currentProvince: '01',
    })
    expect(x.fullName).toBe('Jane Doe')
    expect(x.nationality).toBe('') // must be upper-case ISO alpha-2
    expect(x.subjects).toEqual(['ielts'])
    expect(x.certificates[0].type).toBe('')
    expect(x.experience[0].from).toBe('')
    expect(x.livesIn).toBeNull()
    expect(x.englishLevel).toBeNull()
    expect(x.experienceBand).toBeNull()
    expect(x.currentDistrictKey).toBe('')
    expect(x.currentProvince).toBe('') // Hà Nội is a city chip, never a "somewhere else" province
    expect('evil' in x).toBe(false)
  })
  it('⛔ never sets a server-written column from a body or a #d= fragment', () => {
    const x = normalizeTeacherInput({
      ...body(), situationVersion: 99, consentPublicVersion: 'x', teachAreasConfirmedAt: '2020-01-01', matchEmailOptInAt: 'x',
      matchEmailNoticeVersion: AI_NOTICE_VERSION, coverAreas: ['d1'], coverConsentVersion: 'x', preferredCities: ['ha-noi'], nativeSpeaker: true,
    })
    for (const k of ['situationVersion', 'consentPublicVersion', 'teachAreasConfirmedAt', 'matchEmailOptInAt', 'matchEmailNoticeVersion', 'coverAreas', 'coverConsentVersion', 'preferredCities', 'nativeSpeaker']) {
      expect(k in x, k).toBe(false)
    }
  })
  it('⛔ never clamps a number — a salary of 200, 3,000 certificate hours and a year 1900 reach validation as themselves', () => {
    const x = t({ expectedSalaryM: 200, degreeYear: 1900, certificates: [{ type: 'celta', hours: 3000, provider: '', year: 2019 }] })
    expect(x.expectedSalaryM).toBe(200)
    expect(x.degreeYear).toBe(1900)
    expect(x.certificates[0].hours).toBe(3000)
    const e = validateTeacherInput(x)
    expect(e).toMatchObject({ expectedSalaryM: 'salary_range', degreeYear: 'year_range', 'certificates.0': 'hours_range' })
    expect(validateTeacherInput(t({ expectedSalaryM: 0 })).expectedSalaryM).toBe('salary_range')
  })
  it('stores a start month as its first day', () => {
    expect(t({ availableFrom: '2026-11-17' }).availableFrom).toBe('2026-11-01')
    expect(t({ availableFrom: '2026-11' }).availableFrom).toBe('2026-11-01')
    expect(t({ availableFrom: '2026-13-01' }).availableFrom).toBeNull()
  })
  it('offers the form vocabularies: Online is a place, Business is a subject', () => {
    expect(t({ jobTypes: ['fulltime', 'online'] }).jobTypes).toEqual(['fulltime'])
    // a migrated row keeps 'business' in its column (D4): it loads as Adults, never as a lost answer
    expect(t({ ageGroups: ['business'] }).ageGroups).toEqual(['adults'])
    expect(t({ ageGroups: ['kids', 'business', 'adults'] }).ageGroups).toEqual(['kids', 'adults'])
    expect(TEACHER_FORM_OPTIONS.jobType.map((o) => o.value)).toEqual(['fulltime', 'parttime', 'private'])
    expect(TEACHER_FORM_OPTIONS.ageGroup.map((o) => o.value)).toEqual(['kids', 'teens', 'adults'])
  })
  it('never throws on garbage', () => {
    for (const raw of [null, undefined, 42, 'x', [], { experience: 'nope', certificates: {}, teachAreas: 'x' }]) {
      expect(() => normalizeTeacherInput(raw)).not.toThrow()
    }
  })
  it('is idempotent on a v2 body — normalising a normalised input changes nothing', () => {
    for (const o of Object.values(PERSONAS)) expect(normalizeTeacherInput(t(o))).toEqual(t(o))
  })
})

// ── The input boundary (plan review D2): a teacher.eno.vn #d= fragment or a sessionStorage draft from the old form ──
describe('fromLegacyTeacher — transient old inputs, mapped once at the input boundary', () => {
  /** A v1 `#d=` fragment: the old TeacherInput, cover consent and all. */
  const v1 = {
    fullName: 'Jane Doe', headline: 'CELTA-certified English teacher, 6 years with kids', nationality: 'GB', nativeSpeaker: true,
    languages: ['French'], currentCity: 'ho-chi-minh-city', currentDistrict: 'Quận 7', preferredCities: ['ho-chi-minh-city', 'da-nang'],
    openToOnline: true, availableFrom: '2026-10-15', jobTypes: ['fulltime', 'online'], ageGroups: ['kids', 'business'],
    subjects: ['general-english'], yearsExperience: 6, experience: [], certificates: [], expectedSalaryM: 45,
    coverOpen: true, coverSlots: ['mon-am'], coverAreas: ['d1', 'd3'], coverRateVnd: 300_000, coverConsent: true, consentPublic: true,
  }
  it('is detected by SHAPE: no teach-area list', () => {
    expect(isLegacyTeacherBody(v1)).toBe(true)
    expect(isLegacyTeacherBody(body())).toBe(false)
    expect(isLegacyTeacherBody({ ...body(), teachAreas: [] })).toBe(false) // an unmigrated stored row is v2-shaped, never re-read
    expect(isLegacyTeacherBody(null)).toBe(false)
  })
  it('maps the old places into ONE list — the whole city wins over its districts (B2), Online from any of its three switches', () => {
    const x = normalizeTeacherInput(v1)
    expect(x.teachAreas).toEqual(['online', 'ho-chi-minh-city', 'da-nang'])
    expect(normalizeTeacherInput({ ...v1, preferredCities: ['da-nang'], openToOnline: false, jobTypes: ['parttime'] }).teachAreas).toEqual(['d1', 'd3', 'da-nang'])
    expect(normalizeTeacherInput({ ...v1, preferredCities: [], openToOnline: false, jobTypes: ['online'] }).teachAreas).toContain('online')
    expect(normalizeTeacherInput({ ...v1, coverOpen: false }).teachAreas).not.toContain('d1') // areas of a cover that was off are not places
  })
  it('⛔ never infers "Where are you now?" — the old form forced a city even from abroad (D3)', () => {
    const x = normalizeTeacherInput(v1)
    expect(x.livesIn).toBeNull()
    expect(x.currentCity).toBe('ho-chi-minh-city') // kept as the form's hint; the answer is asked again
    expect(validateTeacherInput(x, ['plans']).livesIn).toBe('required') // so the draft opens on the first step
  })
  it('maps the district text, the job types, the age groups, the English level and the experience band', () => {
    const x = normalizeTeacherInput(v1)
    expect(x.currentDistrictKey).toBe('d7')
    expect(x.jobTypes).toEqual(['fulltime'])
    expect(x.ageGroups).toEqual(['kids', 'adults'])
    expect(x.englishLevel).toBe('native')
    expect(x.experienceBand).toBe('5-10-years')
    expect(x.availableFrom).toBe('2026-10-01')
    expect(normalizeTeacherInput({ ...v1, nativeSpeaker: false }).englishLevel).toBeNull() // false may be the untouched default
    expect(normalizeTeacherInput({ ...v1, yearsExperience: 0 }).experienceBand).toBeNull() // the old default
    expect(normalizeTeacherInput({ ...v1, yearsExperience: 0, experience: [{ role: 'T', employer: 'X' }] }).experienceBand).toBe('under-1-year')
    expect(normalizeTeacherInput({ ...v1, currentDistrict: 'somewhere nice' }).currentDistrictKey).toBe('')
  })
  it('resolves the curated district spellings — "Thủ Đức", "District 2", "Quận 9"', () => {
    expect(legacyDistrictKey('Thủ Đức')).toBe('thu-duc')
    expect(legacyDistrictKey('District 2')).toBe('d2')
    expect(legacyDistrictKey('Quận 9')).toBe('d9')
    expect(legacyDistrictKey('  ')).toBe('')
  })
  it('a v3 sessionStorage draft maps the same way', () => {
    const draft = { ...v1, coverOpen: false, coverConsent: false, videoUrl: null }
    const x = normalizeTeacherInput(fromLegacyTeacher(draft))
    expect(x.teachAreas).toEqual(['online', 'ho-chi-minh-city', 'da-nang'])
    expect(x.coverOpen).toBe(false)
  })
})

describe('the questions a teacher is asked — and what a save keeps', () => {
  it('⛔ drops every answer to a hidden question (an answer to a hidden question is never stored or published)', () => {
    // part-time only: no salary; abroad: no district or city; other language only: no English level; no degree: no details
    const x = saved({
      livesIn: 'abroad', jobTypes: ['parttime'], relocate: 'some', subjects: ['other-language'], teachLanguages: ['French'],
      degreeLevel: null, teachAreas: ['ha-noi', 'd7', 'p-52'], ...coverOn,
    })
    expect(x).toMatchObject({ currentCity: '', currentDistrictKey: '', expectedSalaryM: null, englishLevel: null, degreeMajor: '', degreeInstitution: '', degreeYear: null })
    expect(x.teachAreas).toEqual(['ha-noi'])
    expect(x.coverOpen).toBe(false) // no cover abroad — the periods and rate stay for later
    expect(x.coverSlots).toEqual(coverOn.coverSlots)
    expect(x.teachLanguages).toEqual(['French'])
    expect(saved({ jobTypes: ['private'], relocate: '' }).availableFrom).toBeNull()
    expect(saved({ subjects: ['general-english'] }).teachLanguages).toEqual([])
  })
  it('drops both opt-ins for a teacher who is not looking for work', () => {
    const x = saved({ ...PERSONAS['HCMC teacher who wants only cover'], matchEmailOptIn: true, staffContactOptIn: true })
    expect([x.matchEmailOptIn, x.staffContactOptIn]).toEqual([false, false])
    expect(visibleFields(x).has('matchEmailOptIn')).toBe(false)
  })
  it('applies the relocation answer to the list: "No" keeps home, "Anywhere" adds anywhere, "Online only" is Online', () => {
    expect(saved({ relocate: 'no' }).teachAreas).toEqual(['online', 'd4', 'd7'])
    expect(saved({ relocate: 'anywhere' }).teachAreas).toEqual(['online', 'd4', 'd7', 'anywhere'])
    expect(saved({ livesIn: 'abroad', relocate: 'online-only', teachAreas: ['ha-noi'] }).teachAreas).toEqual(['online'])
  })
  it('B7: Online only from abroad with a full-time goal still asks the Where step, Online locked in', () => {
    const x = saved({ livesIn: 'abroad', relocate: 'online-only', teachAreas: [] })
    expect(teacherSteps(x, { draftHost: false })).toContain('where')
    expect(x.teachAreas).toEqual(['online'])
  })
  it('shows the district only in HCMC and the province only for "somewhere else"', () => {
    expect(visibleFields(t()).has('currentDistrictKey')).toBe(true)
    expect(visibleFields(t({ currentCity: 'binh-duong' })).has('currentDistrictKey')).toBe(false)
    expect(saved({ currentCity: 'binh-duong', teachAreas: ['binh-duong'] }).currentDistrictKey).toBe('')
    expect(visibleFields(t(PERSONAS['Gia Lai teacher'])).has('currentProvince')).toBe(true)
  })
})

describe('validateTeacherInput', () => {
  it('checks only the steps it is asked about — the teacher.eno.vn half never needs a photo or a phone', () => {
    const x = t({ photoUrl: null, phone: '' })
    expect(validateTeacherInput(x, DRAFT_STEPS)).toEqual({})
    expect(Object.keys(validateTeacherInput(x))).toEqual(['photoUrl'])
  })
  it('asks "Where are you now?" and the place it names', () => {
    expect(validateTeacherInput(t({ livesIn: null }), ['plans']).livesIn).toBe('required')
    expect(validateTeacherInput(t({ currentCity: '' }), ['plans']).currentCity).toBe('required')
    expect(validateTeacherInput(t({ livesIn: 'elsewhere', currentProvince: '' }), ['plans']).currentProvince).toBe('required')
  })
  it('asks the relocation question exactly when it is shown — and never answers it for the teacher', () => {
    expect(validateTeacherInput(t({ relocate: '', teachAreas: ['d7'] }), ['plans']).relocate).toBe('required')
    expect(validateTeacherInput(t({ jobTypes: ['private'], relocate: '' }), ['plans']).relocate).toBeUndefined()
    // an answer that does not fit the situation is no answer ("online-only" is for teachers abroad)
    expect(t({ relocate: 'online-only' }).relocate).toBe('')
    // a stored row says nothing: the answer is re-read from its list
    const { relocate: _r, ...stored } = body({ teachAreas: ['d7', 'anywhere'] })
    expect(normalizeTeacherInput(stored).relocate).toBe('anywhere')
  })
  it('requires a job type except where cover is offered — there the Cover step asks for one or cover itself', () => {
    expect(validateTeacherInput(t({ ...PERSONAS['Gia Lai teacher'], jobTypes: [] }), ['plans']).jobTypes).toBe('required')
    expect(validateTeacherInput(t({ jobTypes: [], relocate: '' }), ['plans']).jobTypes).toBeUndefined()
    expect(validateTeacherInput(t({ jobTypes: [], relocate: '' }), ['cover']).coverOpen).toBe('goal_required')
    expect(validateTeacherInput(t({ jobTypes: [], relocate: '', ...coverOn }), ['cover'])).toEqual({})
  })
  it('⛔ B6: the pre-selected places are a suggestion until the teacher confirms or edits them', () => {
    expect(validateTeacherInput(t({ teachAreasConfirmed: false }), ['where']).teachAreas).toBe('confirm')
    expect(validateTeacherInput(t({ teachAreas: [] }), ['where']).teachAreas).toBe('required')
    expect(validateTeacherInput(t({ relocate: 'some', teachAreas: ['d7'] }), ['where']).teachAreas).toBe('other_city_required')
  })
  it('asks the taught language under "Other language", the English level for English-medium subjects, and a band', () => {
    const e = validateTeacherInput(t({ subjects: ['other-language', 'ielts'], teachLanguages: [], englishLevel: null, experienceBand: null }))
    expect(e).toMatchObject({ teachLanguages: 'required', englishLevel: 'required', experienceBand: 'required' })
    expect(validateTeacherInput(saved({ subjects: ['other-language'], teachLanguages: ['Korean'], englishLevel: null })).englishLevel).toBeUndefined()
  })
  it('names the certificate row it refuses — an incomplete one, a second of the same type, hours or a year out of range', () => {
    const e = validateTeacherInput(t({ certificates: [
      { type: '' }, { type: 'celta', hours: 120 }, { type: 'celta' }, { type: 'tefl', hours: 0 }, { type: 'tesol', year: 2999 },
    ] }))
    expect(e).toMatchObject({ 'certificates.0': 'incomplete', 'certificates.2': 'duplicate', 'certificates.3': 'hours_range', 'certificates.4': 'year_range' })
    expect(e['certificates.1']).toBeUndefined()
  })
  it('flags an experience entry that ends before it starts', () => {
    expect(validateTeacherInput(t({ experience: [{ role: 'T', employer: 'X', city: '', from: '2024-01', to: '2023-01' }] }))['experience.0']).toBe('dates')
  })
  it('makes cover complete once switched on: periods, a rate in range, a reach near home and its own consent', () => {
    const on = (o: Record<string, unknown>) => validateTeacherInput(t({ ...coverOn, ...o }), ['cover'])
    expect(on({})).toEqual({})
    expect(on({ coverSlots: [], coverRateVnd: null, coverConsent: false })).toMatchObject({ coverSlots: 'required', coverRateVnd: 'required', coverConsent: 'required' })
    expect(on({ coverRateVnd: 30_000 }).coverRateVnd).toBe('rate_range')
    expect(on({ teachAreas: ['online', 'ha-noi'] }).coverOpen).toBe('reach_required') // nowhere near home to cover
    expect(validateTeacherInput(t({ ...coverOn, livesIn: 'abroad' }), ['cover']).coverOpen).toBe('reach_required')
  })
  it('⛔ requires the phone only while "Our staff may call me" is on (owner, 2026-10-08) — and never accepts junk', () => {
    expect(validateTeacherInput(t({ phone: '' }), ['finish'])).toEqual({})
    expect(validateTeacherInput(t({ phone: '', staffContactOptIn: true }), ['finish']).phone).toBe('required')
    expect(validateTeacherInput(t({ phone: 'call me' }), ['finish']).phone).toBe('invalid')
  })
  it('keeps both opt-ins optional and OFF by default (no bundled consent)', () => {
    expect(validateTeacherInput(t({ matchEmailOptIn: false, staffContactOptIn: false }))).toEqual({})
    expect([EMPTY_TEACHER.matchEmailOptIn, EMPTY_TEACHER.staffContactOptIn, EMPTY_TEACHER.coverOpen]).toEqual([false, false, false])
    expect(EMPTY_TEACHER.livesIn).toBeNull()
  })
})

describe('the goal rule (D6)', () => {
  it('splits the goal errors from the rest', () => {
    expect(splitGoalErrors({ jobTypes: 'required', coverOpen: 'goal_required', fullName: 'required' })).toEqual({
      goal: { jobTypes: 'required', coverOpen: 'goal_required' }, other: { fullName: 'required' },
    })
    expect(splitGoalErrors({ coverOpen: 'reach_required' }).goal).toEqual({})
  })
  it('a profile has a goal while it looks for work or offers public cover', () => {
    expect(hasTeachingGoal(t())).toBe(true)
    expect(hasTeachingGoal(t({ jobTypes: [], relocate: '' }))).toBe(false)
    expect(hasTeachingGoal(t({ jobTypes: [], relocate: '', teachAreas: ['d1'], ...coverOn }))).toBe(true)
  })
})

describe('steps', () => {
  it('own every TeacherInput field exactly once, and the draft steps come first', () => {
    const all = Object.values(TEACHER_STEP_FIELDS).flat()
    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual(Object.keys(EMPTY_TEACHER).sort())
    expect(Object.keys(TEACHER_STEP_FIELDS).slice(0, 4)).toEqual([...DRAFT_STEPS])
  })
})

describe('derived listing facets', () => {
  const tokens = (o: Record<string, unknown> = {}) => teacherFacetTokens(saved(o))
  it('writes every teach area as a "Can teach in" token — never a city-level copy of a district', () => {
    expect(facetValues(tokens(), 'workIn')).toEqual(['online', 'd4', 'd7', 'ha-noi'])
    expect(facetValues(tokens(), 'workIn')).not.toContain('ho-chi-minh-city')
  })
  it('says "In Vietnam now" only for an answer in Vietnam — never from an unanswered default', () => {
    expect(facetValues(tokens(), 'inVietnam')).toEqual(['yes'])
    expect(facetValues(tokens(PERSONAS['Gia Lai teacher']), 'inVietnam')).toEqual(['yes'])
    expect(facetValues(tokens(PERSONAS['teacher abroad who only teaches online']), 'inVietnam')).toEqual([])
    expect(facetValues(teacherFacetTokens(normalizeTeacherInput({ ...body(), livesIn: null })), 'inVietnam')).toEqual([])
  })
  it('sets native / non-native only once the English level is answered (Fluent and Working are non-native)', () => {
    expect(facetValues(tokens(), 'native')).toEqual(['native'])
    expect(facetValues(tokens({ englishLevel: 'fluent' }), 'native')).toEqual(['non-native'])
    expect(facetValues(teacherFacetTokens(t({ englishLevel: null })), 'native')).toEqual([])
    expect(facetValues(tokens({ subjects: ['other-language'], teachLanguages: ['Korean'] }), 'native')).toEqual([])
  })
  it('sets the experience bucket only once answered', () => {
    expect(facetValues(tokens(), 'experience')).toEqual(['5-10-years'])
    expect(facetValues(teacherFacetTokens(t({ experienceBand: null })), 'experience')).toEqual([])
  })
  it('derives the old-link tokens: ageGroup:business from Business English, jobType:online from Online', () => {
    expect(facetValues(tokens({ subjects: ['business-english'] }), 'ageGroup')).toContain('business')
    expect(facetValues(tokens(), 'jobType')).toEqual(['fulltime', 'online'])
    expect(facetValues(tokens({ teachAreas: ['d7', 'ha-noi'] }), 'jobType')).toEqual(['fulltime'])
  })
  it('emits cover tokens only while cover is public — its areas the DERIVED reach near home', () => {
    const x = saved(PERSONAS['HCMC teacher who wants only cover'])
    expect(coverIsPublic(x)).toBe(true)
    const pairs = parseFacetTokens(teacherFacetTokens(x))
    expect(pairs.filter((p) => p.key === 'coverArea').map((p) => p.value)).toEqual(['d1', 'd3'])
    expect(pairs).toContainEqual({ key: 'cover', value: 'open' })
    for (const off of [{ coverOpen: false }, { coverConsent: false }, { coverRateVnd: null }]) {
      const p = parseFacetTokens(teacherFacetTokens(t({ ...PERSONAS['HCMC teacher who wants only cover'], ...off })))
      expect(p.filter((q) => q.key.startsWith('cover')), JSON.stringify(off)).toEqual([])
    }
  })
  it('writes only taxonomy values, so every chip filters — jobType:online is the one derived-only alias kept for old links', () => {
    const cat = CATEGORY_BY_SLUG.teachers
    for (const o of Object.values(PERSONAS)) {
      for (const p of parseFacetTokens(teacherFacetTokens(saved(o)))) {
        if (p.key === 'jobType' && p.value === 'online') continue
        expect(cat.facets.find((f) => f.key === p.key)?.options.map((x) => x.value), `${p.key}:${p.value}`).toContain(p.value)
      }
    }
  })
})

describe('free texts — screened field by field', () => {
  it('names each field, takes the taught languages in, and leaves the (now curated) district out', () => {
    const x = t({ teachLanguages: ['Korean'], subjects: ['other-language'] })
    const fields = teacherFreeTextFields(x)
    expect(fields).toContainEqual(['bio', 'I love phonics.'])
    expect(fields).toContainEqual(['experience.0', 'ILA'])
    expect(fields).toContainEqual(['certificates.0', 'Cambridge'])
    expect(fields).toContainEqual(['teachLanguages', 'Korean'])
    expect(teacherFreeTexts(x)).not.toContain('Quận 7')
  })
})

describe('experience bands', () => {
  it('bucket years on the taxonomy boundaries, and each band\'s floor falls back into it', () => {
    expect([0, 1, 3, 5, 10].map(experienceBucket)).toEqual(['under-1-year', '1-3-years', '3-5-years', '5-10-years', 'over-10-years'])
    for (const b of EXPERIENCE_BANDS) expect(experienceBucket(BAND_FLOOR[b])).toBe(b)
  })
})

describe('AI matching consent (D5)', () => {
  it('counts only an opt-in stamped with the CURRENT AI notice', () => {
    expect(aiMatchConsented({ matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION, staffContactOptIn: false, staffContactNoticeVersion: null })).toBe(true)
    expect(aiMatchConsented({ matchEmailOptIn: false, matchEmailNoticeVersion: null, staffContactOptIn: true, staffContactNoticeVersion: AI_NOTICE_VERSION })).toBe(true)
    // a Gemini-era opt-in (no version) does not count until re-confirmed
    expect(aiMatchConsented({ matchEmailOptIn: true, matchEmailNoticeVersion: null, staffContactOptIn: true, staffContactNoticeVersion: 'old' })).toBe(false)
    // a stamp without the switch is history, not consent
    expect(aiMatchConsented({ matchEmailOptIn: false, matchEmailNoticeVersion: AI_NOTICE_VERSION, staffContactOptIn: false, staffContactNoticeVersion: null })).toBe(false)
  })
})

describe('transitional exports', () => {
  it('keep TEACHER_OPTIONS.workIn as the 14 old values (12 cities, anywhere, online) until the integration merge', () => {
    expect(TEACHER_OPTIONS.workIn.map((o) => o.value)).toEqual([...HUBS, 'online', 'anywhere'])
  })
  it('map every city to a province the area filter knows', () => {
    for (const c of HUBS) expect(CITY_PROVINCE[c], c).toBeTruthy()
  })
  it('pick a subcategory from the subjects', () => {
    expect(teacherSubcategory({ subjects: ['ielts'] })).toBe('exam-prep')
    expect(teacherSubcategory({ subjects: ['stem', 'general-english'] })).toBe('subjects')
    expect(teacherSubcategory({ subjects: ['other-language'] })).toBe('other-languages')
    expect(teacherSubcategory({ subjects: ['phonics'] })).toBe('english')
  })
})
