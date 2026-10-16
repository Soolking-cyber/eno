/**
 * FILL THE TEACHER FORM FROM A CV OR A LINKEDIN FILE (owner, 2026-10-15) — what the model read from the teacher's OWN
 * file becomes answers for the form, and only answers the form already asks. Pure and client-safe: the import route
 * (src/app/api/teachers/me/import) maps the model's JSON here, and the form merges the result here (mergeImport).
 *
 * ⛔ THE MODEL'S OUTPUT IS UNTRUSTED INPUT. Every value is re-validated against the form's own vocabularies (taxonomy
 * enums, the closed language list, ISO country codes, LIMITS) and every free text is screened with the SAME checks the
 * publish core refuses on (publish.ts screenTeacherTexts: phones, contact details, banned words, visa words) — an
 * imported answer must never be the reason Publish fails. What does not pass is DROPPED, never "fixed" into a claim.
 * ⛔ ONLY WHAT THE FILE STATES. No situation answer is ever imported (where the teacher lives, the work they want, where
 * they can teach, when they can start, salary, cover lessons, consents, photo, video — plan §2). Nationality and the
 * English level come only from an explicit statement in the file (never from a name, a photo or LinkedIn's locale —
 * LinkedIn API Terms 3.1(18)), and everything imported is shown to the teacher marked, to check before Publish.
 * ⚠️ DATES: a job's end is '' ONLY when the file says the job is current, or names an end MONTH still ahead (a contract
 * running) — '' means "I still work here" in the form. A bare year that is this year ends this month at the latest (a
 * job left this spring is not current — review, 2026-10-16). A past job whose end the file does not give is SKIPPED and
 * counted, never published as current; a job that has not started yet is not experience and is dropped.
 */
import {
  ENGLISH_LEVELS, FORM_AGE_GROUPS, LIMITS, TEACHER_OPTIONS, experienceBucket,
  type CertificateEntry, type EnglishLevel, type ExperienceEntry, type TeacherInput,
} from '@/lib/teachers/profile'
import { ALL_COUNTRY_CODES } from '@/lib/teachers/countries'
import { LANGUAGES, type LanguageEntry } from '@/components/teachers/language-list'
import { containsContactInfo, findBannedWord } from '@/lib/publish-guard'
import { containsPhoneNumber, extractPhoneNumber } from '@/lib/phone'
import { decodeEntities } from '@/lib/feed-text'
import { teacherVisaMention } from '@/lib/teachers/visa-mention'

/** The form answers an import may fill — steps 3 and 4 only (TEACHER_STEP_FIELDS.teaching + .about). */
export const IMPORT_FIELDS = [
  'subjects', 'teachLanguages', 'ageGroups', 'experienceBand', 'experience',
  'degreeLevel', 'degreeMajor', 'degreeInstitution', 'degreeYear', 'certificates',
  'fullName', 'nationality', 'englishLevel', 'languages', 'headline', 'bio',
] as const satisfies readonly (keyof TeacherInput)[]
export type ImportField = (typeof IMPORT_FIELDS)[number]
export type ImportedAnswers = Partial<Pick<TeacherInput, ImportField>>

/** Where the answers came from — the tag the form shows beside them ("From your CV" / "From your LinkedIn profile"). */
export type ImportSource = 'cv' | 'linkedin-pdf'

export type TeacherImport = {
  source: ImportSource
  fields: ImportedAnswers
  /** A phone number in the file — OFFERED on the last step ("Use my number"), never in the draft or the profile unasked. */
  phone: string | null
  /** Past teaching jobs the file gives no end date for — skipped (see the header), so the summary can say so. */
  skippedJobs: number
}

/** The vocabularies the model is asked to answer in — the form's own (the route's response schema uses these). */
export const IMPORT_SUBJECTS: readonly string[] = TEACHER_OPTIONS.subject.map((o) => o.value)
export const IMPORT_CERT_TYPES: readonly string[] = TEACHER_OPTIONS.cert.map((o) => o.value)
export const IMPORT_DEGREE_LEVELS = ['phd', 'master', 'bachelor', 'associate'] as const
export const IMPORT_AGE_GROUPS: readonly string[] = FORM_AGE_GROUPS

