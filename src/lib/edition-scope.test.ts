import { beforeEach, describe, expect, it, vi } from 'vitest'

// The predicate that keeps the visa/trip desk's listings off the licensed marketplace. The property
// under test is the one the whole edition split rests on: on eno.vn, a desk that cannot be resolved
// must THROW, never return an empty exclusion. Both underlying resolvers are deliberately fail-soft
// (they swallow database errors and return null so the visa feature degrades instead of crashing),
// and inheriting that softness here would silently republish the e-Visa SKUs on the licensed domain.

const h = vi.hoisted(() => ({
  services: true,
  visaDesk: null as null | { id: string },
  tripDesk: null as null | { id: string },
}))

vi.mock('@/lib/edition', () => ({
  get IS_SERVICES() { return h.services },
  get IS_MARKETPLACE() { return !h.services },
  get EDITION() { return h.services ? 'services' : 'marketplace' },
}))
vi.mock('@/lib/visa-shop', () => ({ getVisaShopSeller: async () => h.visaDesk }))
vi.mock('@/lib/trips/dm-thread', () => ({ getTripDesk: async () => h.tripDesk }))
// react's cache() memoises per request; outside a request it is identity. Unwrap it so each test
// sees its own fixture rather than the first one that ran.
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: (f: unknown) => f }))

const { marketplaceListingScope, deskSellerIds, DeskResolutionError } = await import('./edition-scope')

beforeEach(() => {
  h.services = true
  h.visaDesk = null
  h.tripDesk = null
})

describe('marketplaceListingScope', () => {
  it('is a no-op on the services edition, even with no desk', async () => {
    // eno.forum sells these listings, so it must not exclude them — and it must not throw when the
    // desk is missing either, or an unrelated env problem would take the whole storefront down.
    expect(await marketplaceListingScope()).toEqual({})
  })

  it('excludes the desk seller on the marketplace edition', async () => {
    h.services = false
    h.visaDesk = { id: 'desk-1' }
    h.tripDesk = { id: 'desk-1' }
    expect(await marketplaceListingScope()).toEqual({ sellerId: { notIn: ['desk-1'] } })
  })

  it('unions two distinct desks rather than picking one', async () => {
    // Seller.ownerId is @unique so these are normally the same row, but a second support identity
    // has appeared in production before and excluding only one would leak the other's listings.
    h.services = false
    h.visaDesk = { id: 'visa-desk' }
    h.tripDesk = { id: 'trip-desk' }
    const scope = await marketplaceListingScope()
    expect(scope.sellerId?.notIn.sort()).toEqual(['trip-desk', 'visa-desk'])
  })

  // ⚠️ THE TEST THIS FILE EXISTS FOR. An unresolvable desk on eno.vn is a licensing question, not a
  // degraded feature: `{ sellerId: { notIn: [] } }` excludes nothing, so the e-Visa SKUs rejoin the
  // browse feed, search, the sitemap and the Google/Meta product feeds with no error anywhere.
  // A visible 500 on a rail is recoverable in ten minutes; a silently unfiltered feed is not.
  it.each([
    ['neither desk resolves', null, null],
    ['only the visa desk is missing', null, { id: 'trip-desk' }],
    ['only the trip desk is missing', { id: 'visa-desk' }, null],
  ])('marketplace edition: %s', async (_label, visa, trip) => {
    h.services = false
    h.visaDesk = visa
    h.tripDesk = trip
    if (!visa && !trip) {
      await expect(marketplaceListingScope()).rejects.toThrow(DeskResolutionError)
    } else {
      // A partial resolution still excludes what it found — it must never silently widen to {}.
      const scope = await marketplaceListingScope()
      expect(scope.sellerId?.notIn.length).toBe(1)
    }
  })

  it('never returns an empty exclusion list on the marketplace edition', async () => {
    // Stated as its own invariant because it is the exact shape of the failure: the danger is not an
    // exception, it is a well-formed predicate that matches everything.
    h.services = false
    await expect(marketplaceListingScope()).rejects.toThrow(/no desk seller could be resolved/)
  })

  it('names the env vars an operator has to check', async () => {
    h.services = false
    await expect(marketplaceListingScope()).rejects.toThrow(/VISA_SHOP_OWNER_EMAIL/)
  })
})

describe('deskSellerIds', () => {
  it('deduplicates when both desks are the same storefront', async () => {
    h.visaDesk = { id: 'same' }
    h.tripDesk = { id: 'same' }
    expect(await deskSellerIds()).toEqual(['same'])
  })

  it('is empty when nothing resolves, leaving the throw to the caller', async () => {
    expect(await deskSellerIds()).toEqual([])
  })
})
