/**
 * Teacher profile — the ONE definition of what a teacher may submit, and of how a profile becomes
 * its public Listing (owner, 2026-09-30). Pure and import-light: the form validates with it in the
 * browser, the API validates with it again on the server, and the publish core derives the listing
 * from it — so the three can never disagree about a field.
 *
 * ⛔ QUALIFICATIONS ARE DATA, NEVER DOCUMENTS (owner: "without uploading any documents"). Nothing
 * here accepts a file; the CV is the only upload and it lives in TeacherPrivate.
 * ⛔ NO VISA OR WORK-PERMIT FIELD. eno.vn may not mention visa services (the licensing split), and the
 * server screens every free-text field for visa words (see publish.ts).
 */
import { CATEGORY_BY_SLUG, type FacetDef } from '@/lib/taxonomy'
import { buildFacetTokens } from '@/lib/facet-tokens'
import { TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'
import { COVER_LIMITS, COVER_SLOTS, COVER_AREA_KEYS } from '@/lib/teachers/cover'

const facet = (key: string): FacetDef => {
  const f = CATEGORY_BY_SLUG[TEACHERS_CATEGORY_SLUG]?.facets.find((x) => x.key === key)
  if (!f) throw new Error(`teachers facet ${key} missing from the taxonomy`)
  return f
}
const values = (key: string) => facet(key).options.map((o) => o.value)

/** Option lists, straight from the taxonomy so a chip the form offers is always a filterable value. */
export const TEACHER_OPTIONS = {
  workIn: facet('workIn').options,
  cert: facet('cert').options,
  degree: facet('degree').options,
  ageGroup: facet('ageGroup').options,
  subject: facet('subject').options,
  jobType: facet('jobType').options,
} as const

export const LIMITS = {
  name: 80,
  headline: 120,
  bio: 2000,
  shortText: 80,
  experienceEntries: 10,
  certificates: 10,
  languages: 8,
  maxYears: 50,
  maxSalaryM: 150,
} as const

export type ExperienceEntry = { role: string; employer: string; city: string; from: string; to: string }
export type CertificateEntry = { type: string; hours: number | null; provider: string; year: number | null }

export type TeacherInput = {
  fullName: string
  headline: string
  bio: string
  photoUrl: string | null
  videoUrl: string | null
  nationality: string
  nativeSpeaker: boolean
  languages: string[]
  currentCity: string
  currentDistrict: string
  preferredCities: string[]
  openToOnline: boolean
  availableFrom: string | null // YYYY-MM-DD
  jobTypes: string[]
  ageGroups: string[]
  subjects: string[]
  yearsExperience: number
  experience: ExperienceEntry[]
  degreeLevel: string | null
  degreeMajor: string
  degreeInstitution: string
  degreeYear: number | null
  certificates: CertificateEntry[]
  expectedSalaryM: number | null
  /**
   * COVER LESSONS (2026-10-07, src/lib/teachers/cover.ts) — the four fields the teacher edits, plus the
   * separate consent tick. ⛔ The server-written cover columns (coverConfirmedAt, coverConsentAt,
   * coverConsentVersion, coverWithdrawnAt) are deliberately NOT here: normalizeTeacherInput drops unknown
   * keys, so neither a request body nor the teacher.eno.vn `#d=` fragment can set them.
   */
  coverOpen: boolean
  coverSlots: string[]
  coverAreas: string[]
  coverRateVnd: number | null
  /** The cover-publication consent, SEPARATE from consentPublic (PDP Law 91/2025 — unbundled). */
  coverConsent: boolean
  phone: string
  staffContactOptIn: boolean
  matchEmailOptIn: boolean
  consentPublic: boolean
}

export const EMPTY_TEACHER: TeacherInput = {
  fullName: '', headline: '', bio: '', photoUrl: null, videoUrl: null,
  nationality: '', nativeSpeaker: false, languages: [],
  currentCity: '', currentDistrict: '', preferredCities: [], openToOnline: false, availableFrom: null,
  jobTypes: [], ageGroups: [], subjects: [], yearsExperience: 0, experience: [],
  degreeLevel: null, degreeMajor: '', degreeInstitution: '', degreeYear: null, certificates: [],
  expectedSalaryM: null,
  coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, coverConsent: false,
  phone: '', staffContactOptIn: false, matchEmailOptIn: false, consentPublic: false,
}

/** Field → error code. Codes, not prose: the form words them bilingually. */
export type TeacherErrors = Partial<Record<keyof TeacherInput | `experience.${number}` | `certificates.${number}`, string>>

/**
 * The wizard's steps, and which fields each one owns — validation of a step checks only these.
 * ⚠️ `cover` sits BEFORE `qualifications` on purpose: the teacher.eno.vn hand-off fires at the end of
 * `qualifications` (teacher-form.tsx `onDraftHostEnd`), so the new step needed no change there. The form's
 * own `steps[]` list must follow this order — the two lists change together.
 */
export const TEACHER_STEP_FIELDS = {
  about: ['fullName', 'headline', 'bio', 'nationality', 'nativeSpeaker', 'languages'],
  location: ['currentCity', 'currentDistrict', 'preferredCities', 'openToOnline', 'availableFrom'],
  experience: ['yearsExperience', 'experience', 'ageGroups', 'subjects', 'jobTypes', 'expectedSalaryM'],
  cover: ['coverOpen', 'coverSlots', 'coverAreas', 'coverRateVnd', 'coverConsent'],
  qualifications: ['degreeLevel', 'degreeMajor', 'degreeInstitution', 'degreeYear', 'certificates'],
  finish: ['photoUrl', 'videoUrl', 'phone', 'staffContactOptIn', 'matchEmailOptIn', 'consentPublic'],
} as const satisfies Record<string, readonly (keyof TeacherInput)[]>
export type TeacherStep = keyof typeof TEACHER_STEP_FIELDS
/** Steps that may be filled WITHOUT an account (the teacher.eno.vn half). */
export const DRAFT_STEPS: readonly TeacherStep[] = ['about', 'location', 'experience', 'cover', 'qualifications']

/** The cover fields alone — what the edit page's quick panel (PATCH /api/teachers/me/cover) sends. */
export const COVER_FIELDS = TEACHER_STEP_FIELDS.cover

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const longStr = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '')
const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : null
}
const pick = (v: unknown, allowed: readonly string[], max = 20): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && allowed.includes(x)))].slice(0, max) : []
/** `picked` in the order of `allowed`, so the stored list — and the facet tokens built from it — is stable. */
const canonical = (allowed: readonly string[], picked: readonly string[]): string[] => {
  const s = new Set(picked)
  return allowed.filter((v) => s.has(v))
}
const YM = /^\d{4}-(0[1-9]|1[0-2])$/ // experience dates are month precision: YYYY-MM, or '' for "present"
const ISO_COUNTRY = /^[A-Z]{2}$/
const CERT_TYPES = values('cert')
const DEGREES = values('degree')

