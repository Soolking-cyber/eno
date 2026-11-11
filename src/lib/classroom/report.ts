import 'server-only'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api/handler'
import { containsContactInfo } from '@/lib/publish-guard'
import { containsPhoneNumber } from '@/lib/phone'
import { ictWeekStart, streakWindowStart, weeksInARow } from './limits'

export type Viewer = 'learner' | 'teacher' | 'tester'

/** A learner's line as the TEACHER sees it: whole, unless it carries a number or a handle — then masked. */
export function maskContact(text: string | null): string | null {
  if (!text || !(containsPhoneNumber(text) || containsContactInfo(text))) return text
  return '[contact details hidden]'
}

/**
 * Who is reading this session, by account — the learner's account holder, the seat's teacher, or the teacher who ran a
 * test — or a 404. ⛔ Never by session id alone: every read goes through the caller's own relation to the row.
 * ⛔ A teacher reads a seat's sessions only while the seat is active or paused: a learner who leaves (or withdraws, or is
 * removed) takes the teacher's access with them AT ONCE (plan "Erasure"). The rows stay LIMITS.removedRetentionDays for the
 * learner's own history, then the sweep erases them.
 */
export async function sessionForViewer(sessionId: string, accountId: string) {
  const s = await db.classroomSession.findUnique({
    where: { id: sessionId },
    include: {
      feedback: true,
      // The answered turns — and a FLAGGED turn kept although its reply could not be written (2a round 8, codex: the teacher
      // must be able to read what the alert was about). The family's side drops every flagged turn below either way.
      turns: { where: { OR: [{ status: 'ok' }, { status: 'failed', flag: { not: null } }] }, orderBy: { seq: 'asc' }, select: { seq: true, learnerText: true, replyText: true, supportText: true, heardAs: true, flag: true, learnerMs: true } },
      enrollment: { select: { id: true, seatName: true, status: true, avatarId: true, learnerId: true, sessionsPerWeek: true } },
      learner: { select: { ownerId: true, displayName: true, withdrawnAt: true } },
      avatar: { select: { name: true, teacherProfile: { select: { profileId: true, fullName: true, photoUrl: true } } } },
    },
  })
  if (!s) throw new ApiError('session_not_found', 404)
  // ⛔ THE SESSION'S OWN LEARNER decides the family, never the seat's current one; and the teacher reads it only while that
  // same learner still holds the seat (round 3, codex: the database alone does not tie a session to its seat's learner).
  const seat = s.enrollment
  const viewer: Viewer | null = s.testerId === accountId ? 'tester'
    : s.learner?.ownerId === accountId ? 'learner'
      : s.avatar.teacherProfile.profileId === accountId && seat && (seat.status === 'active' || seat.status === 'paused')
        && seat.learnerId === s.learnerId && seat.avatarId === s.avatarId && !s.learner?.withdrawnAt ? 'teacher'
        : null
  if (!viewer) throw new ApiError('session_not_found', 404)
  return { s, viewer }
}

/** The report as a viewer sees it. ⛔ The teacher's private note and the safety flag never reach the learner's side. */
export function reportFor(s: Awaited<ReturnType<typeof sessionForViewer>>['s'], viewer: Viewer) {
  const f = s.feedback
  const teacherSide = viewer !== 'learner'
  // ⛔ NOTHING ON THE FAMILY'S SIDE GIVES A FLAGGED EXCHANGE AWAY (2a round 2, opus): no gap in the turn numbers, a talk
  // time that leaves it out, no turn numbers on the mistakes.
  const shown = s.turns.filter((t) => teacherSide || !t.flag)
  const mistakes = (f && !teacherSide && Array.isArray(f.mistakes))
    ? (f.mistakes as Record<string, unknown>[]).map(({ turn: _turn, ...m }) => m)
    : f?.mistakes
  return {
    id: s.id,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    status: s.status,
    feedbackStatus: s.feedbackStatus,
    talkSeconds: Math.round((teacherSide ? s.learnerSpeechMs : shown.reduce((n, t) => n + t.learnerMs, 0)) / 1000),
    teacher: { name: s.avatar.teacherProfile.fullName, photoUrl: s.avatar.teacherProfile.photoUrl, avatarName: s.avatar.name },
    learner: s.enrollment ? { name: s.learner?.displayName ?? s.enrollment.seatName, seatId: s.enrollment.id } : null,
    feedback: f && s.feedbackStatus === 'ready' ? {
      summary: f.summary, summaryVi: f.summaryVi, wins: f.wins, mistakes, pronunciation: f.pronunciation,
      vocabulary: f.vocabulary, scores: f.scores,
      ...(teacherSide ? { teacherNote: f.teacherNote, safetyFlag: f.safetyFlag } : {}),
    } : null,
    // ⛔ A FLAGGED EXCHANGE IS NEVER SHOWN ON THE ACCOUNT HOLDER'S SIDE (core review, opus): if a child spoke of harm at
    // home, the account holder may be who they spoke of. The teacher (and eno admin) see it; the parent's transcript
    // leaves that exchange out.
    // ⛔ A CHILD'S NUMBER OR HANDLE NEVER REACHES THE TEACHER (2a round 11, opus): a line the learner said that carries one
    // is shown to the teacher masked — the classroom is no way round the marketplace's contact rules. The family sees
    // their own words as said.
    // ⛔ THE TUTOR'S VIETNAMESE HELP IS SHOWN TOO (commit review round 2, opus): the adults who read the exchange read all the
    // AI said, in either language.
    // The tutor's lines passed the contact gate when they were said (tutor-ai.ts); masked on the teacher's side all the same,
    // like the learner's — one rule for every line the teacher reads (commit review, codex + opus).
    transcript: shown.map((t, i) => ({
      seq: teacherSide ? t.seq : i + 1,
      learner: teacherSide ? maskContact(t.learnerText) : t.learnerText,
      avatar: (teacherSide ? maskContact(t.replyText) : t.replyText) ?? '',
      ...(t.supportText ? { avatarVi: (teacherSide ? maskContact(t.supportText) : t.supportText) ?? '' } : {}),
      ...(teacherSide && t.flag ? { flag: t.flag } : {}),
    })),
    // "We heard … — did you mean …?" — the tutor's guesses at sound-alike mishearings, shown as QUESTIONS, never scores.
    heardAs: [...new Map(shown.flatMap((t) => (Array.isArray(t.heardAs) ? (t.heardAs as { heard: string; meant: string }[]) : []))
      .filter((h) => typeof h?.heard === 'string' && typeof h?.meant === 'string')
      // the teacher's side screens these too (2b round 1): they are the learner's words as heard
      .filter((h) => !teacherSide || (maskContact(h.heard) === h.heard && maskContact(h.meant) === h.meant))
      .map((h) => [`${h.heard.toLowerCase()}>${h.meant.toLowerCase()}`, { heard: h.heard, meant: h.meant }] as const)).values()].slice(0, 6),
  }
}

