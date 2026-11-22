import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The listing guard (owner 2026-11-22: "add a proper jev guardrail so we dont have improper posts without price or location
 * promotion like these … it should consume less jev tokens"). The floor is free and never depends on the model; Jev runs only
 * past it, once, on the words; anything that goes wrong with Jev lets the post through.
 */
const h = vi.hoisted(() => ({ exempt: false, counts: new Map<string, number>() }))
vi.mock('@/lib/listing-photo-refusal', () => ({ photoCheckExemptFor: vi.fn(async () => h.exempt) }))
vi.mock('@/lib/ratelimit', () => ({ kv: { incrby: vi.fn(async (k: string, by: number) => { h.counts.set(k, (h.counts.get(k) ?? 0) + by); return h.counts.get(k)! }) } }))
vi.mock('@/lib/log', () => ({ logInfo: vi.fn(), logError: vi.fn() }))

const g = await import('./listing-guard')
const { PublishBlockedError } = await import('./publish-guard')

const post = (o: Partial<Parameters<typeof g.assertListingGuard>[0]> = {}) => ({
  sellerId: 's1', category: 'food-drink', subcategory: null, listingType: 'sell', title: 'Homemade banh mi', description: 'Fresh baguette, pork belly.', price: 25_000, district: 'District 3', ...o,
})
const answer = (promo: number, fake?: number) => new Response(JSON.stringify({ model: 'jev-1.14.0', answers: { promo: { type: 'noul', noul: promo }, ...(fake === undefined ? {} : { fake_price: { type: 'noul', noul: fake } }) }, usage: { input_tokens: 470, output_tokens: 60 } }))
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  h.exempt = false; h.counts.clear()
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
  fetchMock = vi.fn(async () => answer(0.1, 0.05))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof PublishBlockedError ? e.code : `other:${String(e)}`))

