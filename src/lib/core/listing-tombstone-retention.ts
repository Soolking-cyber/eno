import 'server-only'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/compliance/audit'
import { LISTING_REMOVED } from '@/lib/listing-removed'
import { PERSONAL_SCRUB_DATA, mediaUrlsOf } from '@/lib/core/listing-tombstone'
import { writeTombstones } from '@/lib/core/storage-tombstones'
import { listingObjectKey } from '@/lib/listing-image'

/**
 * ── THE RETENTION END OF A LISTING TOMBSTONE ─────────────────────────────────────────────────────
 *
 * Since 2026-10-01 a removed listing is a TOMBSTONE that keeps what was posted (src/lib/listing-removed.ts)
 * — Law 122/2025 Art 17.1(e) keeps posted information for at least a year, and the published Quy chế
 * keeps the platform's records "at least 3 years from the date they arise" (regulations/page.tsx,
 * Article 4 and the data-protection article). But the Privacy Policy also says personal data is kept
 * "only while the purpose it was collected for still exists" and deleted when it is fulfilled
 * (privacy/page.tsx, "How long we keep your data"). With no end, a tombstone would make that false the
 * day its retention lapsed. This is the end (2026-10-01, review).
 *
 * WHAT IT DOES: a tombstone whose removal is older than LISTING_TOMBSTONE_RETENTION_DAYS has its
 * personal content blanked (PERSONAL_SCRUB_DATA — the same blanking a teacher's profile delete gets at
 * once) and its first-party photos and video queued for the storage sweep (StorageTombstone,
 * /api/cron/storage-tombstones). The ROW stays — reports, orders and conversations point at it, and
 * Order is onDelete:Restrict — as a bare record that a listing existed and was removed.
 *
 * ⛔ JOURNALED IN THE HASH-CHAINED AUDIT LOG, IN THE SAME TRANSACTION: one `listing.purged` row per
 * listing (no PII — the id, when it was removed, the period applied). A scrub without its audit row
 * would be an unexplained gap in the record this table exists to keep.
 *
 * ⛔ THE INVESTIGATION HOLD — the same predicate account erasure applies (core/account-erasure.ts): a
 * tombstone is NOT scrubbed while a report about the listing, its storefront or its owner is open,
 * while the owner is held or suspended or carries a compliance flag (an authority hold), or while the
 * listing itself is under a compliance review or an authority takedown order. Those are counted as
 * `held` and retried every run; nothing here can make a case disappear.
 *
 * WHEN A LISTING WAS REMOVED: the newest `listing.removed` audit row (written with every tombstone,
 * src/lib/core/listing-tombstone.ts). A tombstone without one (a status set by hand) falls back to its
 * updatedAt — never earlier than the real removal, so the fallback can only keep data LONGER.
 *
 * ⚠️ NOTHING IS ELIGIBLE BEFORE 2029-10-01: no tombstone existed before 2026-10-01 (measured that day:
 * 0 rows with status 'removed', 0 `listing.removed` audit rows). The job is installed now so that date
 * does not depend on anyone remembering it.
 */

/** ≥ 3 years ("at least 3 years from the date they arise"), plus the leap day a 3-year span can hold. */
export const LISTING_TOMBSTONE_RETENTION_DAYS = 3 * 365 + 1
const DAY_MS = 24 * 60 * 60 * 1000
const PAGE = 500
/** Scrubs per run. Each is one audit append on the chain's advisory lock — bounded, and retried tomorrow. */
const MAX_PER_RUN = 1000
const TX_BATCH = 100

export type ListingRetentionResult = {
  /** Tombstones blanked this run. */
  scrubbed: number
  /** Past retention but under an investigation hold — kept, retried next run. */
  held: number
  /** Past retention, not held, not reached this run (over MAX_PER_RUN) — a backlog. */
  remaining: number
  /** Past retention by updatedAt with no `listing.removed` audit row (status set outside the app). */
  noAuditRow: number
}

/** A tombstone that has already been blanked — every personal column at its scrubbed value. */
const SCRUBBED = { AND: [{ title: PERSONAL_SCRUB_DATA.title }, { description: '' }, { images: '[]' }, { video: null }, { searchText: '' }] }

