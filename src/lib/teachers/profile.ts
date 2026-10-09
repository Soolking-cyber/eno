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
 *
 * ── THE v2 SHAPE (teacher onboarding redesign, owner, 2026-10-08) ─────────────────────────────────────────────────
 * The teacher answers their SITUATION first (where they are now, what work they want), and every later step shows only
 * what fits it. One "Where you can teach" list (`teachAreas`, places.ts) replaces currentCity-as-preference,
 * preferredCities, openToOnline and the cover-area picker; an English level replaces "native speaker"; an experience
 * band replaces the years box. ⛔ ONE SHAPE IN THE CODE (plan review D1): a stored row is always v2 —
 * `situationVersion` (server-written; NULL = not yet migrated by scripts/teachers-backfill.ts) is the only version
 * test, and there is NO runtime adapter for stored rows. The OLD columns stay, rewritten by every save as MIRRORS
 * (projection.ts teacherMirrors) so the old code, the external matcher and a rollback keep reading what they always read.
 * ⚠️ Only TRANSIENT old inputs are mapped, at this boundary (plan review D2): a teacher.eno.vn `#d=` fragment or a
 * sessionStorage draft made by the previous form (fromLegacyTeacher). An old-shape PUT body is refused upstream
 * (409 profile_changed — api/teachers/me), never guessed at.
 */
import { CATEGORY_BY_SLUG, type FacetDef } from '@/lib/taxonomy'
import { buildFacetTokens } from '@/lib/facet-tokens'
import { canonicalDistrictSlug, isCuratedDistrict } from '@/lib/district-canonical'
import { TEACHERS_CATEGORY_SLUG } from '@/lib/teachers/constants'
import { COVER_LIMITS, COVER_SLOTS } from '@/lib/teachers/cover'
import {
  ANYWHERE, HCMC, LIVES_IN, ONLINE, coverReachOf, homeHasCover, isHcmcDistrict, isHub, isPickableProvince,
  normalizeTeachAreas, otherCityKeys, relocationAllowed, type LivesIn,
} from '@/lib/teachers/places'

export { CITY_PROVINCE, LIVES_IN, type LivesIn } from '@/lib/teachers/places'

const facet = (key: string): FacetDef => {
  const f = CATEGORY_BY_SLUG[TEACHERS_CATEGORY_SLUG]?.facets.find((x) => x.key === key)
  if (!f) throw new Error(`teachers facet ${key} missing from the taxonomy`)
  return f
}
const values = (key: string) => facet(key).options.map((o) => o.value)

/** The old "Wants to work in" vocabulary — the 12 cities, 'anywhere', 'online' — with its labels. */
const LEGACY_WORK_IN = facet('workIn').options.filter((o) => isHub(o.value) || o.value === ANYWHERE || o.value === ONLINE)

/** Option lists with their labels, straight from the taxonomy — what a profile SHOWS (facet options, all of them). */
export const TEACHER_OPTIONS = {
  /**
   * ⚠️ TRANSITIONAL ALIAS (2026-10-08): the 14 values the old "Wants to work in" facet had (12 hubs, anywhere, online),
   * NOT the "Can teach in" facet (which also lists districts and provinces). It keeps the old form's city chips and the
   * profile view's city labels working until the onboarding integration merge deletes it — use places.ts placeLabel.
   */
  workIn: LEGACY_WORK_IN,
  cert: facet('cert').options,
  degree: facet('degree').options,
  ageGroup: facet('ageGroup').options,
  subject: facet('subject').options,
  jobType: facet('jobType').options,
  experience: facet('experience').options,
} as const

/** What the teacher can say they want — full-time, part-time, private students (Online is a PLACE now, places.ts). */
export const FORM_JOB_TYPES = ['fulltime', 'parttime', 'private'] as const
/** Who they teach. 'business' is no longer asked: it is derived from the Business English subject (a facet value only). */
export const FORM_AGE_GROUPS = ['kids', 'teens', 'adults'] as const
/**
 * The option lists the FORM offers — separate from the facet options, which keep values the form no longer asks
 * ('business' age group) so old links and old rows still filter and label (plan, 2026-10-08).
 */
export const TEACHER_FORM_OPTIONS = {
  ageGroup: facet('ageGroup').options.filter((o) => (FORM_AGE_GROUPS as readonly string[]).includes(o.value)),
  jobType: facet('jobType').options.filter((o) => (FORM_JOB_TYPES as readonly string[]).includes(o.value)),
} as const

export type EnglishLevel = 'native' | 'fluent' | 'working'
export const ENGLISH_LEVELS: readonly EnglishLevel[] = ['native', 'fluent', 'working']
/** The experience facet's five buckets — "How long have you been teaching?" (no default). */
export const EXPERIENCE_BANDS: readonly string[] = values('experience')
/**
 * Each band's LOWER bound — the `yearsExperience` mirror (projection.ts teacherMirrors) when the stored number does
 * not already fall in the band. experienceBucket(BAND_FLOOR[b]) === b for every band (profile.test.ts).
 */
export const BAND_FLOOR: Readonly<Record<string, number>> = {
  'under-1-year': 0, '1-3-years': 1, '3-5-years': 3, '5-10-years': 5, 'over-10-years': 10,
}
/**
 * "Would you move for a job?" (in Vietnam, full-time or part-time: no / some / anywhere) and "Where in Vietnam would you
 * like to teach?" (abroad: anywhere / some / online-only). UI state: NOT stored — re-derived from teachAreas on load
 * (deriveRelocate) — but the server reads it to apply the answer (normalizeForSave) and to check "some" names a city.
 */
