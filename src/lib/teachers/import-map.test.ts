import { describe, expect, it } from 'vitest'
import { EMPTY_TEACHER, normalizeTeacherInput, validateTeacherInput } from '@/lib/teachers/profile'
import { IMPORT_FIELDS, mapTeacherImport, matchLanguage, mergeImport, teachingBand } from '@/lib/teachers/import-map'

const NOW = new Date('2026-10-15T09:00:00Z')
const map = (raw: unknown) => mapTeacherImport(raw, { now: NOW })

const CV = {
  isCv: true,
  documentKind: 'cv',
  fullName: 'JANE O’BRIEN-SMITH',
  headline: 'CELTA-certified ESL teacher · 6 years with young learners',
  summary: 'I teach English to children and teens.\nCall me on +84 901 234 567 any time.\n\nI love phonics and Cambridge exams. My visa is sorted.',
  nationalityCode: 'ie',
  englishLevel: 'native',
  spokenLanguages: ['English (Native)', 'Spanish - B2', 'Mandarin Chinese – conversational', 'Klingon'],
  taughtLanguages: [],
  subjects: ['general-english', 'phonics', 'not-a-subject'],
  ageGroups: ['kids', 'business'],
  statedTeachingYears: 0,
  jobs: [
    { role: 'ESL Teacher', employer: 'ILA Vietnam', city: 'Ho Chi Minh City', from: '2023-02', to: '', current: true, teaching: true, subjects: ['cambridge'], ageGroups: ['teens'] },
    { role: 'Barista', employer: 'Cafe', city: 'Dublin', from: '2015', to: '2016', current: false, teaching: false },
    { role: 'English Teacher', employer: 'Apollo English', city: 'Hanoi', from: '2020', to: '2022-12', current: false, teaching: true },
    { role: 'Tutor', employer: 'Self-employed', city: '', from: '2019-01', to: '', current: false, teaching: true },
  ],
  education: [
    { level: 'bachelor', field: 'English Literature', institution: 'Trinity College Dublin', year: 2014 },
    { level: 'master', field: 'Education', institution: 'University of Leeds', year: 2019 },
  ],
  certificates: [
    { type: 'tefl', name: 'CELTA', hours: 120, provider: 'Cambridge English', year: 2018 },
    { type: 'tefl', name: '120-hour TEFL certificate', hours: 0, provider: 'i-to-i', year: 2017 },
    { type: 'other-cert', name: 'Young Learners Extension', hours: 0, provider: '', year: 0 },
    { type: 'other-cert', name: 'Another teaching course', hours: 0, provider: '', year: 0 },
    { type: 'tefl', name: 'TEFL again', hours: 99999, provider: '', year: 1800 },
  ],
  phone: 'Phone: 0901 234 567',
}

