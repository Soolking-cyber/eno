import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { ApiError } from '@/lib/api/handler'
import { logError } from '@/lib/log'
import { BUDGET_LOCK } from './budget'
import { buildFeedback, SETTLE_MS } from './feedback'

/**
 * END A SESSION — the learner tapped End, or the page's clock ran out. Once only (`WHERE status = 'live'`), under the
 * budget lock (what it releases is never read half-written by a start). Then the report: built in after(), once the last
 * turn's pronunciation score has settled (feedback.ts SETTLE_MS) — the sweep builds it if this process does not.
 */
export async function endSession(sessionId: string, accountId: string, reason: 'learner' | 'time', now = new Date()): Promise<{ ended: boolean }> {
  const s = await db.classroomSession.findUnique({
    where: { id: sessionId },
    select: { id: true, testerId: true, status: true, learner: { select: { ownerId: true } } },
  })
  if (!s || !(s.testerId === accountId || s.learner?.ownerId === accountId)) throw new ApiError('session_not_found', 404)
  const n = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${BUDGET_LOCK}, 0))`
    // ⛔ AND THE SESSION'S LOCK — the one a turn reserves under (2a round 2, codex + opus): a turn either reserved before
    // this end (it is 'processing', and the report waits for it) or sees the session ended and is refused. Order: budget,
    // then session — a turn takes only the session's, so the two never wait on each other in a circle.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-session:${sessionId}`}, 0))`
    return tx.$executeRaw`
      UPDATE "ClassroomSession"
         SET "status" = 'ended', "endedAt" = (now() AT TIME ZONE 'UTC'), "endReason" = ${reason},
             "usedSeconds" = LEAST(GREATEST(0, EXTRACT(EPOCH FROM (LEAST((now() AT TIME ZONE 'UTC'), "endsAt") - "startedAt"))::int), "reservedMinutes" * 60),
             "updatedAt" = (now() AT TIME ZONE 'UTC')
       WHERE "id" = ${sessionId} AND "status" = 'live'`
  }, { maxWait: 10_000, timeout: 20_000 }) // a kill-switch sweep may hold the budget lock a moment (2a round 6, opus)
  if (n) {
    after(async () => {
      // Wait out the last score (polling the turn rows — no audio is held here), then build; the sweep is the backstop.
      const deadline = Date.now() + SETTLE_MS
      for (;;) {
        // 'waiting' = a score is still pending; anything else (ready, or a failed attempt the sweep will retry) ends it.
        const r = await buildFeedback(sessionId).catch((e) => { logError(e, { op: 'classroom.feedback.after' }); return 'failed' as const })
        if (r !== 'waiting' || Date.now() > deadline) break
        await new Promise((ok) => setTimeout(ok, 4_000))
      }
    })
  }
  return { ended: n > 0 }
}