const COUNTRIES: ReadonlySet<string> = new Set(ALL_COUNTRY_CODES)
const DEGREE_RANK: Readonly<Record<string, number>> = { associate: 1, bachelor: 2, master: 3, phd: 4 }
const YM = /^(\d{4})-(0[1-9]|1[0-2])$/

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const oneLine = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
/**
 * The model's answer with every text DECODED — a model can answer in HTML entities: the fallback model read "Clémence
 * Aubert, Institut français" as "Cl&eacute;mence Aubert, Institut fran&ccedil;ais" (real-model eval, 2026-10-16), which the
 * form would print as typed. Before any check, so the screens see the real text ("&#48;&#57;…" is a phone number too).
 */
const decoded = (v: unknown, depth = 0): unknown => {
  if (typeof v === 'string') return decodeEntities(v)
  if (depth > 4 || !v || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map((x) => decoded(x, depth + 1))
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decoded(x, depth + 1)]))
}
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n) : null
}

/** Would Publish refuse this text? (publish.ts screenTeacherTexts: assertCleanTexts + the visa screen.) */
export function importTextRefused(text: string): boolean {
  return containsPhoneNumber(text) || containsContactInfo(text) || !!findBannedWord(text) || teacherVisaMention(text)
}

/** A short text the form can hold and Publish accepts — else ''. */
function safeShort(v: unknown, max: number): string {
  const s = oneLine(v)
  if (!s) return ''
  const cut = s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '').trim() || s.slice(0, max) : s
  return importTextRefused(cut) ? '' : cut
}

/** "JOHN SMITH" → "John Smith" (CVs often print the name in capitals); anything else as written. */
function nameCase(s: string): string {
  if (s !== s.toUpperCase() || s === s.toLowerCase()) return s
  return s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
}

function fullNameOf(v: unknown): string {
  const s = safeShort(v, LIMITS.name)
  // …and Publish's own name screen (publish-guard assertCleanContactName: a phone, a link, a banned word).
  if (s.length < 2 || /\d|@/.test(s) || !/\p{L}{2}/u.test(s) || importTextRefused(s)) return ''
  return nameCase(s)
}

/** The file's own headline/title line, 10–120 characters; a longer one is cut at its last separator before 120. */
function headlineOf(v: unknown): string {
  // "ESL Teacher @ILA" is LinkedIn's "at", not a handle — read as a handle, the contact screen would drop the line.
  let s = oneLine(v).replace(/\s@\s?(?=\p{Lu})/gu, ' at ')
  if (s.length > LIMITS.headline) {
    const head = s.slice(0, LIMITS.headline)
    const at = Math.max(head.lastIndexOf(' | '), head.lastIndexOf(' · '), head.lastIndexOf(' - '), head.lastIndexOf(', '))
    s = (at >= 10 ? head.slice(0, at) : head.replace(/\s+\S*$/, '')).trim()
  }
  if (s.length < 10 || importTextRefused(s)) return ''
  return s
}

/**
 * The file's summary as the bio: kept in the teacher's own words, sentence by sentence — a sentence Publish would
 * refuse (a phone, an email, a link, a visa word…) is dropped rather than the whole bio. Cut at a sentence end ≤2000.
 */
function bioOf(v: unknown): string {
  if (typeof v !== 'string') return ''
  // ⚠️ PARAGRAPHS ARE BLANK-LINE SEPARATED; a single break is a wrapped line and joins with a space (review, 2026-10-16:
  // split on every break, a phone number wrapped across two lines passed each line's screen and the re-joined bio).
  const paragraphs = v.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const kept: string[][] = []
  for (const p of paragraphs) {
    const ok = p.split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean).filter((x) => !importTextRefused(x))
    if (ok.length) kept.push(ok)
  }
  // ⛔ …and the WHOLE bio is screened as Publish will screen it: what a sentence-by-sentence screen cannot see (a
  // number spread over two sentences) drops sentences from the end until the text passes — or nothing is imported.
  const joined = () => kept.map((ok) => ok.join(' ')).join('\n\n').trim()
  while (kept.length && importTextRefused(joined())) {
    kept[kept.length - 1].pop()
    if (!kept[kept.length - 1].length) kept.pop()
  }
  let out = joined()
  if (out.length > LIMITS.bio) {
    const head = out.slice(0, LIMITS.bio)
    const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('.\n'))
    out = (end > LIMITS.bio / 2 ? head.slice(0, end + 1) : head.replace(/\s+\S*$/, '')).trim()
  }
  return out
}