/**
 * Coerce untrusted input (a request body, a restored URL fragment) into a TeacherInput. Never
 * throws; unknown keys and wrong types are dropped. Validation is a separate step.
 */
export function normalizeTeacherInput(raw: unknown): TeacherInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const thisYear = new Date().getUTCFullYear()
  const currentCity = pick([r.currentCity], values('workIn').filter((v) => v !== 'anywhere' && v !== 'online'))[0] ?? ''
  const preferredCities = pick(r.preferredCities, values('workIn'))
  // Any listed area, in canonical order — NOT filtered by the teacher's cities: the form shows every city, so every
  // stored pick stays visible and removable (cover.ts coverCitiesFor says why the filter was taken out).
  const coverAreas = canonical(COVER_AREA_KEYS, pick(r.coverAreas, COVER_AREA_KEYS, COVER_LIMITS.areas))
  return {
    fullName: str(r.fullName, LIMITS.name),
    headline: str(r.headline, LIMITS.headline),
    bio: longStr(r.bio, LIMITS.bio),
    photoUrl: typeof r.photoUrl === 'string' && r.photoUrl ? r.photoUrl.slice(0, 500) : null,
    videoUrl: typeof r.videoUrl === 'string' && r.videoUrl ? r.videoUrl.slice(0, 500) : null,
    nationality: typeof r.nationality === 'string' && ISO_COUNTRY.test(r.nationality) ? r.nationality : '',
    nativeSpeaker: r.nativeSpeaker === true,
    languages: Array.isArray(r.languages)
      ? [...new Set(r.languages.map((l) => str(l, 30)).filter(Boolean))].slice(0, LIMITS.languages)
      : [],
    currentCity,
    currentDistrict: str(r.currentDistrict, LIMITS.shortText),
    preferredCities,
    openToOnline: r.openToOnline === true,
    availableFrom: typeof r.availableFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.availableFrom) ? r.availableFrom : null,
    jobTypes: pick(r.jobTypes, values('jobType')),
    ageGroups: pick(r.ageGroups, values('ageGroup')),
    subjects: pick(r.subjects, values('subject')),
    yearsExperience: int(r.yearsExperience, 0, LIMITS.maxYears) ?? 0,
    experience: (Array.isArray(r.experience) ? r.experience : []).slice(0, LIMITS.experienceEntries).map((e) => {
      const x = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
      return {
        role: str(x.role, LIMITS.shortText),
        employer: str(x.employer, LIMITS.shortText),
        city: str(x.city, LIMITS.shortText),
        from: typeof x.from === 'string' && YM.test(x.from) ? x.from : '',
        to: typeof x.to === 'string' && YM.test(x.to) ? x.to : '',
      }
    }),
    degreeLevel: typeof r.degreeLevel === 'string' && DEGREES.includes(r.degreeLevel) ? r.degreeLevel : null,
    degreeMajor: str(r.degreeMajor, LIMITS.shortText),
    degreeInstitution: str(r.degreeInstitution, LIMITS.shortText),
    degreeYear: int(r.degreeYear, 1950, thisYear + 1),
    certificates: (Array.isArray(r.certificates) ? r.certificates : []).slice(0, LIMITS.certificates).map((c) => {
      const x = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
      return {
        type: typeof x.type === 'string' && CERT_TYPES.includes(x.type) ? x.type : '',
        hours: int(x.hours, 1, 2000),
        provider: str(x.provider, LIMITS.shortText),
        year: int(x.year, 1950, thisYear + 1),
      }
    }),
    expectedSalaryM: int(r.expectedSalaryM, 0, LIMITS.maxSalaryM),
    coverOpen: r.coverOpen === true,
    coverSlots: canonical(COVER_SLOTS, pick(r.coverSlots, COVER_SLOTS, COVER_LIMITS.slots)),
    coverAreas,
    // NOT clamped to the rate bounds: a typo of 30,000 must reach validation as 30,000 and be refused,
    // never be silently raised to the minimum. Only a nonsense magnitude is cut.
    coverRateVnd: int(r.coverRateVnd, 0, 100_000_000),
    coverConsent: r.coverConsent === true,
    phone: str(r.phone, 20),
    staffContactOptIn: r.staffContactOptIn === true,
    matchEmailOptIn: r.matchEmailOptIn === true,
    consentPublic: r.consentPublic === true,
  }
}

