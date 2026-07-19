import 'server-only'
import { kv } from './ratelimit'
import { applyTrustEvent } from './trust'

// Anti-spam for offers on FIXED-price (non-negotiable) listings.
//
// The offer UI is hidden client-side on fixed-price listings, so an honest buyer
// never sends one. A handful of stray attempts can still happen (a stale tab open
// from before the seller switched to fixed, or a card cached mid-change) — those
// are just rejected with a friendly message, no penalty. But repeatedly POSTing
// offers to fixed-price listings is deliberate abuse (ignoring the block, scripting
// the endpoint), so past a small grace it docks the sender's trust score.
//
// Design guarantees:
//  · The BLOCK (409) needs no counter store — it's a pure DB read of listing.negotiable.
//  · The PENALTY is counter-gated and FAILS OPEN (kv error → no penalty), so a flaky
//    backend can never wrongly punish a buyer.
//  · GRACE attempts in a rolling 24h window are free; beyond that a penalty applies,
//    but at most once per hour per buyer (dedup key) so one burst can't nuke a score
//    and the DB isn't hammered with trust recomputes.

const GRACE = 2                 // free stray attempts per 24h before any penalty
const PENALTY = 3               // trust points docked per penalized burst
const WINDOW_SEC = 24 * 60 * 60 // attempt counter TTL
const PENALTY_COOLDOWN_SEC = 60 * 60 // at most one penalty per hour per buyer

/**
 * Record one rejected fixed-price offer attempt by `buyerId` and, if they're past the
 * grace, dock their trust (rate-limited to once/hour). Best-effort — never throws,
 * never blocks the caller's response.
 */
export async function recordFixedPriceOfferAttempt(buyerId: string): Promise<void> {
  try {
    const countKey = `nonneg-offer:${buyerId}`
    // kv.incrby refreshes the TTL on EVERY increment, not just the first — a
    // stuck counter would trap the buyer past grace for good, so the rolling
    // window self-heals by design (extending it slightly per attempt is fine
    // for a spam counter).
    const n = await kv.incrby(countKey, 1, WINDOW_SEC)
    if (n <= GRACE) return

    // Past grace → penalize, but only if we haven't already this hour.
    const penKey = `nonneg-offer-pen:${buyerId}`
    const claimed = await kv.set(penKey, '1', { nx: true, ex: PENALTY_COOLDOWN_SEC })
    if (!claimed) return // already penalized within the cooldown

    await applyTrustEvent(buyerId, 'manual_adjust', -PENALTY, { reason: 'nonneg_offer_spam' })
  } catch (e) {
    console.error('[offer-guard] penalty', (e as Error).message)
  }
}
