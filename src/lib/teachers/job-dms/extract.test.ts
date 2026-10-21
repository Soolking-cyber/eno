import { describe, expect, it } from 'vitest'
import { denyReason, foldPost, readKind, readPay, readPlaces, readAgeGroups, readPost, readRequirements, readSchedule, titleNamesOtherSubject } from './extract'

// Wed 21 Oct 2026, 09:00 Vietnam time.
const POSTED = new Date('2026-10-21T02:00:00Z')

describe('readKind', () => {
  it('reads a school hiring post', () => {
    expect(readKind(foldPost('We are hiring native English teachers for our centre in District 7. Salary 450k/h.'))).toBe('job_offer')
    expect(readKind(foldPost('Trung tâm Anh ngữ ABC tuyển giáo viên nước ngoài dạy trẻ em tại Quận 3'))).toBe('job_offer')
  })
  it('reads an urgent cover request', () => {
    expect(readKind(foldPost('URGENT cover needed tomorrow 6-7:30pm, kids class, Binh Thanh, 400k/h'))).toBe('cover_request')
    expect(readKind(foldPost('Cần giáo viên dạy thay tối nay tại Gò Vấp'))).toBe('cover_request')
  })
  it('reads a job seeker as a seeker, not a job', () => {
    expect(readKind(foldPost("Hi all, I'm a native English teacher looking for part-time classes in HCMC. TEFL certified."))).toBe('job_seeker')
    expect(readKind(foldPost('I am looking for a new teaching job in Hanoi, available from November. DM me for my CV'))).toBe('job_seeker')
  })
  it('a post about something else is other', () => {
    expect(readKind(foldPost('Anyone know a good dentist in Thao Dien?'))).toBe('other')
  })
})

describe('denyReason — refused whole, never matched', () => {
  it('a gender ask', () => {
    expect(denyReason('Looking for a female teacher for our kindergarten class')).toBe('gender')
    expect(denyReason('Tuyển GV nữ dạy mầm non')).toBe('gender')
    expect(denyReason('Females only, kindergarten')).toBe('discriminatory')
  })
  it('a nationality or passport list', () => {
    expect(denyReason('Native speakers with passports from US, UK, Canada, Australia only')).toBe('nationality')
    expect(denyReason('Must hold a US/UK/AU passport')).toBe('nationality')
    expect(denyReason('Westerners only')).toBe('nationality')
  })
  it('an age limit and a fee (JOB_DENY)', () => {
    expect(denyReason('Teachers aged under 35 please')).toBe('discriminatory')
    expect(denyReason('Training fee required before start')).toBe('fee')
  })
  it('a class description is not a gender ask', () => {
    expect(denyReason('Teaching a class of female students, adults, IELTS')).toBeNull()
    expect(denyReason('We need a native English teacher for kids, District 2')).toBeNull()
  })
})

describe('readPlaces', () => {
  it('an HCMC district, in the forms posts use', () => {
    for (const s of ['District 7', 'Quận 7', 'Q7', 'Q.7', 'D7', 'Dist 7', 'Phu My Hung']) {
      const r = readPlaces(foldPost(`Cover in ${s} tomorrow`))
      expect(r.places).toContain('d7')
      expect(r.places).toContain('ho-chi-minh-city')
      expect(r.cityOnly).toBe(false)
    }
  })
  it('District 1 is not District 10', () => {
    const r = readPlaces(foldPost('Centre in District 10'))
    expect(r.places).toContain('d10')
    expect(r.places).not.toContain('d1')
  })
  it('a whole HCMC post is city-only; Hanoi and Da Nang are never city-only', () => {
    expect(readPlaces(foldPost('Full-time job in Saigon'))).toEqual({ places: ['ho-chi-minh-city'], cityOnly: true })
    expect(readPlaces(foldPost('Cover in Cau Giay tonight'))).toEqual({ places: ['ha-noi'], cityOnly: false })
    expect(readPlaces(foldPost('School in Hoi An'))).toEqual({ places: ['da-nang'], cityOnly: false })
  })
  it('short names need a place word', () => {
    expect(readPlaces(foldPost('Ms Hue will contact you')).places).toEqual([])
    expect(readPlaces(foldPost('Our school in Hue')).places).toEqual(['hue'])
    expect(readPlaces(foldPost('Mr Vinh is the manager')).places).toEqual([])
    expect(readPlaces(foldPost('Teaching job in HN')).places).toEqual(['ha-noi'])
  })
  it('"đi ăn" is not a place', () => {
    expect(readPlaces(foldPost('Sau giờ dạy mình đi ăn')).places).toEqual([])
  })
  it('provinces, old names and online', () => {
    expect(readPlaces(foldPost('Teach in Quy Nhon')).places).toEqual(['p-52'])
    expect(readPlaces(foldPost('Nha Trang centre')).places).toEqual(['khanh-hoa'])
    expect(readPlaces(foldPost('Online classes via Zoom')).places).toEqual(['online'])
  })
})

describe('readPay', () => {
  it('hourly', () => {
    expect(readPay(foldPost('Pay 400k/h'))).toMatchObject({ min: 400_000, max: 400_000, unit: 'hour' })
    expect(readPay(foldPost('350-450k per hour'))).toMatchObject({ min: 350_000, max: 450_000, unit: 'hour' })
    expect(readPay(foldPost('Lương 400.000đ/giờ'))).toMatchObject({ min: 400_000, unit: 'hour' })
    expect(readPay(foldPost('$20/hour'))).toMatchObject({ min: 520_000, unit: 'hour' })
  })
  it('per session', () => {
    expect(readPay(foldPost('500k/buổi'))).toMatchObject({ min: 500_000, unit: 'session' })
  })
  it('monthly', () => {
    expect(readPay(foldPost('Salary: 25-30 million VND'))).toMatchObject({ min: 25_000_000, max: 30_000_000, unit: 'month' })
    expect(readPay(foldPost('lương 25tr-35tr/tháng'))).toMatchObject({ min: 25_000_000, max: 35_000_000, unit: 'month' })
    expect(readPay(foldPost('1,200-1,800 USD/month'))).toMatchObject({ min: 31_200_000, max: 46_800_000, unit: 'month' })
  })
  it('times, ages and counts are not pay', () => {
    expect(readPay(foldPost('Class 6-7:30pm, kids 6 to 8 years old, 10 students'))).toBeNull()
    expect(readPay(foldPost('Contact 0901 234 567'))).toBeNull()
  })
})

