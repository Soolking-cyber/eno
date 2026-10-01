import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { appendAudit } from '@/lib/compliance/audit'
import { LISTING_REMOVED } from '@/lib/listing-removed'
import { listingObjectKey } from '@/lib/listing-image'
import { writeTombstones, type TombstoneReason } from '@/lib/core/storage-tombstones'

/**
 * Write listing TOMBSTONES — the one replacement for every `DELETE FROM "Listing"` a person can
 * trigger (seller delete, moderation reject, admin bulk remove). See src/lib/listing-removed.ts for
 * why there is no hard delete and how a tombstone stays invisible.
 *
 * ⛔ RUNS INSIDE THE CALLER'S TRANSACTION, AND THE AUDIT ROW COMMITS WITH THE STATUS CHANGE. The
 * "who and why" lives in compliance_audit (hash-chained, UPDATE/DELETE blocked by rules —
 * src/lib/compliance/audit.ts), because the Listing table has no column for it and none is added
 * here. A tombstone without its audit row would be a removal nobody can explain.
 *
 * ⛔ IDEMPOTENT. A row already removed (or missing) is skipped, not re-stamped, and gets no second
 * audit row; the returned list is exactly the rows THIS call transitioned, which is what callers
 * count and what their side effects (brand counts, purge, de-index, webhooks) must run over.
 *
 * Account ERASURE is deliberately not routed here: erasing a person's account is the one flow that
 * must truly delete (core/account-erasure.ts), and it still does.
 */

export type RemovalActor =
  /** The storefront owner, through the dashboard, the partner API or MCP. */
  | { kind: 'seller'; profileId: string | null; sellerId: string }
  /** A moderator rejecting a listing from the moderation queue. */
  | { kind: 'moderator'; email: string }
  /** An admin removing listings from the admin listings console. */
  | { kind: 'admin'; email: string }

export type RemovalReason = 'seller_deleted' | 'moderation_rejected' | 'admin_removed'

export type RemovedRow = {
  id: string; sellerId: string; brandSlug: string | null; priorStatus: string; video: string | null
  /** Set only on a SCRUBBED tombstone: the first-party media URLs it no longer references, for the
   *  caller's fast-path purge (their StorageTombstones are already written in the same transaction). */
  scrubbedMedia?: string[]
}

/** What a tombstone writes. Exported for the tests and for anyone auditing the shape. */
export const TOMBSTONE_DATA = { status: LISTING_REMOVED, verified: false, identityHold: false, featured: false } as const

/**
 * ⛔ A PERSON IS NOT A GOODS ADVERTISEMENT — WHAT A PERSONAL-DATA TOMBSTONE ALSO BLANKS (2026-10-01,
 * review). A teacher's listing IS their profile: the title is their full name, the description their
 * headline and bio, the image their photo, the video their clip, plus where they live
 * (src/lib/teachers/publish.ts). Deleting it is an ERASURE request — the teacher form promises "Delete
 * your profile, video link and CV for good" — so the row that stays as the removal's record keeps only
 * what says a listing existed and was removed (ids, category, seller, dates, status) and loses every
 * column that describes the person. The same blanking is what the retention job applies to every
 * tombstone once its retention period is over (src/lib/core/listing-tombstone-retention.ts).
 * ⚠️ ADD A COLUMN HERE WHEN THE LISTING TABLE GROWS ONE THAT CAN HOLD PERSONAL CONTENT.
 */
export const PERSONAL_SCRUB_DATA = {
  title: '[removed]', titleVi: null, description: '', descriptionVi: null,
  images: '[]', video: null, searchText: '', facetTokens: null, attributes: null, model: null,
  location: '', district: null, lat: null, lng: null,
  verificationNotes: null, soldPlatform: null, soldToProfileId: null, saleBuyerHistory: null,
} as const

/** The first-party storage objects a row's images + video name (foreign URLs are not ours to delete). */
export function mediaUrlsOf(row: { images: string | null; video: string | null }): string[] {
  let images: unknown = []
  try { images = JSON.parse(row.images || '[]') } catch { images = [] }
  const urls = [...(Array.isArray(images) ? images.filter((u): u is string => typeof u === 'string') : []), ...(row.video ? [row.video] : [])]
  return urls.filter((u) => listingObjectKey(u) !== null)
}

