import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Serving paid ads (src/lib/ads/serve.ts): which requests may carry one, that a listing ad is intersected with the
 * request's OWN filter (an ad is only ever a card that request could have returned), that only RUNNING ads are picked,
 * that a creative is a candidate only when the request opts in and only while it is approved, and the merge (ad first,
 * its organic copy dropped, nothing else touched).
 */
vi.mock('server-only', () => ({}))
type Ad = { id: string; listingId: string | null; creativeId: string | null; startsAt: Date | null; endsAt: Date | null }
const h = vi.hoisted(() => ({
  adWhere: null as unknown, listingWhere: null as unknown, listingCalls: 0,
  ads: [] as Ad[], listings: [] as { id: string }[], creatives: [] as Record<string, unknown>[], creativeWhere: null as unknown,
  translations: {} as Record<string, Record<string, string>>, translationReads: 0,
}))
vi.mock('@/lib/db', () => ({
  db: {
    listingAd: { findMany: async ({ where }: { where: unknown }) => { h.adWhere = where; return h.ads } },
    adCreative: { findMany: async ({ where }: { where: { id: { in: string[] }; status: string } }) => { h.creativeWhere = where; return h.creatives.filter((c) => where.id.in.includes(c.id as string) && c.status === where.status) } },
    listing: { findMany: async ({ where }: { where: unknown }) => { h.listingCalls++; h.listingWhere = where; return h.listings } },
  },
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (l: { id: string }) => ({ id: l.id, title: 't' }) }))
vi.mock('@/lib/translate', () => ({
  localizeListingTitles: async (x: unknown[]) => x,
  cachedTranslations: async (texts: string[]) => { h.translationReads++; return Object.fromEntries(texts.filter((t) => h.translations[t]).map((t) => [t, h.translations[t]!])) },
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { adEligibleRequest, adEventState, pickAd, withAd, __resetAdServeCache } = await import('./serve')
const NOW = new Date('2026-11-23T08:00:00Z')
const RUN = { startsAt: new Date('2026-11-23T00:00:00Z'), endsAt: new Date('2026-11-30T08:00:00Z') }
const CALIBRATED = 'jev-1.14.0+gemini-4-hydrogen#0.5:abcd1234@2026-11-26:t0.5/0.6/0.5:q12345678'
const CREATIVE = { id: 'cr1', status: 'approved', advertiserName: 'Bean', headline: 'Cà phê mỗi sáng', body: null, imageUrl: 'https://sb.example/storage/v1/object/public/listings/ads/1.webp', clickUrl: 'https://bean.vn/', reviewModel: CALIBRATED }

beforeEach(() => {
  __resetAdServeCache()
  delete process.env.AD_REVIEW_ALLOW_PROVISIONAL
  // Creative ads open to everyone, as after the private test (creative-gate.ts); the test itself has its own describe.
  vi.stubEnv('ADS_CREATIVE_OPEN', '1')
  h.ads = [{ id: 'ad1', listingId: 'l1', creativeId: null, ...RUN }, { id: 'ad2', listingId: 'l9', creativeId: null, ...RUN }]
  h.listings = [{ id: 'l1' }]
  h.creatives = [CREATIVE]
  h.listingCalls = 0
  h.translations = {}
  h.translationReads = 0
})
afterEach(() => vi.unstubAllEnvs())

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

describe('pickAd — listing ads', () => {
  it('asks only for active ads, and only among cards the request\'s own filter returns', async () => {
    const feedWhere = { AND: [{ verified: true }, { categoryId: 'c-vehicles' }] }
    const ad = await pickAd(feedWhere, undefined, NOW)
    expect(h.adWhere).toEqual({ status: 'active', endsAt: { gt: new Date(NOW.getTime() - 86_400_000) } })
    expect(h.listingWhere).toEqual({ AND: [feedWhere, { id: { in: ['l1', 'l9'] } }] })
    // l9 does not match this request, so ad1 is served.
    expect(ad).toEqual({ listing: { id: 'l1', title: 't', isSponsored: true, adId: 'ad1' }, creative: null })
  })

  it('an ad not started yet, or ended, is never picked', async () => {
    h.ads = [{ id: 'ad1', listingId: 'l1', creativeId: null, startsAt: new Date('2026-11-24T00:00:00Z'), endsAt: new Date('2026-11-30T00:00:00Z') }, { id: 'ad3', listingId: 'l1', creativeId: null, startsAt: new Date('2026-11-20T00:00:00Z'), endsAt: new Date('2026-11-23T07:00:00Z') }]
    expect(await pickAd({}, undefined, NOW)).toEqual({ listing: null, creative: null })
  })

  it('no running ad or no matching card → no ad', async () => {
    h.listings = []
    expect(await pickAd({}, undefined, NOW)).toEqual({ listing: null, creative: null })
    __resetAdServeCache()
    h.ads = []
    expect(await pickAd({}, undefined, NOW)).toEqual({ listing: null, creative: null })
  })
})

describe('pickAd — creative ads', () => {
  it('⛔ never a null into `id: { in }`: only creative ads running → no listing query at all', async () => {
    h.ads = [{ id: 'ad7', listingId: null, creativeId: 'cr1', ...RUN }]
    const r = await pickAd({}, 'vi', NOW, { creatives: true })
    expect(h.listingCalls).toBe(0)
    expect(r.creative).toMatchObject({ adId: 'ad7', headline: 'Cà phê mỗi sáng', clickUrl: 'https://bean.vn/' })
  })

  it('a creative is a candidate ONLY when the request opts in (adc=1): otherwise listing ads only, as before', async () => {
    h.ads = [{ id: 'ad7', listingId: null, creativeId: 'cr1', ...RUN }]
    expect(await pickAd({}, undefined, NOW)).toEqual({ listing: null, creative: null })
  })

  it('rotation: a uniform pick among matching listing ads AND running creatives', async () => {
    h.ads = [{ id: 'ad1', listingId: 'l1', creativeId: null, ...RUN }, { id: 'ad7', listingId: null, creativeId: 'cr1', ...RUN }]
    const seen = new Set<string>()
    const rnd = vi.spyOn(Math, 'random')
    for (const x of [0.1, 0.9]) {
      rnd.mockReturnValueOnce(x)
      const r = await pickAd({}, undefined, NOW, { creatives: true })
      seen.add(r.listing ? `listing:${r.listing.adId}` : `creative:${r.creative!.adId}`)
    }
    rnd.mockRestore()
    expect(seen).toEqual(new Set(['listing:ad1', 'creative:ad7']))
  })

  it('⛔ a removed creative (or one approved by a provisional review) is never served', async () => {
    h.ads = [{ id: 'ad7', listingId: null, creativeId: 'cr1', ...RUN }]
    h.creatives = [{ ...CREATIVE, status: 'removed' }]
    expect((await pickAd({}, undefined, NOW, { creatives: true })).creative).toBeNull()
    expect(h.creativeWhere).toEqual({ id: { in: ['cr1'] }, status: 'approved' })
    __resetAdServeCache()
    h.creatives = [{ ...CREATIVE, reviewModel: 'jev-1.14.0+gemini-4-hydrogen#0.5:abcd1234@provisional:t0.5/0.6/0.5:q12345678' }]
    expect((await pickAd({}, undefined, NOW, { creatives: true })).creative).toBeNull()
    // …and its beacons count as invalid, not as nothing.
    expect(await adEventState('ad7', NOW)).toBe('known')
  })

  it('the words in the viewer\'s language from the translation store, read once per (creative, language)', async () => {
    h.ads = [{ id: 'ad7', listingId: null, creativeId: 'cr1', ...RUN }]
    h.translations = { 'Cà phê mỗi sáng': { en: 'Coffee every morning', ko: '매일 아침 커피' } }
    expect((await pickAd({}, 'en', NOW, { creatives: true })).creative).toMatchObject({ headline: 'Cà phê mỗi sáng', headlineI18n: { en: 'Coffee every morning' } })
    expect((await pickAd({}, 'ko', NOW, { creatives: true })).creative).toMatchObject({ headlineI18n: { ko: '매일 아침 커피' } })
    await pickAd({}, 'en', NOW, { creatives: true })
    expect(h.translationReads).toBe(2)
    // No language asked: the advertiser's words as written (the client translates).
    expect((await pickAd({}, undefined, NOW, { creatives: true })).creative!.headlineI18n).toBeUndefined()
  })
})

/** The private test (creative-gate.ts, ADS_CREATIVE_OPEN unset): a creative only for a feed request with `adpreview=1`. */
describe('pickAd — creative ads in their private test', () => {
  beforeEach(() => {
    vi.stubEnv('ADS_CREATIVE_OPEN', '')
    h.ads = [{ id: 'ad1', listingId: 'l1', creativeId: null, ...RUN }, { id: 'ad7', listingId: null, creativeId: 'cr1', ...RUN }]
  })
  const picks = async (opts: { creatives?: boolean; preview?: boolean }) => {
    const seen = new Set<string>()
    const rnd = vi.spyOn(Math, 'random')
    for (const x of [0.1, 0.9]) {
      rnd.mockReturnValueOnce(x)
      const r = await pickAd({}, undefined, NOW, opts)
      seen.add(r.listing ? `listing:${r.listing.adId}` : r.creative ? `creative:${r.creative.adId}` : 'none')
    }
    rnd.mockRestore()
    return seen
  }

  it('⛔ closed, without the preview: never a creative — the listing ad alone, opted in (adc=1) or not', async () => {
    expect(await picks({ creatives: true })).toEqual(new Set(['listing:ad1']))
    expect(await picks({})).toEqual(new Set(['listing:ad1']))
    h.ads = [{ id: 'ad7', listingId: null, creativeId: 'cr1', ...RUN }]
    __resetAdServeCache()
    expect(await pickAd({}, undefined, NOW, { creatives: true })).toEqual({ listing: null, creative: null })
  })

  it('closed, with the preview (adpreview=1) and the opt-in: the creative takes its turn as when open', async () => {
    expect(await picks({ creatives: true, preview: true })).toEqual(new Set(['listing:ad1', 'creative:ad7']))
  })

  it('the preview alone is no opt-in: a client that draws no creative card (no adc=1) still gets listing ads only', async () => {
    expect(await picks({ preview: true })).toEqual(new Set(['listing:ad1']))
  })

  it('open (ADS_CREATIVE_OPEN=1): the creative without any preview', async () => {
    vi.stubEnv('ADS_CREATIVE_OPEN', '1')
    expect(await picks({ creatives: true })).toEqual(new Set(['listing:ad1', 'creative:ad7']))
  })
})

describe('the beacons\' view of an ad (adEventState)', () => {
  it('running now → running; paid but not running (ended within a day, not started) → known; anything else → unknown', async () => {
    h.ads = [
      { id: 'ad1', listingId: 'l1', creativeId: null, ...RUN },
      { id: 'ad3', listingId: 'l1', creativeId: null, startsAt: new Date('2026-11-20T00:00:00Z'), endsAt: new Date('2026-11-23T07:00:00Z') },
    ]
    expect(await adEventState('ad1', NOW)).toBe('running')
    expect(await adEventState('ad3', NOW)).toBe('known')
    expect(await adEventState('nope12345', NOW)).toBe('unknown')
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

describe('the set lives 15 s (a removal stops serving within a minute with the 45 s edge copy)', () => {
  it('a missing table (before the DDL) or a DB blip serves no ad and asks again only after the TTL', async () => {
    const { db } = await import('@/lib/db')
    let calls = 0
    const spy = vi.spyOn(db.listingAd, 'findMany').mockImplementation((async () => { calls++; throw new Error('relation "ListingAd" does not exist') }) as never)
    expect(await pickAd({}, undefined, NOW)).toEqual({ listing: null, creative: null })
    expect(await pickAd({}, undefined, new Date(NOW.getTime() + 10_000))).toEqual({ listing: null, creative: null })
    expect(calls).toBe(1)
    expect(await pickAd({}, undefined, new Date(NOW.getTime() + 16_000))).toEqual({ listing: null, creative: null })
    expect(calls).toBe(2)
    spy.mockRestore()
  })

  it('a creative removed by eno disappears at the next read once the cache is invalidated (admin removal)', async () => {
    h.ads = [{ id: 'ad7', listingId: null, creativeId: 'cr1', ...RUN }]
    expect((await pickAd({}, undefined, NOW, { creatives: true })).creative).not.toBeNull()
    h.creatives = [{ ...CREATIVE, status: 'removed' }]
    expect((await pickAd({}, undefined, new Date(NOW.getTime() + 1_000), { creatives: true })).creative).not.toBeNull()
    __resetAdServeCache()
    expect((await pickAd({}, undefined, new Date(NOW.getTime() + 2_000), { creatives: true })).creative).toBeNull()
  })
})
