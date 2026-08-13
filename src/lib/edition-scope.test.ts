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

const { marketplaceListingScope, scopedListingWhere, deskSellerIds, DeskResolutionError, isServicesDeskListing, deskExcludedListingWhere } = await import('./edition-scope')

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

/**
 * The shared-destination half, where the edition must make NO difference.
 *
 * ⚠️ EVERY CASE RUNS ON BOTH EDITIONS, because the bug these replace was an edition test in the
 * wrong place: the Vertex backfill route guarded itself with `scopedListingWhere`, whose first act
 * on the services edition is `return {}` — so the one caller it was written to stop (an admin
 * re-running the backfill from eno.forum) was the one it could not stop. Both builds write into
 * ONE datastore and eno.vn's concierge reads it, so the exclusion belongs to the DESTINATION, not
 * to the writer. A future `if (IS_SERVICES)` slipped into either helper fails the services half of
 * every table below.
 */
describe.each([
  ['services (eno.forum)', true],
  ['marketplace (eno.vn)', false],
])('the Vertex ingest exclusion on the %s edition', (_name, isServices) => {
  beforeEach(() => { h.services = isServices })

  describe('isServicesDeskListing', () => {
    it('is true for a listing on a desk storefront', async () => {
      h.sellers = [{ id: 'desk-1' }, { id: 'desk-2' }]
      expect(await isServicesDeskListing({ sellerId: 'desk-2' })).toBe(true)
    })

    it('is false for an ordinary seller', async () => {
      h.sellers = [{ id: 'desk-1' }]
      expect(await isServicesDeskListing({ sellerId: 'someone-else' })).toBe(false)
    })

    it('resolves the desk by owner email, so a reseed cannot silently stop matching', async () => {
      h.sellers = [{ id: 'desk-after-reseed' }]
      await isServicesDeskListing({ sellerId: 'desk-after-reseed' })
      expect(h.lastWhere).toEqual({ owner: { email: { in: ['visa@eno.vn', 'shared@eno.vn', 'trips@eno.vn'] } } })
    })

    // "No desk exists" and "I could not find out" are the same value and opposite decisions. A
    // caller that cannot throw must catch this and fail CLOSED, not read the error as `false`.
    it('throws rather than answering false when no desk resolves', async () => {
      h.sellers = []
      await expect(isServicesDeskListing({ sellerId: 'anyone' })).rejects.toThrow(DeskResolutionError)
    })

    it('propagates a database error', async () => {
      h.throwOnQuery = new Error('connection reset')
      await expect(isServicesDeskListing({ sellerId: 'anyone' })).rejects.toThrow('connection reset')
    })

    it('names the shared index in the refusal, so the operator knows which write stopped', async () => {
      h.sellers = []
      await expect(isServicesDeskListing({ sellerId: 'anyone' })).rejects.toThrow(/shared Vertex AI Search index/)
    })
  })

  describe('deskExcludedListingWhere', () => {
    it('AND-composes the exclusion onto the caller predicate', async () => {
      h.sellers = [{ id: 'desk-1' }]
      expect(await deskExcludedListingWhere({ verified: true, status: 'active' })).toEqual({
        AND: [{ verified: true, status: 'active' }, { sellerId: { notIn: ['desk-1'] } }],
      })
    })

    // The trap `scopedListingWhere` was rewritten to close, restated here so the twin cannot
    // regress into a spreadable fragment: object spread overwrites on key collision.
    it('keeps BOTH the caller sellerId filter and the exclusion', async () => {
      h.sellers = [{ id: 'desk-1' }]
      const result = await deskExcludedListingWhere({ sellerId: 'a-real-seller' })
      expect(result).toEqual({ AND: [{ sellerId: 'a-real-seller' }, { sellerId: { notIn: ['desk-1'] } }] })
    })

    it('never returns an unfiltered predicate when no desk resolves', async () => {
      h.sellers = []
      await expect(deskExcludedListingWhere({ verified: true })).rejects.toThrow(DeskResolutionError)
    })

    it('lets a database error stop the import rather than importing everything', async () => {
      h.throwOnQuery = new Error('connection reset')
      await expect(deskExcludedListingWhere({ verified: true })).rejects.toThrow('connection reset')
    })
  })
})

/**
 * `HIDDEN_DESK_OWNER_EMAILS` — the licensing exclusion list, split out from the two desk-ROUTING
 * variables it used to share.
 *
 * ⚠️ THESE TESTS EXIST BECAUSE THE CONFLATION WAS ONE ENV EDIT AWAY FROM DELETING A PARTNER FROM
 * THE MARKETPLACE. While "who answers a visa thread" and "who eno.vn must hide" were the same list,
 * pointing VISA_SHOP_OWNER_EMAIL at VietKite — the intended routing change — would have hidden
 * their 26 live home-feed listings, 404'd their storefront and every one of their conversations,
 * and stripped their official-partner exemption. The variables are separate now; these pin that
 * they stay separate, and that the default is still the old behaviour.
 *
 * The module reads the variable at import time, so each case re-imports with `resetModules` rather
 * than mutating a already-bound constant.
 */
describe('HIDDEN_DESK_OWNER_EMAILS', () => {
  const load = async (value: string | undefined) => {
    vi.resetModules()
    const prev = process.env.HIDDEN_DESK_OWNER_EMAILS
    if (value === undefined) delete process.env.HIDDEN_DESK_OWNER_EMAILS
    else process.env.HIDDEN_DESK_OWNER_EMAILS = value
    try {
      return await import('./edition-scope')
    } finally {
      if (prev === undefined) delete process.env.HIDDEN_DESK_OWNER_EMAILS
      else process.env.HIDDEN_DESK_OWNER_EMAILS = prev
    }
  }

  it('UNSET falls back to the historical union, so the split is a no-op until someone opts in', async () => {
    const m = await load(undefined)
    // The two mocked desk lists, deduped: shared@eno.vn appears in both.
    expect([...m.HIDDEN_DESK_OWNER_EMAILS].sort()).toEqual(['shared@eno.vn', 'trips@eno.vn', 'visa@eno.vn'])
  })

  it('SET replaces the union entirely — a desk address is not implicitly hidden any more', async () => {
    const m = await load('support@eno.forum')
    expect([...m.HIDDEN_DESK_OWNER_EMAILS]).toEqual(['support@eno.forum'])
    // The routing addresses are NOT dragged along.
    expect(m.HIDDEN_DESK_OWNER_EMAILS).not.toContain('visa@eno.vn')
    expect(m.HIDDEN_DESK_OWNER_EMAILS).not.toContain('trips@eno.vn')
  })

  it('normalises case and whitespace, so a stray space cannot silently un-hide a desk', async () => {
    const m = await load('  Support@Eno.Forum , ops@eno.vn ')
    expect([...m.HIDDEN_DESK_OWNER_EMAILS]).toEqual(['support@eno.forum', 'ops@eno.vn'])
  })

  it('EMPTY means "this edition hides nobody" and never reaches the database', async () => {
    const m = await load('')
    expect([...m.HIDDEN_DESK_OWNER_EMAILS]).toEqual([])
    h.lastWhere = null
    h.sellers = [{ id: 'should-not-be-returned' }]
    // ⚠️ The query is SKIPPED, not sent with `in: []` — Prisma answers that with a match-nothing
    // predicate, which happens to be right here but would hide the bug if the semantics changed.
    await expect(m.deskSellerIds()).resolves.toEqual([])
    expect(h.lastWhere).toBeNull()
  })
})