describe('readSchedule', () => {
  it('tomorrow evening', () => {
    expect(readSchedule(foldPost('cover tomorrow 6-7:30pm'), POSTED)).toEqual({ date: '2026-10-22', day: 'thu', part: 'eve', hour: 18, label: 'Thu 22 Oct, evening' })
  })
  it('a weekday is the next one on or after the post day', () => {
    expect(readSchedule(foldPost('this Saturday morning'), POSTED)).toMatchObject({ date: '2026-10-24', day: 'sat', part: 'am' })
  })
  it('a date', () => {
    expect(readSchedule(foldPost('on 28/10 from 18:00'), POSTED)).toMatchObject({ date: '2026-10-28', day: 'wed', part: 'eve' })
  })
  it('nothing stated', () => {
    expect(readSchedule(foldPost('cover needed asap'), POSTED)).toBeNull()
  })
})

describe('readRequirements', () => {
  it('native required unless non-natives are welcome', () => {
    expect(readRequirements(foldPost('Native English speakers only')).native).toBe('required')
    expect(readRequirements(foldPost('Native or non-native welcome')).native).toBe('none')
    expect(readRequirements(foldPost('Native speaker preferred')).native).toBe('preferred')
  })
  it('degree, TEFL, years', () => {
    const r = readRequirements(foldPost("Requirements: Bachelor's degree, TEFL/TESOL certificate, at least 2 years of teaching experience"))
    expect(r).toMatchObject({ degree: 'required', tefl: 'required', minYears: 2 })
  })
  it('in Vietnam / from abroad', () => {
    expect(readRequirements(foldPost('Candidates must be currently in Vietnam')).inVietnam).toBe(true)
    expect(readRequirements(foldPost('Overseas applicants welcome, flight allowance')).abroadOk).toBe(true)
  })
})

describe('readPost', () => {
  it('a typical cover request end to end', () => {
    const f = readPost('URGENT: our centre needs a cover teacher tomorrow 6-7:30pm in Binh Thanh. Kids 8-10, phonics. 400k/h. TEFL preferred.', POSTED)
    expect(f).toMatchObject({
      kind: 'cover_request', poster: 'school', places: ['binh-thanh', 'ho-chi-minh-city'], cityOnly: false,
      pay: { min: 400_000, unit: 'hour' }, schedule: { date: '2026-10-22', part: 'eve' }, ageGroups: ['kids'], deny: null,
    })
    expect(f.employment).toContain('cover')
    expect(f.requirements.tefl).toBe('preferred')
    expect(f.subjects).toContain('phonics')
  })
  it('a teacher asking someone to cover their own class is a swap, not a school', () => {
    expect(readPost("Hi, I need someone to cover my class tomorrow in D2, can't make it", POSTED).poster).toBe('teacher')
  })
})

describe('Vietnamese-language posts', () => {
  it('a post recruiting Vietnamese teachers or TAs is dropped', () => {
    expect(readPost('Trung tâm tuyển giáo viên tiếng Anh và trợ giảng tại Quận 7, lương 8 triệu', POSTED).deny).toBe('vietnamese-oriented')
  })
  it('a Vietnamese post for a foreign teacher stays', () => {
    expect(readPost('Trung tâm tuyển giáo viên nước ngoài dạy trẻ em tại Quận 3, 400k/h', POSTED).deny).toBeNull()
    expect(readPost('Cần gấp giáo viên bản ngữ dạy thay tối nay tại Gò Vấp', POSTED).deny).toBeNull()
  })
  it('an English post is never "Vietnamese-oriented"', () => {
    expect(readPost('We are hiring English teachers in District 7', POSTED).deny).toBeNull()
  })
})

describe('readPay — durations and distances are not money (measured misreads, 2026-10-20)', () => {
  it('minutes and kilometres', () => {
    for (const s of ['Time: 16:30 to 17:30 (60mins in total)', 'Dong Anh, Hanoi (40 minutes from the downtown)', '45 minutes/period', 'a short video (1–2 minutes)', '45km from Hanoi']) expect(readPay(foldPost(s))).toBeNull()
  })
  it('"430 thousand an hour" is the pay, not the 300k gas money after it', () => {
    expect(readPay(foldPost('Pay: 430 thousand an hour Plus 300k for gas money per month'))).toMatchObject({ min: 430_000, unit: 'hour' })
  })
})

describe('readPlaces — a distance is not the place', () => {
  it('"(40 mins from Hanoi)" places the job in Bac Ninh only', () => {
    expect(readPlaces(foldPost("I'm looking for cover teacher this evening - Location: Que Vo, Bac Ninh (40 mins from Hanoi)")).places).toEqual(['p-24'])
    expect(readPlaces(foldPost('Our centre in Bac Giang city (45km from Hanoi)')).places).toEqual(['p-24'])
  })
})

describe('readSchedule — parts of the day (measured misreads)', () => {
  it('a range takes its meridiem from either end', () => {
    expect(readSchedule(foldPost('a small class tonight. Time: 7:30–8:30 PM'), POSTED)?.part).toBe('eve')
    expect(readSchedule(foldPost('Tuesday 5:45-9:00 (2 classes)'), POSTED)?.part).toBe('eve')
    expect(readSchedule(foldPost('Wednesday morning 7:25 AM – 11:20 AM'), POSTED)?.part).toBe('am')
  })
})