describe('mapTeacherImport', () => {
  it('returns null when the model says the file is not a CV (or says nothing)', () => {
    expect(map({ isCv: false, fullName: 'X Y' })).toBeNull()
    expect(map(null)).toBeNull()
    expect(map('nonsense')).toBeNull()
  })

  it('maps a typical teacher CV into form answers the validator accepts', () => {
    const r = map(CV)!
    expect(r.source).toBe('cv')
    expect(r.fields.fullName).toBe('Jane O’Brien-Smith')
    expect(r.fields.headline).toBe('CELTA-certified ESL teacher · 6 years with young learners')
    expect(r.fields.nationality).toBe('IE')
    expect(r.fields.englishLevel).toBe('native')
    // English never listed as an "other" language; unknown names dropped; aliases matched.
    expect(r.fields.languages).toEqual(['Spanish', 'Chinese'])
    // Subjects: enums only, from the whole file and the teaching jobs; 'business' is not a form age group.
    expect(r.fields.subjects).toEqual(['general-english', 'cambridge', 'phonics'])
    expect(r.fields.ageGroups).toEqual(['kids', 'teens'])
    expect(r.fields.degreeLevel).toBe('master')
    expect(r.fields.degreeMajor).toBe('Education')
    expect(r.fields.degreeInstitution).toBe('University of Leeds')
    expect(r.fields.degreeYear).toBe(2019)
    // The whole answer set passes the form's own validation for the steps it touches.
    const t = normalizeTeacherInput({ ...EMPTY_TEACHER, ...r.fields })
    const errors = validateTeacherInput(t, ['teaching'])
    expect(errors).toEqual({})
  })

  it('keeps only teaching jobs, most recent first; a past job with no end date is skipped, never made current', () => {
    const r = map(CV)!
    expect(r.fields.experience).toEqual([
      { role: 'ESL Teacher', employer: 'ILA Vietnam', city: 'Ho Chi Minh City', from: '2023-02', to: '' },
      { role: 'English Teacher', employer: 'Apollo English', city: 'Hanoi', from: '2020-01', to: '2022-12' },
    ])
    expect(r.skippedJobs).toBe(1)
  })

  it('reads a bare year as January (start) and December (end), and a future end as a job still running', () => {
    const r = map({ isCv: true, jobs: [
      { role: 'Teacher', employer: 'A', from: '2018', to: '2019', teaching: true },
      { role: 'Teacher', employer: 'B', from: '2025-09', to: '2027-06', teaching: true },
      // Years past next year are not dates the form takes: no end it can trust → skipped, never "current".
      { role: 'Teacher', employer: 'C', from: '2030-01', to: '2031-01', current: false, teaching: true },
    ] })!
    expect(r.fields.experience).toEqual([
      { role: 'Teacher', employer: 'B', city: '', from: '2025-09', to: '' },
      { role: 'Teacher', employer: 'A', city: '', from: '2018-01', to: '2019-12' },
    ])
    expect(r.skippedJobs).toBe(1)
  })

  it('drops an end before the start rather than publishing impossible dates', () => {
    const r = map({ isCv: true, jobs: [{ role: 'Teacher', employer: 'A', from: '2022-05', to: '2021-01', teaching: true }] })!
    expect(r.fields.experience).toEqual([{ role: 'Teacher', employer: 'A', city: '', from: '', to: '2021-01' }])
  })

  it('caps the jobs at the form limit', () => {
    const jobs = Array.from({ length: 14 }, (_, i) => ({ role: 'Teacher', employer: `School ${i}`, from: `20${10 + i}-01`, to: `20${10 + i}-06`, teaching: true }))
    expect(map({ isCv: true, jobs })!.fields.experience).toHaveLength(10)
  })

  it('computes the experience band from dated teaching jobs, overlaps counted once', () => {
    expect(teachingBand([{ from: '2023-02', to: '' }, { from: '2020-01', to: '2022-12' }], 0, NOW)).toBe('5-10-years')
    expect(teachingBand([{ from: '2026-01', to: '' }, { from: '2026-03', to: '2026-05' }], 0, NOW)).toBe('under-1-year')
    expect(teachingBand([{ from: '2019-01', to: '2020-06' }, { from: '2020-01', to: '2021-06' }], 0, NOW)).toBe('1-3-years') // 30 months, not 36
    // No dated job: a number the file states, else nothing (the band has no default).
    expect(teachingBand([{ from: '', to: '' }], 12, NOW)).toBe('over-10-years')
    expect(teachingBand([], 0, NOW)).toBeNull()
    expect(teachingBand([], 'lots', NOW)).toBeNull()
  })

  it('certificates: the printed name decides the type, one row per type, hours/years in range or null', () => {
    const r = map(CV)!
    expect(r.fields.certificates).toEqual([
      { type: 'celta', hours: 120, provider: 'Cambridge English', year: 2018 },
      { type: 'tefl', hours: 120, provider: 'i-to-i', year: 2017 },
      { type: 'other-cert', hours: null, provider: '', year: null },
    ])
  })

  it('drops bio sentences Publish would refuse, keeps the rest in the teacher’s own words', () => {
    const r = map(CV)!
    expect(r.fields.bio).toBe('I teach English to children and teens.\n\nI love phonics and Cambridge exams.')
  })

  it('never imports a headline Publish would refuse, or one too short to pass', () => {
    expect(map({ isCv: true, headline: 'Teacher' })!.fields.headline).toBeUndefined()
    expect(map({ isCv: true, headline: 'English teacher — email me at jane@example.com' })!.fields.headline).toBeUndefined()
    expect(map({ isCv: true, headline: 'English teacher, visa sponsored jobs only' })!.fields.headline).toBeUndefined()
    expect(map({ isCv: true, headline: 'ESL Teacher @ILA Vietnam | CELTA' })!.fields.headline).toBe('ESL Teacher at ILA Vietnam | CELTA')
  })

  it('cuts a long headline at a separator, never mid-word', () => {
    const long = 'English teacher for kids and teens | IELTS and Cambridge exam preparation | Phonics specialist | Curriculum designer and teacher trainer'
    const h = map({ isCv: true, headline: long })!.fields.headline!
    expect(h.length).toBeLessThanOrEqual(120)
    expect(long.startsWith(h)).toBe(true)
    expect(h.endsWith('|')).toBe(false)
  })

  it('refuses a name with digits or contact details', () => {
    expect(map({ isCv: true, fullName: 'Jane 0901234567' })!.fields.fullName).toBeUndefined()
    expect(map({ isCv: true, fullName: 'jane@example.com' })!.fields.fullName).toBeUndefined()
    expect(map({ isCv: true, fullName: 'J' })!.fields.fullName).toBeUndefined()
    expect(map({ isCv: true, fullName: 'Nguyễn Thị Lan' })!.fields.fullName).toBe('Nguyễn Thị Lan')
  })

  it('nationality and English level only as the closed values', () => {
    expect(map({ isCv: true, nationalityCode: 'UK' })!.fields.nationality).toBeUndefined()
    expect(map({ isCv: true, nationalityCode: 'GB' })!.fields.nationality).toBe('GB')
    expect(map({ isCv: true, englishLevel: 'unknown' })!.fields.englishLevel).toBeUndefined()
    expect(map({ isCv: true, englishLevel: 'C2' })!.fields.englishLevel).toBeUndefined()
  })

  it('"Other language" only with the languages it names, and they are never also "spoken" languages', () => {
    const r = map({ isCv: true, subjects: ['other-language'], taughtLanguages: ['French'], spokenLanguages: ['French', 'German'] })!
    expect(r.fields.subjects).toEqual(['other-language'])
    expect(r.fields.teachLanguages).toEqual(['French'])
    expect(r.fields.languages).toEqual(['German'])
    expect(map({ isCv: true, subjects: ['other-language'] })!.fields.subjects).toBeUndefined()
    expect(map({ isCv: true, subjects: [], taughtLanguages: ['Korean'] })!.fields.subjects).toEqual(['other-language'])
  })

  it('offers a phone only as a dialable number', () => {
    expect(map(CV)!.phone).toBe('+84901234567')
    expect(map({ isCv: true, phone: 'call me' })!.phone).toBeNull()
  })

  it('⛔ never turns a local number from elsewhere into a Vietnamese one — only a country code or a VN mobile is offered', () => {
    expect(map({ isCv: true, phone: 'Mobile: 07700 900123' })!.phone).toBeNull() // a UK mobile, written locally
    expect(map({ isCv: true, phone: '020 7946 0958' })!.phone).toBeNull() // a London landline, written locally
    expect(map({ isCv: true, phone: '+44 7700 900123' })!.phone).toBe('+447700900123')
    expect(map({ isCv: true, phone: '0044 7700 900123' })!.phone).toBe('+447700900123')
    expect(map({ isCv: true, phone: '(+84) 90-123-4567' })!.phone).toBe('+84901234567')
    expect(map({ isCv: true, phone: '+44 (0)7700 900123' })!.phone).toBe('+447700900123') // the UK's trunk (0)
  })

  it('an answer in HTML entities is read as the letters it names (the fallback model, real-model eval 2026-10-16)', () => {
    const r = map({
      isCv: true, fullName: 'Cl&eacute;mence Aubert', taughtLanguages: ['Fran&ccedil;ais'],
      jobs: [{ role: 'French Teacher', employer: 'Institut fran&ccedil;ais de Hanoi', city: 'Hanoi', from: '2019-09', to: '', current: true, teaching: true, subjects: [], ageGroups: [] }],
      education: [{ level: 'master', field: 'FLE (Fran&ccedil;ais Langue &Eacute;trang&egrave;re)', institution: 'Universit&eacute; Lumi&egrave;re Lyon 2', year: 2018 }],
    })!
    expect(r.fields.fullName).toBe('Clémence Aubert')
    expect(r.fields.experience?.[0].employer).toBe('Institut français de Hanoi')
    expect(r.fields.degreeMajor).toBe('FLE (Français Langue Étrangère)')
    expect(r.fields.degreeInstitution).toBe('Université Lumière Lyon 2')
    // Decoded BEFORE the screens: a phone number written as character references is still a phone number.
    expect(map({ isCv: true, summary: 'Call me on &#48;&#57;&#48;&#49; 234 567 any time.' })!.fields.bio).toBeUndefined()
  })

  it('⛔ a local number the file places in another country is never offered as Vietnamese (real-model eval, 2026-10-16)', () => {
    // An Irish mobile written locally has a VN mobile's shape — "Mobile (Ireland): 087 123 4567" became +84 87 123 4567.
    expect(map({ isCv: true, phone: '087 123 4567', phoneCountry: 'IE' })!.phone).toBeNull()
    expect(map({ isCv: true, phone: '082 123 4567', phoneCountry: 'za' })!.phone).toBeNull()
    expect(map({ isCv: true, phone: '0912 345 678', phoneCountry: 'VN' })!.phone).toBe('+84912345678')
    // Placed nowhere — "", or anything that is not an ISO code: the VN mobile shape is offered, as before (a stand-in like
    // "unknown" or "N/A" must never hide a Vietnam-based teacher's real number — gate review, 2026-10-16).
    for (const none of ['unknown', '', 'N/A', 'Viet Nam', undefined]) {
      expect(map({ isCv: true, phone: '0912 345 678', phoneCountry: none })!.phone, String(none)).toBe('+84912345678')
    }
    // A country code written with the number decides it, whatever the country field says.
    expect(map({ isCv: true, phone: '+353 87 123 4567', phoneCountry: 'IE' })!.phone).toBe('+353871234567')
    expect(map({ isCv: true, phone: '+84 912 345 678', phoneCountry: 'IE' })!.phone).toBe('+84912345678')
  })

  it('⛔ a name Publish would refuse (a link, a banned word) is never imported', () => {
    expect(map({ isCv: true, fullName: 'Jane Smith www.janesmith.com' })!.fields.fullName).toBeUndefined()
  })

  it('labels the source', () => {
    expect(map({ isCv: true, documentKind: 'linkedin-profile' })!.source).toBe('linkedin-pdf')
    expect(map({ isCv: true, documentKind: 'cv' })!.source).toBe('cv')
  })

  it('only ever returns the importable fields', () => {
    const r = map({ ...CV, livesIn: 'city', currentCity: 'ho-chi-minh-city', jobTypes: ['fulltime'], teachAreasConfirmed: true, photoUrl: 'https://x', coverOpen: true, matchEmailOptIn: true })!
    for (const k of Object.keys(r.fields)) expect(IMPORT_FIELDS).toContain(k)
  })
})

