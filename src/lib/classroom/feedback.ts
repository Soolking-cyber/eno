import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logError, logWarn } from '@/lib/log'
import { alertSafetyTeam } from './safety'
import { quietError } from './quiet-error'
import { getGeminiVertex } from '@/lib/gemini'
import { draftFeedback, type FeedbackInput } from './feedback-ai'
import { mergeFocus, parseFocusItems, workingOnLines } from './focus'
import { parseFocus } from './plans'
import { estimateCostMicroUsd } from './costs'
import type { PronResult } from './azure-speech'
import type { AgeBand } from './limits'

/**
 * The report waits this long after the end for a turn still being answered and the last pronunciation score (it runs in
 * after()). ⛔ LONGER THAN THE SWEEP'S 120 s FOR A LOST TURN (2a round 2, opus): a slow turn that lands at 90 s is in the
 * report; one that never lands has been marked failed by then, and the report goes without it.
 */
export const SETTLE_MS = 150_000
export const MAX_ATTEMPTS = 3
/** A word scored below this is one to practise; below 60 Azure itself calls it a mispronunciation. */
export const PRACTISE_BELOW = 80

type Turn = { seq: number; status: string; learnerText: string | null; replyText: string; reference: string | null; expectText: string | null; pron: unknown; assessStatus: string; heardAs: unknown; flag: string | null; aiCalls: number; learnerMs: number }

export type WordScore = { word: string; score: number; reliable: boolean; count: number; phonemes?: string }

/**
 * Azure's word scores across the session → the words to practise, worst first. Pure. A word scored in a repeat-after-me
 * turn (its reference was the previous reply's drill sentence) is `reliable`; in free talk it was scored against the
 * learner's own transcript, which cannot catch a sound-alike swap (codex, plan round 2) — still worth practising, never a
 * verdict. The report shows both, labelled.
 */
export function wordsToPractise(turns: readonly Turn[], prevExpect: (seq: number) => string | null): WordScore[] {
  const by = new Map<string, WordScore>()
  for (const t of turns) {
    if (t.assessStatus !== 'done' || !t.pron || typeof t.pron !== 'object') continue
    const reliable = prevExpect(t.seq) !== null
    for (const w of (t.pron as PronResult).words ?? []) {
      const word = w.word.toLowerCase().replace(/[^a-z']/g, '')
      if (!word || w.score >= PRACTISE_BELOW) continue
      const phonemes = (w.phonemes ?? []).filter((p) => p.score < 60).map((p) => p.p).join(' ') || undefined
      const cur = by.get(word)
      if (!cur) { by.set(word, { word, score: w.score, reliable, count: 1, ...(phonemes ? { phonemes } : {}) }); continue }
      cur.count += 1
      // ⛔ A SCORE KEEPS ITS OWN LABEL (2a round 2, codex): a drill-scored occurrence replaces free-talk ones, and within
      // one kind the lowest wins — a free-talk score is never shown under "reliable", nor its sounds under another's.
      if ((reliable && !cur.reliable) || (reliable === cur.reliable && w.score < cur.score)) {
        cur.score = w.score
        cur.reliable = reliable
        if (phonemes) cur.phonemes = phonemes
        else delete cur.phonemes
      }
    }
  }
  return [...by.values()].sort((a, b) => Number(b.reliable) - Number(a.reliable) || a.score - b.score).slice(0, 10)
}

/** Session-level scores from Azure (never the model): mean accuracy and fluency over the scored turns. Pure. */
export function sessionScores(turns: readonly Turn[]): { pronunciation: number | null; fluency: number | null } {
  const done = turns.flatMap((t) => (t.assessStatus === 'done' && t.pron && typeof t.pron === 'object' ? [t.pron as PronResult] : []))
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => typeof x === 'number')
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null
  }
  return { pronunciation: mean(done.map((p) => p.accuracy)), fluency: mean(done.map((p) => p.fluency)) }
}

/**
 * BUILD THE REPORT of one ended session — idempotent (a ready report is left alone; the sweep and the end route may both
 * call it). Writes the report, the cost estimate, the seat's "Working on" list and the next plan's AI draft in ONE
 * transaction. ⛔ A teacher's plan is never touched: the new draft replaces only untouched AI drafts. On failure the
 * attempt is counted; after MAX_ATTEMPTS the session is marked failed and the admin page lists it.
 */
