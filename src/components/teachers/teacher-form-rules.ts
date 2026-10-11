/**
 * THE TEACHER FORM'S OWN RULES — pure, no React (teacher onboarding redesign, 2026-10-08): how one answer re-derives
 * the answers that hang on it, what an edit would throw away, the headline suggestion, the teacher.eno.vn hand-off
 * fragment and the draft's shape. The CONTRACT these build on — what a teacher may submit, which questions are asked,
 * validation, what a save keeps — is src/lib/teachers/profile.ts and places.ts; nothing here decides a field's
 * validity or what is stored. ⚠️ Everything here is only what the FORM SHOWS before a save: the server re-runs
 * normalizeForSave on every body, so a slip here can show a stale answer but never store a hidden one.
 */
import {
  ANYWHERE, HCMC, ONLINE, normalizeTeachAreas, otherCityKeys, placeLabel, provinceKeyOf, relocationAllowed,
} from '@/lib/teachers/places'
import {
  DRAFT_STEPS, EMPTY_TEACHER, PRE_SIGNIN_STEPS, TEACHER_OPTIONS, TEACHER_STEPS, TEACHER_STEP_FIELDS, normalizeForSave, normalizeTeacherInput,
  teacherSteps, validateTeacherInput, type Relocate, type TeacherErrors, type TeacherInput, type TeacherStep,
} from '@/lib/teachers/profile'
import { storedLanguageLabel } from '@/components/teachers/language-list'

export type Situation = Pick<TeacherInput, 'livesIn' | 'currentCity' | 'currentProvince' | 'currentDistrictKey'>

export const isTeacherStep = (v: unknown): v is TeacherStep => typeof v === 'string' && (TEACHER_STEPS as readonly string[]).includes(v)

/** The steps that need a session on eno.vn — everything after the four draft steps. */
export const ACCOUNT_STEPS: readonly TeacherStep[] = TEACHER_STEPS.filter((s) => !DRAFT_STEPS.includes(s))

/** The step a field (or an `experience.2` / `certificates.0` row) is asked on. */
export function stepOfField(key: string): TeacherStep | undefined {
  return TEACHER_STEPS.find((s) => (TEACHER_STEP_FIELDS[s] as readonly string[]).some((f) => key === f || key.startsWith(`${f}.`)))
}

/** The first of `steps` whose fields carry an error, in step order. */
export function firstStepWithError(errors: TeacherErrors, steps: readonly TeacherStep[]): TeacherStep | undefined {
  const bad = new Set(Object.keys(errors).map(stepOfField))
  return steps.find((s) => bad.has(s))
}

/** Validate `steps` the way the server will — on what a save keeps (normalizeForSave), never on hidden answers. */
export function checkSteps(t: TeacherInput, steps: readonly TeacherStep[]): TeacherErrors {
  return validateTeacherInput(normalizeForSave(t), steps)
}

// ── THE PLACES PRE-SELECTED FOR A HOME (plan review B6) ───────────────────────────────────────────────────────────────

/**
 * The places pre-selected for a home — "keeping it takes 0 taps" — and ⛔ ONLY A SUGGESTION until the teacher confirms
 * the list or edits it (teachAreasConfirmed; the server stamps teachAreasConfirmedAt). Nothing is public from an
 * untouched default.
 *   · a city chip → that city (HCMC: "Anywhere in HCMC");
 *   · HCMC when the teacher came for COVER (?goal=cover) → their home district, if they named one: cover is found by
 *     district, so "Only some districts" opens first (plan, WP2);
 *   · somewhere else → their province;  · abroad → nothing (no home area).
 */
export function homeDefaultAreas(s: Situation, coverIntent = false): string[] {
  if (s.livesIn === 'city' && s.currentCity) {
    if (s.currentCity === HCMC && coverIntent) return s.currentDistrictKey ? [s.currentDistrictKey] : []
    return [s.currentCity]
  }
  if (s.livesIn === 'elsewhere') {
    const k = provinceKeyOf(s.currentProvince)
    return k ? [k] : []
  }
  return []
}