export type Relocate = '' | 'no' | 'some' | 'anywhere' | 'online-only'
const RELOCATE_IN_VN: readonly Relocate[] = ['no', 'some', 'anywhere']
const RELOCATE_ABROAD: readonly Relocate[] = ['anywhere', 'some', 'online-only']

/**
 * The notice beside Publish ("…everything except your phone, email, CV and a private video" + "What's public?"). The
 * Publish tap IS the consent; the client echoes the version it showed as `publishNotice`, the server stamps it into
 * TeacherProfile.consentPublicVersion and refuses any other (409 notice_changed). ⛔ BUMP IT WHEN THE NOTICE'S MEANING
 * CHANGES (what is public, to whom) — the record must say which words each teacher accepted (PDP Law 91/2025).
 */
export const PUBLISH_NOTICE_VERSION = '2026-10-08'
/**
 * The AI note beside the two opt-ins — job matching by Claude Haiku 5.5 (Anthropic), the transfer abroad (owner,
 * 2026-10-08 — never Google Gemini). Stamped as matchEmailNoticeVersion / staffContactNoticeVersion when an opt-in is
 * switched on; ⛔ AN OPT-IN COUNTS FOR AI MATCHING ONLY UNDER THIS VERSION (aiMatchConsented, plan review D5): the
 * older opt-ins, given under the Gemini notice with no version, are not exported until the teacher re-confirms.
 */
export const AI_NOTICE_VERSION = '2026-10-08'
/** The row shape a save writes — TeacherProfile.situationVersion (NULL = written by the old code, not yet migrated). */
export const TEACHER_SITUATION_VERSION = 1

export const LIMITS = {
  name: 80,
  headline: 120,
  bio: 2000,
  shortText: 80,
  experienceEntries: 10,
  certificates: 10,
  languages: 8,
  /** the database CHECK TeacherProfile_teach_bounds holds the same number (scripts/teachers-ddl.mjs) */
  teachLanguages: 8,
  minSalaryM: 1,
  maxSalaryM: 150,
  certHoursMin: 1,
  certHoursMax: 2000,
  yearMin: 1950,
} as const

export type ExperienceEntry = { role: string; employer: string; city: string; from: string; to: string }
export type CertificateEntry = { type: string; hours: number | null; provider: string; year: number | null }

export type TeacherInput = {
  // ── 1 · Your plans ──
  /** "Where are you now?" — null = not answered (never defaulted: an untouched default publishes nothing). */
  livesIn: LivesIn | null
  /** a hub slug (places.ts HUBS) when livesIn is 'city', else '' */
  currentCity: string
  /** a curated HCMC district (DISTRICTS slug) when the city is HCMC, else '' ("Prefer not to say") */
  currentDistrictKey: string
  /** a vn-units code of a province no chip covers whole (places.ts PROVINCE_PLACES) when livesIn is 'elsewhere', else '' */
  currentProvince: string
  /** ⊂ fulltime, parttime, private — may stay empty only where cover lessons are offered */
  jobTypes: string[]
  relocate: Relocate
  // ── 2 · Where you teach ──
  /** THE one "Where you can teach" list (places.ts) — public, filterable, and cover's reach */
  teachAreas: string[]
  /**
   * The teacher confirmed (or edited) the list in this form. ⛔ The pre-selected home city is a SUGGESTION until then
   * (plan review B6): checked, never stored as such — the server stamps TeacherProfile.teachAreasConfirmedAt.
   */
  teachAreasConfirmed: boolean
  /** the first day of a month, YYYY-MM-01 */
  availableFrom: string | null
  /** expected monthly salary, millions VND (full-time only); refused outside 1–150, never clamped */
  expectedSalaryM: number | null
  // ── 3 · Your teaching ──
  subjects: string[]
  /** the languages taught under "Other language" — readable names (no ISO-code column in v1, plan review D8) */
  teachLanguages: string[]
  /** ⊂ kids, teens, adults */
  ageGroups: string[]
  experienceBand: string | null
  experience: ExperienceEntry[]
  degreeLevel: string | null
  degreeMajor: string
  degreeInstitution: string
  degreeYear: number | null
  certificates: CertificateEntry[]
  // ── 4 · About you ──
  fullName: string
  nationality: string
  /** only for English-medium subjects; null = not asked / not answered */
  englishLevel: EnglishLevel | null
  /** other languages spoken — readable names, as before */
  languages: string[]
  headline: string
  bio: string
  // ── 5 · Cover lessons (src/lib/teachers/cover.ts) ──
  /**
   * The switch. ⛔ The server-written cover columns (coverAreas — now derived —, coverConfirmedAt, coverConsentAt,
   * coverConsentVersion, coverWithdrawnAt) are NOT here: normalizeTeacherInput drops unknown keys, so neither a request
   * body nor a `#d=` fragment can set them.
   */
  coverOpen: boolean
  coverSlots: string[]
  coverRateVnd: number | null
  /**
   * INTERNAL since 2026-10-08: the switch IS the consent act (no tick box), so the form sets it equal to coverOpen. It
   * counts only under the notice in force (`coverNotice` === COVER_CONSENT_VERSION — publish.ts), and a rebuild from a
   * stored row reads coverConsentVersion === COVER_CONSENT_VERSION (projection.ts teacherInputOfRow).
   */
  coverConsent: boolean
  // ── 6 · Photo & publish ──
  photoUrl: string | null
  videoUrl: string | null
  /**
   * Intro video visibility (owner, 2026-10-07): false = shown on the profile, true = kept private and sent to schools
   * that ask. The video's homes and moves: src/lib/teachers/video.ts. A body from before this field leaves it as stored.
   */
  videoOnRequest: boolean
  /** private; required only while staffContactOptIn is on (owner, 2026-10-08) */
  phone: string
  /** job seekers only, OFF by default, each its own consent with its own stamps (plan review C2) */
  matchEmailOptIn: boolean
  staffContactOptIn: boolean
}