describe('matchLanguage', () => {
  it.each([
    ['Spanish (B2)', 'Spanish'], ['Mandarin', 'Chinese'], ['mandarin chinese', 'Chinese'], ['Brazilian Portuguese', 'Portuguese'],
    ['Tagalog - fluent', 'Filipino'], ['French: native', 'French'], ['Vietnamese', 'Vietnamese'], ['Farsi', 'Persian'],
  ])('%s → %s', (raw, name) => {
    expect(matchLanguage(raw)?.name).toBe(name)
  })
  it('null for anything not on the list', () => {
    expect(matchLanguage('Klingon')).toBeNull()
    expect(matchLanguage('')).toBeNull()
    expect(matchLanguage(42)).toBeNull()
  })
  it('⛔ never another list language than the file names (review, 2026-10-16)', () => {
    expect(matchLanguage('Chinese (Cantonese)')?.name).toBe('Cantonese') // not Mandarin
    expect(matchLanguage('Scottish Gaelic')).toBeNull() // not Irish
    expect(matchLanguage('Serbo-Croatian')).toBeNull() // not Croatian
    expect(matchLanguage('Spanish (fluent)')?.name).toBe('Spanish')
  })
})

describe('the jobs, as the form can hold them (review, 2026-10-16)', () => {
  const jobs = (list: unknown[]) => map({ isCv: true, jobs: list })!.fields.experience ?? []
  const job = (from: string, to: string, current = false, role = 'English Teacher', employer = 'Apollo English') =>
    ({ role, employer, city: 'Hanoi', from, to, current, teaching: true })
  it('⛔ a bare-year end that is THIS year is a job that ended — never "I still work here"', () => {
    expect(jobs([job('2023', '2026')])).toEqual([{ role: 'English Teacher', employer: 'Apollo English', city: 'Hanoi', from: '2023-01', to: '2026-10' }])
  })
  it('a written end month still ahead is a contract running: current', () => {
    expect(jobs([job('2025-09', '2027-06')])[0].to).toBe('')
  })
  it('an end date that has passed wins over a "current" flag', () => {
    expect(jobs([job('2020-01', '2022-12', true)])[0].to).toBe('2022-12')
  })
  it('a job that has not started yet is not experience', () => {
    expect(jobs([job('2027-01', '2027-12')])).toEqual([])
  })
  it('the same job twice (a Word text box is written twice) is kept once', () => {
    expect(jobs([job('2020-01', '2022-12'), job('2020-01', '2022-12')])).toHaveLength(1)
  })
})

