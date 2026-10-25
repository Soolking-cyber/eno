import 'server-only'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api/handler'
import { logWarn } from '@/lib/log'
import { classroomOpenFor } from './config'
import { BUDGET_LOCK, budgetRefusal, budgetUse } from './budget'
import { LIMITS, type Level } from './constants'
import { ageBand, effectiveMinutes, frequencyRefusal, ictDayStart, ictWeekStart, needsAssent, nextPracticeAt, under13, type AgeBand } from './limits'
import { firstPlan, parseFocus, pickPlan, type PlanFocus } from './plans'
import { PRACTICE_NOTICE_VERSION, TEACHER_VIEW_NOTICE_VERSION } from './notices'
import { spatiusConfig } from './spatius'
import { libraryAvatarById } from './library-avatars'
import { speakLine } from './session-voice'
import { NextAtRefusal } from './refusal'
import { containsContactInfo } from '@/lib/publish-guard'
import { containsPhoneNumber } from '@/lib/phone'

/**
 * START A SESSION (plan "Concurrency, limits and budget"). ONE transaction under two locks:
 *   1. the LEARNER's (or, for a teacher's test, the teacher's) — a double tap or a second tab never starts two sessions;
 *      the partial unique index in the DDL is the database's half of the same rule;
 *   2. the classroom's BUDGET lock — what this start reserves is read against what every other start reserved and every
 *      end released, never half-written (budget.ts).
 * A live session already running for the learner is RETURNED, not refused: a reload resumes it with the time it has left.
 */

export type SessionPlan = { brief: string; focus: PlanFocus; openingLine: string; planId: string | null }

export type StartedSession = {
  id: string
  endsAt: string
  mode: 'avatar' | 'voice'
  resumed: boolean
  avatar: { name: string; photoUrl: string | null; voice: string; spatiusAvatarId: string | null }
  learnerName: string
  band: AgeBand
  opening: { text: string; audio: string | null; expect: string | null }
}

/**
 * The opening line, and the first drill sentence when the plan has one — the warm-up starts the session. ⛔ The tutor's
 * contact gate applies to what the avatar SAYS FIRST too (2a round 6, opus): a greeting or a plan line carrying a number or
 * a handle is never spoken — a plain hello in the avatar's name takes its place.
 */
export function openingOf(plan: SessionPlan, avatarName = ''): { text: string; expect: string | null } {
  const contact = (x: string) => containsPhoneNumber(x) || containsContactInfo(x)
  const line = contact(plan.openingLine) ? `Hi! I'm ${avatarName || 'your practice partner'}. How are you today?` : plan.openingLine
  // The warm-up drill is spoken too (2a round 9, opus): one carrying a contact is skipped, never said.
  const drill = plan.focus.drill.find((d) => !contact(d))
  if (!drill) return { text: line, expect: null }
  return { text: `${line} Let's warm up first. Please say after me: ${drill}`, expect: drill }
}

type SeatRow = NonNullable<Awaited<ReturnType<typeof loadSeat>>>

/** What a resumed session says when its latest exchange was flagged — never the safety words again, never a drill. */
const NEUTRAL_RESUME = "Let's keep practising. What would you like to talk about now?"

/**
 * A live session past its end (and the turns' grace) is OVER, whatever the sweep has not done yet (2a round 2, opus): a
 * phone that slept past its end time must not resume a session every turn refuses. ⛔ ENDED IN ITS OWN TRANSACTION, before
 * the start's (2a round 3, codex): inside it, a start refused for the day or the budget would roll the end back and leave
 * the session live. Locks in the start's order — the owner's, the budget's, then the session's (End's and the sweep's).
 * Its report is built by the sweep.
 */
async function endExpired(where: { learnerId: string } | { testerId: string }, ownerLock: string, now: Date): Promise<void> {
  // Past its END is over for a new start (2a round 9, opus): the turns' grace is for a reply in flight, not for resuming.
  const cutoff = now
  const expired = await db.classroomSession.findFirst({ where: { ...where, status: 'live', endsAt: { lt: cutoff } }, select: { id: true } })
  if (!expired) return
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerLock}, 0))`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${BUDGET_LOCK}, 0))`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-session:${expired.id}`}, 0))`
    await tx.$executeRaw`
      UPDATE "ClassroomSession"
         SET "status" = 'ended', "endedAt" = (now() AT TIME ZONE 'UTC'), "endReason" = 'time',
             "usedSeconds" = LEAST(GREATEST(0, EXTRACT(EPOCH FROM ("endsAt" - "startedAt"))::int), "reservedMinutes" * 60),
             "updatedAt" = (now() AT TIME ZONE 'UTC')
       WHERE "id" = ${expired.id} AND "status" = 'live'
         -- UTC with no zone, compared in SQL (sweep.ts's rule; 2a round 5, opus) — never against a client-side Date
         AND "endsAt" < (now() AT TIME ZONE 'UTC')`
  })
}