/** Validate the fields of the given steps (all steps when omitted). Empty object = valid. */
export function validateTeacherInput(t: TeacherInput, steps: readonly TeacherStep[] = Object.keys(TEACHER_STEP_FIELDS) as TeacherStep[]): TeacherErrors {
  const e: TeacherErrors = {}
  const has = (s: TeacherStep) => steps.includes(s)
  if (has('about')) {
    if (t.fullName.length < 2) e.fullName = 'required'
    if (t.headline.length < 10) e.headline = 'too_short'
    if (!t.nationality) e.nationality = 'required'
  }
  if (has('location')) {
    if (!t.currentCity) e.currentCity = 'required'
    if (!t.preferredCities.length && !t.openToOnline) e.preferredCities = 'required'
  }
  if (has('experience')) {
    if (!t.subjects.length) e.subjects = 'required'
    if (!t.ageGroups.length) e.ageGroups = 'required'
    if (!t.jobTypes.length) e.jobTypes = 'required'
    t.experience.forEach((x, i) => {
      if (!x.role || !x.employer) e[`experience.${i}`] = 'incomplete'
      else if (x.from && x.to && x.to < x.from) e[`experience.${i}`] = 'dates'
    })
  }
  // Cover is optional; once switched on it must be complete — a cover profile with no free period, no area
  // or no rate would match searches it cannot answer.
  if (has('cover') && t.coverOpen) {
    if (!t.coverSlots.length) e.coverSlots = 'required'
    if (!t.coverAreas.length) e.coverAreas = 'required'
    if (t.coverRateVnd == null) e.coverRateVnd = 'required'
    else if (t.coverRateVnd < COVER_LIMITS.rateMin || t.coverRateVnd > COVER_LIMITS.rateMax) e.coverRateVnd = 'rate_range'
    // ⛔ Its OWN consent, never folded into consentPublic (PDP Law 91/2025 — specific and unbundled).
    if (!t.coverConsent) e.coverConsent = 'required'
  }
  if (has('qualifications')) {
    t.certificates.forEach((c, i) => {
      if (!c.type) e[`certificates.${i}`] = 'incomplete'
    })
  }
  if (has('finish')) {
    if (!t.photoUrl) e.photoUrl = 'required'
    if (!/^\+?[0-9 ().-]{8,20}$/.test(t.phone)) e.phone = 'invalid'
    // ⛔ The ONLY required consent: the profile being public IS the service. The two opt-ins are
    // separate, optional and default OFF (VN PDP Law 91/2025 — no bundled consent).
    if (!t.consentPublic) e.consentPublic = 'required'
  }
  return e
}

