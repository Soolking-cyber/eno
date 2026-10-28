import { route } from '@/lib/api/handler'
import { TEACHER_DRAFT_RETENTION_DAYS, purgeStaleTeacherDrafts } from '@/lib/teachers/draft'
import { sweepZalo } from '@/lib/teachers/zalo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Retention for unfinished teacher profiles (src/lib/teachers/draft.ts, owner 2026-10-11): a draft untouched for
// TEACHER_DRAFT_RETENTION_DAYS is deleted — what /privacy promises, on a schedule rather than whenever someone looks.
// Also "Zalo for urgent cover" (2026-10-28 — src/lib/teachers/zalo.ts sweepZalo): connection codes erased and a deleted
// profile's counts deleted once their day is over, and a number whose cover is no longer on deleted — /privacy's terms.
//
// Installed as a systemd timer by infra/vn-node/cron/install-cron-timers.sh; the box calls it on 127.0.0.1 with the app's
// CRON_SECRET. One edition is enough — database work on the shared project, idempotent.
export const GET = route({ auth: 'cron' }, async () => {
  // "Zalo for urgent cover" retention (2026-10-28 — zalo.ts sweepZalo): connection codes and a deleted profile's counts
  // after their day, and any number whose cover is switched off. The same daily run (already enabled on the box) — and
  // ⛔ INDEPENDENT of the draft purge (review round 4): one failing never skips the other; a failure still answers 500.
  const [drafts, zalo] = await Promise.allSettled([purgeStaleTeacherDrafts(), sweepZalo()])
  if (drafts.status === 'rejected') throw drafts.reason
  if (zalo.status === 'rejected') throw zalo.reason
  return { ok: true, deleted: drafts.value, retentionDays: TEACHER_DRAFT_RETENTION_DAYS, zalo: zalo.value, checkedAt: new Date().toISOString() }
})