describe('the bio, screened as Publish screens it (review, 2026-10-16)', () => {
  it('⛔ a phone number wrapped across two lines never reaches the bio', () => {
    const bio = map({ isCv: true, summary: 'I am an experienced ESL teacher who loves helping young\nlearners build confidence. For a free demo lesson call +84 901\n234 567 any day.' })!.fields.bio ?? ''
    expect(bio).toBe('I am an experienced ESL teacher who loves helping young learners build confidence.')
  })
  it('a wrapped line joins its paragraph; blank lines still separate paragraphs', () => {
    const bio = map({ isCv: true, summary: 'Five years teaching IELTS to\nadults in Hanoi.\n\nI love phonics with young learners.' })!.fields.bio
    expect(bio).toBe('Five years teaching IELTS to adults in Hanoi.\n\nI love phonics with young learners.')
  })
})

describe('mergeImport', () => {
  it('fills only what is unanswered and returns a new object', () => {
    const t = { ...EMPTY_TEACHER, fullName: 'Typed Name', subjects: ['ielts'] }
    const { next, filled } = mergeImport(t, { fullName: 'Imported', subjects: ['phonics'], headline: 'English teacher for kids', bio: 'Hello.' })
    expect(next).not.toBe(t)
    expect(next.fullName).toBe('Typed Name')
    expect(next.subjects).toEqual(['ielts'])
    expect(next.headline).toBe('English teacher for kids')
    expect(next.bio).toBe('Hello.')
    expect(filled).toEqual(['headline', 'bio'])
  })

  it('returns the SAME object when nothing changed (the untouched-form check is a reference check)', () => {
    const { next, filled } = mergeImport(EMPTY_TEACHER, {})
    expect(next).toBe(EMPTY_TEACHER)
    expect(filled).toEqual([])
  })

  it('never touches the situation answers (step 1) or consents', () => {
    const t = { ...EMPTY_TEACHER, livesIn: 'city' as const, currentCity: 'ha-noi', jobTypes: ['fulltime'] }
    const { next } = mergeImport(t, { fullName: 'A Name' } as never)
    expect(next.livesIn).toBe('city')
    expect(next.currentCity).toBe('ha-noi')
    expect(next.jobTypes).toEqual(['fulltime'])
  })

  it('keeps degree details off a degree level the teacher chose differently', () => {
    const t = { ...EMPTY_TEACHER, degreeLevel: 'bachelor' }
    const { next, filled } = mergeImport(t, { degreeLevel: 'master', degreeMajor: 'Education', degreeInstitution: 'Leeds', degreeYear: 2019 })
    expect(next.degreeLevel).toBe('bachelor')
    expect(next.degreeMajor).toBe('')
    expect(filled).toEqual([])
  })
})
