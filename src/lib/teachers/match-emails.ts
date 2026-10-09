/**
 * WHICH MATCHES GO OUT IN THE TEACHER JOB-MATCH EMAILS — the ONE rule, shared by the cron that sends them
 * (src/app/api/cron/teacher-match-emails/route.ts) and by the plan the owner approves before any send
 * (scripts/teachers-match.ts `email-plan` and `import --plan-out`, run by the /teachers skill). The plan and the send
 * read the same rows through the same function, so "N teachers, M jobs" in the plan is what the send selects.
 *
 * The rule:
 *   · Recipients: teachers with "Email me jobs that match my profile" ON UNDER THE CURRENT AI NOTICE
 *     (matchEmailNoticeVersion = AI_NOTICE_VERSION — plan review D5/E2), a live profile and a live, verified listing.
 *   · Content: `match` rows at most RULES.freshMs old (a job's own lifetime), never emailed, on a live TEACHING job (the
 *     export's own job set, match-io.ts TEACHING_JOB_WHERE), judged by Claude Haiku 5.5 under the v2 prompt (match-io.ts
 *     JUDGE_PROMPT_VERSION) AFTER the teacher's current email consent (createdAt ≥ matchEmailOptInAt) — so nothing judged
 *     under the Gemini-era note, or before a re-grant, is ever mailed.
 *   · ⛔ ONE CONDITION, READ TWICE (gate review, 2026-10-08 — codex + Opus): the selection reads mailableMatchWhere, and
 *     the cron's CLAIM re-applies the same where atomically, plus the consent grant the plan saw — so a job or a profile
 *     pulled mid-run, or a consent withdrawn and re-granted, between the read and the claim is never mailed.
 *   · ONE EMAIL PER TEACHER PER RULES.cooldownMs, AT MOST RULES.perEmail JOBS (best score first) — a match email every
 *     morning is spam however good the matches. ⛔ Teachers in cooldown are left out IN THE QUERY (loadPendingMatchRows),
 *     before the RULES.maxRows read cap — and again before the RULES.maxTeachers slice — so their unmailed rows can never
 *     fill the read and crowd everyone else out of a run (gate review, 2026-10-08 — codex: the move out of route.ts had
 *     lost the query's `notIn`).
 *   · ⛔ No visa wording, ever (the licensed edition carries none): a visa-worded job is dropped BEFORE the per-email cap,
 *     or it would crowd out clean matches forever; the reasons shown are filtered too.
 *
 * Pure except loadCooling / loadPendingMatchRows, which take the Prisma client as an argument: a tsx script (its own
 * client against the tunnel) and the app (src/lib/db) both call them. No 'server-only', no '@/lib/db'.
 */
import type { Prisma, PrismaClient } from '@/generated/prisma/client'
import { fold } from '@/lib/fold'
import { hasVisaWord } from '@/lib/job-listing'
import { AI_NOTICE_VERSION } from '@/lib/teachers/profile'
import { JUDGE_PROMPT_VERSION, PENDING_MATCH_SELECT, TEACHING_JOB_WHERE, emailConsented } from '@/lib/teachers/match-io'

export { emailConsented }

export const MATCH_EMAIL_RULES = {
  /** Reported by the plan and by the send, so a send under another rule than the one approved shows. */
  version: 'teacher-match-emails/v2',
  maxTeachers: 300,
  perEmail: 5,
  cooldownMs: 3 * 86_400_000,
  freshMs: 14 * 86_400_000,
  /** A safety cap on the rows read per run; reaching it is reported (`truncated`), never silent. */
  maxRows: 5000,
} as const

/**
 * hasVisaWord (src/lib/job-listing.ts — the folded, punctuation-stripped SUBSTRING test: '#VisaSponsorship', 'e-visa',
 * 'thị thực', 비자…) plus the words a visa-sponsorship job hides behind: work permit, giấy phép lao động, thẻ tạm trú —
 * on the same folded string, so 'workpermit', 'Work-Permit' and 'giay phep lao dong' are caught too.
 */
export function isVisaWorded(text: string | null | undefined): boolean {
  if (!text) return false
  return hasVisaWord(text) || /workpermit|giaypheplaodong|thetamtru/.test(fold(text).replace(/[^a-z0-9]+/g, ''))
}