export const EMPTY_TEACHER: TeacherInput = {
  livesIn: null, currentCity: '', currentDistrictKey: '', currentProvince: '', jobTypes: [], relocate: '',
  teachAreas: [], teachAreasConfirmed: false, availableFrom: null, expectedSalaryM: null,
  subjects: [], teachLanguages: [], ageGroups: [], experienceBand: null, experience: [],
  degreeLevel: null, degreeMajor: '', degreeInstitution: '', degreeYear: null, certificates: [],
  fullName: '', nationality: '', englishLevel: null, languages: [], headline: '', bio: '',
  coverOpen: false, coverSlots: [], coverRateVnd: null, coverConsent: false,
  photoUrl: null, videoUrl: null, videoOnRequest: false, phone: '', matchEmailOptIn: false, staffContactOptIn: false,
}

/** Field → error code. Codes, not prose: the form words them bilingually. */
export type TeacherErrors = Partial<Record<keyof TeacherInput | `experience.${number}` | `certificates.${number}`, string>>

/**
 * The wizard's steps, in order, and which fields each one owns — validation of a step checks only these.
 * ⚠️ The four draft steps come first and need no account (teacher.eno.vn hands over after `about`, the last of them);
 * `cover` and `finish` need a session on eno.vn. teacherSteps() says which of the six a given teacher sees.
 */
export const TEACHER_STEP_FIELDS = {
  plans: ['livesIn', 'currentCity', 'currentDistrictKey', 'currentProvince', 'jobTypes', 'relocate'],
  where: ['teachAreas', 'teachAreasConfirmed', 'availableFrom', 'expectedSalaryM'],
  teaching: ['subjects', 'teachLanguages', 'ageGroups', 'experienceBand', 'experience', 'degreeLevel', 'degreeMajor', 'degreeInstitution', 'degreeYear', 'certificates'],
  about: ['fullName', 'nationality', 'englishLevel', 'languages', 'headline', 'bio'],
  cover: ['coverOpen', 'coverSlots', 'coverRateVnd', 'coverConsent'],
  finish: ['photoUrl', 'videoUrl', 'videoOnRequest', 'phone', 'matchEmailOptIn', 'staffContactOptIn'],
} as const satisfies Record<string, readonly (keyof TeacherInput)[]>
export type TeacherStep = keyof typeof TEACHER_STEP_FIELDS
export const TEACHER_STEPS = Object.keys(TEACHER_STEP_FIELDS) as TeacherStep[]
/** Steps that may be filled WITHOUT an account — the teacher.eno.vn half, and the `#d=` / draft payload. */
export const DRAFT_STEPS: readonly TeacherStep[] = ['plans', 'where', 'teaching', 'about']

/**
 * The cover fields a body carries — the edit page's quick panel (PATCH /api/teachers/me/cover) sends exactly these.
 * ⚠️ coverAreas LEFT (2026-10-08): the reach is always derived (places.ts coverReachOf), never sent.
 */
export const COVER_FIELDS = TEACHER_STEP_FIELDS.cover

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const longStr = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '')
/**
 * A whole number as typed — ⛔ NEVER CLAMPED (plan, 2026-10-08): a salary of 200 or a certificate of 3,000 hours must
 * reach validation as itself and be REFUSED there (salary_range, hours_range, year_range), never silently become
 * 150 or 2,000. Only a value that is not a number at all becomes null.
 */
const whole = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n) : null
}
const pick = (v: unknown, allowed: readonly string[], max = 20): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && allowed.includes(x)))].slice(0, max) : []
/** `picked` in the order of `allowed`, so the stored list — and the facet tokens built from it — is stable. */
const canonical = (allowed: readonly string[], picked: readonly string[]): string[] => {
  const s = new Set(picked)
  return allowed.filter((v) => s.has(v))
}
const names = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? [...new Set(v.map((l) => str(l, 30)).filter(Boolean))].slice(0, max) : []
const YM = /^\d{4}-(0[1-9]|1[0-2])$/ // experience dates are month precision: YYYY-MM, or '' for "present"
/** A start month — YYYY-MM or YYYY-MM-DD in — stored as the month's first day (plan, 2026-10-08). */
const month = (v: unknown): string | null => {
  const m = typeof v === 'string' ? /^(\d{4}-(?:0[1-9]|1[0-2]))(?:-\d{2})?$/.exec(v) : null
  return m ? `${m[1]}-01` : null
}
const ISO_COUNTRY = /^[A-Z]{2}$/
const PHONE = /^\+?[0-9 ().-]{8,20}$/
const CERT_TYPES = values('cert')
const DEGREES = values('degree')
const SUBJECTS = values('subject')

