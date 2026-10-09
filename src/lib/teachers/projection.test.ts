import { describe, expect, it } from 'vitest'
import {
  NOT_IN_VIETNAM, planTeacherBackfill, proposeBackfillDecision, stableStringify, teacherHome, teacherInputOfRow,
  teacherListingProjection, teacherMirrors, teacherSearchText, withoutCoverFacets,
} from './projection'
import { COVER_CONSENT_VERSION } from './cover'
import { HCMC_DISTRICT_KEYS, PROVINCE_PLACES } from './places'
import { normalizeForSave, normalizeTeacherInput, teacherFacetTokens, TEACHER_SITUATION_VERSION } from './profile'
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { districtLinkSlug } from '@/lib/district-canonical'
import { districtTextMatches, longerDistrictSpellings } from '@/lib/district-match'
import { matchesProvinceRow } from '@/lib/province-match'
import { VN_PROVINCES } from '@/lib/vn-areas'
import { facetValues } from '@/lib/facet-tokens'
import { fold } from '@/lib/fold'

const category = { name: 'Teachers', nameVi: 'Giáo viên' }
const body = (o: Record<string, unknown> = {}) => ({
  livesIn: 'city', currentCity: 'ho-chi-minh-city', currentDistrictKey: 'd7', currentProvince: '', jobTypes: ['fulltime'], relocate: 'some',
  teachAreas: ['online', 'd7', 'd4', 'ha-noi'], teachAreasConfirmed: true, availableFrom: '2026-11-01', expectedSalaryM: 40,
  subjects: ['general-english', 'business-english'], teachLanguages: [], ageGroups: ['kids', 'adults'], experienceBand: '5-10-years',
  experience: [{ role: 'Teacher', employer: 'ILA Vietnam', city: 'HCMC', from: '2020-01', to: '2024-06' }],
  degreeLevel: 'bachelor', degreeMajor: 'Linguistics', degreeInstitution: 'Leeds', degreeYear: 2018, certificates: [],
  fullName: 'Jane Doe', nationality: 'GB', englishLevel: 'native', languages: ['French'],
  headline: 'CELTA-certified English teacher', bio: 'I teach young learners.',
  coverOpen: false, coverSlots: [], coverRateVnd: null, coverConsent: false,
  photoUrl: 'https://sb.eno.vn/x.webp', videoUrl: null, videoOnRequest: false, phone: '', matchEmailOptIn: false, staffContactOptIn: false,
  ...o,
})
const t = (o: Record<string, unknown> = {}) => normalizeForSave(normalizeTeacherInput(body(o)))