// ── languages: the closed list (language-list.ts), by name or alias ─────────────────────────────────────────────────
const LEVEL_WORDS = /\b(native|bilingual|mother tongue|first language|fluent|fluency|proficient|proficiency|full|professional|working|limited|elementary|basic|beginner|intermediate|upper|advanced|conversational|business|level|[abc][12]|ielts|toeic|toefl|hsk|jlpt|topik|n[1-5])\b/g
const BY_WORD: ReadonlyMap<string, LanguageEntry> = new Map(
  LANGUAGES.flatMap((l) => [l.name, ...(l.also ?? [])].map((n) => [n.toLowerCase(), l] as const)),
)
/** "Spanish (B2)", "Mandarin Chinese – conversational", "French: fluent" → the list's entry, or null. */
export function matchLanguage(raw: unknown): LanguageEntry | null {
  if (typeof raw !== 'string') return null
  const clean = (x: string) => x.replace(LEVEL_WORDS, ' ').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  const lower = raw.toLowerCase()
  // What the brackets say first, when it IS a list language: "Chinese (Cantonese)" is Cantonese, never Mandarin.
  for (const m of lower.matchAll(/\(([^)]*)\)/g)) {
    const inner = BY_WORD.get(clean(m[1]))
    if (inner) return inner
  }
  const base = clean(lower.replace(/\(.*?\)/g, ' ').split(/[:–—/|;]|\s-\s/)[0])
  if (!base) return null
  const exact = BY_WORD.get(base)
  if (exact) return exact
  // A name of two languages, or one the list does not hold under another's word, is not guessed: "Serbo-Croatian",
  // "Scottish Gaelic" (not Irish). Only a known qualifier before a list name is read past (review, 2026-10-16).
  const words = base.split(' ')
  if (words.length !== 2 || !LANGUAGE_QUALIFIERS.has(words[0])) return null
  return BY_WORD.get(words[1]) ?? null
}
/** Words that name a variety, never another language: "Brazilian Portuguese", "Mandarin Chinese", "Modern Greek". */
const LANGUAGE_QUALIFIERS: ReadonlySet<string> = new Set([
  'mandarin', 'standard', 'modern', 'brazilian', 'european', 'latin', 'american', 'british', 'australian', 'canadian',
  'mexican', 'castilian', 'swiss', 'austrian', 'belgian', 'egyptian', 'levantine', 'gulf', 'moroccan', 'classical',
  'simplified', 'traditional', 'continental', 'québécois', 'quebec',
])
function languageNames(v: unknown, exclude: ReadonlySet<string>, max: number): string[] {
  const out: string[] = []
  for (const x of arr(v)) {
    const e = matchLanguage(x)
    if (!e || e.code === 'en' || exclude.has(e.code) || out.includes(e.name)) continue
    out.push(e.name)
    if (out.length >= max) break
  }
  return out
}

// ── dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ymOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
/** A file's date as the form's month: YYYY-MM as is, YYYY-M padded, a bare year as its first (start) or last (end) month. */
function monthOf(v: unknown, edge: 'start' | 'end', now: Date): string {
  const s = oneLine(v)
  const y = (n: number) => n >= LIMITS.yearMin && n <= now.getUTCFullYear() + 1
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s)
  if (m && y(Number(m[1])) && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2].padStart(2, '0')}`
  m = /^(\d{4})$/.exec(s)
  if (m && y(Number(m[1]))) return `${m[1]}-${edge === 'start' ? '01' : '12'}`
  return ''
}
const monthIndex = (ym: string): number => {
  const m = YM.exec(ym)
  return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : NaN
}

type Job = ExperienceEntry & { current: boolean }

function jobsOf(v: unknown, now: Date): { jobs: Job[]; skipped: number; subjects: string[]; ageGroups: string[] } {
  const nowYm = ymOf(now)
  const jobs: Job[] = []
  const subjects: string[] = []
  const ageGroups: string[] = []
  let skipped = 0
  for (const x of arr(v).map(obj)) {
    if (x.teaching !== true) continue
    const role = safeShort(x.role, LIMITS.shortText)
    const employer = safeShort(x.employer, LIMITS.shortText)
    if (!role || !employer) continue
    let from = monthOf(x.from, 'start', now)
    let to = monthOf(x.to, 'end', now)
    // A bare year that is THIS year — "2023 – 2026" — ends this month at the latest, never in a December still ahead.
    if (to > nowYm && /^\d{4}$/.test(oneLine(x.to)) && Number(oneLine(x.to)) === now.getUTCFullYear()) to = nowYm
    // Not started yet: not experience.
    if (from > nowYm) continue
    // A written end month still ahead is a contract running: the job is current — as it is when the file says so, unless
    // it also gives an end that has passed (the date wins over the model's flag — gate review, 2026-10-16).
    let current = (x.current === true && (!to || to > nowYm)) || (!!to && to > nowYm)
    if (current) to = ''
    if (!current && !to) { skipped++; continue }
    if (from && to && to < from) from = ''
    current = to === ''
    const city = safeShort(x.city, LIMITS.shortText)
    // The same job twice (a Word text box is written twice; a model can repeat a row): kept once.
    const key = [role, employer, from, to].join('|').toLowerCase()
    if (jobs.some((j) => [j.role, j.employer, j.from, j.to].join('|').toLowerCase() === key)) continue
    jobs.push({ role, employer, city, from, to, current })
    subjects.push(...arr(x.subjects).filter((s): s is string => typeof s === 'string'))
    ageGroups.push(...arr(x.ageGroups).filter((s): s is string => typeof s === 'string'))
  }
  // Most recent first: the current jobs, then by end, then by start.
  jobs.sort((a, b) => Number(b.current) - Number(a.current) || (b.to || '').localeCompare(a.to || '') || (b.from || '').localeCompare(a.from || ''))
  return { jobs: jobs.slice(0, LIMITS.experienceEntries), skipped, subjects, ageGroups }
}

/**
 * How long they have taught, from the dated jobs: overlapping jobs counted once, a current job up to this month. Null
 * when no job has a start month — then a number the file STATES ("6 years of teaching") is used, else nothing (the
 * band has no default: an untouched default once published as "under 1 year" — teaching-step.tsx).
 */
export function teachingBand(jobs: readonly Pick<Job, 'from' | 'to'>[], stated: unknown, now: Date): string | null {
  const nowIdx = monthIndex(ymOf(now))
  const spans = jobs
    .filter((j) => j.from)
    .map((j) => [monthIndex(j.from), j.to ? monthIndex(j.to) : nowIdx] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a)
    .sort((p, q) => p[0] - q[0])
  if (spans.length) {
    let months = 0
    let [s, e] = spans[0]
    for (const [a, b] of spans.slice(1)) {
      if (a <= e + 1) e = Math.max(e, b)
      else { months += e - s + 1; s = a; e = b }
    }
    months += e - s + 1
    return experienceBucket(months / 12)
  }
  const years = int(stated)
  return years !== null && years > 0 && years <= 60 ? experienceBucket(years) : null
}

// ── certificates ────────────────────────────────────────────────────────────────────────────────────────────────────
/** A certificate's NAME, as printed, decides its type when it names one — the model's type only otherwise. */
const CERT_BY_NAME: readonly (readonly [RegExp, string])[] = [
  [/\bdelta\b/i, 'delta'],
  [/\bcelta\b/i, 'celta'],
  [/\btkt\b|teaching knowledge test/i, 'tkt'],
  [/\bpgce\b|post-?graduate certificate in education/i, 'pgce'],
  [/\btesol\b|\bcert\s?tesol\b/i, 'tesol'],
  [/\btefl\b/i, 'tefl'],
  [/\bqts\b|qualified teacher status|teach(?:ing|er(?:'s)?) licen[cs]e|teacher certification|state (?:teaching )?certification/i, 'teaching-license'],
]
function certificatesOf(v: unknown, now: Date): CertificateEntry[] {
  const out: CertificateEntry[] = []
  const year = (n: number | null) => (n !== null && n >= LIMITS.yearMin && n <= now.getUTCFullYear() + 1 ? n : null)
  for (const x of arr(v).map(obj)) {
    const name = oneLine(x.name)
    const byName = CERT_BY_NAME.find(([re]) => re.test(name))?.[1]
    // Both checked against the form's own list — a name rule never offers a type the form does not have.
    const type = [byName, x.type].find((t): t is string => typeof t === 'string' && IMPORT_CERT_TYPES.includes(t)) ?? null
    if (!type || out.some((c) => c.type === type)) continue
    // 0 is the model's "not stated" — then the hours printed in the name ("120-hour TEFL"), if any.
    const given = int(x.hours)
    const statedHours = given !== null && given > 0 ? given : int(/(\d{2,4})\s*-?\s*(?:hours?|hrs?|h)\b/i.exec(name)?.[1])
    out.push({
      type,
      hours: statedHours !== null && statedHours >= LIMITS.certHoursMin && statedHours <= LIMITS.certHoursMax ? statedHours : null,
      provider: safeShort(x.provider, LIMITS.shortText),
      year: year(int(x.year)),
    })
    if (out.length >= LIMITS.certificates) break
  }
  return out
}

function degreeOf(v: unknown, now: Date): Pick<TeacherInput, 'degreeLevel' | 'degreeMajor' | 'degreeInstitution' | 'degreeYear'> | null {
  let best: Record<string, unknown> | null = null
  for (const x of arr(v).map(obj)) {
    const rank = typeof x.level === 'string' ? DEGREE_RANK[x.level] ?? 0 : 0
    if (rank && (!best || rank > (DEGREE_RANK[best.level as string] ?? 0))) best = x
  }
  if (!best) return null
  const y = int(best.year)
  return {
    degreeLevel: best.level as string,
    degreeMajor: safeShort(best.field, LIMITS.shortText),
    degreeInstitution: safeShort(best.institution, LIMITS.shortText),
    degreeYear: y !== null && y >= LIMITS.yearMin && y <= now.getUTCFullYear() + 1 ? y : null,
  }
}

const pickAllowed = (values: readonly unknown[], allowed: readonly string[]): string[] => {
  const s = new Set(values.filter((x): x is string => typeof x === 'string'))
  return allowed.filter((a) => s.has(a))
}

/**
 * The model's JSON → the answers the form may take. Null when the model says the file is not a CV or a profile (a
 * photo of a menu, an ID card…) — the caller says so and imports nothing.
 */
export function mapTeacherImport(raw: unknown, opts: { now: Date }): TeacherImport | null {
  const r = obj(decoded(raw))
  if (r.isCv !== true) return null
  const { now } = opts
  const fields: ImportedAnswers = {}

  const fullName = fullNameOf(r.fullName)
  if (fullName) fields.fullName = fullName
  const headline = headlineOf(r.headline)
  if (headline) fields.headline = headline
  const bio = bioOf(r.summary)
  if (bio) fields.bio = bio
  const nationality = typeof r.nationalityCode === 'string' ? r.nationalityCode.trim().toUpperCase() : ''
  if (COUNTRIES.has(nationality)) fields.nationality = nationality
  if ((ENGLISH_LEVELS as readonly unknown[]).includes(r.englishLevel)) fields.englishLevel = r.englishLevel as EnglishLevel

  const taught = languageNames(r.taughtLanguages, new Set(), LIMITS.teachLanguages)
  const taughtCodes = new Set(taught.map((n) => LANGUAGES.find((l) => l.name === n)!.code))
  const spoken = languageNames(r.spokenLanguages, taughtCodes, LIMITS.languages)
  if (spoken.length) fields.languages = spoken

  const { jobs, skipped, subjects: jobSubjects, ageGroups: jobAges } = jobsOf(r.jobs, now)
  if (jobs.length) fields.experience = jobs.map(({ current: _current, ...e }) => e)
  const band = teachingBand(jobs, r.statedTeachingYears, now)
  if (band) fields.experienceBand = band

  // "Other language" stands only with the languages it names (validation: teachLanguages 'required' with it).
  let subjects = pickAllowed([...arr(r.subjects), ...jobSubjects], IMPORT_SUBJECTS)
  if (taught.length && !subjects.includes('other-language')) subjects = pickAllowed([...subjects, 'other-language'], IMPORT_SUBJECTS)
  if (!taught.length) subjects = subjects.filter((s) => s !== 'other-language')
  if (subjects.length) fields.subjects = subjects
  if (taught.length && subjects.includes('other-language')) fields.teachLanguages = taught
  const ageGroups = pickAllowed([...arr(r.ageGroups), ...jobAges], IMPORT_AGE_GROUPS)
  if (ageGroups.length) fields.ageGroups = ageGroups

  const degree = degreeOf(r.education, now)
  if (degree) Object.assign(fields, degree)
  const certificates = certificatesOf(r.certificates, now)
  if (certificates.length) fields.certificates = certificates

  const source: ImportSource = r.documentKind === 'linkedin-profile' ? 'linkedin-pdf' : 'cv'
  return { source, fields, phone: phoneOf(r.phone, r.phoneCountry), skippedJobs: skipped }
}

/**
 * The number in the file, OFFERED on the last step — only when it can be dialled as written: with its country code
 * (+44 7700…, 0044…), or an unmistakable Vietnamese mobile (0 + 3/5/7/8/9 + 8 digits). ⛔ Never a local number from
 * elsewhere turned Vietnamese: "07700 900123" (a UK mobile) through the app's VN normalisation became +847700900123,
 * one tap from being saved as the teacher's private phone (review, 2026-10-16). ⚠️ A 10-digit 08… or 07… number is
 * ambiguous (a VN mobile, or an Irish, South African or French one written locally): offered as Vietnamese only when
 * the file does not place it in another country (`country`, the model's phoneCountry — "Mobile (Ireland): 087 123 4567"
 * was offered as +84 87 123 4567 in the real-model eval, 2026-10-16). The chip shows the +84, and nothing is used until
 * the teacher taps it.
 */
function phoneOf(v: unknown, country: unknown): string | null {
  // The number as written, without a label around it ("Mobile: …", "Tel …").
  const written = /(?:\+|\b00)?\d[\d\s().\-·]{6,}\d/.exec(oneLine(v))?.[0]
  if (!written) return null
  // "+44 (0)7700 900123": the (0) is the trunk digit dialled at home only — never part of the number from abroad.
  const compact = written.replace(/\(0\)/g, '').replace(/[\s().\-·]/g, '')
  const international = /^(?:\+|00)[1-9]\d{6,14}$/.test(compact)
  // Placed in another country — an ISO code other than VN; "", "unknown", a word or anything else places it nowhere (a
  // stand-in must never hide a Vietnam-based teacher's real number — gate review, 2026-10-16): not offered. A missed offer
  // costs the teacher one typed number on the last step; a wrong one can become their private phone.
  const placed = typeof country === 'string' ? country.trim().toUpperCase() : ''
  const elsewhere = COUNTRIES.has(placed) && placed !== 'VN'
  const vnMobile = /^0[35789]\d{8}$/.test(compact) && !elsewhere
  if (!international && !vnMobile) return null
  const digits = extractPhoneNumber(international ? compact.replace(/^00/, '+') : compact)
  return digits ? `+${digits}` : null
}

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/**
 * THE MERGE — the import fills only what the teacher has NOT answered; an answer they gave (typed now, or saved in
 * their draft) always wins. Returns a NEW object when anything changed (the form's "untouched" test is a reference
 * check against EMPTY_TEACHER) and the fields it filled, in form order, for the summary and the tags.
 * ⛔ Never mergeReview (teacher-form-rules.ts): it takes step 1 whole and would blank the situation answers.
 */
export function mergeImport(t: TeacherInput, fields: ImportedAnswers): { next: TeacherInput; filled: ImportField[] } {
  const filled: ImportField[] = []
  const next: TeacherInput = { ...t }
  for (const key of IMPORT_FIELDS) {
    const value = fields[key]
    if (isBlank(value) || !isBlank(t[key])) continue
    ;(next as Record<ImportField, unknown>)[key] = value
    filled.push(key)
  }
  // Degree details belong to the degree they describe: never under a level the teacher chose differently.
  if (!filled.includes('degreeLevel') && t.degreeLevel && fields.degreeLevel && t.degreeLevel !== fields.degreeLevel) {
    for (const k of ['degreeMajor', 'degreeInstitution', 'degreeYear'] as const) {
      if (filled.includes(k)) { (next as Record<string, unknown>)[k] = t[k]; filled.splice(filled.indexOf(k), 1) }
    }
  }
  return { next: filled.length ? next : t, filled }
}