describe('denyReason — held-out misses (2026-10-20)', () => {
  it('origin asks in the market\'s own forms', () => {
    for (const s of [
      '[Go Vap - EU with fluent level or Native Speaker] Our kindergarten is looking for an ESL teacher',
      'Experience teaching kindergarten and has either British or Irish accent',
      'Teachers to work in Vung Tau, from English-speaking countries or European countries, South Africa',
      'We are looking for native English teachers (UK, Australia, USA, New Zealand, Canada, Ireland)',
      'Need Native Teachers from American,UK, South Africa, Ireland,Irish,Canada',
      '1. PRIMARY SCHOOL – DISTRICT 12European Teacher | Part-time',
      'Native English speaker from a country where English is the first language',
    ]) expect(denyReason(s), s).toBe('nationality')
  })
  it('a gender ask with a nationality in between; an inclusive line is not one', () => {
    expect(denyReason("I'm looking for a female Philippino teacher for an adult learner")).toBe('gender')
    expect(denyReason('Male and female teachers are welcome to apply')).toBeNull()
  })
})

describe('second held-out set misses (2026-10-20)', () => {
  it('gender, age and origin in more forms', () => {
    expect(denyReason('We are looking for a Man Part time English Teacher for preschool')).toBe('gender')
    expect(denyReason('We are looking for a Female South Africa / Native speaker teacher')).toBe('gender')
    expect(denyReason('Position 2: I need 1 female teacher in Ha Dong. 1 male or female teacher is acceptable in Hoang Mai')).toBe('gender')
    expect(denyReason('Requirements: - Aged 21-31 (requirement from the program)')).toBe('discriminatory')
    expect(denyReason('Teachers who are from a native english speaking countries')).toBe('nationality')
    expect(denyReason('𝐖𝐇𝐀𝐓 𝐘𝐎𝐔 𝐍𝐄𝐄𝐃? Eu (Ukraine, Russia, Serbia, Belarus,...) A university degree')).toBe('nationality')
  })
  it('students\' ages and an inclusive line are not asks', () => {
    expect(denyReason('Kids aged 6-12, class of 10')).toBeNull()
    expect(denyReason('Male and female teachers are welcome to apply')).toBeNull()
  })
  it('teaching Vietnamese is not one of our jobs', () => {
    expect(readPost("I'm looking for a qualified, professional teacher of Vietnamese as a foreign language in Da Nang", POSTED).kind).toBe('other')
  })
})

describe('third held-out set misses (2026-10-20)', () => {
  it('nationality in more forms', () => {
    expect(denyReason('[HCM – District 7] FULL-TIME FILIPINO ESL TEACHERS NEEDED')).toBe('nationality')
    expect(denyReason('[HIRING] LOOKING FOR ESL EUROPE TEACHER in Bac Ninh')).toBe('nationality')
    expect(denyReason('Requirement: NES or Europe country with clear accent')).toBe('nationality')
    expect(denyReason('Teachers from non-Asian countries are preferred')).toBe('nationality')
    expect(denyReason('English Tutor (Vietnamese people) Job Description: we are seeking an English tutor')).toBe('nationality')
  })
  it('a warning, a paperwork ad and a teacher selling themselves are not offers', () => {
    expect(readPost('Beware of this institute and this Scammer Woman. She always needs teachers', POSTED).kind).toBe('other')
    expect(readPost('Comprehensive Legal Document Processing Services in Vietnam … the largest foreign teacher recruitment website', POSTED).kind).toBe('other')
    expect(readPost("Hi everyone, I'm currently looking for English teaching or tutoring work from June", POSTED).kind).toBe('job_seeker')
  })
  it('still reads ordinary posts', () => {
    expect(denyReason('We are a European-standard bilingual school hiring English teachers')).toBeNull()
    expect(readPost('We are hiring an English teacher for our centre in District 7, 450k/hour', POSTED).kind).toBe('job_offer')
  })
})

describe('gate 1a reviewer findings (codex + opus, 2026-10-20) — each measured before the fix', () => {
  const r = (s: string) => readPost(s, POSTED)
  it('a requirement keeps its own qualifier', () => {
    expect(readRequirements(foldPost('Native English speaker required. TEFL preferred. Degree required.'))).toMatchObject({ native: 'required', tefl: 'preferred', degree: 'required' })
    expect(readRequirements(foldPost('TEFL is a plus. Native speaker required.'))).toMatchObject({ native: 'required', tefl: 'preferred' })
    expect(readRequirements(foldPost('Requirements: native speaker, a degree, TEFL (preferred)'))).toMatchObject({ native: 'required', degree: 'required', tefl: 'preferred' })
    expect(readRequirements(foldPost('Native speakers preferred. Must be a native English teacher.'))).toMatchObject({ native: 'required' })
  })
  it('Vietnamese typed without accents, or decomposed, is still Vietnamese', () => {
    expect(r('Trung tam tuyen giao vien tieng Anh tai Quan 7, luong 8 trieu').deny).toBe('vietnamese-oriented')
    expect(r('Tuyển giáo viên tiếng Anh tại Quận 7, lương 8 triệu'.normalize('NFD')).deny).toBe('vietnamese-oriented')
    expect(r('Tuyen giao vien nuoc ngoai day tieng Anh tai Quan 7, luong 20 trieu').deny).toBeNull()
    expect(r('We are hiring an English teacher in Quan 7 near Hoc Mon, kids class, 450k per hour').deny).toBeNull()
  })
  it('dates: dotted, never "24/7" or a fraction, never months away', () => {
    expect(r('URGENT cover teacher needed on 25.10.2026 at 6pm, District 7, kids class').schedule?.date).toBe('2026-10-25')
    expect(r('Cover teacher needed 24/7 support, District 3, kids class tomorrow').schedule?.date).toBe('2026-10-22')
    expect(r('Cover teacher needed for 2/3 classes, District 3').schedule?.date ?? null).toBeNull()
  })
  it('Vietnamese and exam words are not weekdays or evenings', () => {
    const s = r('Cần GV dạy thay môn Anh, tôi cần gấp, giáo viên nước ngoài').schedule
    expect(s?.day ?? null).toBeNull()
    expect(s?.part ?? null).toBeNull()
    expect(r('Need cover teacher for SAT class, District 3').schedule?.day ?? null).toBeNull()
    expect(r('Cover teacher needed Sat 6pm, District 3, kids class').schedule?.day).toBe('sat')
    expect(r('Cần giáo viên nước ngoài dạy thay buổi tối thứ 7, Quận 3').schedule?.part).toBe('eve')
  })
  it('"be" is not "bé"', () => {
    expect(readAgeGroups(foldPost('IELTS for adults, candidates must be in Vietnam'))).toEqual(['adults'])
    expect(readAgeGroups(foldPost('Cần giáo viên nước ngoài dạy các bé mầm non'))).toContain('kids')
  })
  it('asks written as form fields are refused', () => {
    expect(denyReason('Hiring English teacher. Gender: Female. District 7')).toBe('gender')
    expect(denyReason('Hiring English teacher. Requirements: Female; degree')).toBe('gender')
    expect(denyReason('Tuyển giáo viên nước ngoài. Giới tính: Nữ')).toBe('gender')
    expect(denyReason('Tuyển giáo viên nước ngoài. Tuổi: 22-35')).toBe('discriminatory')
    expect(denyReason('English teacher needed. Must hold a UK or US passport')).toBe('nationality')
    expect(denyReason('English teacher needed. Nationality: USA/UK')).toBe('nationality')
    expect(denyReason('English teacher needed. Age: under 40')).toBe('discriminatory')
  })
  it('and their inclusive forms are not', () => {
    expect(denyReason('Hiring English teacher. Gender: Male/Female. District 7')).toBeNull()
    expect(denyReason('Hiring English teacher. Nationality: any')).toBeNull()
    expect(denyReason('Kids class, students aged 6-12, District 7')).toBeNull()
  })
})

