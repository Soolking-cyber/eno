/**
 * The eno.vn side of the LOCAL teacher matcher — the CONTRACT with ~/eno-lead-pipeline. Pure record shapes, the columns
 * each step reads, and the builders of every file and stdout line the pipeline parses (its src/teachers/runFiles.ts
 * fails CLOSED on any other shape), shared by scripts/teachers-match.ts, the match-email selection (match-emails.ts) and
 * their tests. The judging itself runs in ~/eno-lead-pipeline (src/cli/teachersMatch.ts), run by the owner's daily
 * /teachers skill, and never sees a teacher's name, phone, email, photo, video or CV.
 *
 * ⛔ THE JUDGE IS CLAUDE HAIKU 5.5 (claude-haiku-5-5, Anthropic) AT MEDIUM EFFORT, THROUGH THE OWNER'S OWN CLAUDE
 * SUBSCRIPTION — the logged-in `claude` CLI on the owner's Mac (owner, 2026-10-08: "also not gemini haiku 5.5 on
 * medium"; not Gemini, not agy, not an API key, no fallback model). Each judged pair carries `modelVersions`
 * { judge, effort, route, prompt } — free-form strings, stored as they arrive — and only pairs judged by
 * JUDGE_MODEL under JUDGE_PROMPT_VERSION are ever written (isHaikuV2) or emailed (match-emails.ts).
 * ⛔ ONLY TEACHERS OPTED IN UNDER THE CURRENT AI NOTICE ARE EXPORTED (profile.ts aiMatchConsented — plan review D5/E1).
 * The export DECLARES it on stdout ({"byConsent":{"current","otherVersion","none"},"consentVersion"} — the pipeline
 * refuses an export without the declaration, or with more teachers in the file than `current`), and the file carries
 * the same marker (MATCH_CONSENT_RULE).
 *
 *   eno.vn export  →  input.json   (opted-in teachers + live teaching jobs, NO name or contact data)  + the declaration
 *   pipeline judge →  output.json  (pairs: teacher × listing, score, reasons, modelVersions)
 *   eno.vn import  →  the plan (--plan-out, a dry run) · TeacherJobMatch rows + the LOCAL staff CSV (--apply)
 *
 * MATCH_IO_VERSION stays 1: the teacher/job/pair shapes are unchanged, the marker is additive and modelVersions is free-form.
 */
import type { Prisma } from '@/generated/prisma/client'
import type { MatchEmailPlan, PendingMatchRow } from '@/lib/teachers/match-emails'
import { AI_NOTICE_VERSION, CITY_PROVINCE, aiMatchConsented } from '@/lib/teachers/profile'

export const MATCH_IO_VERSION = 1
/** A pair the judge scored at or above this — and called a match — is a match (uncalibrated; v1). */
export const MATCH_MIN_SCORE = 70
/** The only judge whose verdicts eno.vn writes or emails (a model id PREFIX — the API may append a date suffix). */
export const JUDGE_MODEL = 'claude-haiku-5-5'
/** The pipeline's prompt version (~/eno-lead-pipeline src/teachers/match.ts JUDGE_PROMPT_VERSION). */
export const JUDGE_PROMPT_VERSION = 'teachers-judge-v2'

/**
 * ⛔ THE CONSENT MARKER the export writes into its file (and names in its stdout declaration): the gate (profile.ts
 * aiMatchConsented) and the AI notice it was applied under. Bump the suffix whenever the gate's meaning changes.
 */
export const MATCH_CONSENT_RULE = 'ai-match-opt-in-v1'
export type MatchConsentMarker = { rule: typeof MATCH_CONSENT_RULE; aiNotice: string }
export const consentMarker = (): MatchConsentMarker => ({ rule: MATCH_CONSENT_RULE, aiNotice: AI_NOTICE_VERSION })

export type MatchTeacher = {
  id: string // TeacherProfile.id
  updatedAt: string // the pipeline's seen-cache key (lastMatchedAt is written without bumping it)
  /** the teacher's own words, with the words of their name replaced by '[name]' (stripNameWords — best effort) */
  headline: string
  bio: string
  nationality: string
  nativeSpeaker: boolean
  /**
   * ⚠️ A hub slug (places.ts HUBS) only when the teacher lives in a hub city — '' for a teacher abroad or elsewhere in
   * Vietnam (the 2026-10-08 onboarding redesign). '' is "no city", never a city to match on: drop it before use.
   */
  currentCity: string
  cities: string[] // the city level of the teacher's teach areas (preferredCities mirror; may include 'anywhere' / 'online')
  openToOnline: boolean
  subjects: string[]
  ageGroups: string[]
  jobTypes: string[]
  yearsExperience: number
  degreeLevel: string | null
  degreeMajor: string | null
  certificates: string[] // certificate TYPES only
  expectedSalaryM: number | null
  availableFrom: string | null
}

