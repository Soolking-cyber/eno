import { route } from '@/lib/api/handler'
import { TEACHER_DRAFT_RETENTION_DAYS, purgeStaleTeacherDrafts } from '@/lib/teachers/draft'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Retention for unfinished teacher profiles (src/lib/teachers/draft.ts, owner 2026-10-11): a draft untouched for
// TEACHER_DRAFT_RETENTION_DAYS is deleted — what /privacy promises, on a schedule rather than whenever someone looks.
//
// Installed as a systemd timer by infra/vn-node/cron/install-cron-timers.sh; the box calls it on 127.0.0.1 with the app's
// CRON_SECRET. One edition is enough — database work on the shared project, idempotent.
export const GET = route({ auth: 'cron' }, async () => {
  const deleted = await purgeStaleTeacherDrafts()
  return { ok: true, deleted, retentionDays: TEACHER_DRAFT_RETENTION_DAYS, checkedAt: new Date().toISOString() }
})
