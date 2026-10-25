import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api/handler'
import { logError, logWarn } from '@/lib/log'
import { getGeminiVertex } from '@/lib/gemini'
import { LIMITS, STRICTNESS, type Strictness } from './constants'
import { parseWav } from './wav'
import { assess, recognize, speechConfig, type PronResult } from './azure-speech'
import { tutorTurn } from './tutor-ai'
import { parseFocus } from './plans'
import { workingOnLines } from './focus'
import { speakLine } from './session-voice'
import { classroomOpenFor } from './config'
import { alertSafetyTeam, safetyReply } from './safety'
import { quietError } from './quiet-error'
import { PRACTICE_NOTICE_VERSION, TEACHER_VIEW_NOTICE_VERSION } from './notices'
import type { AgeBand } from './limits'

/** Below this peak (of 32767) a clip is silence or room noise — no speech service is asked about it. */
export const SILENCE_PEAK = 400
/** A turn shorter than this is a mis-tap. */
export const MIN_TURN_MS = 350
/**
 * A turn still 'processing' this recently blocks the next one (one reply at a time); older, it was lost. ⛔ THE SWEEP'S OWN
 * LINE (sweep.ts ASSESS_STALE_S, 2a round 4, opus): no window in which a stuck turn neither blocks nor is given up.
 */
export const BUSY_MS = 120_000

export type TurnResult =
  | { kind: 'silence' }
  | {
    kind: 'reply'
    seq: number
    learnerText: string
    reply: string
    hint: string
    hintVi: string
    expect: string | null
    heardAs: { heard: string; meant: string }[]
    audio: string | null
    secondsLeft: number
  }

/** The session the CALLER may speak in: theirs (their learner's, or their own test), live, and not past its deadline. */
async function sessionOfCaller(sessionId: string, accountId: string, now: Date) {
  const s = await db.classroomSession.findUnique({
    where: { id: sessionId },
    include: {
      // The session's OWN learner decides whose it is (report.ts's rule), never the seat's current one.
      learner: { select: { ownerId: true, withdrawnAt: true } },
      enrollment: { select: { status: true, learnerId: true, focusNote: true, focusItems: true } },
      avatar: { select: { name: true, persona: true, voice: true, teacherProfile: { select: { profileId: true } } } },
    },
  })
  const mine = s && (s.testerId === accountId || s.learner?.ownerId === accountId)
  if (!s || !mine) throw new ApiError('session_not_found', 404)
  // The seat is still this learner's (report.ts's rule; 2a round 2, codex) — its notes are theirs alone.
  if (s.enrollment && s.enrollment.learnerId !== s.learnerId) throw new ApiError('seat_inactive', 409)
  if (s.status !== 'live' || now.getTime() > s.endsAt.getTime() + LIMITS.deadlineGraceSeconds * 1000) throw new ApiError('session_over', 409)
  if (s.enrollment && (s.enrollment.status !== 'active' || s.learner?.withdrawnAt)) throw new ApiError('seat_inactive', 409)
  // ⛔ THE SWITCH BITES ON EVERY TURN (2a review, opus — config.ts promised it): switched off, or this teacher taken out of
  // the pilot, a live session stops calling the vendors at its next turn, not when the sweep comes round.
  // A FRESH read (2a round 3, opus): a cached switch would let every process keep paying for up to 30 s after "off".
  if (!(await classroomOpenFor(s.avatar.teacherProfile.profileId, { fresh: true })).open) throw new ApiError('classroom_closed', 403)
  return s
}

/**
 * ONE TURN (plan "How one turn works"): check → reserve the turn row under the session's lock → transcript (Azure) →
 * reply (Gemini) → voice (Azure TTS) → answer; the pronunciation score runs in after(), on the clip still in memory, and
 * the clip is dropped when it is done. ⛔ The clip is never written anywhere.
 */