export type MatchJob = {
  id: string // Listing.id
  title: string
  description: string
  city: string | null // workIn slug, when the province maps to one
  cityName: string | null
  salaryM: number | null
  pay: string | null
  linked: boolean // an imported posting (apply at source) vs a school's own post on eno.vn
  url: string
  postedAt: string
}

export type MatchInput = { version: number; generatedAt: string; consent: MatchConsentMarker; teachers: MatchTeacher[]; jobs: MatchJob[] }

export type MatchPair = {
  teacherProfileId?: string
  leadId?: string
  listingId: string
  score: number
  match: boolean
  reasons: string[]
  concerns: string[]
  decision: 'match' | 'reject_sample'
  /** { judge, effort, route, prompt } from the pipeline — e.g. judge 'claude-haiku-5-5', effort 'medium', route 'subscription' */
  modelVersions: Record<string, string>
  /** FB job-seeker leads only (no longer matched since 2026-10-08 — the import skips them). */
  lead?: { url: string | null; excerpt: string }
}
export type MatchOutput = { version: number; generatedAt: string; pairs: MatchPair[] }

// ── consent ───────────────────────────────────────────────────────────────────────────────────────────────────────
type ConsentFields = { matchEmailOptIn: boolean; matchEmailNoticeVersion?: string | null; staffContactOptIn: boolean; staffContactNoticeVersion?: string | null }

/** "Email me jobs that match my profile" counts only under the current AI notice (plan review D5). */
export function emailConsented(t: { matchEmailOptIn: boolean; matchEmailNoticeVersion?: string | null }): boolean {
  return t.matchEmailOptIn && t.matchEmailNoticeVersion === AI_NOTICE_VERSION
}
/** "Our staff may call me" — the same rule. (aiMatchConsented = either of the two.) */
export function staffConsented(t: { staffContactOptIn: boolean; staffContactNoticeVersion?: string | null }): boolean {
  return t.staffContactOptIn && t.staffContactNoticeVersion === AI_NOTICE_VERSION
}

/**
 * Where one live teacher stands, for the export's declaration (the pipeline's `byConsent`):
 *   current      — an opt-in under the CURRENT AI notice (aiMatchConsented): exported;
 *   otherVersion — an opt-in switched on under another notice or none (the Gemini-era tick; a newer notice not yet
 *                  re-confirmed; a checkout whose AI_NOTICE_VERSION disagrees with the deployed one): NOT exported;
 *   none         — no opt-in at all: NOT exported (and never read beyond a count).
 */
export type ConsentState = 'current' | 'otherVersion' | 'none'
export function consentStateOf(r: ConsentFields): ConsentState {
  if (aiMatchConsented(r)) return 'current'
  return r.matchEmailOptIn || r.staffContactOptIn ? 'otherVersion' : 'none'
}

// ── the job set ───────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * ⛔ A LIVE TEACHING JOB — the ONE definition of the job set (gate review, 2026-10-08 — codex): the export sends these to
 * the judge, and the import (scripts/teachers-match.ts) and the email rule (match-emails.ts mailableMatchWhere) RE-APPLY
 * it. An output pair naming any other listing — a malformed or hallucinated id, a services-only or visa product with a
 * bland title (the visa-word filter is only textual), a teacher's own "wanted" post (listingType) — is never written and
 * never emailed as a teaching job, whatever the pipeline returned. `isTeachingJob` is the same rule on a row already read.
 */
export const TEACHING_JOB_WHERE = {
  status: 'active', verified: true, listingType: 'job', category: { slug: 'jobs' }, subcategorySlug: 'teaching',
} satisfies Prisma.ListingWhereInput
export function isTeachingJob(l: { status: string; verified: boolean; listingType: string; subcategorySlug: string | null; category: { slug: string } }): boolean {
  const W = TEACHING_JOB_WHERE
  return l.status === W.status && l.verified === W.verified && l.listingType === W.listingType && l.subcategorySlug === W.subcategorySlug && l.category.slug === W.category.slug
}

