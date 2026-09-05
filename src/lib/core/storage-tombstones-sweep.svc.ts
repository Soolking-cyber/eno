import { db } from '@/lib/db'
import { BUSINESS_VERIFICATION_BUCKET, LISTINGS_BUCKET, LISTING_VIDEOS_BUCKET, getSupabaseAdmin } from '@/lib/supabase-admin'
import { STORAGE_HOST } from '@/lib/listing-image'
import { isStillReferenced } from '@/lib/core/storage-purge'
import { VISA_BUCKET } from '@/lib/visa/storage'
import { logError } from '@/lib/log'
import { TOMBSTONE_GRACE_MS } from '@/lib/core/storage-tombstones'

// ── THE TOMBSTONE SWEEP (services edition only — see storage-tombstones.ts) ───────────────────
//
// ⛔ THE SWEEP RE-CHECKS REFERENCES, PER BUCKET, BEFORE IT DELETES. A tombstone is an intent,
// not a verdict: the flat public buckets have no owner namespace (another user's row may
// legitimately point at the same object), a visa upload is tombstoned before its row exists, and
// a refused case deletion leaves its tombstones behind. Referenced → the tombstone is DROPPED.
//
// ⛔ A ROW IS CLAIMED BEFORE IT IS JUDGED. The grace is only as good as the moment it is read:
// a writer can refresh a tombstone's clock while a batch is running (a re-upload to a reused
// path, a second erasure touching a shared object), and a sweep that judged the row a second
// earlier would then delete the fresh object and drop the refreshed tombstone. So each row is
// first CLAIMED by a compare-and-set on the `notBefore` that was read (moving it out by a lease),
// judged only if the claim landed, and its tombstone deleted only while the lease is still the
// row's clock. A refreshed row fails the claim and is left for the next run.
//
// ⚠️ FAILURES BACK OFF IN DAYS, NOT HOURS. The timer is daily; an hourly back-off is "due again
// tomorrow", so 200 permanent failures (an unknown bucket, a permission error) would retake the
// head of the line every run. 1, 2, 4 … days, capped at 30, moves them out of the way of the rows
// that can be finished, without ever forgetting them.

const CLAIM_LEASE_MS = TOMBSTONE_GRACE_MS
/** A reference check that outlives this is `unknown`, never `unreferenced`. */
const REF_CHECK_TIMEOUT_MS = 8_000
const DAY_MS = 24 * 60 * 60 * 1000
const BATCH = 200
const MAX_BATCHES = 5

type Verdict = 'referenced' | 'unreferenced' | 'unknown'

/** Is the object still pointed at by any live row? Per bucket, because each bucket has its own
 *  notion of a reference. `unknown` (a failed check) must never delete. */
async function referenceVerdict(bucket: string, path: string): Promise<Verdict> {
  switch (bucket) {
    case LISTINGS_BUCKET:
    case LISTING_VIDEOS_BUCKET: {
      // Flat, shared namespace: any surviving row of any user counts (see storage-purge.ts —
      // listing images AND the listing video, both seller images, the profile avatar).
      if (!STORAGE_HOST) return 'unknown'
      // Bounded: five `LIKE '%…%'` scans; a slow database must read as "unknown", never "unreferenced".
      const timeout = new Promise<'unknown'>((resolve) => setTimeout(() => resolve('unknown'), REF_CHECK_TIMEOUT_MS))
      return Promise.race([
        isStillReferenced(`${STORAGE_HOST}/storage/v1/object/public/${bucket}/${path}`).then((r): Verdict => (r ? 'referenced' : 'unreferenced'), (): Verdict => 'unknown'),
        timeout,
      ])
    }
    case VISA_BUCKET: {
      const { data, error } = await getSupabaseAdmin().from('visa_documents').select('id').eq('storage_path', path).limit(1)
      if (error) return 'unknown'
      return data?.length ? 'referenced' : 'unreferenced'
    }
    case BUSINESS_VERIFICATION_BUCKET:
      // One owner per object — every path here is minted under the owner's profile id — and a
      // tombstone in this bucket is only ever written by an erasure already decided (account
      // deletion). Nothing to re-check.
      return 'unreferenced'
    default:
      throw new Error('unknown_bucket')
  }
}

