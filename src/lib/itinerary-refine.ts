import { kv } from '@/lib/ratelimit'

/**
 * The refinement budget a saved itinerary gets — ONE budget, shared by every "suggest something
 * else" route on that trip.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THE SHARING HAS TO BE STRUCTURAL. When stay editing was planned, the
 * proposal said the stays route would "use the same counter as the activity route", and an
 * adversarial review pointed out that two routes agreeing on a string literal is not one counter:
 * the moment somebody namespaces one of them (`itinerary-refine:stays:${id}`, an obvious-looking
 * tidy-up) each surface silently gets its own twelve, and the cap on the trip doubles without a
 * single line looking wrong. The key is built here, once, and neither route knows its shape.
 *
 * ⚠️ BOUNDED, NOT IMPOSSIBLE — the honest framing, and the second thing that review corrected. The
 * tally lives in `kv_store`, an UNLOGGED table, so Postgres truncates it after an unclean shutdown
 * and every trip's count resets to zero. One sequence goes slightly further, and a review of the
 * finished diff worked it out: a request that spends, survives the restart and then refunds
 * decrements a counter the crash already zeroed, leaving −1 and buying a thirteenth refinement in
 * the new epoch. Both are accepted. What survives a crash is the per-account hourly bucket and the
 * global daily ceiling inside `aiGuard`; this cap is the per-trip fairness layer on top of them, and
 * a durable count means a column on Itinerary. Do not describe this as making farming impossible.
 */

/** Per-account hourly bucket, shared by both refine surfaces via `aiGuard('itinerary-refine', …)`.
 *  Small on purpose (generation gets 8): refining is a fast follow-up, so a traveller who needs
 *  more than six an hour is farming rather than planning. */
export const REFINE_HOURLY_LIMIT = 6

/**
 * Lifetime refinements per itinerary, across activities AND accommodation.
 *
 * Twelve is roughly "every stop of a four-day trip, once", well above ordinary use. It is
 * deliberately NOT twelve-per-surface: a trip is one thing to the person who owns it, and the cap
 * exists so a single saved trip cannot become an unlimited free Gemini endpoint.
 */
export const REFINE_LIFETIME_LIMIT = 12

/** The one key. Private on purpose — see the note above. */
const refineCounterKey = (itineraryId: string) => `itinerary-refine:${itineraryId}`

export type RefineSpend =
  | { ok: true; used: number; remaining: number }
  /** The counter itself is unreachable. Callers answer 429: this IS the anti-farming cap, so a KV
   *  outage must not silently remove it. Unlike the generation slot, it fails CLOSED. */
  | { ok: false; reason: 'counter_unavailable' }
  | { ok: false; reason: 'limit' }

/**
 * Take one refinement, atomically.
 *
 * ⚠️ INCREMENT-THEN-CHECK, not read-then-increment. Two tabs reading "11 used" would both see room
 * under the cap and both spend; the atomic increment means the second one reads 13 and is refused.
 */
export async function spendRefinement(itineraryId: string): Promise<RefineSpend> {
  let used: number
  try {
    used = await kv.incrby(refineCounterKey(itineraryId), 1)
  } catch (e) {
    console.error('[itinerary-refine] counter unavailable', (e as Error)?.message?.slice(0, 200))
    return { ok: false, reason: 'counter_unavailable' }
  }
  if (used > REFINE_LIFETIME_LIMIT) {
    // ⚠️ REFUND THE REFUSAL, so the counter PARKS at the cap instead of climbing with every rejected
    // attempt. Nothing was spent, and an inflated tally would quietly mean something else: raise the
    // cap to 20 later and a trip that hammered a refused button would still be locked out.
    //
    // "Parks" is best-effort, not guaranteed — the decrement below swallows its own failure, so a KV
    // error here leaves the count drifting upward. That is the safe direction (the trip stays capped)
    // and it is why this is worth doing rather than worth trusting.
    await refundRefinement(itineraryId)
    return { ok: false, reason: 'limit' }
  }
  return { ok: true, used, remaining: Math.max(0, REFINE_LIFETIME_LIMIT - used) }
}

/**
 * Give a refinement back when WE never spent anything.
 *
 * ⚠️ NOT a general "something went wrong" undo. A call that reached the model and came back with
 * nothing usable HAS been paid for; refunding it would hand a caller repeatable free inference. Each
 * route decides — the rule there is that the refund only fires when no model call happened, or when
 * the provider itself failed. Best effort: it can only ever lower the count, so it cannot let a
 * request past the cap.
 */
export async function refundRefinement(itineraryId: string): Promise<void> {
  // No TTL anywhere on this key: `null` leaves expires_at null, so the row is never swept, which is
  // what makes it a LIFETIME count rather than a rolling window.
  try { await kv.incrby(refineCounterKey(itineraryId), -1) } catch { /* the cap holding too tightly is the safe direction */ }
}