// ── the columns each step reads (the `check` reads every one of them — MATCH_CHECK_SELECT) ─────────────────────────
/** export: the teacher fields the judge gets, the consent columns that decide who, and `fullName` ONLY to strip it. */
export const EXPORT_TEACHER_SELECT = {
  id: true, updatedAt: true, fullName: true, headline: true, bio: true, nationality: true, nativeSpeaker: true, currentCity: true,
  preferredCities: true, openToOnline: true, subjects: true, ageGroups: true, jobTypes: true, yearsExperience: true,
  degreeLevel: true, degreeMajor: true, certificates: true, expectedSalaryM: true, availableFrom: true,
  matchEmailOptIn: true, matchEmailNoticeVersion: true, staffContactOptIn: true, staffContactNoticeVersion: true,
} as const satisfies Prisma.TeacherProfileSelect
export const EXPORT_JOB_SELECT = {
  id: true, title: true, description: true, city: true, salaryM: true, attributes: true, affiliateUrl: true, postedAt: true,
} as const satisfies Prisma.ListingSelect
/** import: the live jobs (and their school, for the staff list) and the teachers, re-checked at write time. */
export const IMPORT_LISTING_SELECT = {
  id: true, title: true, affiliateUrl: true, city: true, attributes: true, seller: { select: { name: true, phone: true } },
  // isTeachingJob's columns: planMatchImport re-checks the job set on the rows it was given.
  status: true, verified: true, listingType: true, subcategorySlug: true, category: { select: { slug: true } },
} as const satisfies Prisma.ListingSelect
export const IMPORT_TEACHER_SELECT = {
  id: true, fullName: true, listingId: true, matchEmailOptIn: true, matchEmailNoticeVersion: true, matchEmailOptInAt: true,
  staffContactOptIn: true, staffContactNoticeVersion: true, private: { select: { phone: true, email: true } },
} as const satisfies Prisma.TeacherProfileSelect
export const EXISTING_MATCH_SELECT = {
  id: true, teacherProfileId: true, listingId: true, modelVersions: true, emailedAt: true, staffStatus: true,
} as const satisfies Prisma.TeacherJobMatchSelect
/** the email rule (match-emails.ts loadPendingMatchRows) — what the plan and the cron read about one waiting match. */
export const PENDING_MATCH_SELECT = {
  id: true, score: true, reasons: true, createdAt: true, teacherProfileId: true,
  teacherProfile: { select: { matchEmailOptInAt: true } },
  listing: { select: { id: true, title: true, city: true, affiliateUrl: true, attributes: true } },
} as const satisfies Prisma.TeacherJobMatchSelect
/** the cron's recipients: a name for the greeting, the account for the unsubscribe token, the address. */
export const EMAIL_TEACHER_SELECT = {
  id: true, fullName: true, profileId: true, private: { select: { email: true } }, profile: { select: { email: true } },
} as const satisfies Prisma.TeacherProfileSelect

/**
 * ⛔ `check` — ONE read per model of every column the export, the import, the email plan and the cron read OR FILTER ON,
 * with the LOCAL Prisma client against PRODUCTION: a column this checkout knows and prod lacks (P2022 / 42703 — the 10-08
 * import died on videoOnRequest) stops the run with exit 3 before anything is judged. match-io.test.ts holds every select
 * above (and the where-columns) to this list.
 */
export const MATCH_CHECK_SELECT = {
  teacherProfile: {
    id: true, profileId: true, listingId: true, status: true, updatedAt: true, lastMatchedAt: true, fullName: true, headline: true,
    bio: true, nationality: true, nativeSpeaker: true, currentCity: true, preferredCities: true, openToOnline: true, subjects: true,
    ageGroups: true, jobTypes: true, yearsExperience: true, degreeLevel: true, degreeMajor: true, certificates: true,
    expectedSalaryM: true, availableFrom: true,
    matchEmailOptIn: true, matchEmailOptInAt: true, matchEmailNoticeVersion: true, matchEmailWithdrawnAt: true,
    staffContactOptIn: true, staffContactOptInAt: true, staffContactNoticeVersion: true, staffContactWithdrawnAt: true,
  },
  teacherPrivate: { teacherProfileId: true, phone: true, email: true },
  teacherJobMatch: {
    id: true, teacherProfileId: true, leadId: true, listingId: true, score: true, reasons: true, concerns: true, decision: true,
    modelVersions: true, staffStatus: true, createdAt: true, emailedAt: true,
  },
  listing: {
    id: true, title: true, description: true, city: true, salaryM: true, attributes: true, affiliateUrl: true, postedAt: true,
    status: true, verified: true, listingType: true, subcategorySlug: true, categoryId: true, sellerId: true,
  },
  category: { id: true, slug: true },
  seller: { id: true, name: true, phone: true },
  profile: { id: true, email: true },
} as const satisfies {
  teacherProfile: Prisma.TeacherProfileSelect; teacherPrivate: Prisma.TeacherPrivateSelect; teacherJobMatch: Prisma.TeacherJobMatchSelect
  listing: Prisma.ListingSelect; category: Prisma.CategorySelect; seller: Prisma.SellerSelect; profile: Prisma.ProfileSelect
}

