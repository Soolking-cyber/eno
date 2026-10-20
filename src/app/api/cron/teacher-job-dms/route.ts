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
 * The answer stays under 200 bytes (eno-cron.sh prints only the first 200). ⚠️ A dry run's ready/held are the RULES'
 * counts only: Laya is not asked on a dry run (run.ts) — and it decides nothing anyway (facts.ts LAYA_ROLE).
 */
export const GET = route({ auth: 'cron' }, async ({ req }) => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'marketplace_only' }
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const r = await runJobDms({ dryRun })
  // A run with no operator, or one that found the run lock held, does nothing — not even STOPs: a failure to see, not a
  // quiet success (codex, gates 3c + 3f).
  // ⚠️ 'deadline' too: a run that ran out of time left teachers unread — the next run continues, but it is visible.
  return { ok: r.failed === 0 && r.stopped !== 'no-operator' && r.stopped !== 'busy' && r.stopped !== 'deadline', m: r.mode, pz: r.paused ?? 0, rd: r.read, rdy: r.ready, h: r.held, d: r.dropped, x: r.expired, t: r.teachers, s: r.sent, sh: r.shadow, sk: r.skipped, f: r.failed, st: r.stops, ...(r.stopped ? { stop: r.stopped } : {}) }
})