/** The cover fields of a body, coerced (shared by the full form and the quick cover panel). */
export function normalizeCoverFields(raw: unknown): Pick<TeacherInput, 'coverOpen' | 'coverSlots' | 'coverRateVnd' | 'coverConsent'> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    coverOpen: r.coverOpen === true,
    coverSlots: canonical(COVER_SLOTS, pick(r.coverSlots, COVER_SLOTS, COVER_LIMITS.slots)),
    // NOT clamped to the rate bounds: a typo of 30,000 must reach validation as 30,000 and be refused,
    // never be silently raised to the minimum. Only a nonsense magnitude is cut.
    coverRateVnd: ((n) => (n === null ? null : Math.min(100_000_000, Math.max(0, n))))(whole(r.coverRateVnd)),
    coverConsent: r.coverConsent === true,
  }
}

/** Is this body the OLD shape (no teach-area list)? An old fragment, an old draft — or an old open tab's save. */
export function isLegacyTeacherBody(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray((raw as Record<string, unknown>).teachAreas)
}

/** An old free-text district → its curated key, when it names one ("Thủ Đức", "Quận 7", "District 7") — else ''. */
export function legacyDistrictKey(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) return ''
  const slug = canonicalDistrictSlug(text.trim())
  return isCuratedDistrict(slug) ? slug : ''
}

/**
 * THE INPUT-BOUNDARY MAPPING of the previous form's shape (plan review D2, 2026-10-08) — for a `#d=` fragment or a
 * sessionStorage draft made before the redesign, and for scripts/teachers-backfill.ts reading a not-yet-migrated row.
 * Never for a request body (refused upstream) and never at runtime for a stored row (D1). Pure; returns a v2-shaped
 * body for normalizeTeacherInput.
 *   · teachAreas — the old preferred cities, plus 'online' (preferred 'online', openToOnline or the old 'Online' job
 *     type), plus the old cover areas while cover was on, plus 'anywhere'. ⛔ WHOLE-CITY WINS (plan review B2): "all of
 *     HCMC" next to some of its districts keeps all of HCMC (places.ts normalizeTeachAreas) — a stated reach never
 *     shrinks; the cover line then reads "All of HCMC" with its tip to narrow it.
 *   · livesIn — ⛔ NULL, never inferred: the old form forced a hub city even on teachers abroad (D3). The teacher
 *     answers again (the draft opens on the first step that fails); the backfill proposes it per row for the owner.
 *   · currentDistrict text → a curated key (HCMC only; anything unrecognised is dropped).
 *   · jobTypes lose 'online' (a place now); 'business' age becomes 'adults' (Business English derives it).
 *   · englishLevel — 'native' only when nativeSpeaker was true (false may be the untouched default).
 *   · experienceBand — the old years' bucket, except none for 0 years with no teaching history (the old default).
 */
export function fromLegacyTeacher(raw: Record<string, unknown>): Record<string, unknown> {
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const preferred = arr(raw.preferredCities)
  const oldJobs = arr(raw.jobTypes)
  const city = typeof raw.currentCity === 'string' && isHub(raw.currentCity) ? raw.currentCity : ''
  const online = preferred.includes(ONLINE) || raw.openToOnline === true || oldJobs.includes(ONLINE)
  const years = whole(raw.yearsExperience)
  const history = Array.isArray(raw.experience) && raw.experience.length > 0
  return {
    ...raw,
    livesIn: null,
    currentCity: city,
    currentDistrictKey: city === HCMC ? legacyDistrictKey(raw.currentDistrict) : '',
    currentProvince: '',
    teachAreas: [
      ...(online ? [ONLINE] : []),
      ...preferred.filter(isHub),
      ...(raw.coverOpen === true ? arr(raw.coverAreas) : []),
      ...(preferred.includes(ANYWHERE) ? [ANYWHERE] : []),
    ],
    jobTypes: oldJobs.filter((j) => j !== ONLINE),
    ageGroups: [...new Set(arr(raw.ageGroups).map((a) => (a === 'business' ? 'adults' : a)))],
    englishLevel: raw.nativeSpeaker === true ? 'native' : null,
    experienceBand: years !== null && (years > 0 || history) ? experienceBucket(Math.max(0, years)) : null,
  }
}

/**
 * Coerce untrusted input (a request body, a restored URL fragment, a stored row from GET) into a TeacherInput. Never
 * throws; unknown keys and wrong types are dropped; numbers are never clamped. Validation is a separate step, and so is
 * dropping the answers to questions the teacher's other answers hide (normalizeForSave).
 */
