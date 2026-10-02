import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The gone-storefront rule (owner, 2026-10-02: the emptied SuperSports shop, "remove it too") —
 * an OWNERLESS seller that HAD listings and has no publicly visible one left has no storefront; an
 * OWNED one always does, and so does an ownerless one that never had a listing (the support / rental
 * desks, which every buyer's inbox links to).
 */
const h = vi.hoisted(() => ({
  /** The public probe's answer (a verified active-or-sold row of this seller's). */
  publicRow: null as null | { id: string },
  /** The any-listing probe's answer (does this seller hold ANY row at all — an emptied catalogue?). */
  anyRow: null as null | { id: string },
  wheres: [] as unknown[],
  sellerWheres: [] as unknown[],
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      // The two probes are told apart by their predicate: only the public one asks `verified`.
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        h.wheres.push(where)
        return 'verified' in where ? h.publicRow : h.anyRow
      },
    },
    seller: {
      findMany: async ({ where }: { where: unknown }) => {
        h.sellerWheres.push(where)
        return []
      },
    },
  },
}))
// get-listing.ts (the PDP's own viewability rule, pinned against ours below) and the surfaces at the
// bottom import the scope; a passthrough keeps their own predicates visible.
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: object) => w,
  marketplaceListingScope: async () => ({}),
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: (l: unknown) => l }))

import { isPublicListing, isStorefrontGone, liveStorefrontWhere, publicListingWhere, PUBLIC_LISTING_STATUSES, storefrontIsGone } from './storefront-gone'
import { listingIsViewable } from '@/app/[lang]/listings/[id]/(pdp)/get-listing'
import { topBusinessListings } from '@/lib/core/business-rail'
import { submittedListingWhere } from '@/lib/sitemap'

beforeEach(() => {
  h.publicRow = null
  h.anyRow = null
  h.wheres = []
  h.sellerWheres = []
})

describe('storefrontIsGone — the rule', () => {
  it('ownerless + had listings + nothing public → gone (an emptied catalogue)', () => {
    expect(storefrontIsGone({ ownerId: null }, false, true)).toBe(true)
  })
  it('the any-listing flag defaults to "had listings", so a two-argument call still means emptied → gone', () => {
    expect(storefrontIsGone({ ownerId: null }, false)).toBe(true)
  })
  it('ownerless + NEVER had a listing → shown (the support / rental desk)', () => {
    expect(storefrontIsGone({ ownerId: null }, false, false)).toBe(false)
  })
  it('ownerless + one public listing → shown', () => {
    expect(storefrontIsGone({ ownerId: null }, true)).toBe(false)
    expect(storefrontIsGone({ ownerId: null }, true, true)).toBe(false)
  })
  it('owned + empty → shown (a real person keeps their shop), whether or not it ever had a row', () => {
    expect(storefrontIsGone({ ownerId: '00000000-0000-0000-0000-000000000001' }, false)).toBe(false)
    expect(storefrontIsGone({ ownerId: '00000000-0000-0000-0000-000000000001' }, false, true)).toBe(false)
    expect(storefrontIsGone({ ownerId: '00000000-0000-0000-0000-000000000001' }, false, false)).toBe(false)
  })
})

describe('isStorefrontGone — the probe', () => {
  it('ownerless, emptied (rows, none public): gone — the public probe, then the any-listing probe, both for this seller, edition-blind', async () => {
    h.anyRow = { id: 'hidden-1' }
    expect(await isStorefrontGone({ id: 'cmu52jkld0000czq443snv0jh', ownerId: null })).toBe(true)
    expect(h.wheres).toEqual([
      { sellerId: 'cmu52jkld0000czq443snv0jh', verified: true, status: { in: ['active', 'sold'] } },
      { sellerId: 'cmu52jkld0000czq443snv0jh' },
    ])
  })

  // The desks are unowned and hold no listing BY CONSTRUCTION (support-thread.ts, the rental desk): their
  // storefront is the one every buyer's inbox links to, and the native apps open it from the thread header.
  it.each(['eno-support-desk', 'eno-support-desk-forum', 'eno-rental-desk'])(
    'ownerless and NEVER had a listing (%s): NOT gone, after both probes found nothing',
    async (id) => {
      expect(await isStorefrontGone({ id, ownerId: null })).toBe(false)
      expect(h.wheres).toEqual([
        { sellerId: id, verified: true, status: { in: ['active', 'sold'] } },
        { sellerId: id },
      ])
    },
  )

  it('ownerless with one active or sold listing: shown, and the any-listing probe never runs', async () => {
    h.publicRow = { id: 'L1' }
    h.anyRow = { id: 'L1' }
    expect(await isStorefrontGone({ id: 's1', ownerId: null })).toBe(false)
    expect(h.wheres).toEqual([{ sellerId: 's1', verified: true, status: { in: ['active', 'sold'] } }])
  })

  it('an owned seller never probes, even empty', async () => {
    expect(await isStorefrontGone({ id: 's1', ownerId: 'p1' })).toBe(false)
    expect(h.wheres).toEqual([])
  })

  it('a live count the caller already ran answers without a probe', async () => {
    expect(await isStorefrontGone({ id: 's1', ownerId: null }, 3)).toBe(false)
    expect(h.wheres).toEqual([])
  })
})