export async function tombstoneListingsTx(
  tx: Prisma.TransactionClient,
  ids: string[],
  opts: {
    actor: RemovalActor
    reason: RemovalReason
    /** A moderator's decision note (already length-capped by the caller); stored in the audit row. */
    note?: string | null
    /**
     * Release the partner's `externalId` (it is kept in the audit row). Only for a SELLER's own
     * delete: the (sellerId, externalId) unique would otherwise stop the partner's sync from ever
     * re-creating that SKU, which a hard delete used to allow. A MODERATOR's or admin's removal keeps
     * it, so the next sync/import of the same SKU hits the tombstone instead of republishing it.
     */
    releaseExternalId?: boolean
    /** Extra guard ANDed into the write (e.g. "no open report"), evaluated atomically with it. */
    where?: Prisma.ListingWhereInput
    /**
     * Also BLANK the personal content (PERSONAL_SCRUB_DATA) and tombstone its first-party photos and
     * video for the storage sweep, in this same transaction — an erasure, not only a removal. Used for
     * a teacher's profile; `storageReason` labels the StorageTombstones.
     */
    scrub?: { storageReason: TombstoneReason }
  },
): Promise<RemovedRow[]> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (!unique.length) return []
  // ⛔ The caller's guard is AND-ed, never spread: a `status` in `opts.where` would otherwise REPLACE the
  // "not already removed" filter (and re-stamp, re-audit a tombstone).
  const where: Prisma.ListingWhereInput = { id: { in: unique }, status: { not: LISTING_REMOVED }, ...(opts.where ? { AND: [opts.where] } : {}) }
  // edition-lint-allow: a WRITE path over ids its caller already authorised (an owner check, an admin
  // session); never rendered. The marketplace scope would make a moderator's removal of a desk listing
  // silently skip it on whichever edition ran it — both editions share the one database.
  const before = await tx.listing.findMany({
    where,
    select: { id: true, status: true, verified: true, externalId: true, sellerId: true, brandSlug: true, video: true, images: true },
  })
  if (!before.length) return []
  const changed = await tx.listing.updateManyAndReturn({
    where: { ...where, id: { in: before.map((r) => r.id) } },
    data: { ...TOMBSTONE_DATA, ...(opts.releaseExternalId ? { externalId: null } : {}), ...(opts.scrub ? PERSONAL_SCRUB_DATA : {}) },
    select: { id: true },
  })
  const done = new Set(changed.map((r) => r.id))
  const out: RemovedRow[] = []
  if (opts.scrub) {
    // The objects the scrubbed rows no longer reference, queued for the sweep WITH the scrub: if the
    // fast path never runs, nothing is left that remembers them otherwise.
    const media = before.filter((r) => done.has(r.id)).flatMap(mediaUrlsOf)
    const refs = media.map((u) => listingObjectKey(u)!).map((k) => ({ bucket: k.bucket, path: k.key }))
    if (refs.length) await writeTombstones(tx, refs, opts.scrub.storageReason)
  }
  for (const r of before) {
    if (!done.has(r.id)) continue
    out.push({ id: r.id, sellerId: r.sellerId, brandSlug: r.brandSlug, priorStatus: r.status, video: opts.scrub ? null : r.video, ...(opts.scrub ? { scrubbedMedia: mediaUrlsOf(r) } : {}) })
    const a = opts.actor
    await appendAudit(tx, {
      actorType: a.kind === 'seller' ? 'user' : 'admin',
      actorId: a.kind === 'seller' ? (a.profileId ?? `seller:${a.sellerId}`) : a.email,
      action: 'listing.removed',
      subjectType: 'listing',
      subjectId: r.id,
      // No PII: ids, the prior state and the decision. The listing row itself is the evidence.
      detail: {
        by: a.kind,
        reason: opts.reason,
        priorStatus: r.status,
        priorVerified: r.verified,
        sellerId: r.sellerId,
        ...(r.externalId ? { externalId: r.externalId } : {}),
        ...(opts.note ? { note: opts.note.slice(0, 500) } : {}),
        ...(opts.scrub ? { personalDataScrubbed: true } : {}),
      },
      legalBasis: 'ecommerceLaw',
    })
  }
  return out
}
