import { IS_SERVICES } from '@/lib/edition'
import 'server-only'
// Relative specifiers, matching the trips/visa DM modules' idiom: `@/…` does not resolve under
// vitest and this file IS unit-tested. That is also why this lives here rather than in messages.ts,
// where it started — messages.ts pulls in `@/generated/prisma/client`, so a predicate defined there
// cannot be imported by a unit test at all, and every consumer's test would have to mock it instead
// of exercising it. A rule about which threads are which should be the most testable thing here.
import { getTripAssistanceListingId } from './trips/dm-thread'
import { getVisaShopListings } from './visa-shop'

/** What a thread is ABOUT. `listing` is the ordinary marketplace conversation, and the fallback. */
export type ThreadKind = 'visa' | 'itinerary' | 'listing'

/**
 * WHICH PRODUCT THREADS THIS DEPLOYMENT MAY RENDER AS PRODUCT THREADS — one flag per service,
 * replacing a single `!IS_SERVICES` short-circuit.
 *
 * The old line said "the marketplace has no product threads at all", which was true while both
 * desks were eno's own support account. It stopped matching the plan on 2026-08-13: visa on eno.vn
 * is run by VietKite and itineraries by GMBR, both licensed third parties selling on the
 * marketplace, and the owner confirmed eno.vn should host those chat flows "same as eno.forum for
 * Vietkite". A single edition boolean cannot express "itinerary yes, visa no" — or the reverse —
 * which is what a per-service rollout needs.
 *
 * ⚠️ DEFAULT IS EXACTLY THE OLD BEHAVIOUR. On the services edition both are on, as before. On the
 * marketplace both are OFF unless explicitly enabled, so this change ships as a no-op and each
 * service is turned on deliberately, one deployment at a time.
 *
 * ⛔⛔ ENABLING EITHER FLAG WITHOUT FIRST REPOINTING ITS DESK env IS A LEGAL LEAK, NOT A BUG.
 * The catalogue these flags gate is resolved by OWNER EMAIL — `getVisaShopListings()` from
 * VISA_SHOP_OWNER_EMAIL, `getTripAssistanceListingId()` from TRIP_DESK_OWNER_EMAIL — and both
 * still default to `support@eno.forum`, eno's OWN service account. The two apps share one database.
 * So turning VISA_THREADS_ENABLED on for eno.vn while that variable still says support@eno.forum
 * would paint eno's own forum e-visa conversations onto the licensed marketplace — precisely the
 * thing eno.vn may not offer. The order is: repoint the desk env to the PARTNER, verify the
 * catalogue resolves to that partner's listings, then set the flag.
 * ⚠️ And repointing that env has its own trap, which is why edition-scope.ts now takes a separate
 * HIDDEN_DESK_OWNER_EMAILS: the desk address used to double as eno.vn's hide-list, so naming a
 * partner there deletes them from the marketplace. Read that file's note before touching either.
 */
export const VISA_THREADS_ENABLED = IS_SERVICES || process.env.VISA_THREADS_ENABLED === 'true'
export const ITINERARY_THREADS_ENABLED = IS_SERVICES || process.env.ITINERARY_THREADS_ENABLED === 'true'

/**
 * THE ONE ANSWER to "what kind of thread is this".
 *
 * ⚠️ THE DISCRIMINATOR IS THE ANCHOR LISTING, NEVER THE SELLER. `Seller.ownerId` is `@unique`, so
 * the visa desk and the trip desk are literally the SAME storefront row — "is this the desk?"
 * cannot tell the two apart. Answering that question with a seller check is what once leaked the
 * trip wizard into e-Visa threads: every visa conversation is with the same seller, so a
 * seller-keyed predicate says yes to all of them. A thread is an ITINERARY thread because it is
 * anchored on the trip-assistance listing, and a VISA thread because it is anchored on one of the
 * visa catalogue listings. Nothing else distinguishes them.
 *
 * ⚠️ FAILS CLOSED to 'listing' — on a missing desk, a missing anchor, an empty catalogue, or a
 * throw. Guessing 'itinerary' or 'visa' when we do not know would paint a product surface onto a
 * stranger's conversation; guessing 'listing' only withholds one. This is the same direction
 * threadHostsWizard has always failed, kept deliberately.
 *
 * Both resolvers are React-cached, so the surfaces that ask this during one request — the customer
 * thread list, the thread page, the admin queue — share one pair of lookups between them.
 */
export async function threadKind(convo: { listingId: string | null }): Promise<ThreadKind> {
  /**
   * ⚠️ STILL THE HIGHEST-LEVERAGE LINES IN THE EDITION SPLIT'S CHAT WORK, now one per service.
   * The two apps SHARE ONE DATABASE, so a user who applied on eno.forum genuinely has those threads
   * sitting in the marketplace's tables. Answering 'listing' disarms the inbox badge, every
   * thread-card branch and the chat context at once, in the direction this function already fails
   * in: withholding a product surface, never painting one onto a conversation that is not one.
   *
   * ⚠️ WHAT CHANGED IS THE GRAIN, NOT THE DIRECTION. It was `if (!IS_SERVICES) return 'listing'` —
   * all or nothing per edition. Each service is now asked separately (see the flags above), so a
   * deployment can host itineraries without hosting visa, or the reverse. Everything still fails
   * closed: a disabled service returns 'listing' at the exact point it would have returned its own
   * kind, rather than short-circuiting earlier, so the anchor lookup stays the ONE discriminator.
   *
   * It is NOT sufficient on its own — a kind of 'listing' hides the CARDS while the concierge's
   * replies remain readable prose, because both concierges insert their answers with no `kind` and
   * default to 'text'. The threads themselves are excluded in the conversations routes.
   */
  if (!VISA_THREADS_ENABLED && !ITINERARY_THREADS_ENABLED) return 'listing'
  if (!convo.listingId) return 'listing'
  try {
    /**
     * ⚠️ ONLY THE ENABLED SERVICE IS LOOKED UP, AND SKIPPING THE OTHER IS A CORRECTNESS FIX RATHER
     * THAN AN OPTIMISATION. The first draft awaited BOTH desks in one `Promise.all` and then applied
     * the flags to the result. `Promise.all` rejects as a unit, so a failure in the DISABLED
     * service's lookup fell into the catch below and returned 'listing' — silently killing the
     * service that was switched on.
     *
     * That is not a hypothetical ordering: on eno.vn the intended first step is itineraries ON with
     * visa still OFF, while VISA_SHOP_OWNER_EMAIL is still pointing at `support@eno.forum` — a desk
     * that deployment has no reason to resolve. The itinerary feature would have been dead on
     * arrival, with no error and a green suite, because the tests only ever exercised successful
     * lookups. All three external reviewers caught it independently.
     *
     * Asking only what this deployment actually serves also makes the flags mean what their names
     * say: a disabled service cannot influence an enabled one.
     */
    const [tripAnchorId, visaListings] = await Promise.all([
      ITINERARY_THREADS_ENABLED ? getTripAssistanceListingId() : Promise.resolve(null),
      VISA_THREADS_ENABLED ? getVisaShopListings() : Promise.resolve([]),
    ])
    if (tripAnchorId && convo.listingId === tripAnchorId) return 'itinerary'
    if (visaListings.some((listing) => listing.id === convo.listingId)) return 'visa'
    return 'listing'
  } catch (e) {
    // A desk-lookup outage must not relabel every ordinary conversation as a product thread.
    console.error('[thread-kind] lookup', e)
    return 'listing'
  }
}