describe('the public-listing predicate is the PDP\'s', () => {
  // Every status the database holds today (measured 2026-10-02) plus the tombstone.
  const STATUSES = ['active', 'sold', 'hidden', 'stale', 'expired', 'removed', 'pending']

  it.each(STATUSES)('status %s: a shop is kept alive exactly when the PDP would open the row', (status) => {
    expect(isPublicListing({ verified: true, status })).toBe(listingIsViewable({ verified: true, status }))
    expect(PUBLIC_LISTING_STATUSES.includes(status)).toBe(listingIsViewable({ verified: true, status }))
  })

  it('an unverified row never counts', () => {
    expect(isPublicListing({ verified: false, status: 'active' })).toBe(false)
    expect(publicListingWhere()).toEqual({ verified: true, status: { in: ['active', 'sold'] } })
  })
})

describe('liveStorefrontWhere — for surfaces that list or link shops', () => {
  it('keeps owned sellers, ownerless ones with a public listing, and ownerless ones that never had a listing (the desks)', () => {
    expect(liveStorefrontWhere()).toEqual({
      OR: [
        { ownerId: { not: null } },
        { listings: { some: { verified: true, status: { in: ['active', 'sold'] } } } },
        { listings: { none: {} } },
      ],
    })
  })

  /**
   * The `where` and the pure rule must agree on every shape of shop, or a surface that LISTS shops would
   * keep one that a surface that OPENS it 404s (or drop one it serves). Evaluated by hand against exactly
   * the branch shapes above — an unknown branch throws, so widening the fragment forces this to be revisited.
   */
  type Shop = { ownerId: string | null; listings: { verified: boolean; status: string }[] }
  const matchesBranch = (b: Record<string, any>, shop: Shop): boolean => {
    if ('ownerId' in b) {
      expect(b).toEqual({ ownerId: { not: null } })
      return shop.ownerId !== null
    }
    if (b.listings && 'some' in b.listings) {
      expect(b.listings.some).toEqual(publicListingWhere())
      return shop.listings.some((l) => isPublicListing(l))
    }
    if (b.listings && 'none' in b.listings) {
      expect(b.listings.none).toEqual({})
      return shop.listings.length === 0
    }
    throw new Error(`liveStorefrontWhere grew a branch this test does not know: ${JSON.stringify(b)}`)
  }
  const isLive = (shop: Shop) => (liveStorefrontWhere().OR as Record<string, any>[]).some((b) => matchesBranch(b, shop))

  const SHOPS: [string, Shop][] = [
    ['emptied import catalogue (all hidden)', { ownerId: null, listings: [{ verified: true, status: 'hidden' }, { verified: true, status: 'stale' }] }],
    ['ownerless, only unverified rows', { ownerId: null, listings: [{ verified: false, status: 'active' }] }],
    ['ownerless, one sold row', { ownerId: null, listings: [{ verified: true, status: 'hidden' }, { verified: true, status: 'sold' }] }],
    ['ownerless, active stock', { ownerId: null, listings: [{ verified: true, status: 'active' }] }],
    ['a desk: ownerless, never had a listing', { ownerId: null, listings: [] }],
    ['owned, empty', { ownerId: 'p1', listings: [] }],
    ['owned, all hidden', { ownerId: 'p1', listings: [{ verified: true, status: 'hidden' }] }],
  ]

  it.each(SHOPS)('%s: listed exactly when the rule says it is not gone', (_label, shop) => {
    const gone = storefrontIsGone(shop, shop.listings.some((l) => isPublicListing(l)), shop.listings.length > 0)
    expect(isLive(shop)).toBe(!gone)
  })

  it('only the emptied shapes (rows, none public) are gone among them', () => {
    expect(SHOPS.filter(([, shop]) => !isLive(shop)).map(([label]) => label)).toEqual([
      'emptied import catalogue (all hidden)',
      'ownerless, only unverified rows',
    ])
  })

  it('hands out a fresh object each call, so no caller can mutate another\'s filter', () => {
    const a = liveStorefrontWhere()
    expect(a).not.toBe(liveStorefrontWhere())
  })
})

/**
 * ⚠️ THE SURFACES THAT NEED NO GATE OF THEIR OWN, AND WHY — pinned so the reason cannot quietly lapse.
 * Each one only ever names a shop that holds an ACTIVE verified listing, which is a public listing, so a
 * gone shop (none) cannot reach it. Should one of them widen to sellers without stock, this goes red and
 * that surface needs `liveStorefrontWhere()`.
 */
describe('surfaces that are gone-safe by construction', () => {
  it('the "Outstanding businesses" rail picks only sellers with an active verified listing', async () => {
    await topBusinessListings()
    expect(h.sellerWheres[0]).toMatchObject({ listings: { some: { verified: true, status: 'active' } } })
  })

  it('pages.xml submits a storefront only for a seller with an own active verified listing', async () => {
    const where = JSON.stringify(await submittedListingWhere())
    expect(where).toContain('"verified":true')
    expect(where).toContain('"status":"active"')
  })
})