describe('native is required only when non-natives are not taken (held-out 3, 2026-10-20)', () => {
  const nat = (s: string) => readRequirements(foldPost(s)).native
  it('inclusive forms are not a requirement', () => {
    expect(nat('Looking for non- native teacher needed for one kindergarten')).toBe('none')
    expect(nat('Requirements • Native or near-native English speaker. • Bachelor’s degree')).toBe('none')
    expect(nat('Language skills: native English speaker or non-native speaker with native-level fluency')).toBe('none')
    expect(nat("HIRING ESL / NATIVE ENGLISH TEACHER – HANOI We're looking for an ESL or native English teacher")).toBe('none')
    expect(nat('[WE ARE HIRING] NATIVE/NON-NATIVE ENGLISH TEACHERS')).toBe('none')
    expect(nat('English proficiency certificate (non-native speakers)')).toBe('none')
    expect(nat('Good English and clear pronunciation (native speaker not required)')).toBe('none')
    expect(nat('a caring teacher (native English speaker or Vietnamese local teacher)')).toBe('none')
  })
  it('a native requirement still reads as one', () => {
    expect(nat('Native English speakers only. Degree required.')).toBe('required')
    expect(nat('Native English teacher needed for kids class, District 7')).toBe('required')
    expect(nat('Native speakers only, no non-natives please')).toBe('required')
  })
})

describe('gate 1b reviewer findings (codex + opus, 2026-10-20) — each measured before the fix', () => {
  const req = (s: string) => readRequirements(foldPost(s))
  it('a negated or employer-provided qualification is not asked for', () => {
    expect(req('TEFL not required. Degree required.')).toMatchObject({ tefl: 'none', degree: 'required' })
    expect(req('No degree required, TEFL a plus')).toMatchObject({ degree: 'none', tefl: 'preferred' })
    expect(req('A degree is not necessary')).toMatchObject({ degree: 'none' })
    expect(req('We provide free TEFL training for new teachers')).toMatchObject({ tefl: 'none' })
    expect(req('TEFL certificate required; we sponsor your work permit')).toMatchObject({ tefl: 'required' })
  })
  it('metres are not millions', () => {
    expect(readPay(foldPost('Located 200m from Vincom, pay 400k/h'))).toMatchObject({ max: 400_000, unit: 'hour' })
    expect(readPay(foldPost('Classroom 30m2, salary 25 million per month'))).toMatchObject({ max: 25_000_000, unit: 'month' })
    expect(readPay(foldPost('Hiring teacher, 2m from the school gate'))).toBeNull()
    expect(readPay(foldPost('Salary: 30m/month'))).toMatchObject({ max: 30_000_000, unit: 'month' })
    expect(readPay(foldPost('Package 35m net, housing included'))).toMatchObject({ max: 35_000_000 })
  })
  it('"2 hours to adults in Thu Duc" is a lesson, not a distance', () => {
    expect(readPlaces(foldPost('Teach 2 hours to adults in Thu Duc; our main branch is District 1')).places).toEqual(expect.arrayContaining(['thu-duc', 'd1']))
    expect(readPlaces(foldPost('Que Vo, Bac Ninh (40 mins from Hanoi)')).places).not.toContain('ha-noi')
    expect(readPlaces(foldPost('Our school is 30 minutes to Hanoi by car, in Bac Ninh')).places).not.toContain('ha-noi')
  })
  it('a job listing (LinkedIn alert, team forward) needs no hiring words but keeps the role screens', () => {
    const L = (s: string) => readPost(s, POSTED, { listing: true }).kind
    expect(L('English Teacher · ILA Vietnam · Ho Chi Minh City')).toBe('job_offer')
    expect(L('Teaching Assistant – ABC School, Hanoi')).toBe('other')
    expect(L('Sales Executive · Saigon Co · Ho Chi Minh City')).toBe('other')
    expect(L('Vietnamese Language Teacher · Expat Centre · Hanoi')).toBe('other')
    expect(L('Cover teacher needed this Saturday · District 7 · ABC Centre')).toBe('cover_request')
  })
})