/** The schema-drift codes: Prisma's (P2022 column, P2021 table) and Postgres' (42703 column, 42P01 table). */
export const SCHEMA_DRIFT_CODES: readonly string[] = ['P2022', 'P2021', '42703', '42P01']
/** The error's code — Prisma's, the driver adapter's, or one named in the message. */
export function errorCode(e: unknown): string {
  const o = e as { code?: unknown; meta?: { code?: unknown }; cause?: { code?: unknown; originalCode?: unknown } } | null
  for (const c of [o?.code, o?.meta?.code, o?.cause?.originalCode, o?.cause?.code]) if (typeof c === 'string' && c) return c
  return /\b(P\d{4}|42703|42P01)\b/.exec(String((e as Error | null)?.message ?? e))?.[1] ?? 'unknown'
}
/** `check`'s exit for a failed read: 3 = schema drift (a DDL question — prod needs teachers-ddl.mjs), 4 = the database. */
export function checkFailure(e: unknown): { exit: 3 | 4; code: string } {
  const code = errorCode(e)
  return { exit: SCHEMA_DRIFT_CODES.includes(code) ? 3 : 4, code }
}

// ── export ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The TeacherProfile columns toMatchTeacher reads — `fullName` ONLY to take it out of the free text, never to send it. */
export type ExportTeacherRow = {
  id: string; updatedAt: Date; fullName: string; headline: string; bio: string; nationality: string; nativeSpeaker: boolean
  currentCity: string; preferredCities: string[]; openToOnline: boolean; subjects: string[]; ageGroups: string[]; jobTypes: string[]
  yearsExperience: number; degreeLevel: string | null; degreeMajor: string | null; certificates: unknown; expectedSalaryM: number | null
  availableFrom: Date | null
}
export type ExportJobRow = {
  id: string; title: string; description: string; city: string | null; salaryM: number | null; attributes: string | null
  affiliateUrl: string | null; postedAt: Date
}
/** Exactly what the judge's input holds about a teacher — the AI note and /privacy's "Anthropic (Claude)" row list these. */
export const MATCH_TEACHER_FIELDS = [
  'id', 'updatedAt', 'headline', 'bio', 'nationality', 'nativeSpeaker', 'currentCity', 'cities', 'openToOnline', 'subjects',
  'ageGroups', 'jobTypes', 'yearsExperience', 'degreeLevel', 'degreeMajor', 'certificates', 'expectedSalaryM', 'availableFrom',
] as const satisfies readonly (keyof MatchTeacher)[]

/**
 * ⛔ ONE TEACHER AS THE JUDGE SEES IT — built field by field, never by spreading the row, so a column added to the select
 * (a name, a phone, a photo) can never ride along. The name's words are taken out of the headline and the about text.
 */
export function toMatchTeacher(t: ExportTeacherRow): MatchTeacher {
  return {
    id: t.id, updatedAt: t.updatedAt.toISOString(),
    headline: stripNameWords(t.headline, t.fullName), bio: stripNameWords(t.bio, t.fullName),
    nationality: t.nationality, nativeSpeaker: t.nativeSpeaker, currentCity: t.currentCity, cities: t.preferredCities,
    openToOnline: t.openToOnline, subjects: t.subjects, ageGroups: t.ageGroups, jobTypes: t.jobTypes,
    yearsExperience: t.yearsExperience, degreeLevel: t.degreeLevel, degreeMajor: t.degreeMajor,
    certificates: (Array.isArray(t.certificates) ? t.certificates : []).map((c) => String((c as { type?: unknown })?.type ?? '')).filter(Boolean),
    expectedSalaryM: t.expectedSalaryM, availableFrom: t.availableFrom?.toISOString().slice(0, 10) ?? null,
  }
}

/** The pay a posting states, unless it is unreadable. */
export function salaryTextOf(attributes: string | null): string | null {
  try { const a = JSON.parse(attributes ?? '{}') as Record<string, unknown>; return typeof a.salaryText === 'string' ? a.salaryText : null } catch { return null }
}

