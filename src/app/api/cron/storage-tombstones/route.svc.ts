import { route } from '@/lib/api/handler'
import { sweepTombstones } from '@/lib/core/storage-tombstones-sweep.svc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // up to 5 × 200 rows, each a reference check + a storage call; eno-cron.sh allows 900s

// Drains the durable erasure queue (public."StorageTombstone" — see src/lib/core/storage-tombstones.ts):
// objects that account deletion, visa document replacement or visa case deletion could not remove
// on their own fast path. Installed as a systemd timer by infra/vn-node/cron/install-cron-timers.sh,
// which calls it on the SERVICES container (eno.forum, :3002) — this is a `.svc.` route: the sweep
// must know the visa documents table to judge a visa tombstone, and that vocabulary does not
// compile into the marketplace image. One edition is enough: shared database, shared buckets.
//
// Response `{ ok, removed, dropped, failed, skipped, remaining, queued, checkedAt }` 200. `failed > 0`
// is still a 200 — the rows stay queued with attempts/lastError, backed off, and the next run retries;
// the numbers reach the timer's journal line. Auth failures are `route()`'s standard 401.
export const GET = route({ auth: 'cron' }, async () => {
  const result = await sweepTombstones()
  return { ok: true, ...result, checkedAt: new Date().toISOString() }
})