export type TombstoneSweep = { removed: number; dropped: number; failed: number; skipped: number; remaining: number; queued: number }

/** Drain due tombstones: delete what is unreferenced, drop what is referenced, keep (and count)
 *  what could not be settled. A failure never loses the record — attempts/lastError go on the row,
 *  and the clock backs off. `remaining` = still due after this run; `queued` = every row that
 *  exists, due or not, so a backlog that has backed off is still visible to an operator. */
export async function sweepTombstones(now = new Date(), limit = BATCH): Promise<TombstoneSweep> {
  let removed = 0
  let dropped = 0
  let failed = 0
  let skipped = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const due = await db.storageTombstone.findMany({
      where: { notBefore: { lt: now } },
      orderBy: { notBefore: 'asc' },
      take: limit,
      select: { id: true, bucket: true, path: true, attempts: true, notBefore: true },
    })
    if (!due.length) break
    let moved = 0
    for (const t of due) {
      // CLAIM: the row is ours only if its clock is still the one we read.
      const lease = new Date(now.getTime() + CLAIM_LEASE_MS)
      const claim = await db.storageTombstone.updateMany({ where: { id: t.id, notBefore: t.notBefore }, data: { notBefore: lease } })
      if (claim.count !== 1) { skipped++; moved++; continue } // refreshed or taken meanwhile — next run
      try {
        const verdict = await referenceVerdict(t.bucket, t.path)
        if (verdict === 'unknown') throw new Error('reference_check_failed')
        if (verdict === 'referenced') {
          await db.storageTombstone.deleteMany({ where: { id: t.id, notBefore: lease } })
          dropped++; moved++
          continue
        }
        // ⛔ THE LEASE IS CHECKED AGAIN RIGHT BEFORE THE OBJECT GOES. The claim above guards the row;
        // a writer that refreshed the clock AFTER the claim (an intent for the same path) would
        // otherwise see its fresh object removed by a verdict that predates its row. Every writer
        // mints unique paths (uuids, timestamps + random), so this is belt and braces — cheap ones.
        const still = await db.storageTombstone.updateMany({ where: { id: t.id, notBefore: lease }, data: { notBefore: lease } })
        if (still.count !== 1) { skipped++; moved++; continue }
        // Absent already is not an error for Supabase's remove(): the object simply is not listed
        // in `data`. Absent is the end state this sweep exists to reach.
        const { error } = await getSupabaseAdmin().storage.from(t.bucket).remove([t.path])
        if (error) throw new Error(`storage_remove_failed: ${error.message}`)
        await db.storageTombstone.deleteMany({ where: { id: t.id, notBefore: lease } })
        removed++; moved++
      } catch (e) {
        failed++; moved++
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 200)
        const retryIn = Math.min(DAY_MS * 2 ** t.attempts, 30 * DAY_MS)
        await db.storageTombstone.updateMany({
          where: { id: t.id, notBefore: lease },
          data: { attempts: { increment: 1 }, lastError: message, notBefore: new Date(now.getTime() + retryIn) },
        }).catch((err) => logError(err, { op: 'storage-tombstones.mark-failed' }))
        // Bucket and tombstone id only — a KYC path carries a profile id and does not belong in a log.
        console.error('[storage-tombstones] not finished — backed off', t.bucket, t.id, message)
      }
    }
    if (due.length < limit || moved === 0) break
  }
  const [remaining, queued] = await Promise.all([
    db.storageTombstone.count({ where: { notBefore: { lt: now } } }),
    db.storageTombstone.count(),
  ])
  return { removed, dropped, failed, skipped, remaining, queued }
}