describe('gate 1c reviewer findings (codex + opus, 2026-10-20) — each measured before the fix', () => {
  const r = (s: string, listing = false) => readPost(s, POSTED, { listing })
  it('asks that slipped through are refused', () => {
    expect(r('English teacher needed in District 3. US citizens only').deny).toBe('nationality')
    expect(r('English teacher needed in District 3. U.S. citizens preferred').deny).toBe('nationality')
    expect(r('Tuyển giáo viên Tây dạy tiếng Anh tại Quận 3').deny).toBe('nationality')
    expect(r('Tuyển giáo viên nước ngoài, ưu tiên giáo viên da trắng, Quận 3').deny).toBe('discriminatory')
    expect(r('Hiring English teacher in District 3. Requirements: max 40 years old, degree').deny).toBe('discriminatory')
    // (eno's own job screen, job-listing.ts JOB_DENY, refuses "under NN years old" whoever it is about — kept.)
    expect(r('Hiring English teacher in District 3, adult class: students over 18 years old').deny).toBeNull()
    expect(readRequirements(foldPost('Native speakers required; non-native candidates will not be considered')).native).toBe('required')
  })
  it('"male and female teachers" is not an ask', () => {
    expect(r('We are hiring male and female teachers in District 3').deny).toBeNull()
  })
  it('assistant and non-teaching roles are not teaching jobs', () => {
    expect(r('Hiring Teacher Assistants for our kindergarten in District 7').kind).toBe('other')
    expect(r('English Teacher Assistant · ABC · Ho Chi Minh City', true).kind).toBe('other')
    expect(r('Admissions Officer · IELTS Centre · Hanoi', true).kind).toBe('other')
    expect(r('IELTS Sales Consultant · ILA · Ho Chi Minh City', true).kind).toBe('other')
    expect(r("We're hiring sales staff at our TEFL academy in District 3").kind).toBe('other')
    expect(r('We are hiring English teachers and teaching assistants in District 7').kind).toBe('job_offer')
    expect(r('IELTS Teacher · ILA Vietnam · Ho Chi Minh City', true).kind).toBe('job_offer')
  })
  it('places: a quarter, a street and a distance', () => {
    expect(readPlaces(foldPost('Hiring English teacher in Hanoi. Start date: Q1 2027')).places).toEqual(['ha-noi'])
    expect(readPlaces(foldPost('Our centre on Hai Ba Trung street, District 1, is hiring')).places).not.toContain('ha-noi')
    expect(readPlaces(foldPost('Our school is 40 minutes from Hanoi in Bac Ninh')).places).toEqual(['p-24'])
  })
  it('schedules: a duration, an earlier date, the nearest year, exact month names, weekday order', () => {
    expect(readSchedule(foldPost('Cover needed, 2h class, District 3, tomorrow'), POSTED)?.part ?? null).toBeNull()
    expect(readSchedule(foldPost('Cover needed at 2h, District 3, tomorrow'), POSTED)?.part).toBe('pm')
    expect(readSchedule(foldPost('Posted 19/10/2026; cover needed tomorrow 6pm, D7'), POSTED)?.date).toBe('2026-10-22')
    expect(readSchedule(foldPost('Cover teacher needed 30/12, District 3'), new Date('2026-12-29T03:00:00Z'))?.date).toBe('2026-12-30')
    expect(readSchedule(foldPost('Cover teacher needed 3/1, District 3'), new Date('2026-12-29T03:00:00Z'))?.date).toBe('2027-01-03')
    expect(readSchedule(foldPost('Cover teacher for novice 5 students in District 3'), POSTED)?.date ?? null).toBeNull()
    expect(readSchedule(foldPost('Cover teacher needed Saturday or Sunday morning, District 3'), POSTED)?.day).toBe('sat')
  })
})

describe('gate 1d reviewer findings (codex + opus, 2026-10-20)', () => {
  const r = (s: string, listing = false) => readPost(s, POSTED, { listing })
  it('"UK English teacher required" is held; a Vietnamese post saying natives are NOT needed stays Vietnamese-oriented', () => {
    expect(r('Our centre in District 3 is hiring: UK English teacher required').mention).toBe('country')
    expect(r('Tuyển giáo viên tiếng Anh tại Quận 7, lương 8 triệu, không cần bản ngữ').deny).toBe('vietnamese-oriented')
  })
  it('HCMC addresses with Hanoi district names stay in HCMC', () => {
    expect(readPlaces(foldPost('Our centre at 123 Hai Ba Trung, District 1, is hiring')).places).not.toContain('ha-noi')
    expect(readPlaces(foldPost('Thạnh Xuân, Quận 12 — cần giáo viên nước ngoài')).places).not.toContain('ha-noi')
    expect(readPlaces(foldPost('Hiring in Thanh Xuan, Hanoi')).places).toContain('ha-noi')
    expect(readPlaces(foldPost('Hiring a teacher in Cau Giay')).places).toContain('ha-noi')
  })
  it('pay: a phone is not a salary; USD before the figure', () => {
    expect(readPay(foldPost('Lương: liên hệ 090.123.4567, 20 triệu/tháng'))).toMatchObject({ max: 20_000_000, unit: 'month' })
    expect(readPay(foldPost('Salary USD 1,500/month'))).toMatchObject({ max: 1_500 * 26_000, unit: 'month' })
  })
  it('dates and times: a grade, a posted date and time, "Sun" the brand', () => {
    expect(readSchedule(foldPost('Cover teacher needed tomorrow 6pm for grade 10/11 class, District 7'), POSTED)?.date).toBe('2026-10-22')
    expect(readSchedule(foldPost('Posted 21/10/2026; cover needed 23/10/2026, District 7'), POSTED)?.date).toBe('2026-10-23')
    expect(readSchedule(foldPost('Posted at 09:00; cover needed tomorrow 18:00, District 7'), POSTED)?.part).toBe('eve')
    expect(readSchedule(foldPost('Sun English Centre needs a cover teacher, District 7'), POSTED)?.day ?? null).toBeNull()
  })
  it('a job about teachers is not a teaching job', () => {
    expect(r('Teacher Recruitment Specialist · Apollo · Ho Chi Minh City', true).kind).toBe('other')
  })
})