export async function processTurn(sessionId: string, accountId: string, clientTurnId: string, wav: Buffer, now = new Date()): Promise<TurnResult> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientTurnId)) throw new ApiError('bad_request', 400)
  const info = parseWav(wav)
  if (!info || info.ms > (LIMITS.turnSeconds + 1) * 1000) throw new ApiError('audio_invalid', 400)
  const session = await sessionOfCaller(sessionId, accountId, now)
  if (info.ms < MIN_TURN_MS || info.peak < SILENCE_PEAK) return { kind: 'silence' }

  // ── Reserve the turn: the count, the duplicate and the seq, under the SESSION's lock, in a short transaction —
  // the slow calls run after it commits (codex, plan round 2: parallel distinct turns must never pass the cap).
  const reserved = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-session:${sessionId}`}, 0))`
    // ⛔ STILL LIVE, CHECKED AGAIN UNDER THE LOCK END TAKES TOO (2a round 2, codex + opus): the check above ran before
    // the lock — an End that landed meanwhile must refuse this turn, not let it pay the vendors on an ended session.
    const now2 = await tx.classroomSession.findUnique({
      where: { id: sessionId },
      select: {
        status: true, endsAt: true, learnerId: true,
        learner: { select: { withdrawnAt: true, practiceConsentVersion: true, teacherViewConsentVersion: true } },
        enrollment: { select: { status: true, learnerId: true } },
      },
    })
    if (!now2 || now2.status !== 'live' || now.getTime() > now2.endsAt.getTime() + LIMITS.deadlineGraceSeconds * 1000) throw new ApiError('session_over', 409)
    // …and the seat and the consent, read again here too (2a round 3, codex): a withdrawal or a removal that landed since
    // the first check stops this turn before any audio leaves.
    if (now2.enrollment && (now2.enrollment.status !== 'active' || now2.enrollment.learnerId !== now2.learnerId || now2.learner?.withdrawnAt)) throw new ApiError('seat_inactive', 409)
    // The notices as they are NOW (2a round 4, codex): a session started under a version since replaced asks again first.
    if (now2.learner && (now2.learner.practiceConsentVersion !== PRACTICE_NOTICE_VERSION || now2.learner.teacherViewConsentVersion !== TEACHER_VIEW_NOTICE_VERSION)) {
      throw new ApiError('consent_required', 409)
    }
    // A duplicate (a retried upload) only after the re-checks above — a retry is refused like a new turn would be (2a
    // round 5, codex).
    const dup = await tx.classroomTurn.findUnique({ where: { sessionId_clientTurnId: { sessionId, clientTurnId } } })
    // ⛔ A FAILED ID IS FINAL (2a round 10, codex + opus — reusing it in place raced the one-at-a-time gate, let a stale
    // worker overwrite its replacement and dodged the cap): the page sends every upload under a fresh id anyway.
    if (dup) return { dup }
    // ⛔ ONE REPLY AT A TIME (2a review, codex): a second upload while one is being answered would reply from the same old
    // history, out of order, and pay the vendors twice. The page sends one turn and waits; anything else is refused.
    const busy = await tx.classroomTurn.findFirst({ where: { sessionId, status: 'processing', updatedAt: { gt: new Date(now.getTime() - BUSY_MS) } }, select: { id: true } })
    if (busy) throw new ApiError('turn_in_progress', 409)
    const last = await tx.classroomTurn.findFirst({ where: { sessionId }, orderBy: { seq: 'desc' }, select: { seq: true } })
    const seq = (last?.seq ?? 0) + 1
    if (seq > LIMITS.turnsPerSession) throw new ApiError('turn_cap', 409)
    const row = await tx.classroomTurn.create({ data: { sessionId, seq, clientTurnId, status: 'processing', learnerMs: info.ms } })
    return { row }
  })
  if ('dup' in reserved && reserved.dup) {
    const d = reserved.dup
    // A retried upload of a turn that already answered: the same answer again. Its voice (never stored) is made again only
    // for the session's LATEST turn — a genuine retry; an old turn answers with its text alone, so a looping client
    // cannot run up the speech bill (2a round 2, opus). The route's rate limit bounds the rest.
    if (d.status === 'ok' && d.learnerText) {
      // ⛔ A FLAGGED turn's retry gives nothing back (2a round 6, codex): not the words, not the hints — only eno's own safe
      // line. The family's report hides that exchange; a replayed upload must not hand it over either.
      if (d.flag) return { kind: 'reply', seq: d.seq, learnerText: '', reply: safetyReply(bandOf(session)), hint: '', hintVi: '', expect: null, heardAs: [], audio: null, secondsLeft: Math.max(0, Math.round((session.endsAt.getTime() - Date.now()) / 1000)) }
      const latest = await db.classroomTurn.findFirst({ where: { sessionId, status: 'ok' }, orderBy: { seq: 'desc' }, select: { id: true } })
      const audio = latest?.id === d.id ? await speakLine(d.replyText, session.avatar.voice, levelOf(session), bandOf(session)).catch(() => null) : null
      return replyOf(d, session, now, audio)
    }
    if (d.status === 'processing') throw new ApiError('turn_in_progress', 409)
    throw new ApiError('tutor_unavailable', 503)
  }
  const turn = reserved.row!

  // The reserved row is given back, then the refusal thrown — each built where it is decided, so every code that reaches
  // the wire is a literal ApiError (errors.test.ts harvests them).
  // ⛔ KEPT AS 'failed', NEVER DELETED (2a round 9, opus): a deleted row would free its seq, and attempts — each paid to
  // the speech service — would never reach LIMITS.turnsPerSession. A failed row is skipped by the history and the report.
  const fail = async (refusal: ApiError, e?: unknown): Promise<never> => {
    if (e) logWarn(`[classroom] turn failed: ${refusal.code}`, { status: (e as { status?: number }).status ?? null })
    await db.classroomTurn.update({ where: { id: turn.id }, data: { status: 'failed', updatedAt: new Date() } }).catch((e) => logError(quietError(e), { op: 'classroom.turn.unreserve' }))
    throw refusal
  }

  const cfg = speechConfig()
  if (!cfg) return fail(new ApiError('speech_unavailable', 503))
  let heard
  try {
    heard = await recognize(cfg, wav)
  } catch (e) {
    return fail(new ApiError('speech_unavailable', 503), e)
  }
  if (heard.status === 'silence') {
    await db.classroomTurn.update({ where: { id: turn.id }, data: { status: 'failed', updatedAt: new Date() } }).catch((e) => logError(quietError(e), { op: 'classroom.turn.unreserve' }))
    return { kind: 'silence' }
  }

  const before = await db.classroomTurn.findMany({ where: { sessionId, seq: { lt: turn.seq }, status: 'ok' }, orderBy: { seq: 'asc' }, select: { learnerText: true, replyText: true, expectText: true, flag: true } })
  // ⛔ A FLAGGED EXCHANGE LEAVES THE TUTOR'S MEMORY (2a review, codex): the safety reply was given once; a later reply
  // that remembered it could repeat the disclosure into the family's transcript and the report model.
  const history = before.filter((h) => !h.flag)
  const snapshot = (session.planSnapshot ?? {}) as Record<string, unknown>
  const focus = parseFocus(snapshot.focus)
  const practised = new Set(before.map((h) => h.expectText).filter(Boolean))
  const ai = getGeminiVertex()
  if (!ai) return fail(new ApiError('tutor_unavailable', 503))
  let reply: Awaited<ReturnType<typeof tutorTurn>>
  try {
    reply = await tutorTurn(ai, {
      avatarName: session.avatar.name,
      persona: session.avatar.persona,
      level: levelOf(session),
      band: bandOf(session),
      strictness: strictnessOf(session),
      focusNote: session.enrollment?.focusNote ?? '',
      plan: { brief: typeof snapshot.brief === 'string' ? snapshot.brief : '', focus },
      workingOn: workingOnLines(session.enrollment?.focusItems),
      history: history.flatMap((h) => [...(h.learnerText ? [{ who: 'learner' as const, text: h.learnerText }] : []), { who: 'avatar' as const, text: h.replyText }]),
      learnerText: heard.text,
      secondsLeft: Math.max(0, (session.endsAt.getTime() - now.getTime()) / 1000),
      drillLeft: focus.drill.filter((d) => !practised.has(d)),
    })
  } catch (e) {
    // ⛔ A HARM FLAG IS NEVER LOST WITH ITS REPLY (2a round 5, opus): the model flagged the turn but its words could not
    // be used (a helpline number trips the contact gate, for one) — the turn is saved FLAGGED, with our own kind words,
    // and a person is alerted below.
    if (!(e as { safety?: boolean }).safety) return fail(new ApiError('tutor_unavailable', 503), e)
    reply = { reply: safetyReply(bandOf(session)), hint: '', hintVi: '', expect: null, heardAs: [], safety: true, model: 'eno-safety', calls: (e as { calls?: number }).calls ?? 1 }
  }
  // A flagged turn never sets a drill (2a round 10, opus): nothing after a disclosure is scored as a repeat of anything.
  if (reply.safety) reply = { ...reply, expect: null }

  // The reference that scores THIS turn: the sentence the previous reply asked for (a drill — reliable), else what the
  // learner said (Microsoft's transcribe-then-score; words to practise, never a verdict).
  const asked = before.at(-1)?.expectText ?? null
  // A masked word ("****" — Azure masks profanity in the spoken form too) is no reference: free talk with one is not
  // scored at all rather than scored against stars (2a round 8, opus).
  const reference = asked ?? (heard.lexical.includes('*') ? null : heard.lexical)
  const audio = await speakLine(reply.reply, session.avatar.voice, levelOf(session), bandOf(session)).catch((e) => {
    logWarn('[classroom] reply TTS failed', { status: (e as { status?: number }).status ?? null })
    return null
  })
  // A final write that fails gives the reserved row back like any other failure (2a round 3, opus) — never a turn left
  // 'processing' that blocks the next upload for BUSY_MS and holds up the report.
  try {
    await db.$transaction(async (tx) => {
      // Written only while the turn is still 'processing' (2a round 4, opus): one the sweep already gave up stays given up.
      const written = await tx.classroomTurn.updateMany({
        where: { id: turn.id, status: 'processing' },
        data: {
          status: 'ok', learnerText: heard.text, replyText: reply.reply, hint: reply.hint, hintVi: reply.hintVi, expectText: reply.expect,
          reference, heardAs: reply.heardAs, assessStatus: reference ? 'pending' : 'skipped', flag: reply.safety ? 'harm' : null, aiCalls: reply.calls, updatedAt: new Date(),
        },
      })
      if (!written.count) throw new ApiError('tutor_unavailable', 503)
      await tx.classroomSession.update({
        where: { id: sessionId },
        data: { turnCount: { increment: 1 }, learnerSpeechMs: { increment: info.ms }, avatarChars: { increment: reply.reply.length }, updatedAt: new Date() },
      })
    })
  } catch (e) {
    if (reply.safety) {
      // ⛔ THE FLAG OUTLIVES A FAILED WRITE (2a round 7, codex): the reserved row is kept — 'failed', but FLAGGED, with
      // what was said and answered — so the session's report is flagged and an admin can read the exchange; then a person
      // is told. Never deleted like an ordinary failure.
      logWarn('[classroom] flagged turn could not be written in full', { status: (e as { status?: number }).status ?? null })
      await db.classroomTurn.update({ where: { id: turn.id }, data: { status: 'failed', flag: 'harm', learnerText: heard.text, replyText: reply.reply, updatedAt: new Date() } })
        .catch((e2) => logError(quietError(e2), { op: 'classroom.turn.flag-keep' }))
      await alertSafetyTeam(sessionId)
      throw new ApiError('tutor_unavailable', 503)
    }
    return fail(new ApiError('tutor_unavailable', 503), e)
  }
  if (reply.safety) after(() => alertSafetyTeam(sessionId))

  // ⛔ After the answer: score the clip in memory, then let it go. A failure is recorded as such — never retried later,
  // because nothing of the audio is left to retry with.
  if (reference) after(async () => {
    let pron: PronResult | null = null
    try {
      pron = await assess(cfg, wav, reference, asked !== null)
    } catch (e) {
      logWarn('[classroom] pronunciation assessment failed', { status: (e as { status?: number }).status ?? null })
    }
    await db.classroomTurn.update({
      where: { id: turn.id },
      data: pron ? { pron, assessStatus: 'done', updatedAt: new Date() } : { assessStatus: 'failed', updatedAt: new Date() },
    }).catch((e) => logError(quietError(e), { op: 'classroom.turn.assess' }))
  })

  return {
    kind: 'reply', seq: turn.seq, learnerText: heard.text, reply: reply.reply, hint: reply.hint, hintVi: reply.hintVi,
    expect: reply.expect, heardAs: reply.heardAs, audio,
    // From the moment of the answer, not of the upload (2a round 4, codex): the reply itself took time.
    secondsLeft: Math.max(0, Math.round((session.endsAt.getTime() - Date.now()) / 1000)),
  }
}