const homeOf = (s: Situation) => `${s.livesIn ?? ''}|${s.currentCity}|${s.currentProvince}`

/**
 * A new answer to "Where are you now?" (the chip, the district, the province — or a town alias switching the chip).
 *   · The parts the new answer does not ask go (a district outside HCMC, a province when not "somewhere else").
 *   · A NEW HOME re-derives the list: Online (if picked) + the new home's pre-selection, unconfirmed — the old home's
 *     places mean something else now. "Would you move?" is asked again (its "only around {city}" changed). The FIRST
 *     answer instead KEEPS what an old draft carried (places.ts: nothing is thrown away before the situation exists)
 *     and adds the pre-selection; the pruning then follows the answer.
 *   · Only the HCMC district changed: an untouched pre-selection follows it (cover's "Only some districts").
 */
export function withSituation(t: TeacherInput, next: Partial<Situation>, coverIntent = false): TeacherInput {
  const s: Situation = {
    livesIn: next.livesIn !== undefined ? next.livesIn : t.livesIn,
    currentCity: next.currentCity ?? t.currentCity,
    currentProvince: next.currentProvince ?? t.currentProvince,
    currentDistrictKey: next.currentDistrictKey ?? t.currentDistrictKey,
  }
  if (s.livesIn !== 'city') s.currentCity = ''
  if (s.livesIn !== 'elsewhere') s.currentProvince = ''
  if (s.currentCity !== HCMC) s.currentDistrictKey = ''
  const out: TeacherInput = { ...t, ...s }
  const ctx = { ...s, jobTypes: t.jobTypes }
  if (t.livesIn === null) {
    out.teachAreas = normalizeTeachAreas([...t.teachAreas, ...homeDefaultAreas(s, coverIntent)], ctx)
    out.teachAreasConfirmed = false
  } else if (homeOf(t) !== homeOf(s)) {
    out.teachAreas = normalizeTeachAreas([...(t.teachAreas.includes(ONLINE) ? [ONLINE] : []), ...homeDefaultAreas(s, coverIntent)], ctx)
    out.teachAreasConfirmed = false
    out.relocate = ''
  } else if (s.currentDistrictKey !== t.currentDistrictKey && !t.teachAreasConfirmed) {
    // ⚠️ An EMPTY pre-selection is untouched too: the cover entry's HCMC chip comes BEFORE its district (the district
    // field appears only after the chip), so the first district always arrives over [] — guarding on a non-empty `before`
    // meant the home district was never pre-selected (browser run, 2026-10-09). An unconfirmed list is only a suggestion;
    // a teacher's own edit confirms it, and a confirmed list never moves.
    const before = homeDefaultAreas(t, coverIntent)
    const untouched = t.teachAreas.filter((k) => k !== ONLINE).join() === before.join()
    if (untouched) out.teachAreas = normalizeTeachAreas([...(t.teachAreas.includes(ONLINE) ? [ONLINE] : []), ...homeDefaultAreas(s, coverIntent)], ctx)
  }
  return out
}

/**
 * New job types. When the relocation question stops being asked (no full-time / part-time left, in Vietnam), its answer
 * and the places away from home go with it — the same pruning a save does (normalizeForSave), shown now.
 */
export function withJobTypes(t: TeacherInput, jobTypes: string[]): TeacherInput {
  const out = { ...t, jobTypes }
  if (relocationAllowed(t) && !relocationAllowed(out)) {
    out.relocate = ''
    out.teachAreas = normalizeTeachAreas(t.teachAreas, out)
  }
  return out
}

/**
 * The answer to "Would you move for a job?" / "Where in Vietnam would you like to teach?", applied to the list at once
 * (the rules normalizeForSave applies at a save): "No" takes the other cities away, "Some cities" leaves them to pick,
 * "Anywhere" is one line that stands for every other city, and "Online only" (abroad) IS the list — Online, derived,
 * asked nowhere else (plan review B7).
 */
