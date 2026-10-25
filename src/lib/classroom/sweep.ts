import 'server-only'
import { db } from '@/lib/db'
import { LIMITS } from './constants'
import { BUDGET_LOCK } from './budget'
import { buildPendingFeedback } from './feedback'
import { logError } from '@/lib/log'
import { quietError } from './quiet-error'

/** A live session this long past its end is abandoned (nobody tapped End; the page was closed or the phone slept). */
export const ABANDON_AFTER_S = 120
/** A pronunciation score still pending this long never comes: the clip lived only in memory, in the process that died. */
export const ASSESS_STALE_S = 120

export type SweepResult = { ended: number; assessFailed: number; turnsFailed: number; invitesExpired: number; erased: number; reports: number }

/**
 * One sweep pass (src/app/api/cron/classroom-sweep). Each step is one statement, and the session ends take the BUDGET LOCK
 * like every other end and start (budget.ts): what an end releases and what a start reserves are never read half-written.
 * ⚠️ Prisma's DateTime columns are `timestamp(3)` holding UTC with no zone, so every comparison here is against
 * `now() AT TIME ZONE 'UTC'` (the repo's convention — job-ad-sightings.ts), never a bare now().
 * The feedback pass at the end builds the reports of sessions this (or anything) ended, a few per run.
 */
export async function sweepClassroom({ killAll }: { killAll: boolean }): Promise<SweepResult> {
  const ended = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${BUDGET_LOCK}, 0))`
    const due = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "ClassroomSession"
       WHERE "status" = 'live'
         AND (${killAll} OR "endsAt" < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${ABANDON_AFTER_S}))`
    let n = 0
    for (const { id } of due) {
      // ⛔ AND EACH SESSION'S OWN LOCK — End's rule (2a round 3, codex + opus): a turn either reserved before this end, or
      // sees it ended; the kill switch never lets one more turn pay the vendors. Budget, then session: End's order.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-session:${id}`}, 0))`
      n += await tx.$executeRaw`
        UPDATE "ClassroomSession"
           SET "status" = 'ended',
               "endedAt" = (now() AT TIME ZONE 'UTC'),
               "endReason" = CASE WHEN ${killAll} AND "endsAt" > (now() AT TIME ZONE 'UTC') THEN 'kill_switch' ELSE 'abandoned' END,
               "usedSeconds" = LEAST(GREATEST(0, EXTRACT(EPOCH FROM (LEAST((now() AT TIME ZONE 'UTC'), "endsAt") - "startedAt"))::int), "reservedMinutes" * 60),
               "updatedAt" = (now() AT TIME ZONE 'UTC')
         WHERE "id" = ${id} AND "status" = 'live'`
    }
    return n
  }, { maxWait: 5_000, timeout: 30_000 })

  // ⛔ EACH TIDY-UP STEP ON ITS OWN (2c round 1, opus): one bad row in a later step must not stop the others, nor keep the
  // cron from stamping swept_at (which would close the classroom). Ending sessions, above, is the one step whose failure
  // DOES stop the run — then nothing is stamped, and the classroom closes itself within SWEEP_FRESH_S (fail closed).
  const step = (op: string, run: () => Promise<number>): Promise<number> =>
    run().catch((e) => { logError(quietError(e), { op: `classroom.sweep.${op}` }); return 0 })

  const assessFailed = await step('assess', () => db.$executeRaw`
    UPDATE "ClassroomTurn" SET "assessStatus" = 'failed', "updatedAt" = (now() AT TIME ZONE 'UTC')
     WHERE "assessStatus" = 'pending' AND "updatedAt" < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${ASSESS_STALE_S})`)

  // A turn still 'processing' this long after its reservation lost its process mid-reply: it is no answer (the learner
  // retried or moved on — a failed turn is skipped by the history and the report).
  const turnsFailed = await step('turns', () => db.$executeRaw`
    UPDATE "ClassroomTurn" SET "status" = 'failed', "updatedAt" = (now() AT TIME ZONE 'UTC')
     WHERE "status" = 'processing' AND "updatedAt" < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${ASSESS_STALE_S})`)

  // A one-use invite past its date stops working: the code is cleared, the seat stays for the teacher to re-invite.
  const invitesExpired = await step('invites', () => db.$executeRaw`
    UPDATE "ClassroomEnrollment" SET "inviteCode" = NULL, "updatedAt" = (now() AT TIME ZONE 'UTC')
     WHERE "status" = 'invited' AND "inviteCode" IS NOT NULL AND "inviteExpiresAt" < (now() AT TIME ZONE 'UTC')`)

  // A seat the teacher removed (or the learner left) keeps its sessions for LIMITS.removedRetentionDays, then they go —
  // reports, transcripts and plans with them (cascades). The seat row itself goes too: nothing of the learner is left.
  const seatsErased = await step('erase-seats', () => db.$executeRaw`
    DELETE FROM "ClassroomEnrollment"
     WHERE "status" = 'removed' AND "removedAt" < (now() AT TIME ZONE 'UTC') - make_interval(days => ${LIMITS.removedRetentionDays})`)
  // A teacher's own test sessions (their voice, written down) go after the same days (2a review, opus) — they belong to
  // no seat, so nothing above reaches them.
  const testsErased = await step('erase-tests', () => db.$executeRaw`
    DELETE FROM "ClassroomSession"
     WHERE "testerId" IS NOT NULL AND "status" = 'ended' AND "endedAt" < (now() AT TIME ZONE 'UTC') - make_interval(days => ${LIMITS.removedRetentionDays})`)
  // A learner who WITHDREW and has no seat left (every seat was removed, then erased above) goes too, after the same days
  // (2c round 2, opus) — their name, birth year and consent dates; the compliance log keeps the consent's record.
  const learnersErased = await step('erase-learners', () => db.$executeRaw`
    DELETE FROM "ClassroomLearner" l
     WHERE l."withdrawnAt" < (now() AT TIME ZONE 'UTC') - make_interval(days => ${LIMITS.removedRetentionDays})
       AND NOT EXISTS (SELECT 1 FROM "ClassroomEnrollment" e WHERE e."learnerId" = l."id")`)
  const erased = seatsErased + testsErased + learnersErased

  // Reports nobody built yet (the end route's after() died, or the session was abandoned) — a few per run.
  const reports = await step('reports', () => buildPendingFeedback(5))

  return { ended, assessFailed, turnsFailed, invitesExpired, erased, reports }
}
