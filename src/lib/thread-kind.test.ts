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
  // ⚠️ PER-RESOLVER throws, added alongside the shared flag. The shared `throwOnLookup` cannot
  // express "the DISABLED desk is broken while the ENABLED one is fine", which is the exact
  // condition the cross-service regression lives in — and a test that cannot express it silently
  // passed against the bug.
  throwOnTrip: false,
  throwOnVisa: false,
}))

vi.mock('./trips/dm-thread', () => ({
  getTripAssistanceListingId: async () => {
    if (h.throwOnLookup || h.throwOnTrip) throw new Error('desk lookup down')
    return h.tripAnchorId
  },
}))
vi.mock('./visa-shop', () => ({
  getVisaShopListings: async () => {
    if (h.throwOnLookup || h.throwOnVisa) throw new Error('catalogue lookup down')
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

/**
 * THE MARKETPLACE EDITION, PER SERVICE.
 *
 * ⚠️ EVERY TEST ABOVE RUNS AS THE SERVICES EDITION — `NEXT_PUBLIC_ENO_EDITION` is unset under
 * vitest and `edition.ts` defaults to 'services'. So the branch that governs the LICENSED
 * marketplace, the one whose failure mode is a legal problem rather than a cosmetic one, had no
 * coverage at all. These cases drive the real `edition.ts` by setting the variable before import,
 * rather than mocking it, so the default that ships is the default under test.
 *
 * What they pin: the flags are INDEPENDENT. "itinerary on eno.vn, visa not" is the shape the
 * rollout needs (itineraries are GMBR's, visa is VietKite's, and they arrive separately), and a
 * single edition boolean could not express it.
 */
describe('marketplace edition — one flag per service', () => {
  const load = async (env: Record<string, string | undefined>) => {
    vi.resetModules()
    const keys = ['NEXT_PUBLIC_ENO_EDITION', 'VISA_THREADS_ENABLED', 'ITINERARY_THREADS_ENABLED']
    const prev: Record<string, string | undefined> = {}
    for (const k of keys) { prev[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k] }
    try {
      return await import('./thread-kind')
    } finally {
      for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k] }
    }
  }
  const MARKET = { NEXT_PUBLIC_ENO_EDITION: 'marketplace' } as Record<string, string | undefined>

  beforeEach(() => {
    h.tripAnchorId = 'trip-anchor'
    h.visaListings = [{ id: 'visa-1' }]
    h.throwOnLookup = false
    h.throwOnTrip = false
    h.throwOnVisa = false
  })

  it('withholds BOTH kinds by default — the change ships as a no-op on eno.vn', async () => {
    const m = await load(MARKET)
    expect(m.VISA_THREADS_ENABLED).toBe(false)
    expect(m.ITINERARY_THREADS_ENABLED).toBe(false)
    await expect(m.threadKind(convo('visa-1'))).resolves.toBe('listing')
    await expect(m.threadKind(convo('trip-anchor'))).resolves.toBe('listing')
  })

  it('visa on, itinerary off: the visa anchor answers visa and the trip anchor still does not', async () => {
    const m = await load({ ...MARKET, VISA_THREADS_ENABLED: 'true' })
    await expect(m.threadKind(convo('visa-1'))).resolves.toBe('visa')
    await expect(m.threadKind(convo('trip-anchor'))).resolves.toBe('listing')
  })

  it('itinerary on, visa off: the mirror image — the two flags do not leak into each other', async () => {
    const m = await load({ ...MARKET, ITINERARY_THREADS_ENABLED: 'true' })
    await expect(m.threadKind(convo('trip-anchor'))).resolves.toBe('itinerary')
    await expect(m.threadKind(convo('visa-1'))).resolves.toBe('listing')
  })

  it('only the exact string "true" enables a service — a stray value fails CLOSED', async () => {
    const m = await load({ ...MARKET, VISA_THREADS_ENABLED: '1' })
    expect(m.VISA_THREADS_ENABLED).toBe(false)
    await expect(m.threadKind(convo('visa-1'))).resolves.toBe('listing')
  })

  /**
   * ⚠️ THE REGRESSION ALL THREE REVIEWERS CAUGHT, PINNED. The first draft awaited both desks in one
   * `Promise.all` and applied the flags afterwards, so a throw from the DISABLED service rejected
   * the pair and the catch returned 'listing' — the ENABLED service silently dead. This is the
   * exact eno.vn rollout shape: itineraries on, visa off, VISA_SHOP_OWNER_EMAIL still pointing at a
   * desk that deployment never resolves.
   */
  it('a DISABLED service that throws cannot kill the ENABLED one', async () => {
    const m = await load({ ...MARKET, ITINERARY_THREADS_ENABLED: 'true' })
    h.throwOnVisa = true // the DISABLED desk is broken; the enabled one is healthy
    // Visa is off, so its resolver is never called and its failure cannot reach the catch.
    await expect(m.threadKind(convo('trip-anchor'))).resolves.toBe('itinerary')
  })

  it('the enabled service still fails CLOSED when its OWN lookup throws', async () => {
    const m = await load({ ...MARKET, ITINERARY_THREADS_ENABLED: 'true' })
    h.throwOnTrip = true // the ENABLED desk is the broken one
    await expect(m.threadKind(convo('trip-anchor'))).resolves.toBe('listing')
  })

  it('the services edition still enables both without any flag set', async () => {
    const m = await load({ NEXT_PUBLIC_ENO_EDITION: 'services' })
    expect(m.VISA_THREADS_ENABLED).toBe(true)
    expect(m.ITINERARY_THREADS_ENABLED).toBe(true)
    await expect(m.threadKind(convo('visa-1'))).resolves.toBe('visa')
    await expect(m.threadKind(convo('trip-anchor'))).resolves.toBe('itinerary')
  })
})
