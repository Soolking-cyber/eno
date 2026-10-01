import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { sweepListingTombstoneRetention } from '@/lib/core/listing-tombstone-retention'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // up to 1,000 scrubs, each one audit append; eno-cron.sh allows 900s

// Retention end for LISTING TOMBSTONES (src/lib/core/listing-tombstone-retention.ts): a removed
// listing past its retention period has its personal content blanked and its media queued for the
// storage sweep, journaled in compliance_audit. Nothing is eligible before 2029-10-01 (no tombstone
// existed before 2026-10-01).
//
// Installed as a systemd timer by infra/vn-node/cron/install-cron-timers.sh; the box calls it on
// 127.0.0.1 with the app's CRON_SECRET. One edition is enough — pure database work on the shared
// project, idempotent, no per-container cache to flush.
//
// Response: `{ ok, scrubbed, held, remaining, noAuditRow, checkedAt }`. ⛔ A BACKLOG (`remaining > 0`)
// is a **500** with the same body, like business-verification-retention: personal data held past its
// date behind a green journal is the outcome to avoid, and eno-cron.sh exits non-zero on anything but
// 200, so the unit shows FAILED until the backlog drains. `held` (an investigation hold) is NOT a
// failure — keeping evidence while a case is open is the rule working. Auth failures are `route()`'s 401.
export const GET = route({ auth: 'cron' }, async () => {
  const result = await sweepListingTombstoneRetention()
  const ok = result.remaining === 0
  const body = { ok, ...result, checkedAt: new Date().toISOString() }
  return ok ? body : NextResponse.json(body, { status: 500 })
})