// ── C5: what every reader of a teacher row will see, per persona — written before the readers change ────────────────
describe('teacherHome — the Listing city / district / location every reader of a teacher row sees', () => {
  const cases: [string, Record<string, unknown>, { city: string; district: string | null; location: string }][] = [
    ['HCMC, District 7', {}, { city: 'Hồ Chí Minh', district: 'Quận 7 (Phú Mỹ Hưng)', location: 'District 7 (Phu My Hung), Ho Chi Minh City' }],
    ['HCMC, prefers not to say', { currentDistrictKey: '' }, { city: 'Hồ Chí Minh', district: null, location: 'Ho Chi Minh City' }],
    ['Bình Dương (no district question)', { currentCity: 'binh-duong', currentDistrictKey: 'd7', relocate: 'no' }, { city: 'Hồ Chí Minh', district: null, location: 'Binh Duong' }],
    ['Nha Trang', { currentCity: 'khanh-hoa', relocate: 'no' }, { city: 'Khánh Hoà', district: null, location: 'Nha Trang' }],
    ['Gia Lai (somewhere else)', { livesIn: 'elsewhere', currentCity: '', currentProvince: '52', relocate: 'no' }, { city: 'Gia Lai', district: null, location: 'Gia Lai' }],
    ['abroad, with Online', { livesIn: 'abroad', relocate: 'some' }, { city: '', district: null, location: `${NOT_IN_VIETNAM} · Online` }],
    ['abroad, no Online', { livesIn: 'abroad', relocate: 'some', teachAreas: ['ha-noi'] }, { city: '', district: null, location: NOT_IN_VIETNAM }],
  ]
  it.each(cases)('%s', (_name, o, want) => {
    expect(teacherHome(t(o))).toEqual(want)
  })
  it('⛔ has no "Hồ Chí Minh" fallback: a teacher abroad, or unanswered, is in no city', () => {
    expect(teacherHome(t({ livesIn: 'abroad', relocate: 'some' })).city).toBe('')
    expect(teacherHome(normalizeTeacherInput(body({ livesIn: null }))).city).toBe('')
  })
  it('never shows a relocation city as where an abroad teacher lives (D8)', () => {
    expect(teacherHome(t({ livesIn: 'abroad', relocate: 'some', teachAreas: ['online', 'ha-noi'] })).location).not.toContain('Ha')
  })
  it('stores a district every district reader resolves to its OWN slug — all 24 (the chips, /c/teachers/<district>, the Area filter)', () => {
    for (const key of HCMC_DISTRICT_KEYS) {
      const home = teacherHome(t({ currentDistrictKey: key }))
      expect(home.district, key).toBe(DISTRICTS.find((d) => d.slug === key)!.name)
      expect(districtLinkSlug(home.district!), key).toBe(key)
      // the Area pill's district filter (district-slug.ts / district-match.ts, the JS twin): its own scope finds it…
      const d = DISTRICTS.find((x) => x.slug === key)!
      const hit = d.match!.some((m) => districtTextMatches(home.district!, m) || districtTextMatches(home.location, m))
      const refused = longerDistrictSpellings(key).some((m) => home.district!.includes(m))
      expect(hit && !refused, key).toBe(true)
    }
  })
  it('stores a city the province filter finds for its province (what the Area panel sends: the vn-units English name)', () => {
    const provinceEn = (vi: string) => VN_PROVINCES.find((p) => p.name === vi)!.nameEn
    for (const o of [{}, { currentCity: 'phu-quoc', relocate: 'no' }, { currentCity: 'vung-tau', relocate: 'no' }]) {
      const home = teacherHome(t(o))
      expect(matchesProvinceRow(home, provinceEn(home.city)), home.city).toBe(true)
    }
    for (const p of PROVINCE_PLACES) {
      const home = teacherHome(t({ livesIn: 'elsewhere', currentCity: '', currentProvince: p.code, relocate: 'no' }))
      expect(matchesProvinceRow(home, p.nameEn), p.nameEn).toBe(true)
    }
    expect(VN_PROVINCES.some((p) => matchesProvinceRow(teacherHome(t({ livesIn: 'abroad', relocate: 'some', teachAreas: ['ha-noi'] })), p.nameEn))).toBe(false)
  })
})

describe('teacherSearchText — what a school types and finds', () => {
  const text = (o: Record<string, unknown> = {}) => teacherSearchText(t(o), category)
  it('adds nationality (EN + VI), employers, languages, job types, ages, city labels in both languages and Online', () => {
    const s = text()
    for (const w of ['united kingdom', 'vuong quoc anh', 'ila vietnam', 'french', 'full-time', 'toan thoi gian', 'kids', 'tre em', 'ho chi minh city', 'tp. ho chi minh', 'hanoi', 'ha noi', 'online', 'truc tuyen', 'giao vien']) {
      expect(s, w).toContain(w)
    }
  })
  it('adds the province of a teacher who lives "somewhere else"', () => {
    expect(text({ livesIn: 'elsewhere', currentCity: '', currentProvince: '52', relocate: 'no', teachAreas: ['online'] })).toContain('gia lai')
  })
  it('⛔ never adds a district name — district-query would read it as the teacher\'s home district', () => {
    const s = text({ teachAreas: ['d7', 'd1', 'thu-duc'], relocate: 'no' })
    for (const key of ['d7', 'd1', 'thu-duc']) {
      const d = DISTRICTS.find((x) => x.slug === key)!
      for (const spelling of [d.name, d.nameEn, ...(d.match ?? [])]) expect(s, spelling).not.toContain(fold(spelling))
    }
    expect(s).toContain('ho chi minh city') // the city level only
  })
  it('adds the cover words only while cover is public', () => {
    const on = { jobTypes: [], relocate: '', teachAreas: ['d7'], coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, coverConsent: true }
    expect(text(on)).toContain('day thay')
    expect(text({ ...on, coverConsent: false })).not.toContain('day thay')
  })
})

