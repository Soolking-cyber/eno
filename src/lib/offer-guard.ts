import 'server-only'
import { getRedis } from './ratelimit'
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
//  · The BLOCK (409) needs no Redis — it's a pure DB read of listing.negotiable.
//  · The PENALTY is Redis-gated and FAILS OPEN (no Redis → no penalty), so a flaky
//    or missing Upstash can never wrongly punish a buyer.
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
  const redis = getRedis()
  if (!redis) return // fail-open: no counter store → block only, never penalize
  try {
    const countKey = `nonneg-offer:${buyerId}`
    const n = await redis.incr(countKey)
    // Refresh the TTL on EVERY increment, not just the first. INCR + EXPIRE are two
    // separate round-trips; if the n===1 EXPIRE ever dropped, the key would live
    // forever and the buyer's 24h window would never reset — trapping them past grace
    // for good. Re-setting it each time makes a lost EXPIRE self-heal (it just extends
    // the rolling window slightly, which is fine for a spam counter).
    await redis.expire(countKey, WINDOW_SEC)
    if (n <= GRACE) return

    // Past grace → penalize, but only if we haven't already this hour.
    const penKey = `nonneg-offer-pen:${buyerId}`
    const claimed = await redis.set(penKey, '1', { nx: true, ex: PENALTY_COOLDOWN_SEC })
    if (!claimed) return // already penalized within the cooldown

    await applyTrustEvent(buyerId, 'manual_adjust', -PENALTY, { reason: 'nonneg_offer_spam' })
  } catch (e) {
    console.error('[offer-guard] penalty', (e as Error).message)
  }
}