export async function buildFeedback(sessionId: string, now = new Date()): Promise<'ready' | 'waiting' | 'pending' | 'failed' | 'skipped'> {
  // ⛔ ONE BUILDER AT A TIME (the end route's after() and the sweep can both reach a session): an owned lock, released only
  // while it still holds this builder's token — a second builder skips, it never writes a second report or a second draft.
  const lockKey = `classroom-feedback:${sessionId}`
  const token = randomUUID()
  if ((await kv.set(lockKey, token, { nx: true, ex: 180 })) !== 'OK') return 'skipped'
  try {
    return await buildFeedbackLocked(sessionId, now)
  } finally {
    // Released only while it still holds THIS builder's token, in one statement (2a round 3, codex): a get-then-delete
    // could remove a successor's lock taken in between. kv_store holds the token as a JSON string (ratelimit.ts kv.set).
    await db.$executeRaw`DELETE FROM public.kv_store WHERE key = ${lockKey} AND value = ${JSON.stringify(token)}::jsonb`
      .catch((e) => logError(e, { op: 'classroom.feedback.unlock' }))
  }
}

async function buildFeedbackLocked(sessionId: string, now: Date): Promise<'ready' | 'waiting' | 'pending' | 'failed' | 'skipped'> {
  const s = await db.classroomSession.findUnique({
    where: { id: sessionId },
    include: {
      turns: { where: { status: { in: ['ok', 'processing', 'failed'] } }, orderBy: { seq: 'asc' } },
      enrollment: { select: { id: true, focusItems: true } },
    },
  })
  if (!s || s.status !== 'ended' || s.feedbackStatus !== 'pending') return 'skipped'
  // ⛔ A TURN STILL ON ITS WAY IS WAITED FOR (2a review, codex + opus): End can land while a reply is being made — the
  // report waits (up to SETTLE_MS) for it and for the last pronunciation score, never builds without them; after that
  // the sweep has marked a lost turn failed, and it is left out.
  const pending = s.turns.some((t) => t.status === 'processing' || t.assessStatus === 'pending')
  if (pending && s.endedAt && now.getTime() - s.endedAt.getTime() < SETTLE_MS) return 'waiting'
  const turns = (s.turns as unknown as Turn[]).filter((t) => t.status === 'ok')
  // The safety flag reads EVERY turn — one saved flagged but 'failed' (its reply could not be written) still flags the
  // session (2a round 7, codex).
  const anyFlag = s.turns.some((t) => t.flag === 'harm')
  // A failed write counts as an attempt too, and turns terminal at MAX_ATTEMPTS (2a review, codex + opus): a write that
  // fails every time must not be paid for — and retried ahead of every newer report — on every sweep, forever.
  const failAttempt = async (e: unknown, op: string): Promise<'failed' | 'pending'> => {
    logError(quietError(e), { op })
    const attempts = s.feedbackAttempts + 1
    const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
    await db.classroomSession.update({ where: { id: sessionId }, data: { feedbackAttempts: attempts, feedbackStatus: status, updatedAt: now } })
      .catch((e2) => logError(e2, { op: 'classroom.feedback.attempt' }))
    return status
  }

  const snap = (s.planSnapshot ?? {}) as Record<string, unknown>
  const band: AgeBand = snap.band === 'child-young' || snap.band === 'child' || snap.band === 'teen' ? snap.band : 'adult'
  const expectBySeq = new Map(turns.map((t) => [t.seq, t.expectText]))
  const prevExpect = (seq: number) => {
    for (let q = seq - 1; q >= 0; q--) if (expectBySeq.has(q)) return expectBySeq.get(q) ?? null
    return null
  }
  // ⛔ A FLAGGED EXCHANGE STAYS OUT OF THE REPORT (core review, opus): the account holder reads it, and if a child spoke
  // of harm at home the account holder may be who they spoke of. The teacher sees that exchange, flagged, in the
  // transcript (report.ts); the summary, mistakes, scores, words to practise, "Working on" and the next plan are all
  // built without it — nothing said there can surface on the family's side, or steer the next session.
  const clean = turns.filter((t) => !t.flag)
  const flagged = wordsToPractise(clean, prevExpect)
  const scores = sessionScores(clean)
  const learnerTurns = clean.filter((t) => t.learnerText)
  const aiCallsSoFar = turns.reduce((n, t) => n + (t.aiCalls ?? 0), 0)
  const cost = (extraCalls: number) => estimateCostMicroUsd({ mode: s.mode, usedSeconds: s.usedSeconds, learnerSpeechMs: s.learnerSpeechMs, avatarChars: s.avatarChars, aiCalls: aiCallsSoFar + extraCalls })
  const safetyFlag = anyFlag ? 'harm' : null
  if (safetyFlag) logWarn('[classroom] safety flag on a session — see /admin/classroom', { sessionId })

  // Nothing said: a short report without a model call, and the plan GIVEN BACK — a session the learner never spoke in
  // (the mic refused, the page closed) did not practise it, so the same plan runs next time. Unless a newer plan is
  // already waiting (the teacher wrote one meanwhile); under the seat's plan lock, like every plan write.
  if (!learnerTurns.length) {
    try {
      await db.$transaction(async (tx) => {
        await tx.classroomFeedback.upsert({
          where: { sessionId },
          create: { sessionId, summary: '', scores: { pronunciation: null, fluency: null, grammarFixes: 0, talkSeconds: 0 }, safetyFlag },
          update: {},
        })
        await tx.classroomSession.update({ where: { id: sessionId }, data: { feedbackStatus: 'ready', costMicroUsd: cost(0), updatedAt: now } })
        if (!s.enrollment || !s.planId) return
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-plan:${s.enrollment.id}`}, 0))`
        const used = await tx.classroomPlan.findUnique({ where: { id: s.planId }, select: { source: true, status: true } })
        if (used?.status !== 'used') return
        // ⛔ WHICH PLAN COMES BACK (2b round 1, codex + opus — "any later session" alone could strand a teacher's plan):
        // a TEACHER's plan comes back unless a newer teacher plan already waits — the teacher's intention outlives a silent
        // session, whatever started since; an AI draft comes back only while nothing newer exists (no plan waiting, no
        // later session) — otherwise it is stale and the next report drafts a fresh one.
        const back = used.source === 'teacher'
          ? !(await tx.classroomPlan.count({ where: { enrollmentId: s.enrollment.id, source: 'teacher', status: 'approved' } }))
          : !(await tx.classroomPlan.count({ where: { enrollmentId: s.enrollment.id, status: { not: 'used' } } }))
            && !(await tx.classroomSession.count({ where: { enrollmentId: s.enrollment.id, startedAt: { gt: s.startedAt } } }))
        if (back) await tx.classroomPlan.update({ where: { id: s.planId }, data: { status: used.source === 'teacher' ? 'approved' : 'draft', updatedAt: now } })
      })
    } catch (e) {
      return failAttempt(e, 'classroom.feedback.write-empty')
    }
    if (safetyFlag) await alertSafetyTeam(sessionId)
    return 'ready'
  }

  const ai = getGeminiVertex()
  const input: FeedbackInput = {
    level: typeof snap.level === 'string' ? snap.level : 'B1',
    band,
    plan: { brief: typeof snap.brief === 'string' ? snap.brief : '', focus: parseFocus(snap.focus) },
    workingOn: workingOnLines(s.enrollment?.focusItems, 8),
    turns: clean.map((t) => ({ seq: t.seq, learner: t.learnerText, avatar: t.replyText })),
    flaggedWords: flagged.map((w) => ({ word: w.word, score: w.score, reliable: w.reliable, ...(w.phonemes ? { phonemes: w.phonemes } : {}) })),
    heardAs: clean.flatMap((t) => (Array.isArray(t.heardAs) ? (t.heardAs as { heard: string; meant: string }[]) : [])).slice(0, 10),
  }
  let draft
  try {
    if (!ai) throw Object.assign(new Error('ai_not_configured'), { status: 503 })
    draft = await draftFeedback(ai, input)
  } catch (e) {
    const attempts = s.feedbackAttempts + 1
    logWarn('[classroom] report failed', { attempts, status: (e as { status?: number }).status ?? null })
    await db.classroomSession.update({ where: { id: sessionId }, data: { feedbackAttempts: attempts, feedbackStatus: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', updatedAt: now } })
      .catch((e2) => logError(e2, { op: 'classroom.feedback.attempt' }))
    if (safetyFlag) await alertSafetyTeam(sessionId) // a report that cannot be built still tells a person
    return attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
  }

  const pronunciation = flagged.map((w) => ({ word: w.word, score: w.score, reliable: w.reliable, tip: draft.tips.get(w.word) ?? null }))
  const used = new Set(draft.focusWordsUsed.map((w) => w.toLowerCase()))
  const planWords = input.plan.focus.focusWords
  try {
    await db.$transaction(async (tx) => {
      await tx.classroomFeedback.upsert({
        where: { sessionId },
        create: {
          sessionId,
          summary: draft.summary,
          summaryVi: draft.summaryVi,
          wins: draft.wins,
          mistakes: draft.mistakes,
          pronunciation,
          vocabulary: { used: planWords.filter((w) => used.has(w.toLowerCase())), missed: planWords.filter((w) => !used.has(w.toLowerCase())), new: draft.newWords },
          // Talk time of what the report shows — a flagged exchange is left out here too.
          scores: { ...scores, grammarFixes: draft.mistakes.length, talkSeconds: Math.round(clean.reduce((n, t) => n + (t.learnerMs ?? 0), 0) / 1000) },
          safetyFlag,
        },
        update: {},
      })
      await tx.classroomSession.update({ where: { id: sessionId }, data: { feedbackStatus: 'ready', costMicroUsd: cost(draft.calls), updatedAt: now } })
      if (!s.enrollment) return // a teacher's test: a report, but no learner to adapt to
      // Everything that moves the learner on happens under the seat's PLAN lock — the teacher's save (api/classroom/plans),
      // a session start and every other report take it too — reading "Working on" AGAIN inside it (2a round 2, codex: two
      // reports merging the same old list would lose one's update).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-plan:${s.enrollment.id}`}, 0))`
      // ⛔ A LATE REPORT NEVER WINDS THE LEARNER BACK (codex): when a LATER session of this seat — one the learner SPOKE in
      // (2a round 11, opus: an empty one moves nothing) — already has its report, this one is saved but moves neither
      // "Working on" nor the next plan.
      if (await tx.classroomSession.count({ where: { enrollmentId: s.enrollment.id, startedAt: { gt: s.startedAt }, feedbackStatus: 'ready', turnCount: { gt: 0 } } })) return
      const seatNow = await tx.classroomEnrollment.findUnique({ where: { id: s.enrollment.id }, select: { focusItems: true } })
      const items = mergeFocus(parseFocusItems(seatNow?.focusItems), draft.focusFound, draft.rightAgain, now)
      await tx.classroomEnrollment.update({ where: { id: s.enrollment.id }, data: { focusItems: items, updatedAt: now } })
      // ⛔ THE TEACHER'S PLAN WINS: with a teacher-approved plan waiting, no AI draft is written at all.
      const teacherWaiting = await tx.classroomPlan.count({ where: { enrollmentId: s.enrollment.id, status: 'approved' } })
      // No brief, no draft (round 7, opus) — the CHECK would refuse it and take the whole report down with it.
      if (teacherWaiting || !draft.nextPlan.brief) return
      await tx.classroomPlan.deleteMany({ where: { enrollmentId: s.enrollment.id, status: 'draft', source: 'ai' } })
      await tx.classroomPlan.create({
        data: {
          enrollmentId: s.enrollment.id, source: 'ai', status: 'draft', brief: draft.nextPlan.brief,
          focus: draft.nextPlan.focus, openingLine: draft.nextPlan.openingLine, fromSessionId: sessionId,
        },
      })
    })
  } catch (e) {
    return failAttempt(e, 'classroom.feedback.write')
  }
  if (safetyFlag) await alertSafetyTeam(sessionId)
  return 'ready'
}

/** The sweep's feedback pass: ended sessions whose report is still pending, past the settle time — a few per run. */
export async function buildPendingFeedback(limit = 5, now = new Date()): Promise<number> {
  const due = await db.classroomSession.findMany({
    where: { status: 'ended', feedbackStatus: 'pending', endedAt: { lt: new Date(now.getTime() - SETTLE_MS) } },
    orderBy: { endedAt: 'asc' },
    take: limit,
    select: { id: true },
  })
  let ready = 0
  for (const { id } of due) {
    // One session's error never stops the pass for the others (2a round 5, opus).
    const r = await buildFeedback(id, now).catch((e) => { logError(quietError(e), { op: 'classroom.feedback.sweep', sessionId: id }); return 'pending' as const })
    if (r === 'ready') ready++
  }
  return ready
}