/** Every free-text field a teacher typed — the publish core screens all of them (contact, banned, visa). */
export function teacherFreeTexts(t: TeacherInput): string[] {
  return [
    t.fullName, t.headline, t.bio, t.currentDistrict, t.degreeMajor, t.degreeInstitution,
    ...t.languages,
    ...t.experience.flatMap((x) => [x.role, x.employer, x.city]),
    ...t.certificates.map((c) => c.provider),
  ].filter(Boolean)
}

export function experienceBucket(years: number): string {
  if (years < 1) return 'under-1-year'
  if (years < 3) return '1-3-years'
  if (years < 5) return '3-5-years'
  if (years < 10) return '5-10-years'
  return 'over-10-years'
}

/** The primary subcategory, from what they teach (a single slug is all a Listing row holds). */
export function teacherSubcategory(t: Pick<TeacherInput, 'subjects'>): string {
  if (t.subjects.includes('ielts') || t.subjects.includes('toefl-toeic') || t.subjects.includes('cambridge')) return 'exam-prep'
  if (t.subjects.includes('stem')) return 'subjects'
  if (t.subjects.length && t.subjects.every((s) => s === 'other-language')) return 'other-languages'
  return 'english'
}

/**
 * The derived facet tokens (all multi-valued facets go to `facetTokens`, which no public write path
 * can reach — see src/lib/facet-tokens.ts). Every value is a taxonomy slug, so every chip filters.
 * ⚠️ `coverConsent` IS NOT A COLUMN. A rebuild from a stored row must set it to
 * `coverConsentVersion === COVER_CONSENT_VERSION` (as publish.ts withStoredCover does), or the teacher silently
 * drops out of cover search (gate review, 2026-10-07).
 */
export function teacherFacetTokens(t: TeacherInput): string | null {
  const workIn = [...t.preferredCities]
  if (t.openToOnline && !workIn.includes('online')) workIn.push('online')
  // ⛔ COVER TOKENS ONLY WHILE COVER IS ON AND CONSENTED. Switching it off keeps the saved periods, areas
  // and rate on the profile for later, but the next save drops every cover token, so the profile leaves
  // cover search at once (the facet filters read only these tokens).
  const cover = coverIsPublic(t)
  return buildFacetTokens({
    cover: cover ? 'open' : null,
    coverSlot: cover ? t.coverSlots : null,
    coverArea: cover ? t.coverAreas : null,
    workIn,
    native: t.nativeSpeaker ? 'native' : 'non-native',
    experience: experienceBucket(t.yearsExperience),
    cert: t.certificates.map((c) => c.type).filter(Boolean),
    degree: t.degreeLevel,
    ageGroup: t.ageGroups,
    subject: t.subjects,
    jobType: t.jobTypes,
    video: t.videoUrl ? 'has-video' : null,
  })
}

/** Cover availability is shown and searchable only when switched on, consented and complete. */
export function coverIsPublic(t: Pick<TeacherInput, 'coverOpen' | 'coverConsent' | 'coverSlots' | 'coverAreas' | 'coverRateVnd'>): boolean {
  return t.coverOpen && t.coverConsent && t.coverSlots.length > 0 && t.coverAreas.length > 0 && t.coverRateVnd != null
}

/** The searchable prose of the public listing (title stays the teacher's name). */
export function teacherListingDescription(t: TeacherInput): string {
  return [t.headline, t.bio].filter(Boolean).join('\n\n').slice(0, 5000)
}

/**
 * `currentCity` slug → the province string `Listing.city` stores (vn-units `name`, the Vietnamese
 * one — the area filter matches it, see src/lib/province-match.ts). Post-2025-merger provinces:
 * Bình Dương and Vũng Tàu are now Hồ Chí Minh, Phú Quốc is An Giang — the chip keeps the name
 * people use, the row keeps the unit the filter knows.
 */
export const CITY_PROVINCE: Record<string, string> = {
  'ho-chi-minh-city': 'Hồ Chí Minh',
  'ha-noi': 'Hà Nội',
  'da-nang': 'Đà Nẵng',
  'hai-phong': 'Hải Phòng',
  'can-tho': 'Cần Thơ',
  hue: 'Huế',
  'khanh-hoa': 'Khánh Hoà',
  'lam-dong': 'Lâm Đồng',
  'dong-nai': 'Đồng Nai',
  'binh-duong': 'Hồ Chí Minh',
  'vung-tau': 'Hồ Chí Minh',
  'phu-quoc': 'An Giang',
}