describe('gate 1e reviewer findings (codex + opus, 2026-10-20)', () => {
  const r = (s: string, listing = false) => readPost(s, POSTED, { listing })
  it('Vietnamese gender and age asks with words between', () => {
    expect(r('Tuyển giáo viên bản ngữ nữ dạy mầm non tại Quận 7').deny).toBe('gender')
    expect(r('Tuyển giáo viên nước ngoài, nữ, 25-30 tuổi, Quận 3').deny).toBe('gender')
    expect(r('Tuyển giáo viên nước ngoài (nữ) dạy tại Quận 3').deny).toBe('gender')
    expect(r('Cần nữ giáo viên nước ngoài tại Quận 3').deny).toBe('gender')
    expect(r('Tuyển giáo viên nước ngoài 25-35 tuổi, Quận 3').deny).toBe('discriminatory')
    expect(r('Cần giáo viên nước ngoài dạy học viên 18-25 tuổi tại Quận 3').deny).toBeNull()
    expect(r('Tuyển giáo viên nước ngoài tại Việt Nam, Quận 3').deny).toBeNull()
  })
  it('other nationality adjectives are held', () => {
    expect(r('Our centre in District 3 is hiring: French teachers only').mention ?? r('Our centre in District 3 is hiring: French teachers only').deny).toBeTruthy()
  })
  it('listing titles: a non-teaching role, or a trainer/coach/instructor of something else, is not a teaching job', () => {
    expect(r('Teacher Sales Consultant · ABC · Ho Chi Minh City', true).kind).toBe('other')
    expect(r('Sales Trainer · Prudential · Ho Chi Minh City', true).kind).toBe('other')
    expect(r('Yoga Instructor · Wellness Co · Hanoi', true).kind).toBe('other')
    expect(r('Football Coach · Sports Academy · Hanoi', true).kind).toBe('other')
    expect(r('IELTS Instructor · ILA · Ho Chi Minh City', true).kind).toBe('job_offer')
    expect(r('We are hiring yoga instructors for our studio in District 3').kind).toBe('other')
  })
  it('a quarter is not a district, "in Q1" still is', () => {
    expect(readPlaces(foldPost('Hanoi centre hiring, start Q3')).places).toEqual(['ha-noi'])
    expect(readPlaces(foldPost('Our centre in Q1 is hiring')).places).toEqual(expect.arrayContaining(['d1', 'ho-chi-minh-city']))
  })
})

describe('gate 2a reviewer findings on the reader (opus, 2026-10-20)', () => {
  it('"nữ sinh" is the class, not an ask; an instructor for an English centre is a teaching role', () => {
    expect(readPost('Cần giáo viên nước ngoài dạy nữ sinh lớp 10 tại Quận 3', POSTED).deny).toBeNull()
    expect(readPost("We're hiring instructors for our English centre in District 3", POSTED).kind).toBe('job_offer')
  })
})

describe('gate 2b reviewer findings on the reader (opus, 2026-10-20)', () => {
  it('"Giới tính: Nam/Nữ" is inclusive; "người lớn 25-40 tuổi" is the class', () => {
    expect(readPost('Tuyển giáo viên nước ngoài tại Quận 3. Giới tính: Nam/Nữ', POSTED).deny).toBeNull()
    expect(readPost('Cần giáo viên nước ngoài dạy người lớn 25-40 tuổi tại Quận 3', POSTED).deny).toBeNull()
  })
  it('a clock time is kept as the start hour', () => {
    expect(readSchedule(foldPost('cover at 8pm tonight'), POSTED)).toMatchObject({ part: 'eve', hour: 20 })
    expect(readSchedule(foldPost('cover this evening'), POSTED)).toMatchObject({ part: 'eve', hour: null })
  })
})

describe('gate 2c reviewer findings on the reader (opus, 2026-10-20)', () => {
  it('"tại Việt Nam, nữ" is an ask, not "nam, nữ"', () => {
    expect(readPost('Tuyển GV nước ngoài tại Việt Nam, nữ, Quận 3', POSTED).deny).toBe('gender')
    expect(readPost('Tuyển giáo viên nước ngoài, giới tính: nam, nữ, Quận 3', POSTED).deny).toBeNull()
  })
  it('"Instructor needed, kindergarten" is a teaching role', () => {
    expect(readPost('Instructor needed for our kindergarten in District 7, 400k/h', POSTED).kind).toBe('job_offer')
  })
})

describe('gate 2d reviewer findings on the reader (opus, 2026-10-20)', () => {
  it('"năm" (a year) is not "nam"; class words before an age range', () => {
    expect(readPost('Tuyển giáo viên nước ngoài, lương 300 triệu/năm, Quận 3', POSTED).deny).toBeNull()
    expect(readPost('Cần giáo viên nước ngoài dạy lớp người đi làm 25-40 tuổi tại Quận 3', POSTED).deny).toBeNull()
    expect(readPost('Hiring a teacher to teach working professionals 25-40 years old in District 3', POSTED).deny).toBeNull()
  })
  it('sports and arts jobs for kids are not English teaching jobs', () => {
    expect(readPost('We are hiring swimming instructors for kids in District 7', POSTED).kind).toBe('other')
    expect(readPost('Football coach needed for our kindergarten in District 2', POSTED).kind).toBe('other')
    expect(readPost('Piano teacher needed for our kids, District 3', POSTED).kind).toBe('other')
    expect(readPost('English teacher needed for our kindergarten; we also run art classes. District 2', POSTED).kind).toBe('job_offer')
  })
  it('"7h tối" is 7pm', () => {
    expect(readSchedule(foldPost('Cần giáo viên nước ngoài dạy thay lúc 7h tối mai, Quận 3'), POSTED)).toMatchObject({ part: 'eve', hour: 19 })
    expect(readSchedule(foldPost('cover at 7 in the evening tomorrow'), POSTED)).toMatchObject({ part: 'eve', hour: 19 })
  })
})