export async function sweepListingTombstoneRetention(now: Date = new Date()): Promise<ListingRetentionResult> {
  const cutoff = new Date(now.getTime() - LISTING_TOMBSTONE_RETENTION_DAYS * DAY_MS)
  const result: ListingRetentionResult = { scrubbed: 0, held: 0, remaining: 0, noAuditRow: 0 }
  const eligible: { id: string; removedAt: Date }[] = []
  let cursor: string | undefined
  for (;;) {
    // edition-lint-allow: a retention sweep over every tombstone, both editions' — they share one
    // database, and neither edition may keep a lapsed record of the other's. Nothing here is rendered.
    const page = await db.listing.findMany({
      where: { status: LISTING_REMOVED, NOT: SCRUBBED },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, updatedAt: true },
    })
    if (!page.length) break
    cursor = page[page.length - 1].id
    const removedAt = new Map<string, Date>()
    for (const a of await db.complianceAudit.findMany({
      where: { action: 'listing.removed', subjectType: 'listing', subjectId: { in: page.map((l) => l.id) } },
      select: { subjectId: true, occurredAt: true },
    })) {
      const prev = removedAt.get(a.subjectId)
      if (!prev || a.occurredAt > prev) removedAt.set(a.subjectId, a.occurredAt)
    }
    for (const l of page) {
      const at = removedAt.get(l.id)
      if (!at) {
        if (l.updatedAt < cutoff) { result.noAuditRow++; eligible.push({ id: l.id, removedAt: l.updatedAt }) }
      } else if (at < cutoff) eligible.push({ id: l.id, removedAt: at })
    }
  }
  if (!eligible.length) return result

  for (let i = 0; i < eligible.length; i += TX_BATCH) {
    const batch = eligible.slice(i, i + TX_BATCH)
    if (result.scrubbed >= MAX_PER_RUN) { result.remaining += batch.length; continue }
    const ids = batch.map((e) => e.id)
    // edition-lint-allow: the ids above, read again for the hold — an internal sweep, never rendered.
    const rows = await db.listing.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, sellerId: true, complianceStatus: true, takedownOrderId: true,
        seller: { select: { ownerId: true, owner: { select: { enforcementState: true, complianceFlag: true } } } },
      },
    })
    const sellerIds = [...new Set(rows.map((r) => r.sellerId))]
    const ownerIds = [...new Set(rows.map((r) => r.seller.ownerId).filter((o): o is string => !!o))]
    const open = await db.report.findMany({
      where: { status: 'open', OR: [{ listingId: { in: ids } }, { targetSellerId: { in: sellerIds } }, ...(ownerIds.length ? [{ targetProfileId: { in: ownerIds } }] : [])] },
      select: { listingId: true, targetSellerId: true, targetProfileId: true },
    })
    const heldIds = new Set<string>()
    for (const r of rows) {
      const owner = r.seller.owner
      const onHold =
        open.some((o) => o.listingId === r.id || o.targetSellerId === r.sellerId || (!!r.seller.ownerId && o.targetProfileId === r.seller.ownerId))
        || ['held', 'suspended'].includes(owner?.enforcementState ?? '')
        || !!owner?.complianceFlag
        || ['under_review', 'taken_down'].includes(r.complianceStatus)
        || !!r.takedownOrderId
      if (onHold) heldIds.add(r.id)
    }
    result.held += heldIds.size
    const go = batch.filter((e) => !heldIds.has(e.id) && rows.some((r) => r.id === e.id))
    if (!go.length) continue
    result.scrubbed += await db.$transaction(async (tx) => {
      // edition-lint-allow: the same internal sweep's re-read inside its write transaction.
      const before = await tx.listing.findMany({
        // Re-checked INSIDE the write's transaction: still a tombstone, still not scrubbed, no report
        // opened on it since the hold check above.
        where: { id: { in: go.map((e) => e.id) }, status: LISTING_REMOVED, NOT: SCRUBBED, reports: { none: { status: 'open' } } },
        select: { id: true, images: true, video: true },
      })
      if (!before.length) return 0
      const changed = await tx.listing.updateManyAndReturn({
        where: { id: { in: before.map((b) => b.id) }, status: LISTING_REMOVED, reports: { none: { status: 'open' } } },
        data: PERSONAL_SCRUB_DATA,
        select: { id: true },
      })
      // Only what THIS write blanked gets its media queued and its audit row.
      const done = new Set(changed.map((c) => c.id))
      const scrubbed = before.filter((b) => done.has(b.id))
      const refs = scrubbed.flatMap(mediaUrlsOf).map((u) => listingObjectKey(u)!).map((k) => ({ bucket: k.bucket, path: k.key }))
      if (refs.length) await writeTombstones(tx, refs, 'listing_retention_expired')
      const at = new Map(go.map((e) => [e.id, e.removedAt]))
      for (const b of scrubbed) {
        await appendAudit(tx, {
          actorType: 'system',
          actorId: 'cron:listing-tombstone-retention',
          action: 'listing.purged',
          subjectType: 'listing',
          subjectId: b.id,
          detail: { reason: 'retention_expired', removedAt: at.get(b.id)!.toISOString(), retentionDays: LISTING_TOMBSTONE_RETENTION_DAYS, mediaQueued: mediaUrlsOf(b).length },
          legalBasis: 'ecommerceLaw',
        })
      }
      return scrubbed.length
    }, { timeout: 60_000 })
  }
  return result
}
