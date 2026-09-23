import 'server-only'
import { db } from '@/lib/db'
import { refreshListingSurfaces } from '@/lib/listing-surfaces'

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
 */
export async function releaseIdentityHolds(ownerId: string): Promise<number> {
  const sellers = await db.seller.findMany({ where: { ownerId }, select: { id: true } })
  if (!sellers.length) return 0
  const held = await db.listing.findMany({ where: { sellerId: { in: sellers.map((s) => s.id) }, identityHold: true }, select: { id: true } })
  if (!held.length) return 0
  const ids = held.map((l) => l.id)
  const r = await db.listing.updateMany({ where: { id: { in: ids }, identityHold: true }, data: { verified: true, identityHold: false } })
  refreshPublicSurfaces(ids)
  return r.count
}

/** Best-effort cache + search refresh — the shared helper every public-state change uses. */
export function refreshPublicSurfaces(ids: string[]): void {
  refreshListingSurfaces(ids, 'identityHolds')
}