describe('gate 3b reviewer findings on the reader (opus, 2026-10-20)', () => {
  it('"tới" is a range\'s "to", not "tối" (evening)', () => {
    expect(readSchedule(foldPost('Cần giáo viên nước ngoài dạy thay từ 7h tới 9h sáng mai, Quận 3'), POSTED)).toMatchObject({ part: 'am', hour: 7 })
  })
  it('a men-only "(nam)" is refused; hiring words before an age range are not the class', () => {
    expect(readPost('Cần giáo viên bản ngữ (nam), 400k/h, Quận 3', POSTED).deny).toBe('gender')
    expect(readPost('Tuyển giáo viên nước ngoài và nhân viên 22-30 tuổi, Quận 3', POSTED).deny).toBe('discriminatory')
    expect(readPost('English teachers wanted in District 3, staff must be 25-35 years old', POSTED).deny).toBe('discriminatory')
  })
})

describe('a place name is one word, not its syllables (the first LinkedIn alert, 2026-10-21)', () => {
  // A LinkedIn job as run.ts reads it: its text, "title · company · place" — each field once.
  const linkedin = (title: string, company: string, place: string) => readPost(`${title} · ${company} · ${place}`, POSTED, { listing: true })
  it('an English job in Ho Chi Minh City is not "Vietnamese-oriented" (four of the first six were dropped as one)', () => {
    expect(linkedin('English Second Language Teacher- Vietnam', 'English 1', 'Ho Chi Minh City, Ho Chi Minh City, Vietnam').deny).toBeNull()
    expect(linkedin('PYP Stem Specialist Teacher', 'Tesla Education', 'Ho Chi Minh City, Vietnam').deny).toBeNull()
    expect(linkedin('AI Lecturer', 'EON TECH', 'Ho Chi Minh City, Vietnam').deny).toBeNull()
    expect(linkedin('Teacher', 'ABC', 'Ho Chi Minh City, Ho Chi Minh City, Vietnam').deny).toBeNull()
  })
  it('a short English post that names its places is English (held-out 4, n=3006)', () => {
    expect(readPost('English teachers wanted - new academic year 2026-2027 GEMS - Ho Chi Minh City, Vietnam Up To 470,000 VND per hour Job Description: - Public Schools in Ho Chi Minh City, Vietnam See more', POSTED).deny).toBeNull()
    expect(readPost('IELTS teacher, Phu Nhuan, Ho Chi Minh City', POSTED).deny).toBeNull()
  })
  it('a Vietnamese job is still one: a place counts once — as a Vietnamese word when a syllable of it is one', () => {
    expect(linkedin('Giáo Viên Tiếng Anh Mầm non – Pathway School', 'Pathway School', 'Ho Chi Minh City, Ho Chi Minh City, Vietnam').deny).toBe('vietnamese-oriented')
    // Typed without accents, where the place made the fourth Vietnamese word (opus, gate 10c): still four.
    expect(linkedin('Giao vien tieng Anh', 'ABC Center', 'Ho Chi Minh City, Vietnam').deny).toBe('vietnamese-oriented')
    expect(readPost('Tuyen GV tieng Anh tai Ho Chi Minh, luong 8tr', POSTED).deny).toBe('vietnamese-oriented')
    expect(readPost('Can GV day IELTS tai Ho Chi Minh, luong cao, lien he 09xx', POSTED).deny).toBe('vietnamese-oriented') // opus, gate 10d
    expect(readPost('Trung tam tuyen giao vien tieng Anh tai Ho Chi Minh, luong 8 trieu', POSTED).deny).toBe('vietnamese-oriented')
    // The same syllables as WORDS still count: liên hệ, phụ huynh, buổi chiều, giờ — typed without accents.
    expect(readPost('Can tuyen tro giang, lien he phu huynh buoi chieu, gio lam viec linh hoat, Quan 7', POSTED).deny).toBe('vietnamese-oriented')
    // The accents are measured as before — place names included (codex, gate 10a).
    expect(readPost('Tuyen GV tieng Anh, Quận 7, Hồ Chí Minh', POSTED).deny).toBe('vietnamese-oriented')
  })
})