type ViewedSession = Awaited<ReturnType<typeof sessionForViewer>>['s']
type Scores = { pronunciation: number | null; fluency: number | null }

/** A stored score, or null — the feedback row's `scores` is JSON written by feedback.ts, read defensively. */
function scoreOf(scores: unknown, key: 'pronunciation' | 'fluency'): number | null {
  const v = scores && typeof scores === 'object' ? (scores as Record<string, unknown>)[key] : null
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** How many earlier ready reports previousScores looks through for each score. */
export const PREVIOUS_SCAN = 30

/**
 * THE SCALE'S "SINCE LAST TIME" (Praktika comparison, gap 7): each score's value in the latest EARLIER session of the same
 * seat AND the same learner that HAS that score (plan review, opus: pronunciation is null whenever no repeat-after-me sentence
 * was scored, so "the last session" would often compare against nothing). Looked for in the PREVIOUS_SCAN ready reports
 * before this one (commit review, codex: ten was too few) — a score older than that is no "last time" worth comparing to
 * (at the week's cap that is over a month back), so no change is shown. Only the two numbers leave those rows. A tester's
 * session (no seat) has none; neither has a report still being built (the route skips it while the report view polls).
 */
export async function previousScores(s: ViewedSession): Promise<Scores | null> {
  if (!s.enrollment || !s.learnerId || s.feedbackStatus !== 'ready') return null
  const rows = await db.classroomSession.findMany({
    where: { enrollmentId: s.enrollment.id, learnerId: s.learnerId, startedAt: { lt: s.startedAt }, feedbackStatus: 'ready', feedback: { isNot: null } },
    orderBy: { startedAt: 'desc' },
    take: PREVIOUS_SCAN,
    select: { feedback: { select: { scores: true } } },
  })
  const first = (key: 'pronunciation' | 'fluency') => rows.map((r) => scoreOf(r.feedback?.scores, key)).find((v) => v !== null) ?? null
  return { pronunciation: first('pronunciation'), fluency: first('fluency') }
}

/** How long after a lesson ends its report still opens with the celebration (plan review: never on an old report). */
export const CELEBRATE_WITHIN_MS = 15 * 60_000

/**
 * THE CELEBRATION AFTER A LESSON (gap 4): the family's side only, only for a session that ENDED in the last
 * CELEBRATE_WITHIN_MS and that the learner spoke in — decided here, never by the URL (plan review, codex + opus: `?done=1`
 * survives a refresh, a bookmark, the back button). Carries the week as the home shows it (me.ts): the learner's sessions
 * this week against the seat's target, and the streak — for this session's own seat and learner.
 */
export async function celebrationFor(s: ViewedSession, viewer: Viewer, talkSeconds: number, now = new Date()): Promise<{ done: number; of: number; streak: number } | null> {
  if (viewer !== 'learner' || !s.enrollment || !s.learnerId || !s.endedAt || talkSeconds <= 0) return null
  if (now.getTime() - s.endedAt.getTime() > CELEBRATE_WITHIN_MS) return null
  const rows = await db.classroomSession.findMany({
    where: { enrollmentId: s.enrollment.id, learnerId: s.learnerId, turnCount: { gt: 0 }, startedAt: { gte: streakWindowStart(now) } },
    select: { startedAt: true },
  })
  const weekStart = ictWeekStart(now)
  return {
    done: rows.filter((r) => r.startedAt >= weekStart).length,
    of: s.enrollment.sessionsPerWeek,
    streak: weeksInARow(rows.map((r) => r.startedAt), now),
  }
}