/** One live teaching job as the judge sees it — public listing fields only. */
export function toMatchJob(j: ExportJobRow, origin: string): MatchJob {
  return {
    id: j.id, title: j.title, description: j.description.slice(0, 3000), city: provinceToCitySlug(j.city), cityName: j.city,
    salaryM: j.salaryM, pay: salaryTextOf(j.attributes), linked: !!j.affiliateUrl,
    url: `${origin}/listings/${j.id}`, postedAt: j.postedAt.toISOString(),
  }
}

/**
 * ⛔ THE EXPORT'S STDOUT DECLARATION — the line the pipeline's consent check requires (runFiles.ts checkConsent): it
 * refuses (exit 3, nothing judged) without `byConsent` {current, otherVersion, none}, or when the file holds more
 * teachers than `current`. Every live teacher (a live profile with a live, verified listing) is counted exactly once.
 */
export type ExportDeclaration = {
  export: { teachers: number; jobs: number }
  byConsent: Record<ConsentState, number>
  consentVersion: string
  consentRule: typeof MATCH_CONSENT_RULE
}
export function buildMatchExport(o: {
  /** live teachers with an opt-in switched on, under any notice */
  opted: (ExportTeacherRow & ConsentFields)[]
  /** live teachers with neither opt-in on — only counted */
  notOptedIn: number
  jobs: ExportJobRow[]
  origin: string
  generatedAt: Date
}): { input: MatchInput; declaration: ExportDeclaration } {
  const byConsent: Record<ConsentState, number> = { current: 0, otherVersion: 0, none: o.notOptedIn }
  const current: ExportTeacherRow[] = []
  for (const t of o.opted) {
    const state = consentStateOf(t)
    byConsent[state]++
    // ⛔ THE GATE — only `current` reaches the file.
    if (state === 'current') current.push(t)
  }
  const input: MatchInput = {
    version: MATCH_IO_VERSION, generatedAt: o.generatedAt.toISOString(), consent: consentMarker(),
    teachers: current.map((t) => toMatchTeacher(t)), jobs: o.jobs.map((j) => toMatchJob(j, o.origin)),
  }
  return {
    input,
    declaration: { export: { teachers: input.teachers.length, jobs: input.jobs.length }, byConsent, consentVersion: AI_NOTICE_VERSION, consentRule: MATCH_CONSENT_RULE },
  }
}

// ── import ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Validate the pipeline's output before anything is written. Throws on a shape it does not know. */
export function parseMatchOutput(raw: unknown): MatchOutput {
  const o = raw as MatchOutput
  if (!o || o.version !== MATCH_IO_VERSION || !Array.isArray(o.pairs)) throw new Error('teachers-match: unknown output shape')
  for (const p of o.pairs) {
    if (!!p.teacherProfileId === !!p.leadId) throw new Error('teachers-match: a pair must name exactly one of teacher / lead')
    if (typeof p.listingId !== 'string' || !Number.isFinite(p.score)) throw new Error('teachers-match: bad pair')
    if (p.decision !== 'match' && p.decision !== 'reject_sample') throw new Error('teachers-match: bad decision')
    if (p.decision === 'match' && (!p.match || p.score < MATCH_MIN_SCORE)) throw new Error('teachers-match: a "match" below the bar')
  }
  return o
}

/**
 * ⛔ Judged by Claude Haiku 5.5 under the v2 prompt — the only verdicts eno.vn writes (the import refuses an output with
 * any other pair: exit 3) and emails (match-emails.ts). An old-wrapper output (Gemini via agy, or the Opus fallback) fails.
 */
export function isHaikuV2(p: { modelVersions?: unknown }): boolean {
  const mv = p.modelVersions
  if (!mv || typeof mv !== 'object') return false
  const { judge, prompt } = mv as Record<string, unknown>
  return typeof judge === 'string' && judge.startsWith(JUDGE_MODEL) && prompt === JUDGE_PROMPT_VERSION
}

export type ImportListingRow = {
  id: string; title: string; affiliateUrl: string | null; city: string; attributes: string | null; seller: { name: string; phone: string | null }
  status: string; verified: boolean; listingType: string; subcategorySlug: string | null; category: { slug: string }
}
export type ImportTeacherRow = ConsentFields & {
  id: string; fullName: string; listingId: string | null; matchEmailOptInAt: Date | null; private: { phone: string | null; email: string | null } | null
}
export type ExistingMatchRow = { id: string; teacherProfileId: string | null; listingId: string; modelVersions: unknown; emailedAt: Date | null; staffStatus: string | null }
type TeacherPair = MatchPair & { teacherProfileId: string }