describe('the price floor — free, no model', () => {
  it.each([['sell', 0], ['sell', 1], ['rent', 999], ['wholesale', 500], ['service', 0], ['event', 0], ['sell', Number.NaN]])('%s at %s đ → price_required', (t, p) => {
    expect(g.priceFloorProblem(t, p)).toBe('price_required')
  })
  it.each([['sell', 1_000], ['free', 0], ['job', 0], ['teacher', 0], ['wanted', 0]])('%s at %s đ passes', (t, p) => {
    expect(g.priceFloorProblem(t, p)).toBeNull()
  })
  it('⛔ refuses before any Jev call — the two live examples (a café post at 0 đ, a show promo at 1 đ) cost nothing', async () => {
    expect(await refusal(g.assertListingGuard(post({ title: 'Which Flavor are you Choosing Today?', price: 0 })))).toBe('price_required')
    expect(await refusal(g.assertListingGuard(post({ title: 'THE LOVE-STRUCK SOUL | DUY DUC', price: 1 })))).toBe('price_required')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Jev — one call, the words only', () => {
  it('asks both questions for a priced intent, on the pinned model, with the key as a Bearer token and no photo', async () => {
    await g.assertListingGuard(post())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('jev-1.14.0')
    expect(Object.keys(body.questions)).toEqual(['promo', 'fake_price'])
    expect(body.assets).toBeUndefined()
    expect(body.state).toContain('Title: Homemade banh mi')
    expect(body.state).toContain('Price: 25,000 đ')
  })
  it('a job or a giveaway is asked only whether it is an advert', async () => {
    fetchMock.mockResolvedValueOnce(answer(0.05))
    await g.assertListingGuard(post({ listingType: 'job', price: 0 }))
    expect(Object.keys(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).questions)).toEqual(['promo'])
  })
  it('cuts the description to 500 characters (tokens), whitespace folded', () => {
    const s = g.jevState(post({ description: `a  \n b ${'x'.repeat(900)}` }))
    expect(s).toContain('Description: a b x')
    expect(s.split('Description: ')[1].length).toBe(500)
  })
  it.each([
    [0.74, 0.05, 'not_a_listing'], [0.7, 0.05, 'not_a_listing'], [0.69, 0.05, null],
    [0.1, 0.85, 'price_placeholder'], [0.1, 0.84, null], [0.95, 0.95, 'not_a_listing'],
  ])('promo %s, placeholder price %s → %s', async (promo, fake, code) => {
    fetchMock.mockResolvedValueOnce(answer(promo, fake))
    expect(await refusal(g.assertListingGuard(post()))).toBe(code)
  })
})

describe('⛔ fails open — Jev never blocks a post by being unavailable', () => {
  it('no key → no call, passes', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '')
    expect(await refusal(g.assertListingGuard(post()))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([
    ['an HTTP error', async () => new Response('{}', { status: 529 })],
    ['a network error', async () => { throw new TypeError('fetch failed') }],
    ['the deadline', async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }],
    ['an answer out of range', async () => answer(1.7, 0.1)],
    ['a missing answer', async () => new Response(JSON.stringify({ answers: {} }))],
  ])('%s → passes', async (_n, impl) => {
    fetchMock.mockImplementationOnce(impl)
    expect(await refusal(g.assertListingGuard(post()))).toBeNull()
  })
  const today = () => new Date().toISOString().slice(0, 10)
  it(`over the day's cap for everyone (${g.JEV_DAILY_CAP} calls) → no call, passes; both refused charges are given back`, async () => {
    h.counts.set(`listing-guard-jev:${today()}`, g.JEV_DAILY_CAP)
    expect(await refusal(g.assertListingGuard(post()))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.counts.get(`listing-guard-jev:${today()}`)).toBe(g.JEV_DAILY_CAP)
    expect(h.counts.get(`listing-guard-jev-seller:s1:${today()}`)).toBe(0)
  })
  it(`⛔ one storefront past its own cap (${g.JEV_SELLER_DAILY_CAP}) is REFUSED until tomorrow — a spending limit is never a way round the check; another storefront is still checked`, async () => {
    h.counts.set(`listing-guard-jev-seller:s1:${today()}`, g.JEV_SELLER_DAILY_CAP)
    expect(await refusal(g.assertListingGuard(post()))).toBe('listing_check_limit')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.counts.get(`listing-guard-jev-seller:s1:${today()}`)).toBe(g.JEV_SELLER_DAILY_CAP)
    expect(h.counts.get(`listing-guard-jev:${today()}`) ?? 0).toBe(0)
    fetchMock.mockResolvedValueOnce(answer(0.95, 0.1))
    expect(await refusal(g.assertListingGuard(post({ sellerId: 's2' })))).toBe('not_a_listing')
  })
  it('the global counter failing after the storefront was charged gives the storefront its charge back, and the post passes', async () => {
    const { kv } = await import('@/lib/ratelimit')
    vi.mocked(kv.incrby).mockImplementationOnce(async (k: string, by: number) => { h.counts.set(k, (h.counts.get(k) ?? 0) + by); return h.counts.get(k)! })
      .mockImplementationOnce(async () => { throw new Error('kv down') })
    expect(await refusal(g.assertListingGuard(post()))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.counts.get(`listing-guard-jev-seller:s1:${today()}`)).toBe(0)
  })
  it('the floor still refuses with no key at all', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '')
    expect(await refusal(g.assertListingGuard(post({ price: 0 })))).toBe('price_required')
  })
})

