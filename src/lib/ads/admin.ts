import 'server-only'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/compliance/audit'
import { logError } from '@/lib/log'
import { usdcText } from '@/lib/x402/config'
import { invalidateAdServeCache } from './serve'
import { removeAdImage } from './creative-review'
import { spendAtomic } from './stats'
import { adLockKey } from './book'

/**
 * ── ENO TAKES AN AD DOWN (owner 2026-11-25; the advertising policy's "Removal and refunds"). One creative, for good:
 *   1. in ONE transaction: the creative `removed` (removedAt, removedReason, its picture's URL cleared), every run of it
 *      that has not finished ENDED NOW — a run under way stops at this moment, one stacked after it ends where it would
 *      have started (it never runs) — and the audit row (`ad.creative.removed`, on the advertiser's shop);
 *   2. this process's serving set is read again at once (the other edition's within its 15 s), and the feed's edge copy
 *      with a creative lives 45 s: it stops showing within a minute;
 *   3. eno's copy of the picture is deleted (best effort; nothing else ever deletes an `ads/` object).
 * ⛔ NO AUTOMATIC REFUND: what each ended run did not use (its price pro rata to the time cut off) is returned to the
 * admin and written into the audit row, for the manual pro-rata refund the policy promises on request — and so is every
 * run whose payment is not confirmed yet (`settled: false`): should it settle, it never starts and is refunded whole.
 * A removed creative is never served, booked or activated again, and the same content is answered `removed` at any age.
 */
/** `settled: false` — a payment not confirmed yet (pending / unknown / under review): if it settles, the run never starts
 *  (book.ts activate sends it to review) and the whole price is the refund. */
export type RemovedAd = { adId: string; paid_usdc: string; unused_usdc: string; settled: boolean }

export async function removeAdCreative(creativeId: string, admin: string, reason: string, now = new Date()): Promise<{ alreadyRemoved: boolean; refunds: RemovedAd[] } | null> {
  const result = await db.$transaction(async (tx) => {
    // ⛔ THE LOCK ACTIVATION TAKES (book.ts adLockKey `creative-ad:<id>`): a payment settling this very moment either
    // activates before this (and its run is ended below) or after it (and sees the creative removed: never runs, review).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${adLockKey({ listingId: null, creativeId })}))`
    const c = await tx.adCreative.findUnique({ where: { id: creativeId }, select: { id: true, sellerId: true, status: true, imageUrl: true } })
    if (!c) return null
    // ⛔ THE GUARDED WRITE FIRST: of two admins removing at once, one changes the row and the other is told it was already
    // removed — never two audit rows or the same refund twice.
    const won = await tx.adCreative.updateMany({ where: { id: creativeId, status: { not: 'removed' } }, data: { status: 'removed', removedAt: now, removedReason: reason, imageUrl: '' } })
    if (!won.count) return { alreadyRemoved: true, refunds: [] as RemovedAd[], imageUrl: '' }
    const imageUrl = c.imageUrl
    const runs = await tx.listingAd.findMany({
      where: { creativeId, OR: [{ status: 'active', endsAt: { gt: now } }, { status: { in: ['pending', 'unknown', 'review'] } }] },
      select: { id: true, amount: true, startsAt: true, endsAt: true, status: true },
    })
    const refunds: RemovedAd[] = runs.map((r) => {
      const settled = r.status === 'active'
      const used = settled ? spendAtomic(r, now) : BigInt(0)
      return { adId: r.id, paid_usdc: usdcText(r.amount), unused_usdc: usdcText((BigInt(r.amount) - used).toString()), settled }
    })
    // A run under way ends now; a run stacked after it ends at its own start (it never runs).
    await tx.listingAd.updateMany({ where: { creativeId, status: 'active', startsAt: { lte: now }, endsAt: { gt: now } }, data: { endsAt: now } })
    await tx.$executeRaw`UPDATE "ListingAd" SET "endsAt" = "startsAt" WHERE "creativeId" = ${creativeId} AND "status" = 'active' AND "startsAt" > ${now}`
    await appendAudit(tx, {
      actorType: 'admin',
      actorId: admin,
      action: 'ad.creative.removed',
      subjectType: 'seller',
      subjectId: c.sellerId,
      detail: { creativeId, reason, refunds },
      legalBasis: 'ecommerceLaw',
    })
    return { alreadyRemoved: false, refunds, imageUrl }
  })
  if (!result) return null
  invalidateAdServeCache()
  if (result.imageUrl) await removeAdImage(result.imageUrl).catch((e: unknown) => logError(e, { op: 'ads.remove.image' }))
  return { alreadyRemoved: result.alreadyRemoved, refunds: result.refunds }
}