describe('the first shadow grading (2026-10-21) — a TITLE for another subject, a TITLE for foreigners only', () => {
  const listing = (title: string, text = title) => readPost(text, POSTED, { listing: true, title })
  it('a title for another academic subject, with no English or STEM beside it, is not a job for eno\'s teachers', () => {
    for (const title of [
      'Secondary Economics Teacher (AY2027-2028) — Inspired Education',
      'Psychology Teacher (Cambridge, AP), Hanoi — Korea Global School',
      'Teacher of History',
      'Lecturer/Associate Lecturer in Digital Media (Digital Animation) — RMIT University Vietnam LLC',
    ]) expect(listing(title).kind, title).toBe('other')
    // "excellent English required" is a qualification, and it is not in the title (codex, gate 12a)
    expect(listing('Economics Teacher', 'Economics Teacher. Excellent English required. District 2.').kind).toBe('other')
    // the role, not its employer or place: "— English Language School" is the school (codex, gates 12b, 12c)
    for (const title of ['Economics Teacher — English Language School', 'Economics Teacher-English Language School', 'History Teacher, English Language School'])
      expect(listing(title).kind, title).toBe('other')
    // a stage or an audience is not the subject (codex, gate 12c)
    for (const title of ['History Teacher for Kids', 'Kindergarten and Drama Teacher']) expect(listing(title).kind, title).toBe('other')
    expect(listing('Hanoi - Economics Teacher').kind).toBe('other')
    expect(listing('Lecturer in Law at Hanoi University').kind).toBe('other')
  })
  it('kept: a title that also names English or STEM; the words in the prose do not count', () => {
    for (const title of ['English and History Teacher — ABC School', 'Maths and History Teacher'])
      expect(listing(title).kind, title).toBe('job_offer')
    // prose, not the role (codex + opus, gate 12a): "a 20-year history", "work history", "labour law", "office politics"
    expect(listing('Computer Science Teacher', 'Computer Science Teacher — join a school with a 20-year history').kind).toBe('job_offer')
    expect(listing('Native teacher, grades 6–9, Thu Duc', 'Native teacher, grades 6–9. Send your CV with your work history. Contract per Vietnamese labour law, no office politics.').kind).toBe('job_offer')
    expect(listing('Teacher of Computer Science').subjects).toContain('stem')
    // the employer after " at " is not the subject
    expect(listing('Teacher at Hanoi Law University').kind).toBe('job_offer')
    // an AI or data role is not a subject a teacher's profile holds ("AI Trainer" jobs train models)
    for (const title of ['AI Lecturer', 'AI Trainer (Freelance)', 'Data Science Instructor']) expect(listing(title).kind, title).toBe('other')
    // by the TITLE screen itself — the subject's own "science" is not STEM (codex + opus, gate 12f)
    for (const title of ['Data Science Instructor', 'Social Science Teacher', 'Political Science Lecturer']) expect(titleNamesOtherSubject(title), title).toBe(true)
    expect(titleNamesOtherSubject('Science and History Teacher')).toBe(false)
    expect(listing('AI and Robotics Teacher').kind).toBe('job_offer')
    expect(listing('Teacher (AI-assisted classroom)').kind).toBe('job_offer') // a duty, not the subject (opus, gate 12c)
    // a Facebook post has no title and is not screened by one (the labelled sets: n=77, a kindergarten role beside it)
    expect(readPost('SINGAPORE INTERNATIONAL SCHOOL IS LOOKING FOR TEACHERS: Business/Economics Teacher (Hanoi) Kindergarten Teacher (Hanoi, Hai Phong). Minimum 2 years of classroom teaching experience.', POSTED).kind).toBe('job_offer')
  })
  it('a job titled in Vietnamese only is for Vietnamese teachers — unless it names an English role or the post a foreigner', () => {
    // a LinkedIn job's text is "title · company · place" (2026-10-21: too short to measure once a place is one word)
    const li = (title: string, rest = ' · IELTS ARENA · Hanoi Capital Region') => readPost(title + rest, POSTED, { listing: true, title, fieldsOnly: true })
    expect(li('Giáo Viên IELTS Fulltime Từ 7.5').deny).toBe('vietnamese-oriented')
    expect(li('Giáo viên IELTS', ' · Foreign Language Center · Hanoi').deny).toBe('vietnamese-oriented') // the company is not a cue (codex, gate 12d)
    // nor a school's name in a post with a body (codex, gate 12e)
    expect(readPost('Giáo viên tiếng Anh — Foreign Language Center\nTrung tâm cần tuyển giáo viên tiếng Anh dạy trẻ em tại Quận 7, lương 8 triệu, làm việc buổi chiều và cuối tuần.', POSTED, { title: 'Giáo viên tiếng Anh — Foreign Language Center' }).deny).toBe('vietnamese-oriented')
    expect(readPost('Giáo viên tiếng Anh — Foreign-Language Center\nTrung tâm cần tuyển giáo viên tiếng Anh dạy trẻ em tại Quận 7, lương 8 triệu, làm việc buổi chiều và cuối tuần.', POSTED).deny).toBe('vietnamese-oriented')
    expect(readPost('Tuyển giáo viên nước ngoài dạy tiếng Anh tại Quận 7, lương theo giờ, foreigners welcome.', POSTED).deny).toBeNull()
    expect(li('Giáo Viên Tiếng Anh Bản Ngữ / Native English Teacher').deny).toBeNull()
    expect(li('Giáo viên nước ngoài dạy IELTS').deny).toBeNull()
    expect(li('English Teacher – Hà Nội').deny).toBeNull()
    expect(li('English Second Language Teacher- Vietnam', ' · English 1 · Ho Chi Minh City, Ho Chi Minh City, Vietnam').deny).toBeNull()
    // a post with a body is measured by it: an English description under a Vietnamese title (opus, gate 12c)
    expect(listing('Giáo viên tiếng Anh', 'Giáo viên tiếng Anh\nTESOL required, kids classes in District 7, 25M a month, Monday to Friday mornings, small classes of twelve, modern classrooms, friendly team.').deny).toBeNull()
    // the post asks for a native speaker: not for Vietnamese teachers, whatever its title's language
    expect(listing('Giáo viên tiếng Anh', 'Giáo viên tiếng Anh\nWe are hiring native speakers for kids classes in District 7.').deny).toBeNull()
  })
  it('a title that takes foreigners only is a nationality ask; so is a bracket anywhere; the prose\'s visa note is not', () => {
    for (const title of ['[Expat Only] English Teacher / Part-Time (20H/week) — Nam Uc Scotch AGS', 'English Teacher — expat teachers only', 'Only foreign teachers: ESL, District 7', 'ESL Teacher (non-Vietnamese teachers only)', 'Expat-Only English Teacher'])
      expect(listing(title).deny, title).toBe('nationality')
    expect(readPost('ESL teacher wanted in District 3 (expats only), 450k an hour', POSTED).deny).toBe('nationality')
    expect(readPost('ESL teacher wanted in District 3 (Foreign teachers only), 450k an hour', POSTED).deny).toBe('nationality')
    // prose (opus, gate 12a): a visa note is not an ask
    expect(listing('ESL Teacher — District 7', 'ESL Teacher. Foreigners only need a passport and a degree for the work permit; we sponsor it.').deny).toBeNull()
    expect(listing('ESL Teacher at our only foreign-language centre').deny).toBeNull() // "only" is not about the teacher (opus, gate 12c)
    // the role named for expats, without "only", is left to the owner (as "native" is a language level): not refused
    expect(listing('Expat Primary Teacher – Pathway School, District 2, HCMC (Full-time)').deny).toBeNull()
  })
})