describe('Community (meetups, classes, clubs, lost & found): a notice about an event is that category’s post', () => {
  it('no advert question there; a paid event still gets the price question', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ answers: { fake_price: { type: 'noul', noul: 0.1 } }, usage: { input_tokens: 400 } })))
    expect(await refusal(g.assertListingGuard(post({ category: 'community-events', listingType: 'event', title: 'Saturday language exchange, drinks included', price: 50_000 })))).toBeNull()
    expect(Object.keys(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).questions)).toEqual(['fake_price'])
  })
  it('a free meetup costs no call at all', async () => {
    expect(await refusal(g.assertListingGuard(post({ category: 'community-events', listingType: 'free', price: 0 })))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('a paid event at 0 đ is refused by the floor, with advice that fits (choose Free)', async () => {
    expect(await refusal(g.assertListingGuard(post({ category: 'community-events', listingType: 'event', price: 0 })))).toBe('price_required')
    expect(g.LISTING_GUARD_REFUSAL.price_required.en).toContain('If it’s free, choose Free')
  })
})

describe('exempt storefronts (teachers, protected stores, eno desks, official partners) are never checked', () => {
  it('no floor, no call', async () => {
    h.exempt = true
    expect(await refusal(g.assertListingGuard(post({ price: 0 })))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('bulk — one storefront, many rows', () => {
  const row = (o: Partial<ReturnType<typeof post>> = {}) => { const { sellerId: _s, ...r } = post(o); return r }
  it('floor per row, Jev only past it, a null row skipped; each row gets its own answer', async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => (String(init.body).includes('GRAND OPENING') ? answer(0.97, 0.6) : answer(0.1, 0.05)))
    const out = await g.listingGuardProblems('s1', [row({ price: 0 }), null, row({ title: 'GRAND OPENING – 50% off' }), row()])
    expect(out).toEqual(['price_required', null, 'not_a_listing', null])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('runs at most eight calls at once', async () => {
    let live = 0, peak = 0
    fetchMock.mockImplementation(async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return answer(0.1, 0.05) })
    await g.listingGuardProblems('s1', Array.from({ length: 30 }, () => row()))
    expect(fetchMock).toHaveBeenCalledTimes(30)
    expect(peak).toBe(8)
  })
  it('the exemption is asked per category, once each', async () => {
    const { photoCheckExemptFor } = await import('@/lib/listing-photo-refusal')
    vi.mocked(photoCheckExemptFor).mockClear()
    await g.listingGuardProblems('s1', [row(), row(), row({ category: 'electronics' }), row()])
    expect(vi.mocked(photoCheckExemptFor)).toHaveBeenCalledTimes(2)
  })
  it('a storefront past its cap: each remaining row is refused (listing_check_limit), no call', async () => {
    h.counts.set(`listing-guard-jev-seller:s1:${new Date().toISOString().slice(0, 10)}`, g.JEV_SELLER_DAILY_CAP)
    expect(await g.listingGuardProblems('s1', [row(), row({ price: 0 })])).toEqual(['listing_check_limit', 'price_required'])
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('⛔ a 20 s budget: past it no new call starts and the rows left pass unchecked (Cloudflare cuts at 100 s)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      fetchMock.mockImplementation(async () => { vi.setSystemTime(Date.now() + 6_000); return answer(0.95, 0.1) })
      const out = await g.listingGuardProblems('s1', Array.from({ length: 40 }, () => row()))
      expect(fetchMock.mock.calls.length).toBeLessThan(40)
      expect(out.filter((x) => x === null).length).toBe(40 - fetchMock.mock.calls.length)
    } finally { vi.useRealTimers() }
  })
  it('an exempt storefront: every row null, no call', async () => {
    h.exempt = true
    expect(await g.listingGuardProblems('s1', [row({ price: 0 }), row()])).toEqual([null, null])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the refusal sentences', () => {
  it('every code has both languages, and says what to fix', () => {
    for (const code of ['price_required', 'price_placeholder', 'not_a_listing', 'listing_check_limit'] as const) {
      expect(g.isListingGuardCode(code)).toBe(true)
      expect(g.LISTING_GUARD_REFUSAL[code].en.length).toBeGreaterThan(20)
      expect(g.LISTING_GUARD_REFUSAL[code].vi.length).toBeGreaterThan(20)
    }
    expect(g.isListingGuardCode('toString')).toBe(false)
  })
})