// A cover save over a row the backfill has not migrated (publish.ts saveTeacherCover) changes only the cover part of what
// the OLD code wrote — re-projected from its empty v2 answers, the listing lost its place, native and experience facets.
describe('withoutCoverFacets — the cover part off, everything else as written (gate review, 2026-10-09)', () => {
  const coverOn = { coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, coverConsent: true }
  it('takes exactly the cover tokens and the trailing cover words off what the old builder wrote', () => {
    const old = {
      facetTokens: '|cover:open|coverSlot:mon-am|coverSlot:tue-eve|coverArea:d7|workIn:ho-chi-minh-city|native:native|experience:5-10-years|jobType:online|',
      searchText: fold('Jane Doe English teacher Ho Chi Minh City Teachers Giáo viên cover lessons cover teacher substitute teacher dạy thay giáo viên dạy thay'),
    }
    expect(withoutCoverFacets(old)).toEqual({
      facetTokens: '|workIn:ho-chi-minh-city|native:native|experience:5-10-years|jobType:online|',
      searchText: 'jane doe english teacher ho chi minh city teachers giao vien',
    })
  })
  it('is the cover-off builder\'s output, run on the cover-on one — the two can never disagree about the cover words', () => {
    const withCover = teacherListingProjection(t(coverOn), category)
    const without = teacherListingProjection(t(), category)
    expect(withCover.facetTokens).toContain('|cover:open|')
    expect(withoutCoverFacets(withCover)).toEqual({ facetTokens: without.facetTokens, searchText: without.searchText })
  })
  it('leaves a listing with no cover part untouched (and an empty one empty)', () => {
    const plain = teacherListingProjection(t(), category)
    expect(withoutCoverFacets(plain)).toEqual({ facetTokens: plain.facetTokens, searchText: plain.searchText })
    expect(withoutCoverFacets({ facetTokens: '|cover:open|', searchText: null })).toEqual({ facetTokens: null, searchText: '' })
  })
})

describe('teacherListingProjection', () => {
  it('is one builder: tokens, text, home and the full-time salary', () => {
    const x = t()
    const p = teacherListingProjection(x, category)
    expect(p).toMatchObject({ title: 'Jane Doe', subcategorySlug: 'english', salaryM: 40, ...teacherHome(x) })
    expect(p.facetTokens).toBe(teacherFacetTokens(x))
    expect(p.searchText).toBe(teacherSearchText(x, category))
    expect(teacherListingProjection(t({ jobTypes: ['parttime'] }), category).salaryM).toBeNull()
  })
})

