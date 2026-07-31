import { beforeEach, describe, expect, it, vi } from 'vitest'

// The predicate that keeps the visa/trip desk's listings off the licensed marketplace.
//
// ⚠️ THIS FILE WAS REWRITTEN AFTER AN ADVERSARIAL REVIEW, and the reason is worth stating because the
// first version was actively misleading. It asserted that a PARTIAL desk resolution — visa desk found,
// trip desk null — should still return `{ sellerId: { notIn: [visaDesk] } }`, and called that
// "excludes what it found". That is a leak with a test blessing it: the trip desk's listings stay in
// the licensed marketplace's feed, with no exception and a green suite. The implementation now
// resolves both desks in ONE query so that a failure cannot masquerade as an absence, and these tests
// pin THAT.

const h = vi.hoisted(() => ({
  services: true,
  sellers: [] as Array<{ id: string }>,
  throwOnQuery: null as null | Error,
  lastWhere: null as unknown,
}))

vi.mock('@/lib/edition', () => ({
  get IS_SERVICES() { return h.services },
  get IS_MARKETPLACE() { return !h.services },
  get EDITION() { return h.services ? 'services' : 'marketplace' },
}))
vi.mock('@/lib/visa-shop', () => ({ VISA_SHOP_OWNER_EMAILS: ['visa@eno.vn', 'shared@eno.vn'] }))
vi.mock('@/lib/trips/dm-thread', () => ({ TRIP_DESK_OWNER_EMAILS: ['trips@eno.vn', 'shared@eno.vn'] }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: {
      findMany: async ({ where }: { where: unknown }) => {
        h.lastWhere = where
        if (h.throwOnQuery) throw h.throwOnQuery
        return h.sellers
      },
    },
  },
}))
// react's cache() memoises per request; outside a request it is identity. Unwrap it so each test
// sees its own fixture rather than the first one that ran.
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: (f: unknown) => f }))

const { marketplaceListingScope, scopedListingWhere, deskSellerIds, DeskResolutionError } = await import('./edition-scope')

beforeEach(() => {
  h.services = true
  h.sellers = [{ id: 'desk-1' }]
  h.throwOnQuery = null
  h.lastWhere = null
})

describe('deskSellerIds', () => {
  it('queries the union of both desks address lists, deduplicated', async () => {
    await deskSellerIds()
    expect(h.lastWhere).toEqual({ owner: { email: { in: ['visa@eno.vn', 'shared@eno.vn', 'trips@eno.vn'] } } })
  })

  it('deduplicates when both desks are the same storefront', async () => {
    // Seller.ownerId is @unique, so one support account owns exactly one storefront and both
    // features hang off it. A ONE-row result is the NORMAL case, not a partial failure — which is
    // why "require two rows" would be the wrong rule and would take the marketplace down.
    h.sellers = [{ id: 'same' }, { id: 'same' }]
    expect(await deskSellerIds()).toEqual(['same'])
  })

  // ⚠️ NO try/catch IN THE IMPLEMENTATION, deliberately. The two desk helpers it replaced are
  // fail-soft by design (they swallow DB errors and return null so the visa feature degrades rather
  // than throws). Inheriting that made null ambiguous — "not set up" or "lookup failed" — and those
  // need opposite handling on a legal boundary.
  it('propagates a database error instead of reporting an empty desk list', async () => {
    h.throwOnQuery = new Error('connection reset')
    await expect(deskSellerIds()).rejects.toThrow('connection reset')
  })
})

describe('marketplaceListingScope', () => {
  it('is a no-op on the services edition, even with no desk', async () => {
    // eno.forum sells these listings, so it must not exclude them — and it must not throw when the
    // desk is missing either, or an unrelated env problem would take the whole storefront down.
    h.sellers = []
    expect(await marketplaceListingScope()).toEqual({})
  })

  it('does not even query on the services edition', async () => {
    await marketplaceListingScope()
    expect(h.lastWhere).toBeNull()
  })

  it('excludes every desk seller on the marketplace edition', async () => {
    h.services = false
    h.sellers = [{ id: 'visa-desk' }, { id: 'trip-desk' }]
    const scope = await marketplaceListingScope()
    expect(scope.sellerId?.notIn.sort()).toEqual(['trip-desk', 'visa-desk'])
  })

  // ⚠️ THE TEST THIS FILE EXISTS FOR. An unresolvable desk on eno.vn is a licensing question, not a
  // degraded feature: `{ sellerId: { notIn: [] } }` excludes nothing, so the e-Visa SKUs rejoin the
  // browse feed, search, the sitemap and the Google/Meta product feeds with no error anywhere.
  // A visible 500 on a rail is recoverable in ten minutes; a silently unfiltered feed is not.
  it('throws on the marketplace edition when no desk resolves', async () => {
    h.services = false
    h.sellers = []
    await expect(marketplaceListingScope()).rejects.toThrow(DeskResolutionError)
  })

  it('never returns an empty exclusion list on the marketplace edition', async () => {
    // Stated as its own invariant because it is the exact shape of the failure: the danger is not an
    // exception, it is a well-formed predicate that matches everything.
    h.services = false
    h.sellers = []
    await expect(marketplaceListingScope()).rejects.toThrow(/no desk seller could be resolved/)
  })

  it('names the env vars an operator has to check', async () => {
    h.services = false
    h.sellers = []
    await expect(marketplaceListingScope()).rejects.toThrow(/VISA_SHOP_OWNER_EMAIL/)
  })

  it('lets a database error surface rather than serving an unfiltered feed', async () => {
    h.services = false
    h.throwOnQuery = new Error('connection reset')
    await expect(marketplaceListingScope()).rejects.toThrow('connection reset')
  })
})

describe('scopedListingWhere', () => {
  it('returns the caller where untouched on the services edition, with no AND wrapper', async () => {
    const where = { status: 'active', sellerId: 'someone' }
    expect(await scopedListingWhere(where)).toBe(where)
  })

  /**
   * ⚠️ THE COMPOSITION TRAP, WHICH BOTH INDEPENDENT REVIEWERS WALKED INTO. The original API returned
   * a spreadable fragment, so `{ ...scope, sellerId: x }` silently dropped the exclusion (later key
   * wins) and `{ sellerId: x, ...scope }` silently dropped the caller's filter. The first is a leak
   * with no error, no failing test and no lint hit — the file mentions the helper, so it looks
   * guarded. AND-composition makes collision impossible.
   */
  it('keeps BOTH the caller sellerId filter and the desk exclusion', async () => {
    h.services = false
    h.sellers = [{ id: 'desk-1' }]
    const result = await scopedListingWhere({ status: 'active', sellerId: 'a-real-seller' })
    expect(result).toEqual({
      AND: [
        { status: 'active', sellerId: 'a-real-seller' },
        { sellerId: { notIn: ['desk-1'] } },
      ],
    })
  })

  it('cannot be defeated by key collision, whichever way a caller would have spread it', async () => {
    h.services = false
    h.sellers = [{ id: 'desk-1' }]
    const result = await scopedListingWhere({ sellerId: 'desk-1' })
    // Asking for the desk's own listings on the marketplace edition yields a contradiction that
    // returns nothing — which is correct. The exclusion survives; it is not overwritten.
    expect(JSON.stringify(result)).toContain('notIn')
  })

  it('still fails closed when the desk cannot be resolved', async () => {
    h.services = false
    h.sellers = []
    await expect(scopedListingWhere({ status: 'active' })).rejects.toThrow(DeskResolutionError)
  })
})
