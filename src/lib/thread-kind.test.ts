import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The one predicate that says what a thread is about.
 *
 * ⚠️ WHAT THESE TESTS EXIST TO FORBID. The visa desk and the trip desk are the SAME `Seller` row —
 * `Seller.ownerId` is `@unique`, so one storefront serves both products. A predicate that answers
 * "is this the desk?" therefore says YES to every visa thread and every trip thread alike, and that
 * exact mistake once leaked the trip wizard into e-Visa conversations. The discriminator has to be
 * the ANCHOR LISTING.
 *
 * The seller id is deliberately IDENTICAL in every fixture below, and threaded through every case,
 * so a seller-keyed implementation cannot pass this file: it would have to answer the same kind for
 * the visa listing, the trip anchor and an ordinary listing, and the first two assertions disagree.
 */

const h = vi.hoisted(() => ({
  tripAnchorId: null as string | null,
  visaListings: [] as { id: string }[],
  throwOnLookup: false,
}))

vi.mock('./trips/dm-thread', () => ({
  getTripAssistanceListingId: async () => {
    if (h.throwOnLookup) throw new Error('desk lookup down')
    return h.tripAnchorId
  },
}))
vi.mock('./visa-shop', () => ({
  getVisaShopListings: async () => {
    if (h.throwOnLookup) throw new Error('catalogue lookup down')
    return h.visaListings
  },
}))

const { threadKind } = await import('./thread-kind')

/** Every fixture shares ONE seller, which is the whole point — see the header. */
const SAME_SELLER = 'seller-shared-by-both-desks'
const convo = (listingId: string | null) => ({ listingId, sellerId: SAME_SELLER })

beforeEach(() => {
  h.tripAnchorId = 'listing-trip-anchor'
  h.visaListings = [{ id: 'listing-visa-standard' }, { id: 'listing-visa-urgent' }]
  h.throwOnLookup = false
})

describe('itinerary is the trip ANCHOR listing and nothing else', () => {
  it('answers itinerary for the anchor', async () => {
    expect(await threadKind(convo('listing-trip-anchor'))).toBe('itinerary')
  })

  it('answers listing for an ordinary listing sold by the SAME seller', async () => {
    // A seller-keyed predicate cannot tell this apart from the anchor above.
    expect(await threadKind(convo('listing-ordinary-motorbike'))).toBe('listing')
  })
})

describe('visa is a CATALOGUE listing and nothing else', () => {
  it.each(['listing-visa-standard', 'listing-visa-urgent'])('answers visa for %s', async (id) => {
    expect(await threadKind(convo(id))).toBe('visa')
  })

  it('does NOT answer visa for the trip anchor, though both share the seller', async () => {
    expect(await threadKind(convo('listing-trip-anchor'))).not.toBe('visa')
  })

  it('does NOT answer itinerary for a visa listing', async () => {
    expect(await threadKind(convo('listing-visa-standard'))).not.toBe('itinerary')
  })
})

describe('it fails CLOSED, in every way it can fail', () => {
  it('answers listing when the thread has no anchor at all', async () => {
    expect(await threadKind(convo(null))).toBe('listing')
  })

  it('answers listing when the trip desk is unconfigured', async () => {
    h.tripAnchorId = null
    expect(await threadKind(convo('listing-trip-anchor'))).toBe('listing')
  })

  it('answers listing when the visa catalogue is empty', async () => {
    h.visaListings = []
    expect(await threadKind(convo('listing-visa-standard'))).toBe('listing')
  })

  it('answers listing when a lookup THROWS, rather than propagating', async () => {
    // A desk outage must not relabel conversations, and must not 500 the thread list either.
    h.throwOnLookup = true
    expect(await threadKind(convo('listing-visa-standard'))).toBe('listing')
    expect(await threadKind(convo('listing-trip-anchor'))).toBe('listing')
  })
})

describe('the answer is a function of the ANCHOR alone', () => {
  it('ignores the seller entirely — a different seller on the anchor still answers itinerary', async () => {
    // Stated as a property rather than an implementation detail: whoever the thread is with, the
    // anchor decides. Ownership of the thread is a separate question, answered elsewhere.
    expect(await threadKind({ listingId: 'listing-trip-anchor' })).toBe('itinerary')
    expect(await threadKind({ listingId: 'listing-visa-urgent' })).toBe('visa')
  })

  it('never invents a kind for an inherited Object key used as a listing id', async () => {
    for (const key of ['toString', '__proto__', 'constructor']) {
      expect(await threadKind(convo(key))).toBe('listing')
    }
  })
})
