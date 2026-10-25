import { route } from '@/lib/api/handler'
import { readClassroomConfig, resetClassroomConfigCache, stampClassroomSweep } from '@/lib/classroom/config'
import { sweepClassroom } from '@/lib/classroom/sweep'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ── eno CLASSROOM: THE SWEEP (plan "Concurrency, limits and budget") ─────────────────────────────────────────────────
//
// Every 5 minutes, on eno.vn only (one database serves both editions). Ends sessions nobody finished (past endsAt + 2 min
// — 'abandoned'), and with the switch read as OFF every live session ('kill_switch'); marks pronunciation scores still
// pending after 2 minutes as failed (their audio is gone: it lived only in memory); builds or retries feedback (≤ 3
// attempts); expires invites; erases sessions of seats removed more than 90 days ago. Then stamps classroom_config.swept_at
// — the precondition both writers of the switch check before turning the classroom on (config.ts SWEEP_FRESH_S).
// ⚠️ NOTHING DEPENDS ON THIS FOR CORRECTNESS: turns refuse a session past its deadline in SQL, and starts count live
// reservations whatever the sweep did. It tidies up, and turns sessions into reports when nobody tapped End.
// Answers {tables:false} until scripts/classroom-ddl.mjs has run on the database. 200 { ended, feedback, … }.

export const GET = route({ auth: 'cron' }, async () => {
  // A FRESH read, never this process's cache (the calls sweep's rule: two editions, two caches, one database).
  resetClassroomConfigCache()
  const config = await readClassroomConfig()
  // ⚠️ Only a switch that was actually READ as off ends live sessions — never a failed read.
  const killAll = config.readOk && config.mode === 'off'
  try {
    const result = await sweepClassroom({ killAll })
    await stampClassroomSweep()
    return { ...result, killAll }
  } catch (e) {
    if (e instanceof Error && /42P01|"Classroom\w*" does not exist|classroom_config" does not exist/.test(e.message)) return { tables: false }
    throw e
  }
})