/**
 * THE IMPORT, PLANNED — the same for the dry run (--plan-out) and the apply, so what the owner approved is what lands.
 *   · `foreign` > 0 → the caller refuses the whole output (exit 3): a pair not judged by Claude Haiku 5.5 v2.
 *   · lead pairs (FB job seekers) are counted, never written; a repeated pair counts once.
 *   · ⛔ consent and liveness RE-CHECKED: a teacher who switched both opt-ins off (or hid the profile) since the export,
 *     or a job that went away, is skipped — nothing judged about them is written. ⛔ So is a listing that is not a live
 *     teaching job (isTeachingJob — the export's own job set, re-applied on the rows given: gate review, 2026-10-08).
 *   · a pair is judged ONCE by this judge: a v2 verdict, a staff status or an emailedAt is never rewritten. An OLDER
 *     verdict on the same pair (Gemini/agy or Opus era — never mailable) that nothing used is REPLACED (`supersede`).
 *   · staff rows: new matches of teachers who allowed staff calls under the current notice — an email-only teacher gets
 *     the email, not a call; `newEmailRows`: this run's new matches as the email rule sees them (email consent only).
 */
export function planMatchImport(o: {
  output: MatchOutput; listings: ImportListingRow[]; teachers: ImportTeacherRow[]; existing: ExistingMatchRow[]; now: Date; origin: string
}) {
  const foreign = o.output.pairs.filter((p) => !isHaikuV2(p)).length
  const skippedLeads = o.output.pairs.filter((p) => !p.teacherProfileId).length
  const seenPair = new Set<string>()
  const pairs = o.output.pairs.filter((p): p is TeacherPair => {
    if (!p.teacherProfileId) return false
    const k = `${p.teacherProfileId}|${p.listingId}`
    if (seenPair.has(k)) return false
    seenPair.add(k)
    return true
  })
  const L = new Map(o.listings.filter((l) => isTeachingJob(l)).map((l) => [l.id, l]))
  const T = new Map(o.teachers.filter((t) => aiMatchConsented(t)).map((t) => [t.id, t]))
  const usable = pairs.filter((p) => L.has(p.listingId) && T.has(p.teacherProfileId))
  const known = new Map(o.existing.map((e) => [`${e.teacherProfileId}|${e.listingId}`, e]))
  const supersede: string[] = []
  const fresh = usable.filter((p) => {
    const e = known.get(`${p.teacherProfileId}|${p.listingId}`)
    if (!e) return true
    if (isHaikuV2(e) || e.emailedAt || e.staffStatus) return false
    supersede.push(e.id)
    return true
  })
  const freshMatches = fresh.filter((p) => p.decision === 'match')
  const teacherOf = (p: TeacherPair) => T.get(p.teacherProfileId)!
  const listingOf = (p: TeacherPair) => L.get(p.listingId)!
  const staffRows = freshMatches.filter((p) => staffConsented(teacherOf(p)))
  const newEmailRows: PendingMatchRow[] = freshMatches.flatMap((p, i) => {
    const t = teacherOf(p)
    const l = listingOf(p)
    if (!emailConsented(t)) return []
    return [{
      id: `new:${i}`, score: Math.round(p.score), reasons: p.reasons, createdAt: o.now, teacherProfileId: t.id,
      teacherProfile: { matchEmailOptInAt: t.matchEmailOptInAt },
      listing: { id: l.id, title: l.title, city: l.city, affiliateUrl: l.affiliateUrl, attributes: l.attributes },
    }]
  })
  // ⛔ No names, profile links, phones, emails, FB excerpts or AI reasons — a letter per teacher, public job facts.
  const letters = new Map<string, string>()
  const sample = [...freshMatches].sort((a, b) => b.score - a.score).slice(0, 5).map((p) => {
    const t = teacherOf(p)
    const l = listingOf(p)
    if (!letters.has(t.id)) letters.set(t.id, String.fromCharCode(65 + letters.size))
    return {
      teacher: letters.get(t.id)!, consent: [emailConsented(t) && 'email', staffConsented(t) && 'staff call'].filter(Boolean).join(' + '),
      score: Math.round(p.score), job: l.title, province: l.city, pay: salaryTextOf(l.attributes), jobUrl: `${o.origin}/listings/${l.id}`,
      linked: !!l.affiliateUrl,
    }
  })
  return {
    foreign,
    summary: {
      pairs: o.output.pairs.length, stillLive: usable.length, new: fresh.length, newMatches: freshMatches.length,
      rejectSamples: fresh.length - freshMatches.length, superseded: supersede.length, skippedLeads,
    },
    /** new matches by the teacher's consent: email (they will get it), or a staff call only */
    byConsent: {
      email: freshMatches.filter((p) => emailConsented(teacherOf(p))).length,
      staffCallOnly: freshMatches.filter((p) => !emailConsented(teacherOf(p)) && staffConsented(teacherOf(p))).length,
    },
    fresh, supersede, staffRows, newEmailRows, sample, teacherOf, listingOf,
  }
}
export type MatchImportPlan = ReturnType<typeof planMatchImport>

