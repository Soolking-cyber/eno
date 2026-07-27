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
  if (!convo.listingId) return 'listing'
  try {
    const [tripAnchorId, visaListings] = await Promise.all([
      getTripAssistanceListingId(),
      getVisaShopListings(),
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