export function normalizeTeacherInput(input: unknown): TeacherInput {
  const obj = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const r = isLegacyTeacherBody(obj) ? fromLegacyTeacher(obj) : obj
  const livesIn = (LIVES_IN as readonly unknown[]).includes(r.livesIn) ? (r.livesIn as LivesIn) : null
  const situation = {
    livesIn,
    currentCity: typeof r.currentCity === 'string' && isHub(r.currentCity) ? r.currentCity : '',
    currentProvince: isPickableProvince(r.currentProvince) ? r.currentProvince : '',
    jobTypes: canonical(FORM_JOB_TYPES, pick(r.jobTypes, FORM_JOB_TYPES)),
  }
  const teachAreas = normalizeTeachAreas(r.teachAreas, situation)
  const t: TeacherInput = {
    ...situation,
    currentDistrictKey: typeof r.currentDistrictKey === 'string' && isHcmcDistrict(r.currentDistrictKey) ? r.currentDistrictKey : '',
    relocate: '',
    teachAreas,
    teachAreasConfirmed: r.teachAreasConfirmed === true,
    availableFrom: month(r.availableFrom),
    expectedSalaryM: whole(r.expectedSalaryM),
    subjects: canonical(SUBJECTS, pick(r.subjects, SUBJECTS)),
    teachLanguages: names(r.teachLanguages, LIMITS.teachLanguages),
    // 'business' (a stored value the backfill keeps — D4) reads as Adults: Business English is what derives it now.
    ageGroups: canonical(FORM_AGE_GROUPS, pick(Array.isArray(r.ageGroups) ? r.ageGroups.map((a) => (a === 'business' ? 'adults' : a)) : [], FORM_AGE_GROUPS)),
    experienceBand: typeof r.experienceBand === 'string' && EXPERIENCE_BANDS.includes(r.experienceBand) ? r.experienceBand : null,
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
    degreeYear: whole(r.degreeYear),
    certificates: (Array.isArray(r.certificates) ? r.certificates : []).slice(0, LIMITS.certificates).map((c) => {
      const x = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
      return {
        type: typeof x.type === 'string' && CERT_TYPES.includes(x.type) ? x.type : '',
        hours: whole(x.hours),
        provider: str(x.provider, LIMITS.shortText),
        year: whole(x.year),
      }
    }),
    fullName: str(r.fullName, LIMITS.name),
    nationality: typeof r.nationality === 'string' && ISO_COUNTRY.test(r.nationality) ? r.nationality : '',
    englishLevel: (ENGLISH_LEVELS as readonly unknown[]).includes(r.englishLevel) ? (r.englishLevel as EnglishLevel) : null,
    languages: names(r.languages, LIMITS.languages),
    headline: str(r.headline, LIMITS.headline),
    bio: longStr(r.bio, LIMITS.bio),
    ...normalizeCoverFields(r),
    photoUrl: typeof r.photoUrl === 'string' && r.photoUrl ? r.photoUrl.slice(0, 500) : null,
    videoUrl: typeof r.videoUrl === 'string' && r.videoUrl ? r.videoUrl.slice(0, 500) : null,
    videoOnRequest: r.videoOnRequest === true,
    phone: str(r.phone, 20),
    matchEmailOptIn: r.matchEmailOptIn === true,
    staffContactOptIn: r.staffContactOptIn === true,
  }
  // ⛔ Re-derived only when the body does not say (a stored row, an old draft): a form that sends '' has NOT answered
  // "Would you move?", and reading its list as "No" would answer it for the teacher (an untouched default, B6).
  t.relocate = r.relocate !== undefined
    ? (relocateAnswers(t).includes(r.relocate as Relocate) ? (r.relocate as Relocate) : '')
    : deriveRelocate(t)
  return t
}

const FT_PT: ReadonlySet<string> = new Set(['fulltime', 'parttime'])
const wantsJob = (t: Pick<TeacherInput, 'jobTypes'>) => t.jobTypes.some((j) => FT_PT.has(j))
/** The relocation answers this teacher is offered — none unless the question is asked (places.ts relocationAllowed). */
function relocateAnswers(t: Pick<TeacherInput, 'livesIn' | 'currentCity' | 'currentProvince' | 'jobTypes'>): readonly Relocate[] {
  if (!relocationAllowed(t)) return []
  return t.livesIn === 'abroad' ? RELOCATE_ABROAD : RELOCATE_IN_VN
}

/**
 * The relocation answer a teach-area list stands for — how the form re-reads a stored profile (the answer itself is
 * never stored). '' when the question is not asked, or (abroad) not yet answered.
 */
export function deriveRelocate(t: Pick<TeacherInput, 'livesIn' | 'currentCity' | 'currentProvince' | 'jobTypes' | 'teachAreas'>): Relocate {
  if (!relocationAllowed(t)) return ''
  if (t.teachAreas.includes(ANYWHERE)) return 'anywhere'
  const others = new Set(otherCityKeys(t))
  if (t.teachAreas.some((k) => others.has(k))) return 'some'
  if (t.livesIn === 'abroad') return t.teachAreas.includes(ONLINE) ? 'online-only' : ''
  return 'no'
}

/** Is any subject taught in English (everything but "Other language")? — the English-level question appears only then. */
export const englishMedium = (subjects: readonly string[]): boolean => subjects.some((s) => s !== 'other-language')

/**
 * "Online only" from abroad with no full-time / part-time goal: nothing is left to ask on the Where step, which is
 * skipped (the 4-step rail) — Online, asked once on the first step, is the whole list (plan review B7).
 */
export const whereSkipped = (t: Pick<TeacherInput, 'livesIn' | 'relocate' | 'jobTypes'>): boolean =>
  t.livesIn === 'abroad' && t.relocate === 'online-only' && !wantsJob(t)

/**
 * THE QUESTIONS THIS TEACHER IS ASKED — what the form shows, what validation checks and what a save keeps (an answer
 * to a hidden question is never stored or published — normalizeForSave):
 *   · the district only in HCMC, the province only for "somewhere else";
 *   · "Would you move?" only for full-time / part-time job seekers in Vietnam and for teachers abroad;
 *   · the start month only for full-time / part-time, the salary only for full-time;
 *   · the taught language only under "Other language", the English level only for English-medium subjects;
 *   · degree details only once a degree is picked; the cover step only where the home area has cover;
 *   · both opt-ins only for job seekers. The phone is always offered (required only with staff calls).
 */