/** The columns the plan and the email need from one pending match. */
export type PendingMatchRow = {
  id: string
  score: number
  reasons: unknown
  createdAt: Date
  teacherProfileId: string | null
  teacherProfile: { matchEmailOptInAt: Date | null } | null
  listing: { id: string; title: string; city: string | null; affiliateUrl: string | null; attributes: string | null }
}

type MatchDb = Pick<PrismaClient, 'teacherJobMatch'>

/** Teachers emailed within the cooldown (an unclear send keeps its claim, so it counts as emailed here too). */
export async function loadCooling(db: MatchDb, now: number): Promise<Set<string>> {
  const rows = await db.teacherJobMatch.findMany({
    where: { emailedAt: { gt: new Date(now - MATCH_EMAIL_RULES.cooldownMs) }, teacherProfileId: { not: null } },
    select: { teacherProfileId: true },
    distinct: ['teacherProfileId'],
  })
  return new Set(rows.flatMap((r) => (r.teacherProfileId ? [r.teacherProfileId] : [])))
}

/** A teacher the match emails may go to — the selection, the cron's recipient re-read and its claim read this ONE where. */
export const MAILABLE_TEACHER_WHERE = {
  matchEmailOptIn: true, matchEmailNoticeVersion: AI_NOTICE_VERSION, status: 'live',
  // The teacher's own listing must still be live too — a profile moderation pulled is not mailed.
  listing: { status: 'active', verified: true },
} satisfies Prisma.TeacherProfileWhereInput

/**
 * ⛔ A MATCH THE RULE MAY MAIL, as of `now` (the run's start) — loadPendingMatchRows reads it, and the cron's claim
 * re-applies it in the same UPDATE that sets emailedAt, with `teacher` narrowed to the consent grant the plan saw
 * ({ ...MAILABLE_TEACHER_WHERE, matchEmailOptInAt }). (createdAt ≥ matchEmailOptInAt compares two columns, which a where
 * cannot: planMatchEmails applies it, and the claim's equal grant keeps it true.)
 */
export function mailableMatchWhere(now: number, teacher: Prisma.TeacherProfileWhereInput = MAILABLE_TEACHER_WHERE) {
  return {
    decision: 'match', emailedAt: null, createdAt: { gt: new Date(now - MATCH_EMAIL_RULES.freshMs) },
    // ⛔ Judged by the v2 prompt (Claude Haiku 5.5) — never a Gemini/agy or Opus-fallback verdict.
    modelVersions: { path: ['prompt'], equals: JUDGE_PROMPT_VERSION },
    teacherProfile: teacher,
    // ⛔ A live TEACHING job — the export's job set (match-io.ts), never just any live listing.
    listing: TEACHING_JOB_WHERE,
  } satisfies Prisma.TeacherJobMatchWhereInput
}

/**
 * Every match the rule may mail, best score first, EXCEPT the teachers in `cooling` (loadCooling) — left out here, in the
 * query, before the RULES.maxRows cap: their unmailed rows would otherwise fill the read and starve every other teacher
 * until those rows expired. The per-email and per-run caps are planMatchEmails'.
 */
export async function loadPendingMatchRows(db: MatchDb, now: number, cooling: ReadonlySet<string>): Promise<PendingMatchRow[]> {
  return db.teacherJobMatch.findMany({
    where: { ...mailableMatchWhere(now), ...(cooling.size ? { teacherProfileId: { notIn: [...cooling] } } : {}) },
    select: PENDING_MATCH_SELECT,
    // A stable order: the same rows give the same plan, and the same five jobs, every time.
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: MATCH_EMAIL_RULES.maxRows,
  })
}

export type MatchEmailPlan = {
  rules: string
  /** In send order (each teacher's best match first), at most RULES.maxTeachers, each with 1..RULES.perEmail matches. */
  teachers: { teacherProfileId: string; matches: PendingMatchRow[] }[]
  counts: {
    teachers: number
    jobs: number
    /** teachers emailed within the cooldown — none of them is mailed this run (their rows are not even read) */
    cooling: number
    /** matches dropped for visa wording */
    visaDropped: number
    /** matches judged before the teacher's current email consent (or with no consent time) — never mailed */
    beforeConsent: number
    /** teachers left for a later run by the maxTeachers cap */
    overCap: number
    /** the row cap was reached: lower-scored rows wait for a later run */
    truncated: boolean
  }
}