/**
 * ⛔ THE DRY RUN'S FILE (`import --plan-out`) — what the pipeline's plan.json embeds and its guards read: `import.new`,
 * `email.teachers` (the send guard's ceiling), `email.rules`, `csvRows`, `purge`, `sample`. Counts and public job facts only.
 */
export function importPlanDoc(p: MatchImportPlan, email: MatchEmailPlan, purge: PurgeCounts) {
  return { import: p.summary, byConsent: p.byConsent, csvRows: p.staffRows.length, email: { rules: email.rules, ...email.counts }, purge, sample: p.sample }
}

/** Days the import keeps its personal-data by-products: the lead rows, the reject samples and the local staff lists. */
export const MATCH_RETENTION_DAYS = 90

/**
 * ⛔ WHAT THE IMPORT DELETES (VN PDP Law 91/2025 — keep only what the purpose needs; /privacy "How long we keep your
 * data": deleted when the purpose is fulfilled). The dry run counts each (the plan's `purge`), --apply deletes them:
 *   · leadRows      — the AI's verdicts about FB users who never signed up, after MATCH_RETENTION_DAYS;
 *   · rejectSamples — the below-the-bar samples, after the same period (the staff lists' own);
 *   · withdrawn     — ⛔ EVERY row, at any age, of a teacher whose two opt-ins are both OFF (gate review, 2026-10-08 —
 *     Opus): the purpose ended when they switched off (or never began: rows the pre-consent matcher wrote), so the
 *     scores, reasons, concerns and staff statuses about them go. Keyed on the two SWITCHES, never on the notice version:
 *     a checkout whose AI_NOTICE_VERSION runs ahead of the deployed one must not read every consenting teacher as
 *     withdrawn. The consent evidence (…At / …NoticeVersion / …WithdrawnAt) is on TeacherProfile and stays.
 *     ⚠️ EXCEPT a row EMAILED inside the cooldown (`cooldownMs` = MATCH_EMAIL_RULES.cooldownMs, passed in — match-emails
 *     imports this file): loadCooling reads those rows, so deleting them reset the cooldown, and a teacher who
 *     unsubscribed and switched emails back on within it was mailed again early (commit gate, 2026-10-09 — Opus). It
 *     goes on the first run after the window: at most `cooldownMs` of one emailed row is kept.
 */
export function retentionWheres(now: Date, cooldownMs: number) {
  const cutoff = new Date(now.getTime() - MATCH_RETENTION_DAYS * 86_400_000)
  return {
    leadRows: { createdAt: { lt: cutoff }, leadId: { not: null } },
    rejectSamples: { createdAt: { lt: cutoff }, leadId: null, decision: 'reject_sample' },
    withdrawn: {
      teacherProfileId: { not: null }, teacherProfile: { matchEmailOptIn: false, staffContactOptIn: false },
      OR: [{ emailedAt: null }, { emailedAt: { lt: new Date(now.getTime() - cooldownMs) } }],
    },
  } satisfies Record<string, Prisma.TeacherJobMatchWhereInput>
}
export type PurgeCounts = Record<keyof ReturnType<typeof retentionWheres>, number>

/** The staff lists the retention sweep may delete: the applied ones AND an unconfirmed `.pending` one (withStaffList). */
export const STAFF_LIST_FILE = /^teacher-matches-.*\.csv(?:\.pending)?$/
const PENDING_SUFFIX = '.pending'

/**
 * ⛔ THE STAFF LIST AROUND THE DATABASE WRITE (gate review, 2026-10-08 — codex). Two failures to avoid at once:
 *   · the list written AFTER the rows: a crash between them loses that day's list for good — a re-run sees every pair as
 *     known (Opus, commit gate 09-30). So it is written FIRST…
 *   · …but as `<file>.pending`, renamed to `<file>` only once the transaction COMMITTED: a failed write never leaves a
 *     list that looks applied — staff calls and phone numbers for matches that never landed.
 * A `.pending` left behind is an apply that did not confirm (re-run the apply; the same --run-id overwrites it); the
 * retention sweep deletes it with the rest (STAFF_LIST_FILE). The caller passes the file system (scripts/teachers-match.ts).
 */
