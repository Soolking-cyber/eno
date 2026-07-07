import 'server-only'
import { db } from '@/lib/db'

// ── Urgent sale "Bán gấp" (2026-07-07) ───────────────────────────────────────────
// A FREE chip (no paid bumps — strategy decision) that marks a listing as a rush
// sale, aimed at the departing-expat "moving sale" reality. Kept meaningful by
// three server-enforced scarcity rules (a free badge everyone wears is no badge):
//   · auto-expires after 7 days, NEVER silently renewed (fake urgency is a
//     blacklisted dark pattern — UCPD Annex I);
//   · per-listing re-arm requires a 7-day cooldown after expiry — urgent at most
//     half of a listing's life. Turning it OFF early stamps urgentUntil=now, so
//     off/on cycling can't mint fresh windows;
//   · max 2 concurrently-urgent active listings per seller (account-keyed, so
//     delete-and-repost doesn't mint quota).
// Urgency is a promise of flexibility, so activating it force-enables offers
// (negotiable=true). It has ZERO ranking effect — the single biggest anti-gaming
// decision: a free chip that boosted rank would be universally applied.

const DAY = 24 * 60 * 60 * 1000

export const URGENT = {
  DURATION_MS: 7 * DAY,       // active window per activation
  COOLDOWN_MS: 7 * DAY,       // wait after expiry before the same listing can re-arm
  MAX_ACTIVE_PER_SELLER: 2,   // concurrently-urgent listings per seller
} as const

/** Read-time check — a listing is urgent while urgentUntil is in the future. */
export function urgentActive(urgentUntil: Date | null | undefined): boolean {
  return !!urgentUntil && urgentUntil.getTime() > Date.now()
}

/** Seller quota: how many of their listings hold a live urgent window. Deliberately
 *  NOT filtered by status — an unexpired window holds a slot even while the listing is
 *  hidden/sold, else hide→activate-a-third→unhide would mint unlimited concurrent
 *  urgents (the read-time badge check is status-blind). Windows are ≤7d, so a
 *  hidden/sold listing can't hoard a slot for long. */
export async function urgentQuotaFree(sellerId: string, excludeListingId?: string): Promise<boolean> {
  const n = await db.listing.count({
    where: {
      sellerId,
      urgentUntil: { gt: new Date() },
      ...(excludeListingId ? { id: { not: excludeListingId } } : {}),
    },
  })
  return n < URGENT.MAX_ACTIVE_PER_SELLER
}

/**
 * Full activation gate for an EXISTING listing (the edit path): already active is a
 * no-op (never extends), a past window enforces the re-arm cooldown, and the seller
 * quota is checked last. Returns the field to set, or a 409-able error code.
 */
export async function activateUrgentGate(
  listing: { id: string; sellerId: string; urgentUntil: Date | null },
): Promise<{ ok: true; urgentUntil: Date } | { ok: 'noop' } | { ok: false; error: 'urgent_cooldown' | 'urgent_quota' }> {
  const now = Date.now()
  if (listing.urgentUntil && listing.urgentUntil.getTime() > now) return { ok: 'noop' } // already urgent — no silent renewal
  if (listing.urgentUntil && now < listing.urgentUntil.getTime() + URGENT.COOLDOWN_MS) {
    return { ok: false, error: 'urgent_cooldown' }
  }
  if (!(await urgentQuotaFree(listing.sellerId, listing.id))) return { ok: false, error: 'urgent_quota' }
  return { ok: true, urgentUntil: new Date(now + URGENT.DURATION_MS) }
}
