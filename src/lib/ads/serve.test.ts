import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Serving paid ads (src/lib/ads/serve.ts): which requests may carry one, that the pick is intersected with the request's
 * OWN filter (an ad is only ever a card that request could have returned), that only RUNNING ads are asked for, and the
 * merge (ad first, its organic copy dropped, nothing else touched).
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ adWhere: null as unknown, listingWhere: null as unknown, ads: [] as { id: string; listingId: string; impressions: number; endsAt: Date }[], listings: [] as { id: string }[] }))
vi.mock('@/lib/db', () => ({
  db: {
    listingAd: { findMany: async ({ where }: { where: unknown }) => { h.adWhere = where; return h.ads } },
    listing: { findMany: async ({ where }: { where: unknown }) => { h.listingWhere = where; return h.listings } },
  },
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (l: { id: string }) => ({ id: l.id, title: 't' }) }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (x: unknown[]) => x }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { adEligibleRequest, pickAd, withAd, __resetAdServeCache } = await import('./serve')
const NOW = new Date('2026-11-23T08:00:00Z')

beforeEach(() => {
  __resetAdServeCache()
  h.ads = [{ id: 'ad1', listingId: 'l1', impressions: 5, endsAt: new Date('2026-11-30T08:00:00Z') }, { id: 'ad2', listingId: 'l9', impressions: 0, endsAt: new Date('2026-11-30T08:00:00Z') }]
  h.listings = [{ id: 'l1' }]
})

describe('adEligibleRequest', () => {
  it('first page of a public feed only: never a later page, a histogram, a storefront, an id list, featured or ads=0', () => {
    const sp = (q: string) => new URLSearchParams(q)
    expect(adEligibleRequest(sp('category=vehicles'), 0, false)).toBe(true)
    expect(adEligibleRequest(sp('q=honda'), 0, false)).toBe(true)
    expect(adEligibleRequest(sp('category=vehicles'), 12, false)).toBe(false)
    expect(adEligibleRequest(sp('category=vehicles'), 0, true)).toBe(false)
    expect(adEligibleRequest(sp('seller=s1'), 0, false)).toBe(false)
    expect(adEligibleRequest(sp('ids=a,b'), 0, false)).toBe(false)
    expect(adEligibleRequest(sp('featured=true'), 0, false)).toBe(false)
    expect(adEligibleRequest(sp('category=vehicles&ads=0'), 0, false)).toBe(false)
  })
})

describe('pickAd', () => {
  it('asks only for RUNNING ads, and only among cards the request\'s own filter returns', async () => {
    const feedWhere = { AND: [{ verified: true }, { categoryId: 'c-vehicles' }] }
    const ad = await pickAd(feedWhere, undefined, NOW)
    expect(h.adWhere).toEqual({ status: 'active', startsAt: { lte: NOW }, endsAt: { gt: NOW } })
    expect(h.listingWhere).toEqual({ AND: [feedWhere, { id: { in: ['l1', 'l9'] } }] })
    // l9 does not match this request, so ad1 is served even though ad2 has fewer impressions.
    expect(ad).toEqual({ id: 'l1', title: 't', isSponsored: true, adId: 'ad1' })
  })

  it('no running ad or no matching card → no ad; a failure serves the organic page', async () => {
    h.listings = []
    expect(await pickAd({}, undefined, NOW)).toBeNull()
    __resetAdServeCache()
    h.ads = []
    expect(await pickAd({}, undefined, NOW)).toBeNull()
  })
})

describe('withAd', () => {
  it('puts the ad first and drops its organic copy, keeping every other row in order', () => {
    const rows = [{ id: 'a' }, { id: 'l1' }, { id: 'b' }]
    expect(withAd(rows, { id: 'l1' }).map((r) => r.id)).toEqual(['l1', 'a', 'b'])
    expect(withAd(rows, { id: 'z' }).map((r) => r.id)).toEqual(['z', 'a', 'l1', 'b'])
    expect(withAd(rows, null)).toBe(rows)
  })
})

describe('a missing table (before the DDL) or a DB blip', () => {
  it('serves no ad and asks again only after the minute, not on every request', async () => {
    const { db } = await import('@/lib/db')
    let calls = 0
    const spy = vi.spyOn(db.listingAd, 'findMany').mockImplementation((async () => { calls++; throw new Error('relation "ListingAd" does not exist') }) as never)
    expect(await pickAd({}, undefined, NOW)).toBeNull()
    expect(await pickAd({}, undefined, new Date(NOW.getTime() + 30_000))).toBeNull()
    expect(calls).toBe(1)
    expect(await pickAd({}, undefined, new Date(NOW.getTime() + 61_000))).toBeNull()
    expect(calls).toBe(2)
    spy.mockRestore()
  })
})