export function withRelocate(t: TeacherInput, relocate: Relocate): TeacherInput {
  const others = new Set(otherCityKeys(t))
  let areas = t.teachAreas
  if (relocate === 'no') areas = areas.filter((k) => k !== ANYWHERE && !others.has(k))
  else if (relocate === 'some') areas = areas.filter((k) => k !== ANYWHERE)
  else if (relocate === 'anywhere') areas = normalizeTeachAreas([...areas.filter((k) => !others.has(k)), ANYWHERE], t)
  else if (relocate === 'online-only') areas = [ONLINE]
  return { ...t, relocate, teachAreas: areas }
}

// ── WHAT AN EDIT WOULD THROW AWAY (plan: "a warning appears before a change drops answers") ─────────────────────────

export type DroppedField =
  | 'expectedSalaryM' | 'availableFrom' | 'teachLanguages' | 'englishLevel' | 'degreeDetails' | 'optIns' | 'cover'
  | 'currentDistrictKey'

/**
 * What saving `next` instead of `prev` would discard that `prev` still holds — compared on what a save KEEPS
 * (normalizeForSave), so a hidden answer that was never going to be saved is not reported, and a place the new answer
 * rules out is. Removing Full-time takes the salary (and the start month, without Part-time); moving abroad switches
 * cover off; a new home drops the old home's places.
 */
export function droppedAnswers(prev: TeacherInput, next: TeacherInput): { fields: DroppedField[]; places: string[] } {
  const a = normalizeForSave(prev)
  const b = normalizeForSave(next)
  const fields: DroppedField[] = []
  if (a.currentDistrictKey && !b.currentDistrictKey) fields.push('currentDistrictKey')
  if (a.expectedSalaryM != null && b.expectedSalaryM == null) fields.push('expectedSalaryM')
  if (a.availableFrom && !b.availableFrom) fields.push('availableFrom')
  if (a.teachLanguages.length && !b.teachLanguages.length) fields.push('teachLanguages')
  if (a.englishLevel && !b.englishLevel) fields.push('englishLevel')
  const degree = (x: TeacherInput) => !!(x.degreeMajor || x.degreeInstitution || x.degreeYear != null)
  if (degree(a) && !degree(b)) fields.push('degreeDetails')
  if ((a.matchEmailOptIn || a.staffContactOptIn) && !(b.matchEmailOptIn || b.staffContactOptIn)) fields.push('optIns')
  if (a.coverOpen && !b.coverOpen) fields.push('cover')
  const kept = new Set(b.teachAreas)
  return { fields, places: a.teachAreas.filter((k) => !kept.has(k)) }
}

export const nothingDropped = (d: { fields: readonly unknown[]; places: readonly unknown[] }) => !d.fields.length && !d.places.length

// ── THE HEADLINE SUGGESTION ("Use suggestion", built from step 3) ──────────────────────────────────────────────────

const CERT_ORDER = ['delta', 'celta', 'pgce', 'tesol', 'tefl', 'tkt'] as const
/** Tuples, not `{ en, vi }` pairs: this is the TEACHER's text once used, never UI copy for the MT catalogue. */
const BAND_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  'under-1-year': ['under 1 year', 'dưới 1 năm'],
  '1-3-years': ['1–3 years', '1–3 năm'],
  '3-5-years': ['3–5 years', '3–5 năm'],
  '5-10-years': ['5–10 years', '5–10 năm'],
  'over-10-years': ['10+ years', 'trên 10 năm'],
}

/**
 * A headline from what the teacher told step 3 — their best certificate, up to two subjects (or the language they
 * teach), their experience — in Vietnamese on a Vietnamese page and English everywhere else (it is the teacher's own
 * public text, which schools read: never machine-translated). '' when step 3 says too little to suggest anything.
 */