type SessionRow = Awaited<ReturnType<typeof sessionOfCaller>>
const snap = (s: SessionRow) => (s.planSnapshot ?? {}) as Record<string, unknown>
function levelOf(s: SessionRow): string { return typeof snap(s).level === 'string' ? (snap(s).level as string) : 'B1' }
function bandOf(s: SessionRow): AgeBand {
  const b = snap(s).band
  return b === 'child-young' || b === 'child' || b === 'teen' || b === 'adult' ? b : 'adult'
}
function strictnessOf(s: SessionRow): Strictness {
  const v = snap(s).strictness
  return (STRICTNESS as readonly unknown[]).includes(v) ? (v as Strictness) : 'balanced'
}

function replyOf(d: { seq: number; learnerText: string | null; replyText: string; hint: string; hintVi: string; expectText: string | null; heardAs: unknown; flag: string | null }, s: SessionRow, now: Date, audio: string | null): TurnResult {
  return {
    kind: 'reply', seq: d.seq, learnerText: d.learnerText ?? '', reply: d.replyText, hint: d.hint, hintVi: d.hintVi, expect: d.expectText,
    heardAs: Array.isArray(d.heardAs) ? (d.heardAs as { heard: string; meant: string }[]) : [],
    audio, secondsLeft: Math.max(0, Math.round((s.endsAt.getTime() - now.getTime()) / 1000)),
  }
}