/**
 * The pure rule over rows already filtered for consent, liveness and judge (loadPendingMatchRows — or the import's new
 * ones, which the query never saw: so the cooldown is applied here too).
 */
export function planMatchEmails(rows: readonly PendingMatchRow[], cooling: ReadonlySet<string>): MatchEmailPlan {
  const R = MATCH_EMAIL_RULES
  const ordered = [...rows].sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const byTeacher = new Map<string, PendingMatchRow[]>()
  let visaDropped = 0
  let beforeConsent = 0
  for (const m of ordered) {
    const t = m.teacherProfileId
    if (!t) continue // a lead's row (FB job seekers are not matched since 2026-10-08) — never an email
    // The cooldown first: a cooling teacher's rows never reach the caps below.
    if (cooling.has(t)) continue
    const consentAt = m.teacherProfile?.matchEmailOptInAt ?? null
    if (!consentAt || m.createdAt.getTime() < consentAt.getTime()) { beforeConsent++; continue }
    // Visa-worded jobs go BEFORE the per-email cap, or they would crowd out clean matches forever.
    if (isVisaWorded(`${m.listing.title} ${m.listing.attributes ?? ''}`)) { visaDropped++; continue }
    const list = byTeacher.get(t) ?? []
    if (list.length < R.perEmail) list.push(m)
    byTeacher.set(t, list)
  }
  const all = [...byTeacher].map(([teacherProfileId, matches]) => ({ teacherProfileId, matches }))
  const teachers = all.slice(0, R.maxTeachers)
  return {
    rules: R.version,
    teachers,
    counts: {
      teachers: teachers.length,
      jobs: teachers.reduce((n, t) => n + t.matches.length, 0),
      cooling: cooling.size,
      visaDropped,
      beforeConsent,
      overCap: all.length - teachers.length,
      truncated: rows.length >= R.maxRows,
    },
  }
}

/** One job as the email shows it (src/lib/emails/teacher-matches.ts TeacherMatchJob). */
export function matchEmailJob(m: PendingMatchRow, origin: string) {
  const attrs = (() => { try { return JSON.parse(m.listing.attributes ?? '{}') as Record<string, unknown> } catch { return {} } })()
  return {
    title: m.listing.title,
    city: m.listing.city,
    pay: typeof attrs.salaryText === 'string' && !isVisaWorded(attrs.salaryText) ? attrs.salaryText : null,
    url: `${origin}/listings/${m.listing.id}`,
    applyAtSource: !!m.listing.affiliateUrl,
    // ⛔ Filtered HERE, not trusted from the judge: the licensed edition emails no visa wording.
    reasons: (Array.isArray(m.reasons) ? m.reasons : []).map(String).filter((r) => r.trim() && !isVisaWorded(r)).slice(0, 2),
  }
}

/** `email-plan`'s line (scripts/teachers-match.ts): the pipeline's send guard reads `teachers` and `rules` from it. */
export function emailPlanLine(plan: MatchEmailPlan) {
  return { rules: plan.rules, ...plan.counts }
}

/** eno-cron.sh prints only this many bytes of the body; the /teachers send parses that line — a cut body is a failed send. */
export const MATCH_EMAIL_BODY_LIMIT = 200

/**
 * The cron's answer: { ok, rules, teachers, sent, failed, unknown, skipped } (+ `stopped`, `left` when the run ended
 * early). ⛔ ALWAYS UNDER MATCH_EMAIL_BODY_LIMIT BYTES: every count is ≤ maxTeachers (3 digits) and `stopped` is clipped,
 * so the worst case fits (match-emails.test.ts).
 */
export function matchEmailResult(o: { teachers: number; sent: number; failed: number; unknown: number; skipped: number; stopped: string | null; left: number }) {
  const stopped = o.stopped ? o.stopped.replace(/[^a-z0-9_]/gi, '').slice(0, 32) || 'stopped' : null
  return {
    ok: o.failed === 0 && o.unknown === 0 && !stopped, rules: MATCH_EMAIL_RULES.version,
    teachers: o.teachers, sent: o.sent, failed: o.failed, unknown: o.unknown, skipped: o.skipped,
    ...(stopped ? { stopped, left: o.left } : {}),
  }
}
