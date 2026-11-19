import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ⛔ MOVED TO /api/cron/digest-daily (owner, 2026-11-19: at most 90 a day, never to partners — src/lib/digest-schedule.ts).
 * This path stays as a NO-OP on purpose, for both directions of a mismatch between the box's timers and the deployed code:
 *   · the old Thursday timer calling this revision sends nothing (rather than one day's share of the list);
 *   · a rollback to an older revision leaves the new daily timer calling /digest-daily, which that revision does not have,
 *     so it 404s and sends nothing. A daily timer pointed at THIS path on old code would have mailed everyone every day.
 * Never put a send back here.
 */
export const GET = route({ auth: 'cron' }, async () => ({ ok: true, skipped: 'moved', to: '/api/cron/digest-daily' }))
