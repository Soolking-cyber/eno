import { route } from '@/lib/api/handler'
import { IS_MARKETPLACE } from '@/lib/edition'
import { runJobDms } from '@/lib/teachers/job-dms/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/**
 * TEACHER JOB DMs (owner, 2026-10-20) — every 30 minutes, 08:00–20:30 Vietnam time (a POLICY timer: installed, enabled by
 * hand after a dry run). What one run does, and its modes: src/lib/teachers/job-dms/run.ts. `?dryRun=1` = counts only.
 * Teachers live on eno.vn only — marketplace edition; the box timer is pinned to eno.vn:3001.
 * The answer stays under 200 bytes (eno-cron.sh prints only the first 200).
 */
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const r = await runJobDms({ dryRun })
  return { ok: r.failed === 0, m: r.mode, rd: r.read, rdy: r.ready, h: r.held, d: r.dropped, x: r.expired, t: r.teachers, s: r.sent, sh: r.shadow, sk: r.skipped, f: r.failed, st: r.stops, ...(r.stopped ? { stop: r.stopped } : {}) }
})