async function loadSeat(seatId: string, accountId: string) {
  return db.classroomEnrollment.findFirst({
    where: { id: seatId, learner: { ownerId: accountId } },
    include: {
      learner: true,
      avatar: { include: { teacherProfile: { select: { profileId: true, photoUrl: true } } } },
    },
  })
}

/** Which face this session gets: Spatius only when configured, the avatar has a 3D look, and the learner may have one. */
function modeFor(avatar: SeatRow['avatar'], child13: boolean, spatiusChildrenOk: boolean): { mode: 'avatar' | 'voice'; spatiusAvatarId: string | null } {
  if (!spatiusConfig() || (child13 && !spatiusChildrenOk)) return { mode: 'voice', spatiusAvatarId: null }
  if (avatar.look === 'library' && libraryAvatarById(avatar.libraryAvatarId)) return { mode: 'avatar', spatiusAvatarId: avatar.libraryAvatarId }
  if (avatar.look === 'custom' && avatar.customStatus === 'ready' && avatar.spatiusAvatarId) return { mode: 'avatar', spatiusAvatarId: avatar.spatiusAvatarId }
  return { mode: 'voice', spatiusAvatarId: null }
}

export async function startLearnerSession(seatId: string, accountId: string, now = new Date()): Promise<StartedSession> {
  const seat = await loadSeat(seatId, accountId)
  if (!seat || !seat.learner) throw new ApiError('seat_not_found', 404)
  if (seat.status !== 'active') throw new ApiError('seat_inactive', 409)
  const learner = seat.learner
  const kind = learner.kind === 'child' ? 'child' : 'self'
  // ⛔ No consent on record (or withdrawn) → no practice; the join page asks again.
  if (learner.withdrawnAt || learner.practiceConsentVersion !== PRACTICE_NOTICE_VERSION || learner.teacherViewConsentVersion !== TEACHER_VIEW_NOTICE_VERSION) {
    throw new ApiError('consent_required', 409)
  }
  if (needsAssent(kind, learner.birthYear, now) && !learner.assentAt) throw new ApiError('assent_required', 409)
  // Learners follow their teacher (config.ts) — a FRESH read: a start is where the switch must bite.
  const { open, config } = await classroomOpenFor(seat.avatar.teacherProfile.profileId, { fresh: true })
  if (!open) throw new ApiError('classroom_closed', 403)

  const child13 = under13(kind, learner.birthYear, now)
  const face = modeFor(seat.avatar, child13, config.spatiusChildrenOk)
  const minutes = effectiveMinutes(seat.sessionMinutes, kind, learner.birthYear, now)
  const band = ageBand(kind, learner.birthYear, now)

  await endExpired({ learnerId: learner.id }, `eno-classroom-learner:${learner.id}`, now)
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-learner:${learner.id}`}, 0))`
    // The seat and the consent, read AGAIN under the lock (2a round 3, codex): a withdrawal or a removal that landed since
    // the checks above stops this start.
    const now2 = await tx.classroomEnrollment.findUnique({
      where: { id: seat.id },
      select: { status: true, learnerId: true, learner: { select: { withdrawnAt: true, practiceConsentVersion: true, teacherViewConsentVersion: true } } },
    })
    if (!now2 || now2.status !== 'active' || now2.learnerId !== learner.id) throw new ApiError('seat_inactive', 409)
    if (now2.learner?.withdrawnAt || now2.learner?.practiceConsentVersion !== PRACTICE_NOTICE_VERSION || now2.learner?.teacherViewConsentVersion !== TEACHER_VIEW_NOTICE_VERSION) {
      throw new ApiError('consent_required', 409)
    }
    const live = await tx.classroomSession.findFirst({ where: { learnerId: learner.id, status: 'live' } })
    if (live) {
      // A live session of ANOTHER seat (another teacher's class) is not resumed here: one at a time per learner.
      if (live.enrollmentId !== seat.id) throw new ApiError('session_live', 409)
      // Resumed where the conversation IS — the avatar's latest line, and the drill it asked for, which is what the next
      // turn is scored against (2a round 4, codex) — not the opening.
      // ⛔ Never a FLAGGED reply (2a round 5, opus): a parent reopening the tab must not hear the safety words aloud. When the
      // latest exchange IS flagged, a neutral line with no drill takes its place — the next turn is scored against the
      // latest turn's drill, and a flagged turn never has one (2a round 10, opus).
      const latest = await tx.classroomTurn.findFirst({ where: { sessionId: live.id, status: 'ok' }, orderBy: { seq: 'desc' }, select: { replyText: true, expectText: true, flag: true } })
      const last = latest?.flag ? { replyText: NEUTRAL_RESUME, expectText: null } : latest
      // The face as it may be NOW (round 5, opus): a session that started with the 3D avatar continues voice-only when the
      // under-13 switch, the Spatius set-up or the look changed since — never "avatar" with no avatar to load.
      if (live.mode === 'avatar' && face.mode !== 'avatar') await tx.classroomSession.update({ where: { id: live.id }, data: { mode: 'voice', updatedAt: now } })
      const session = live.mode === 'avatar' && face.mode !== 'avatar' ? { ...live, mode: 'voice' } : live
      return { session, opening: { text: last?.replyText ?? '', expect: last?.expectText ?? null }, resumed: true }
    }
    // ⛔ A SESSION THE LEARNER NEVER SPOKE IN DOES NOT SPEND THE DAY (core review, opus): a start that died at once — the
    // mic refused, the page closed — is not practice. Only sessions with an answered turn count towards the day and the
    // week; every start counts towards LIMITS.startsPerDay. The minutes a start reserved count in the budget either way.
    const spoke = { enrollmentId: seat.id, turnCount: { gt: 0 } }
    const [week, today, starts] = await Promise.all([
      tx.classroomSession.count({ where: { ...spoke, startedAt: { gte: ictWeekStart(now) } } }),
      tx.classroomSession.count({ where: { ...spoke, startedAt: { gte: ictDayStart(now) } } }),
      tx.classroomSession.count({ where: { enrollmentId: seat.id, startedAt: { gte: ictDayStart(now) } } }),
    ])
    const freq = frequencyRefusal(week, today, seat.sessionsPerWeek, starts)
    if (freq) throw new NextAtRefusal(freq, nextPracticeAt(freq, now).toISOString())

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${BUDGET_LOCK}, 0))`
    const over = budgetRefusal(await budgetUse(tx, seat.avatarId), config, minutes)
    if (over === 'teacher') throw new ApiError('budget_teacher', 409)
    if (over) throw new ApiError('budget_classroom', 409)

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-plan:${seat.id}`}, 0))`
    const plans = await tx.classroomPlan.findMany({ where: { enrollmentId: seat.id, status: { not: 'used' } }, orderBy: { updatedAt: 'desc' }, take: 10 })
    const picked = pickPlan(plans)
    const plan: SessionPlan = picked
      ? { brief: picked.brief, focus: parseFocus(picked.focus), openingLine: picked.openingLine || seat.avatar.greeting || `Hi! It's ${seat.avatar.name} again. How are you today?`, planId: picked.id }
      : { ...firstPlan(seat.level as Level, seat.avatar.greeting, seat.avatar.name), planId: null }
    if (picked) await tx.classroomPlan.update({ where: { id: picked.id }, data: { status: 'used', updatedAt: now } })

    const opening = openingOf(plan, seat.avatar.name)
    const session = await tx.classroomSession.create({
      data: {
        enrollmentId: seat.id, avatarId: seat.avatarId, learnerId: learner.id, planId: plan.planId,
        planSnapshot: { brief: plan.brief, focus: plan.focus, openingLine: plan.openingLine, level: seat.level, strictness: seat.strictness, band },
        mode: face.mode, startedAt: now, endsAt: new Date(now.getTime() + minutes * 60_000), reservedMinutes: minutes,
      },
    })
    await tx.classroomTurn.create({ data: { sessionId: session.id, seq: 0, status: 'ok', replyText: opening.text, expectText: opening.expect } })
    return { session, opening, resumed: false }
  }, { maxWait: 5_000, timeout: 15_000 })

  const audio = await speakLine(result.opening.text, seat.avatar.voice, seat.level, band).catch((e) => {
    logWarn('[classroom] opening line TTS failed', { status: (e as { status?: number }).status ?? null })
    return null
  })
  return {
    id: result.session.id,
    endsAt: result.session.endsAt.toISOString(),
    mode: result.session.mode === 'avatar' ? 'avatar' : 'voice',
    resumed: result.resumed,
    avatar: { name: seat.avatar.name, photoUrl: seat.avatar.teacherProfile.photoUrl, voice: seat.avatar.voice, spatiusAvatarId: result.session.mode === 'avatar' ? face.spatiusAvatarId : null },
    learnerName: learner.displayName,
    band,
    opening: { text: result.opening.text, audio, expect: result.opening.expect },
  }
}