export function visibleFields(t: TeacherInput): ReadonlySet<keyof TeacherInput> {
  const v = new Set<keyof TeacherInput>([
    'livesIn', 'jobTypes', 'subjects', 'ageGroups', 'experienceBand', 'experience', 'degreeLevel', 'certificates',
    'fullName', 'nationality', 'languages', 'headline', 'bio', 'photoUrl', 'videoUrl', 'videoOnRequest', 'phone',
  ])
  if (t.livesIn === 'city') {
    v.add('currentCity')
    if (t.currentCity === HCMC) v.add('currentDistrictKey')
  }
  if (t.livesIn === 'elsewhere') v.add('currentProvince')
  if (relocationAllowed(t)) v.add('relocate')
  if (!whereSkipped(t)) { v.add('teachAreas'); v.add('teachAreasConfirmed') }
  if (wantsJob(t)) v.add('availableFrom')
  if (t.jobTypes.includes('fulltime')) v.add('expectedSalaryM')
  if (t.subjects.includes('other-language')) v.add('teachLanguages')
  if (englishMedium(t.subjects)) v.add('englishLevel')
  if (t.degreeLevel && t.degreeLevel !== 'no-degree') { v.add('degreeMajor'); v.add('degreeInstitution'); v.add('degreeYear') }
  if (homeHasCover(t)) for (const k of COVER_FIELDS) v.add(k)
  if (t.jobTypes.length) { v.add('matchEmailOptIn'); v.add('staffContactOptIn') }
  return v
}

/**
 * The steps this teacher sees, in order (the step rail). HCMC job seeker: 6 · a province without cover: 5 · abroad,
 * online only: 4 · teacher.eno.vn (`draftHost`): the 4 draft steps, then "Finish on eno.vn".
 */
export function teacherSteps(t: TeacherInput, opts: { draftHost: boolean }): TeacherStep[] {
  const steps: TeacherStep[] = ['plans']
  if (!whereSkipped(t)) steps.push('where')
  steps.push('teaching', 'about')
  if (opts.draftHost) return steps
  if (homeHasCover(t)) steps.push('cover')
  steps.push('finish')
  return steps
}

/**
 * ⛔ WHAT A SAVE KEEPS: every answer to a question the teacher's other answers hide is dropped (the server runs this
 * before validating; the backfill too), and the teach-area list is held to the answered situation and to the relocation
 * answer (no other cities after "No", 'anywhere' after "Anywhere", only Online after "Online only"). A switched-off or
 * unavailable cover keeps its periods and rate for later — only the switch and its consent go.
 */
export function normalizeForSave(input: TeacherInput): TeacherInput {
  const t: TeacherInput = { ...input }
  const v = visibleFields(t)
  if (!v.has('currentCity')) t.currentCity = ''
  if (!v.has('currentDistrictKey')) t.currentDistrictKey = ''
  if (!v.has('currentProvince')) t.currentProvince = ''
  if (!v.has('relocate')) t.relocate = ''
  let areas = normalizeTeachAreas(t.teachAreas, t)
  const others = new Set(otherCityKeys(t))
  if (t.relocate === 'no') areas = areas.filter((k) => k !== ANYWHERE && !others.has(k))
  if (t.relocate === 'some') areas = areas.filter((k) => k !== ANYWHERE)
  if (t.relocate === 'anywhere') areas = normalizeTeachAreas([...areas, ANYWHERE], t)
  if (t.relocate === 'online-only') areas = [ONLINE]
  t.teachAreas = areas
  if (!v.has('availableFrom')) t.availableFrom = null
  if (!v.has('expectedSalaryM')) t.expectedSalaryM = null
  if (!v.has('teachLanguages')) t.teachLanguages = []
  if (!v.has('englishLevel')) t.englishLevel = null
  if (!v.has('degreeMajor')) { t.degreeMajor = ''; t.degreeInstitution = ''; t.degreeYear = null }
  if (!v.has('matchEmailOptIn')) { t.matchEmailOptIn = false; t.staffContactOptIn = false }
  if (!v.has('coverOpen')) { t.coverOpen = false; t.coverConsent = false }
  return t
}

/**
 * A teacher with neither a job goal nor public cover has nothing to be found for. At creation that is refused (the
 * goal errors); on an edit — cover switched off, or the last job type removed — the save still goes through and the
 * profile is HIDDEN (plan review D6, 2026-10-08: a withdrawal never requires inventing a goal).
 */
export const hasTeachingGoal = (t: TeacherInput): boolean => t.jobTypes.length > 0 || coverIsPublic(t)
/**
 * The goal rule's errors (jobTypes 'required' on the first step, coverOpen 'goal_required' on the Cover step) apart from
 * the rest — what refuses a first publish, but on an edit only hides the profile (publish.ts).
 */
export function splitGoalErrors(e: TeacherErrors): { goal: TeacherErrors; other: TeacherErrors } {
  const goal: TeacherErrors = {}
  const other: TeacherErrors = {}
  for (const [k, v] of Object.entries(e) as [keyof TeacherErrors, string][]) {
    if ((k === 'jobTypes' && v === 'required') || (k === 'coverOpen' && v === 'goal_required')) goal[k] = v
    else other[k] = v
  }
  return { goal, other }
}