export function suggestHeadline(t: Pick<TeacherInput, 'subjects' | 'teachLanguages' | 'certificates' | 'experienceBand'>, lang: string): string {
  const vi = lang === 'vi'
  const label = (opts: readonly { value: string; label: string; labelVi: string }[], v: string) => {
    const o = opts.find((x) => x.value === v)
    return o ? (vi ? o.labelVi : o.label) : ''
  }
  const taught = t.teachLanguages.slice(0, 2).map((n) => storedLanguageLabel(n, vi ? 'vi' : 'en'))
  const subjects = t.subjects
    .flatMap((s) => (s === 'other-language' ? (taught.length ? taught : [label(TEACHER_OPTIONS.subject, s)]) : [label(TEACHER_OPTIONS.subject, s)]))
    .filter(Boolean)
    .slice(0, 2)
  if (!subjects.length) return ''
  const cert = CERT_ORDER.find((c) => t.certificates.some((x) => x.type === c))
  const certName = cert ? label(TEACHER_OPTIONS.cert, cert) : ''
  const band = t.experienceBand ? BAND_WORDS[t.experienceBand] : undefined
  const what = subjects.join(' & ')
  const head = vi
    ? `Giáo viên ${what}${certName ? ` có chứng chỉ ${certName}` : ''}`
    : `${certName ? `${certName}-certified ` : ''}${what} teacher`
  return `${head}${band ? ` · ${vi ? band[1] : band[0]}` : ''}`.slice(0, 120)
}

// ── THE teacher.eno.vn HAND-OFF AND THE DRAFT (plan, 2026-10-08) ──────────────────────────────────────────────────

/** The fields the four draft steps own — all a `#d=` fragment or a draft may carry. */
export const DRAFT_FIELDS: readonly (keyof TeacherInput)[] = DRAFT_STEPS.flatMap((s) => TEACHER_STEP_FIELDS[s])

/** `t` cut to the draft steps' fields: ⛔ never a consent, a cover field, a phone or an upload. */
export function draftPart(t: TeacherInput): Partial<TeacherInput> {
  return Object.fromEntries(DRAFT_FIELDS.map((k) => [k, t[k]])) as Partial<TeacherInput>
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromBase64Url(s: string): unknown {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
  } catch {
    return null
  }
}

/** The `#d=` value teacher.eno.vn hands to eno.vn: base64url of `{ v: 2, t }`, `t` the draft steps' fields only. */
/**
 * What teacher.eno.vn hands over: the fields of the steps it SHOWS (PRE_SIGNIN_STEPS) — ⛔ never what an older tab's copy
 * kept behind them (commit gate, codex 2026-10-11: on a shared tab, the previous visitor's name and bio would cross,
 * unseen, into the next person's account). A four-step fragment (a host tab opened before, or a crafted link) is READ
 * as step 1 too (decodeHandoff) — its later steps are not kept.
 */
export const HANDOFF_FIELDS: readonly (keyof TeacherInput)[] = [
  ...PRE_SIGNIN_STEPS.flatMap((s) => TEACHER_STEP_FIELDS[s]),
  // …and the teaching areas step 1 itself writes (withSituation, plans-step SITUATION_FIELDS: an online-only teacher
  // skips Where — commit gate, opus round 11).
  'teachAreas', 'teachAreasConfirmed',
]
/** Two answer sets compared as the account stores them (draftDataOf = fromDraft): never raw form state against it. */
export const sameDraftAnswers = (a: unknown, b: unknown): boolean =>
  JSON.stringify(draftPart(fromDraft(a))) === JSON.stringify(draftPart(fromDraft(b)))
// Still the v2 shape — every draft step's field, the later ones EMPTY: a body without a teachAreas array reads as the
// pre-redesign v1 (isLegacyTeacherBody) and would lose step 1 on the way in.
export const encodeHandoff = (t: TeacherInput): string => toBase64Url(JSON.stringify({ v: 2, t: draftPart(handoffPart(t)) }))
/**
 * "Review these answers in my profile" and "Use the answers I just gave instead": these answers over the saved ones —
 * step 1 as a whole (it is one decision), and of the later draft steps only what the answers hold. ⛔ Never a blank over
 * a saved answer (a hand-off carries step 1 only: set whole, it would empty the name and bio — commit gate, round 14).
 */