/** A teacher tries their own avatar: no seat, no learner — LIMITS.teacherTestsPerDay a day, LIMITS.teacherTestMinutes each. */
export async function startTeacherTest(accountId: string, now = new Date()): Promise<StartedSession> {
  const tp = await db.teacherProfile.findUnique({ where: { profileId: accountId }, select: { id: true, photoUrl: true, classroomAvatar: true } })
  if (!tp) throw new ApiError('teacher_profile_required', 403)
  const avatar = tp.classroomAvatar
  if (!avatar) throw new ApiError('avatar_required', 409)
  const { open, config } = await classroomOpenFor(accountId, { fresh: true })
  if (!open) throw new ApiError('classroom_closed', 403)
  const minutes = LIMITS.teacherTestMinutes
  const face = spatiusConfig() && avatar.look === 'library' && libraryAvatarById(avatar.libraryAvatarId)
    ? { mode: 'avatar' as const, spatiusAvatarId: avatar.libraryAvatarId }
    : spatiusConfig() && avatar.look === 'custom' && avatar.customStatus === 'ready' && avatar.spatiusAvatarId
      ? { mode: 'avatar' as const, spatiusAvatarId: avatar.spatiusAvatarId }
      : { mode: 'voice' as const, spatiusAvatarId: null }
  const plan: SessionPlan = { ...firstPlan('B1', avatar.greeting, avatar.name), planId: null }
  const fresh = openingOf(plan, avatar.name)

  await endExpired({ testerId: accountId }, `eno-classroom-tester:${accountId}`, now)
  const { session, opening, resumed } = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-tester:${accountId}`}, 0))`
    const live = await tx.classroomSession.findFirst({ where: { testerId: accountId, status: 'live' } })
    if (live) {
      // A reload RESUMES the test where it is (2a reviews, opus + codex): the avatar's latest line and its drill — never a
      // new opening from today's greeting.
      const latest = await tx.classroomTurn.findFirst({ where: { sessionId: live.id, status: 'ok' }, orderBy: { seq: 'desc' }, select: { replyText: true, expectText: true, flag: true } })
      const last = latest?.flag ? { replyText: NEUTRAL_RESUME, expectText: null } : latest
      if (live.mode === 'avatar' && face.mode !== 'avatar') await tx.classroomSession.update({ where: { id: live.id }, data: { mode: 'voice', updatedAt: now } })
      const session = live.mode === 'avatar' && face.mode !== 'avatar' ? { ...live, mode: 'voice' } : live
      return { session, opening: { text: last?.replyText ?? fresh.text, expect: last?.expectText ?? null }, resumed: true }
    }
    const tests = await tx.classroomSession.count({ where: { testerId: accountId, startedAt: { gte: ictDayStart(now) } } })
    if (tests >= LIMITS.teacherTestsPerDay) throw new NextAtRefusal('test_limit', nextPracticeAt('day_limit', now).toISOString())
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${BUDGET_LOCK}, 0))`
    const over = budgetRefusal(await budgetUse(tx, avatar.id), config, minutes)
    if (over === 'teacher') throw new ApiError('budget_teacher', 409)
    if (over) throw new ApiError('budget_classroom', 409)
    const s = await tx.classroomSession.create({
      data: {
        avatarId: avatar.id, testerId: accountId, mode: face.mode, startedAt: now, endsAt: new Date(now.getTime() + minutes * 60_000), reservedMinutes: minutes,
        planSnapshot: { brief: plan.brief, focus: plan.focus, openingLine: plan.openingLine, level: 'B1', strictness: 'balanced', band: 'adult' },
      },
    })
    await tx.classroomTurn.create({ data: { sessionId: s.id, seq: 0, status: 'ok', replyText: fresh.text, expectText: fresh.expect } })
    return { session: s, opening: fresh, resumed: false }
  }, { maxWait: 5_000, timeout: 15_000 })

  const audio = await speakLine(opening.text, avatar.voice, 'B1', 'adult').catch(() => null)
  return {
    id: session.id,
    endsAt: session.endsAt.toISOString(),
    mode: session.mode === 'avatar' ? 'avatar' : 'voice',
    resumed,
    avatar: { name: avatar.name, photoUrl: tp.photoUrl, voice: avatar.voice, spatiusAvatarId: session.mode === 'avatar' ? face.spatiusAvatarId : null },
    learnerName: '',
    band: 'adult',
    opening: { text: opening.text, audio, expect: opening.expect },
  }
}