/**
 * Validate the fields of the given steps (all steps when omitted). Empty object = valid. Follows visibleFields: a
 * hidden question is never required. Run it on normalizeForSave's output — the server always does.
 */
export function validateTeacherInput(t: TeacherInput, steps: readonly TeacherStep[] = TEACHER_STEPS): TeacherErrors {
  const e: TeacherErrors = {}
  const has = (s: TeacherStep) => steps.includes(s)
  const v = visibleFields(t)
  const nextYear = new Date().getUTCFullYear() + 1
  const yearOk = (y: number) => y >= LIMITS.yearMin && y <= nextYear
  if (has('plans')) {
    if (!t.livesIn) e.livesIn = 'required'
    else if (t.livesIn === 'city' && !isHub(t.currentCity)) e.currentCity = 'required'
    else if (t.livesIn === 'elsewhere' && !isPickableProvince(t.currentProvince)) e.currentProvince = 'required'
    // The work may stay empty only where cover lessons are offered — there the Cover step asks for one or the other.
    if (t.livesIn && !t.jobTypes.length && !homeHasCover(t)) e.jobTypes = 'required'
    if (v.has('relocate') && !t.relocate) e.relocate = 'required'
  }
  if (has('where') && v.has('teachAreas')) {
    const others = new Set(otherCityKeys(t))
    if (!t.teachAreas.length) e.teachAreas = 'required'
    else if (t.relocate === 'some' && !t.teachAreas.some((k) => others.has(k))) e.teachAreas = 'other_city_required'
    // ⛔ The pre-selected home city is a suggestion until the teacher confirms or edits the list (plan review B6).
    else if (!t.teachAreasConfirmed) e.teachAreas = 'confirm'
    if (v.has('expectedSalaryM') && t.expectedSalaryM != null && (t.expectedSalaryM < LIMITS.minSalaryM || t.expectedSalaryM > LIMITS.maxSalaryM)) e.expectedSalaryM = 'salary_range'
  }
  if (has('teaching')) {
    if (!t.subjects.length) e.subjects = 'required'
    if (v.has('teachLanguages') && !t.teachLanguages.length) e.teachLanguages = 'required'
    if (!t.ageGroups.length) e.ageGroups = 'required'
    if (!t.experienceBand) e.experienceBand = 'required'
    t.experience.forEach((x, i) => {
      if (!x.role || !x.employer) e[`experience.${i}`] = 'incomplete'
      else if (x.from && x.to && x.to < x.from) e[`experience.${i}`] = 'dates'
    })
    if (v.has('degreeYear') && t.degreeYear != null && !yearOk(t.degreeYear)) e.degreeYear = 'year_range'
    const seen = new Set<string>()
    t.certificates.forEach((c, i) => {
      // One error per row, and the row is the certificate's (the form names it: "CELTA: …").
      if (!c.type) e[`certificates.${i}`] = 'incomplete'
      else if (seen.has(c.type)) e[`certificates.${i}`] = 'duplicate'
      else if (c.hours != null && (c.hours < LIMITS.certHoursMin || c.hours > LIMITS.certHoursMax)) e[`certificates.${i}`] = 'hours_range'
      else if (c.year != null && !yearOk(c.year)) e[`certificates.${i}`] = 'year_range'
      if (c.type) seen.add(c.type)
    })
  }
  if (has('about')) {
    if (t.fullName.length < 2) e.fullName = 'required'
    if (t.headline.length < 10) e.headline = 'too_short'
    if (!t.nationality) e.nationality = 'required'
    if (v.has('englishLevel') && !t.englishLevel) e.englishLevel = 'required'
  }
  // Cover is optional; once switched on it must be complete — a cover profile with no free period, no reach or no
  // rate would match searches it cannot answer. ⚠️ Switched on, it is checked even where the Cover step is not shown:
  // the quick cover panel saves without normalizeForSave, and "on" with no home area is "on" with no reach.
  if (has('cover')) {
    if (v.has('coverOpen') && !t.jobTypes.length && !t.coverOpen) e.coverOpen = 'goal_required'
    if (t.coverOpen) {
      if (!t.coverSlots.length) e.coverSlots = 'required'
      if (t.coverRateVnd == null) e.coverRateVnd = 'required'
      else if (t.coverRateVnd < COVER_LIMITS.rateMin || t.coverRateVnd > COVER_LIMITS.rateMax) e.coverRateVnd = 'rate_range'
      // The reach is the teach areas near home (places.ts coverReachOf): none there, nowhere to cover.
      if (!coverReachOf(t).length) e.coverOpen = 'reach_required'
      // ⛔ Its OWN consent — the switch, under the notice in force (publish.ts) — never folded into Publish.
      if (!t.coverConsent) e.coverConsent = 'required'
    }
  }
  if (has('finish')) {
    if (!t.photoUrl) e.photoUrl = 'required'
    // Private, and needed only for "Our staff may call me" (owner, 2026-10-08) — otherwise optional, but never junk.
    if (t.staffContactOptIn && !t.phone) e.phone = 'required'
    else if (t.phone && !PHONE.test(t.phone)) e.phone = 'invalid'
  }
  return e
}

/**
 * Every free-text field a teacher typed, by the key the form knows it under — the publish core screens each one and
 * names the FIELD it refused (never the word: a banned or visa word must not reach eno.vn's UI or wire), so the form
 * can jump to it. ⚠️ currentDistrict LEFT (2026-10-08): it is a curated district now, not free text.
 */