describe('teacherMirrors — the old columns, rewritten on every save (B3)', () => {
  it('keep the old meanings: city-level cities, the Online flag, the derived reach, native, the district display name', () => {
    const m = teacherMirrors(t({ coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, coverConsent: true }), null)
    expect(m).toEqual({
      preferredCities: ['ho-chi-minh-city', 'ha-noi', 'online'], openToOnline: true, coverAreas: ['d4', 'd7'],
      nativeSpeaker: true, yearsExperience: 5, currentDistrict: 'Quận 7 (Phú Mỹ Hưng)',
    })
    expect(teacherMirrors(t({ englishLevel: 'fluent', currentDistrictKey: '' }), null)).toMatchObject({ nativeSpeaker: false, currentDistrict: null })
  })
  it('keep the stored years while they fall in the answered band — never throw a precise number away', () => {
    expect(teacherMirrors(t(), { yearsExperience: 7 }).yearsExperience).toBe(7)
    expect(teacherMirrors(t(), { yearsExperience: 12 }).yearsExperience).toBe(5) // the band moved: its floor
    expect(teacherMirrors(t({ experienceBand: 'over-10-years' }), { yearsExperience: 3 }).yearsExperience).toBe(10)
  })
})

describe('teacherInputOfRow — a stored, migrated row (no legacy adapter, D1)', () => {
  const row = (o: Record<string, unknown> = {}) => ({
    ...body(), relocate: undefined, availableFrom: new Date('2026-11-01T00:00:00Z'), teachAreasConfirmedAt: new Date('2026-10-08T00:00:00Z'),
    coverOpen: true, coverSlots: ['mon-am'], coverRateVnd: 300_000, coverConsentVersion: COVER_CONSENT_VERSION, situationVersion: 1, ...o,
  })
  it('reads the cover consent from the stored notice version, never a column', () => {
    expect(teacherInputOfRow(row()).coverConsent).toBe(true)
    expect(teacherInputOfRow(row({ coverConsentVersion: '2026-10-07' })).coverConsent).toBe(false)
  })
  it('re-reads the relocation answer and the confirmation from what is stored', () => {
    const x = teacherInputOfRow(row())
    expect(x.relocate).toBe('some')
    expect(x.teachAreasConfirmed).toBe(true)
    expect(x.availableFrom).toBe('2026-11-01')
  })
  it('a row the backfill has not reached has no places — never re-derived from the mirrors', () => {
    const x = teacherInputOfRow(row({ teachAreas: [], livesIn: null, preferredCities: ['ha-noi'], situationVersion: null }))
    expect(x.teachAreas).toEqual([])
    expect(x.livesIn).toBeNull()
  })
})