export function mergeReview(saved: TeacherInput, t: TeacherInput): TeacherInput {
  const same = (k: keyof TeacherInput) => JSON.stringify(saved[k]) === JSON.stringify(t[k])
  const answered = (k: keyof TeacherInput) => JSON.stringify(t[k]) !== JSON.stringify(EMPTY_TEACHER[k])
  const step1 = TEACHER_STEP_FIELDS.plans as readonly (keyof TeacherInput)[]
  // The teaching areas and their confirmation go together and FOLLOW STEP 1 (commit gate, opus rounds 15-16): a new home
  // or new work brings its own areas — none, then the teacher picks them again — never the old city's confirmed ones;
  // the same step 1 keeps the saved areas unless these answers name some.
  const areas: (keyof TeacherInput)[] = !step1.every(same) || answered('teachAreas') ? ['teachAreas', 'teachAreasConfirmed'] : []
  const later = DRAFT_FIELDS.filter((k) => !step1.includes(k) && k !== 'teachAreas' && k !== 'teachAreasConfirmed' && answered(k))
  return { ...saved, ...(Object.fromEntries([...step1, ...areas, ...later].map((k) => [k, t[k]])) as Partial<TeacherInput>) }
}
/** `t` cut to what a signed-out visitor gives (HANDOFF_FIELDS), every other field EMPTY. */
export const handoffPart = (t: TeacherInput): TeacherInput =>
  ({ ...EMPTY_TEACHER, ...(Object.fromEntries(HANDOFF_FIELDS.map((k) => [k, t[k]])) as Partial<TeacherInput>) })

/**
 * The campaign tags the hand-off carries to eno.vn, as a query — or ''. The first-visit record is per host, so without
 * them eno.vn sees a visit from teacher.eno.vn and the campaign that brought the teacher is lost.
 * ⛔ THE CONTRACT IS WHAT src/lib/attribution.ts READS FROM AN ADDRESS, AND NOTHING ELSE: `utm_source`, `utm_medium`,
 * `utm_campaign` — three named tags, the first value of each, in that order. Never a click id (fbclid, gclid), another
 * `utm_*`, or anything else in the address (commit gate, 2026-10-11: a pattern over `utm_*` needed a cap on how many,
 * an order to keep, and still let a crafted address grow the hand-off). A tag whose value serializes past
 * CAMPAIGN_TAG_MAX is dropped rather than cut, so the whole query is at most three times that, however it is encoded.
 * ⚠️ Read at the tap, from this page's address: a teacher who comes back later to a bare teacher.eno.vn address hands
 * off without them, and eno.vn then records the visit it sees. It records them under the Analytics choice made THERE.
 */
export function campaignQuery(search: string): string {
  const from = new URLSearchParams(search)
  const kept: string[] = []
  for (const tag of CAMPAIGN_TAGS) {
    const value = from.get(tag)?.trim()
    if (!value) continue
    const pair = new URLSearchParams([[tag, value]]).toString()
    if (pair.length <= CAMPAIGN_TAG_MAX) kept.push(pair)
  }
  return kept.length ? `?${kept.join('&')}` : ''
}
const CAMPAIGN_TAGS = ['utm_source', 'utm_medium', 'utm_campaign'] as const
/** One `tag=value`, serialized. A real campaign name is a few dozen plain characters. */
export const CAMPAIGN_TAG_MAX = 200

/**
 * A `#d=` value read back — v2 (`{ v: 2, t }`), or a v1 fragment from before the redesign (the old TeacherInput itself,
 * mapped at the input boundary by normalizeTeacherInput → fromLegacyTeacher, plan review D2). ⛔ WHATEVER IT CARRIES,
 * only the draft steps' fields survive: a crafted link can never arrive with a consent ticked, cover on, a phone or an
 * upload (a v1 fragment carried the cover consent, gate review 2026-10-07). null for anything unreadable.
 */