export function teacherFreeTextFields(t: TeacherInput): [field: string, text: string][] {
  const out: [string, string][] = [
    ['fullName', t.fullName], ['headline', t.headline], ['bio', t.bio],
    ['degreeMajor', t.degreeMajor], ['degreeInstitution', t.degreeInstitution],
    ...t.languages.map((l): [string, string] => ['languages', l]),
    ...t.teachLanguages.map((l): [string, string] => ['teachLanguages', l]),
    ...t.experience.flatMap((x, i): [string, string][] => [[`experience.${i}`, x.role], [`experience.${i}`, x.employer], [`experience.${i}`, x.city]]),
    ...t.certificates.map((c, i): [string, string] => [`certificates.${i}`, c.provider]),
  ]
  return out.filter(([, text]) => !!text)
}
/** The texts alone. */
export function teacherFreeTexts(t: TeacherInput): string[] {
  return teacherFreeTextFields(t).map(([, text]) => text)
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
 * The derived facet tokens (all multi-valued facets go to `facetTokens`, which no public write path can reach — see
 * src/lib/facet-tokens.ts). Since 2026-10-08:
 *   · workIn:<every teach area> ("Can teach in"), always — the key is kept, so old attr_workIn links need no alias;
 *     ⛔ never a city-level copy of a district pick: "anywhere in HCMC" is its own token, and a District 7 teacher
 *     carrying `workIn:ho-chi-minh-city` would answer a District 1 search (attr-match expands d1 to the whole city);
 *   · inVietnam:yes once "Where are you now?" is answered with a place in Vietnam (never from a default — D3);
 *   · native:native / native:non-native once the English level is answered (Fluent and Working are non-native; a
 *     teacher of other languages only is asked nothing and carries neither);
 *   · experience:<band> once answered;
 *   · ageGroup:business from the Business English subject, jobType:online from 'online' in the teach areas — the old
 *     links (attr_ageGroup=business, attr_jobType=online) keep matching; the stored lists keep whatever they hold;
 *   · cover tokens only while cover is public, its areas the derived reach (places.ts coverReachOf).
 * ⚠️ `coverConsent` IS NOT A COLUMN. A rebuild from a stored row must set it to
 * `coverConsentVersion === COVER_CONSENT_VERSION` (projection.ts teacherInputOfRow does), or the teacher silently
 * drops out of cover search (gate review, 2026-10-07).
 */
export function teacherFacetTokens(t: TeacherInput): string | null {
  // ⛔ COVER TOKENS ONLY WHILE COVER IS ON AND CONSENTED. Switching it off keeps the saved periods and rate on the
  // profile for later, but the next save drops every cover token, so the profile leaves cover search at once.
  const cover = coverIsPublic(t)
  return buildFacetTokens({
    cover: cover ? 'open' : null,
    coverSlot: cover ? t.coverSlots : null,
    coverArea: cover ? coverReachOf(t) : null,
    workIn: t.teachAreas,
    inVietnam: t.livesIn === 'city' || t.livesIn === 'elsewhere' ? 'yes' : null,
    native: t.englishLevel === 'native' ? 'native' : t.englishLevel ? 'non-native' : null,
    experience: t.experienceBand,
    cert: t.certificates.map((c) => c.type).filter(Boolean),
    degree: t.degreeLevel,
    ageGroup: [...t.ageGroups, ...(t.subjects.includes('business-english') ? ['business'] : [])],
    subject: t.subjects,
    jobType: [...t.jobTypes, ...(t.teachAreas.includes(ONLINE) ? [ONLINE] : [])],
    video: t.videoUrl ? 'has-video' : null,
  })
}

/** Cover availability is shown and searchable only when switched on, consented and complete — with somewhere to cover. */
export function coverIsPublic(
  t: Pick<TeacherInput, 'coverOpen' | 'coverConsent' | 'coverSlots' | 'coverRateVnd' | 'teachAreas' | 'livesIn' | 'currentCity' | 'currentProvince'>,
): boolean {
  return t.coverOpen && t.coverConsent && t.coverSlots.length > 0 && t.coverRateVnd != null && coverReachOf(t).length > 0
}

/** The searchable prose of the public listing (title stays the teacher's name). */
export function teacherListingDescription(t: Pick<TeacherInput, 'headline' | 'bio'>): string {
  return [t.headline, t.bio].filter(Boolean).join('\n\n').slice(0, 5000)
}

/**
 * ⛔ MAY THIS TEACHER BE SENT TO THE AI MATCHER? Only with an opt-in switched on UNDER THE CURRENT AI NOTICE (plan
 * review D5, owner 2026-10-08: matching runs only for teachers who opted in; Claude Haiku 5.5, Anthropic). The export
 * in scripts/teachers-match.ts filters by this — an opt-in from the Gemini-era form, with no version, does not count
 * until the teacher re-confirms in /teachers/edit.
 */
export function aiMatchConsented(r: {
  matchEmailOptIn: boolean; matchEmailNoticeVersion?: string | null; staffContactOptIn: boolean; staffContactNoticeVersion?: string | null
}): boolean {
  return (r.matchEmailOptIn && r.matchEmailNoticeVersion === AI_NOTICE_VERSION) || (r.staffContactOptIn && r.staffContactNoticeVersion === AI_NOTICE_VERSION)
}