export async function withStaffList<T>(
  list: { file: string; body: string | null } | null,
  fs: { write: (file: string, body: string) => void; rename: (from: string, to: string) => void; exists: (file: string) => boolean },
  commit: () => Promise<T>,
): Promise<T> {
  if (!list) return commit()
  const pending = `${list.file}${PENDING_SUFFIX}`
  if (list.body === null) {
    // ⛔ NOTHING NEW TO LIST, BUT THIS RUN'S `.pending` IS THERE (commit gate, 2026-10-09 — codex): the apply before this
    // one wrote it, COMMITTED, and died before its rename — that is why its rows are "known" now and this one has none (a
    // commit that failed leaves them unknown, and this run would list them again). Promote it once this commit lands:
    // skipping it — "no rows, no file" — lost that day's staff list for good.
    const done = await commit()
    if (fs.exists(pending)) fs.rename(pending, list.file)
    return done
  }
  fs.write(pending, list.body)
  const done = await commit()
  fs.rename(pending, list.file)
  return done
}

/** The staff list's line — the pipeline's parseApplyOutput reads it (/^staff list: (\d+) rows? → (.+)$/) and the JSON's `csv`. */
export function staffListLine(csv: { file: string; rows: number } | null): string {
  return csv ? `staff list: ${csv.rows} rows → ${csv.file}` : 'staff list: none (no new staff-call matches)'
}

/**
 * `import --apply`'s stdout: the human lines the old callers logged (`import: …`, `staff list: …`) and ONE JSON line —
 * { applied, import, byConsent, csv: {file, rows} | null, purge: {leadRows, rejectSamples, withdrawn, csvFiles} } — that the
 * pipeline's parseApplyOutput turns into apply.json (it keeps `purge` as it is: an added count changes nothing there).
 */
export function applyOutputLines(o: {
  summary: MatchImportPlan['summary']; byConsent: MatchImportPlan['byConsent']; csv: { file: string; rows: number } | null
  purge: PurgeCounts & { csvFiles: number }
}): string[] {
  const s = o.summary
  return [
    `import: ${s.pairs} pairs, ${s.stillLive} still live and consented, ${s.new} new (${s.newMatches} matches)`,
    staffListLine(o.csv),
    JSON.stringify({ applied: true, import: s, byConsent: o.byConsent, csv: o.csv, purge: o.purge }),
  ]
}

// ── shared ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Listing.city (a vn-units province name) → the teacher `workIn` slug, where one maps back. */
export function provinceToCitySlug(province: string | null | undefined): string | null {
  if (!province) return null
  // CITY_PROVINCE is many-to-one (Bình Dương, Vũng Tàu → Hồ Chí Minh); the canonical slug wins.
  const canonical: Record<string, string> = { 'Hồ Chí Minh': 'ho-chi-minh-city', 'An Giang': 'phu-quoc' }
  if (canonical[province]) return canonical[province]
  const hit = Object.entries(CITY_PROVINCE).find(([, p]) => p === province)
  return hit ? hit[0] : null
}

/** Lower case, no accents, đ → d — for comparing words the way a reader would (Nguyễn = nguyen = NGUYEN). */
const foldWord = (w: string) => w.normalize('NFD').replace(/\p{M}+/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
const WORD = /[\p{L}\p{M}]+/gu

/**
 * The teacher's own name taken out of their free text before it leaves eno.vn: every WHOLE word of `fullName` with two or
 * more letters, case- and accent-insensitively, becomes '[name]' (a run of them, one '[name]'). ⚠️ BEST EFFORT — a
 * nickname or another spelling survives; the notices promise only that the NAME FIELD is never sent (plan, 2026-10-08).
 */
export function stripNameWords(text: string, fullName: string | null | undefined): string {
  if (!text || !fullName) return text
  const words = new Set((fullName.normalize('NFC').match(WORD) ?? []).map(foldWord).filter((w) => [...w].length >= 2))
  if (!words.size) return text
  return text
    .normalize('NFC')
    .replace(WORD, (w) => (words.has(foldWord(w)) ? '[name]' : w))
    .replace(/\[name\](?:[ \t]+\[name\])+/g, '[name]')
}

/** One CSV cell, quoted, with formula-injection neutralised (a leading = + - @ opens a formula in Sheets/Excel). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}
