import 'server-only'
import { db } from '@/lib/db'
import { refreshListingSurfaces } from '@/lib/listing-surfaces'
import { licenceBlockedIds } from '@/lib/core/licence-check'
import { deskSellerIds } from '@/lib/edition-scope'
import { licenceClearedWhere } from '@/lib/licence-stamp'

// ── Releasing what the seller identity gate parked ──────────────────────────────────────────────
//
// Its own module so recompute-verification.ts can call it without an import cycle: the gate
// (seller-publish-gate.ts) reads verification status FROM recompute-verification, and recompute
// calls the release back. The rules for what gets parked in the first place live in the gate.

/**
 * The seller is verified now: publish everything the gate parked for them. Called from
 * recomputeVerification whenever the derived status is `verified` — not only on a change, because
 * a cache that already said `verified` (a lapse the sweep never recorded, then a renewal) must still
 * release what was parked while the decision said otherwise. Two small indexed reads and no write
 * when there is nothing to release.
 *
 * ⚠️ `identityHold = true` IS THE ONLY SELECTOR, AND THAT IS SAFE ONLY BECAUSE EVERY TAKEDOWN CLEARS
 * IT. Each path that writes `verified: false` as a moderation act (admin unverify, the moderation
 * queue, provenance and AI auto-holds, the enforcement pull) also writes `identityHold: false`, so a
 * listing a human or a system pulled can never be released from here.
 *
 * ⛔ …AND NEVER AN e-VISA / LEGAL & PERMITS ROW eno HAS NOT CHECKED (owner, 2026-10-14 — licence-stamp.ts). The
 * seller's identity is not the provider's licence: a parked aisle row that is not cleared (licenceBlockedIds) STAYS
 * parked, and the write ANDs licenceClearedWhere. This closes the move-while-parked-then-release gap — a row parked
 * outside the aisles, then edited into one (which re-holds it but never touches identityHold), would otherwise go live
 * the day its owner verifies. It is published by 'licence-approve' instead (api/admin/listings publishListings), and
 * the identity gate still applies there.
 */
export async function releaseIdentityHolds(ownerId: string): Promise<number> {
  const sellers = await db.seller.findMany({ where: { ownerId }, select: { id: true } })
  if (!sellers.length) return 0
  const held = await db.listing.findMany({ where: { sellerId: { in: sellers.map((s) => s.id) }, identityHold: true }, select: { id: true } })
  if (!held.length) return 0
  const desk = await deskSellerIds()
  const blocked = await licenceBlockedIds(held.map((l) => l.id), desk)
  const ids = held.map((l) => l.id).filter((id) => !blocked.has(id))
  if (!ids.length) return 0
  const r = await db.listing.updateMany({ where: { id: { in: ids }, identityHold: true, AND: [licenceClearedWhere(desk)] }, data: { verified: true, identityHold: false, verificationNotes: null } })
  refreshPublicSurfaces(ids)
  return r.count
}

/** Best-effort cache + search refresh — the shared helper every public-state change uses. */
export function refreshPublicSurfaces(ids: string[]): void {
  refreshListingSurfaces(ids, 'identityHolds')
}