export function decodeHandoff(value: string): TeacherInput | null {
  const raw = fromBase64Url(value)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const body = r.v === 2 && r.t && typeof r.t === 'object' ? r.t : r
  // ⛔ …and of those, step 1 only (handoffPart): a link — an older host tab's four steps, or a crafted one — never brings
  // a name, a headline or a bio into an account the teacher never saw them on (commit gate, codex + opus round 14).
  return handoffPart(normalizeTeacherInput(body))
}

/**
 * What a stored draft may hold: everything typed, minus ⛔ the uploads (the key is this TAB's, but a shared browser's
 * tab can be the next person's — and the server only takes a teacher's OWN recent upload, video.ts), the cover switch
 * (its periods and rate are kept) and every consent — each is asked again where it is given.
 */
export function forDraft(t: TeacherInput): TeacherInput {
  return { ...t, photoUrl: null, videoUrl: null, coverOpen: false, coverConsent: false, matchEmailOptIn: false, staffContactOptIn: false }
}

/** A draft read back — any shape the form ever wrote (v4 now, the old v3), normalised, the same things stripped again. */
export const fromDraft = (raw: unknown): TeacherInput => forDraft(normalizeTeacherInput(raw))

/**
 * ⛔ WHERE A SAVED DRAFT REOPENS — ONE RULE for the form and the dashboard's "Step X of Y" (owner, 2026-10-11; plan review,
 * opus: computed from the first failing step). Where the teacher was, never past the first step that fails — over EVERY
 * step they see on eno.vn, because a draft carries no photo, cover switch or consent (forDraft): one saved on Photo &
 * publish reopens on the first of those it lacks, and the dashboard says that step, not the one they left.
 */
export function draftResumeStep(t: TeacherInput, saved: unknown): { step: TeacherStep; index: number; total: number } {
  const steps = teacherSteps(t, { draftHost: false })
  const bad = firstStepWithError(checkSteps(t, steps), steps)
  const want = isTeacherStep(saved) && steps.includes(saved) ? saved : null
  const at = (s: TeacherStep) => steps.indexOf(s)
  const step = bad && (!want || at(bad) < at(want)) ? bad : want ?? bad ?? steps[0]
  return { step, index: at(step) + 1, total: steps.length }
}

export function isEmptyTeacher(t: TeacherInput): boolean {
  // Field by field: a normalized body lists its keys in another order than EMPTY_TEACHER (draft.ts, 2026-10-11).
  return (Object.keys(EMPTY_TEACHER) as (keyof TeacherInput)[]).every((k) => JSON.stringify(t[k]) === JSON.stringify(EMPTY_TEACHER[k]))
}
/**
 * Nothing the account would keep: these answers as a draft stores them (draftDataOf: fromDraft, no phone) are empty —
 * a choice ticked and unticked again, a phone alone. Never sent (the server refuses an empty draft with a 400 — commit
 * gate, opus round 12).
 */
export const nothingToSave = (t: TeacherInput): boolean => isEmptyTeacher({ ...fromDraft(t), phone: '' })

/** A start month as the form shows it: none, "now" (this month or earlier) or a later month (YYYY-MM). */
export function startChoice(availableFrom: string | null, now = new Date()): { kind: 'none' } | { kind: 'now' } | { kind: 'month'; month: string } {
  if (!availableFrom) return { kind: 'none' }
  const month = availableFrom.slice(0, 7)
  return month <= thisMonth(now) ? { kind: 'now' } : { kind: 'month', month }
}
/** YYYY-MM of `now`, in the reader's own calendar (the device's). */
export const thisMonth = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
/** The next `n` months after this one, YYYY-MM. */
export function nextMonths(n: number, now = new Date()): string[] {
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** A place's name for a sentence ("District 7 · District 4") — never machine-translated (PlaceName's rule). */
export const placeList = (keys: readonly string[], lang: string) => keys.map((k) => placeLabel(k, lang)).join(' · ')
