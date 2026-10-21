import { after } from 'next/server'
import { route } from '@/lib/api/handler'
import { readCallsConfig, resetCallsConfigCache } from '@/lib/calls/server/config'
import { purgeOldTelemetry, stampSweep, sweepStale } from '@/lib/calls/server/session'
import { afterCallEnded } from '@/lib/calls/server/finish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── IN-APP CALLS: THE SWEEP (DESIGN.md v3 §3.2 steps 7 and 10) ─────────────────────────────────────────────────────
//
// Every minute. Ends what is no longer fresh — ringing past 45 s ('missed'), answered with a heartbeat older than
// 45 s ('lost'), connected past the 2 h cap ('cap_reached') — writes each record, revokes its relay credentials and
// frees its rows. With the switch OFF it ends EVERY live call ('kill_switch') — the backstop: a call anyone is still
// beating already ended at its next heartbeat (eligibility.ts liveCallRefusal), no rebuild.
// ⚠️ NOTHING DEPENDS ON THIS RUNNING FOR CORRECTNESS. Busy checks read freshness in SQL, and the call routes end a
// stale call the moment either side is heard from; this only tidies up after calls nobody is touching any more.
// It also drops telemetry older than TELEMETRY_RETENTION_DAYS (session.ts — provisional until counsel sets the window;
// call_session rows themselves are kept until then: Decree 333/2026 Art 16.6 wants ≥ 12 months of system logs).
// One run is enough for both editions (one database). 200 { ended, killAll, telemetryPurged }.

export const GET = route({ auth: 'cron' }, async () => {
  // A FRESH read, never this process's cache: the other edition may have just switched calls back on, and a cached
  // 'off' here would end the calls it started (commit-gate review — two editions, two caches, one database).
  resetCallsConfigCache()
  const config = await readCallsConfig()
  // ⚠️ Only a switch that was actually READ as off kills live calls — never a failed read (config.ts readOk).
  const killAll = config.readOk && config.mode === 'off'
  let ended: Awaited<ReturnType<typeof sweepStale>>
  try {
    ended = await sweepStale({ killAll, limit: 500 })
  } catch (e) {
    // A database the calls DDL has not reached yet has nothing to sweep (scripts/calls-ddl.mjs).
    if (e instanceof Error && /42P01|call_session" does not exist/.test(e.message)) return { ended: 0, killAll, tables: false }
    throw e
  }
  for (const { row, reason } of ended) after(() => afterCallEnded(row, reason))
  const telemetryPurged = await purgeOldTelemetry()
  // "The sweep is running" — the precondition both writers of the switch check before turning calls on.
  await stampSweep()
  return { ended: ended.length, killAll, telemetryPurged }
})