// ── The backfill (scripts/teachers-backfill.ts): the two production row shapes ───────────────────────────────────────
describe('planTeacherBackfill', () => {
  /** The demo profile as ~/eno-video-work/demo/create-demo-teacher.mts wrote it (2026-10-08), after the DDL ran. */
  const demo = {
    id: 'tp-demo', profileId: 'p-owner', listingId: 'l-demo', situationVersion: null,
    fullName: 'Shanazar Babakulyyev', headline: 'Demo profile · Science, Math & English teacher in Ho Chi Minh City', bio: 'This is a demo profile.',
    photoUrl: 'https://sb.eno.vn/storage/v1/object/public/listings/a.webp', videoUrl: 'https://sb.eno.vn/storage/v1/object/public/listing-videos/v.mp4',
    videoOnRequest: false, nationality: 'CA', nativeSpeaker: false, languages: ['English', 'Russian', 'Vietnamese (basic)'],
    currentCity: 'ho-chi-minh-city', currentDistrict: 'Thủ Đức', preferredCities: ['ho-chi-minh-city', 'online'], openToOnline: true,
    availableFrom: null, jobTypes: ['parttime', 'private', 'online'], ageGroups: ['kids', 'teens', 'adults'], subjects: ['stem', 'general-english', 'ielts'],
    yearsExperience: 10, experience: [{ role: 'Science Teacher', employer: 'iSmart Education', city: 'Ho Chi Minh City', from: '2022-11', to: '' }],
    degreeLevel: 'bachelor', degreeMajor: 'Petroleum engineering', degreeInstitution: 'Universitatea Petrol-Gaze din Ploiești', degreeYear: 2015,
    certificates: [], expectedSalaryM: 35, staffContactOptIn: false, matchEmailOptIn: false,
    coverOpen: true, coverSlots: ['mon-eve', 'tue-eve', 'wed-eve', 'thu-eve', 'fri-eve', 'sat-am'], coverAreas: ['d1', 'd3', 'thu-duc'],
    coverRateVnd: 300_000, coverConsentVersion: '2026-10-07',
    livesIn: null, currentProvince: null, currentDistrictKey: null, teachAreas: [], teachLanguages: [], englishLevel: null, experienceBand: null,
  }
  /** A plausible pre-cover real row: Hanoi, wants Da Nang too, full-time, a 'business' age group, 0 years and no history. */
  const real = {
    ...demo, id: 'tp-real', listingId: 'l-real', fullName: 'Real Teacher', nationality: 'US', nativeSpeaker: true, videoUrl: null,
    currentCity: 'ha-noi', currentDistrict: 'Cầu Giấy', preferredCities: ['ha-noi', 'da-nang'], openToOnline: false, jobTypes: ['fulltime'],
    ageGroups: ['kids', 'business'], subjects: ['general-english'], yearsExperience: 0, experience: [], coverOpen: false, coverSlots: [],
    coverAreas: [], coverRateVnd: null, coverConsentVersion: null,
  }
  it('PROPOSES livesIn from the old city — and the owner decides', () => {
    expect(proposeBackfillDecision(demo)).toEqual({ livesIn: 'city' })
    expect(proposeBackfillDecision({ ...demo, currentCity: '' })).toEqual({ livesIn: null })
  })
  it('migrates the demo row: whole HCMC wins over its old cover districts, Thủ Đức resolves, the stale cover leaves search', () => {
    const plan = planTeacherBackfill(demo, category, proposeBackfillDecision(demo), true)
    expect(plan.profile).toEqual({
      livesIn: 'city', currentProvince: null, currentDistrictKey: 'thu-duc', teachAreas: ['online', 'ho-chi-minh-city'], teachLanguages: [],
      englishLevel: null, experienceBand: 'over-10-years', situationVersion: TEACHER_SITUATION_VERSION,
    })
    expect(plan.listing).toMatchObject({ city: 'Hồ Chí Minh', district: 'TP Thủ Đức', location: 'Thu Duc City, Ho Chi Minh City' })
    const tok = plan.listing!.facetTokens
    expect(facetValues(tok, 'workIn')).toEqual(['online', 'ho-chi-minh-city'])
    expect(facetValues(tok, 'inVietnam')).toEqual(['yes'])
    expect(facetValues(tok, 'jobType')).toEqual(['parttime', 'private', 'online'])
    expect(facetValues(tok, 'experience')).toEqual(['over-10-years'])
    expect(facetValues(tok, 'native')).toEqual([]) // nativeSpeaker false was maybe the default: unanswered now
    expect(facetValues(tok, 'video')).toEqual(['has-video'])
    // ⛔ The '2026-10-07' grant is no consent under the bumped notice: the re-projection a version bump requires.
    expect(tok).not.toContain('|cover')
    const flags = plan.flags.join('\n')
    for (const w of ['PROPOSED', 'Thủ Đức', 'cover was ON under notice 2026-10-07', 'whole city wins', "job type 'online'", 'English level is left unanswered']) {
      expect(flags, w).toContain(w)
    }
  })
  it('migrates a real-looking row: another city kept for a full-time seeker, business → adults, 0 years left unanswered', () => {
    const plan = planTeacherBackfill(real, category, proposeBackfillDecision(real), true)
    expect(plan.profile).toMatchObject({ livesIn: 'city', teachAreas: ['ha-noi', 'da-nang'], englishLevel: 'native', experienceBand: null, currentDistrictKey: null })
    expect(plan.listing).toMatchObject({ city: 'Hà Nội', district: null, location: 'Hanoi' })
    expect(facetValues(plan.listing!.facetTokens, 'ageGroup')).toEqual(['kids', 'adults'])
    const flags = plan.flags.join('\n')
    for (const w of ["age group 'business'", 'ageGroup:business token is DROPPED', '0 years and no teaching history', 'district text "Cầu Giấy" dropped']) {
      expect(flags, w).toContain(w)
    }
  })
  it('flags a row whose only job type was Online: no goal left, so its next save must pick one or it hides (D6)', () => {
    const onlineOnly = { ...real, jobTypes: ['online'], preferredCities: ['ha-noi'] }
    const plan = planTeacherBackfill(onlineOnly, category, { livesIn: 'city' }, true)
    expect(plan.profile.teachAreas).toEqual(['online', 'ha-noi'])
    expect(facetValues(plan.listing!.facetTokens, 'jobType')).toEqual(['online']) // the old link still finds them
    expect(plan.flags.join('\n')).toContain('no job goal left')
    expect(planTeacherBackfill(real, category, { livesIn: 'city' }, true).flags.join('\n')).not.toContain('no job goal left')
  })
  it('flags every teach area the decided situation drops — nothing is dropped silently', () => {
    const privateOnly = { ...real, jobTypes: ['private'] }
    const plan = planTeacherBackfill(privateOnly, category, { livesIn: 'city' }, true)
    expect(plan.profile.teachAreas).toEqual(['ha-noi'])
    expect(plan.flags.join('\n')).toContain('da-nang (away from home')
  })
  it('applies the owner\'s decision: abroad, somewhere else, or left unanswered', () => {
    const abroad = planTeacherBackfill(real, category, { livesIn: 'abroad' }, true)
    expect(abroad.profile).toMatchObject({ livesIn: 'abroad', teachAreas: ['ha-noi', 'da-nang'] })
    expect(abroad.listing).toMatchObject({ city: '', location: NOT_IN_VIETNAM })
    expect(facetValues(abroad.listing!.facetTokens, 'inVietnam')).toEqual([])
    const gialai = planTeacherBackfill(real, category, { livesIn: 'elsewhere', currentProvince: '52' }, true)
    expect(gialai.profile).toMatchObject({ livesIn: 'elsewhere', currentProvince: '52' })
    expect(gialai.listing).toMatchObject({ city: 'Gia Lai', location: 'Gia Lai' })
    const none = planTeacherBackfill(real, category, { livesIn: null }, true)
    expect(none.profile.livesIn).toBeNull()
    expect(none.flags.join('\n')).toContain('livesIn left unanswered')
  })
  it('⛔ writes only the new columns (D4) — and no listing for a row without one', () => {
    const plan = planTeacherBackfill(demo, category, { livesIn: 'city' }, false)
    expect(Object.keys(plan.profile).sort()).toEqual(['currentDistrictKey', 'currentProvince', 'englishLevel', 'experienceBand', 'livesIn', 'situationVersion', 'teachAreas', 'teachLanguages'])
    expect(plan.listing).toBeNull()
  })
  it('is deterministic — the dry run and --apply compute the same plan from the same row', () => {
    const a = planTeacherBackfill(demo, category, { livesIn: 'city' }, true)
    const b = planTeacherBackfill(JSON.parse(JSON.stringify(demo)), category, { livesIn: 'city' }, true)
    expect(stableStringify(a)).toBe(stableStringify(b))
  })
})

describe('stableStringify', () => {
  it('sorts keys at every depth, writes Dates as ISO and drops undefined', () => {
    const d = new Date('2026-10-08T01:02:03.004Z')
    expect(stableStringify({ b: 1, a: { d: [2, { y: 1, x: d }], c: undefined } })).toBe('{"a":{"d":[2,{"x":"2026-10-08T01:02:03.004Z","y":1}]},"b":1}')
    expect(stableStringify({ x: 1, y: 2 })).toBe(stableStringify({ y: 2, x: 1 }))
    expect(stableStringify({ x: 1 })).not.toBe(stableStringify({ x: 2 }))
  })
})
