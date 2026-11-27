import { beforeEach, describe, expect, it, vi } from 'vitest'
// The new-Apple backstop (src/lib/new-apple-night.ts) reads its own rows; this suite's fake db would hand it the used fixtures.
vi.mock('@/lib/new-apple-night', () => ({ sellStaleNewApple: async () => ({ staleNewApple: 0 }) }))

// /api/cron/affiliate-crawl — the AccessTrade CRAWL campaigns (Hoàng Hà, ShopDunk; chat only) through the shared nightly
// body (src/lib/affiliate-night.ts). The crawl itself is faked; the body, the allow-list and the SQL builders are real.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  crawlCalls: [] as Array<{ campaign: string; campaignId: string }>,
  feedCalls: 0,
  rows: [] as Row[],
  prices: new Map<string, { price: number; affiliateUrl: string | null; name: string; url: string }>(),
  enoRun: true,
  complete: true,
  newSkus: new Set<string>(),
  soldOutSkus: new Set<string>(),
  soldOutDistrusted: 0,
  sql: [] as string[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/affiliate-price-refresh', async (orig) => ({
  ...(await orig<typeof import('@/lib/affiliate-price-refresh')>()),
  campaignIdFor: async () => { throw new Error('a crawl campaign never asks the datafeed for its id') },
  fetchFeedPrices: async () => { h.feedCalls++; throw new Error('a crawl campaign is never walked as a datafeed') },
}))
vi.mock('@/lib/accesstrade-crawl-feed', () => ({
  fetchCrawlPrices: async (campaign: string, campaignId: string) => {
    h.crawlCalls.push({ campaign, campaignId })
    return { prices: h.prices, unpriced: new Map(), seenIds: new Set(h.prices.keys()), seen: h.prices.size, complete: h.complete, dropped: 0, newSkus: h.newSkus,
      soldOutSkus: h.soldOutSkus, soldOutDistrusted: h.soldOutDistrusted,
      read: { rows: h.prices.size, unknown: 0, skippedNew: 0, pages: 3, failed: 0, fatal: false } }
  },
}))
vi.mock('@/lib/eno-run-partners', async (orig) => ({ ...(await orig<typeof import('@/lib/eno-run-partners')>()), isEnoRunPartner: () => h.enoRun }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: { findFirst: async () => ({ id: 's-hh', ownerId: 'o', officialPartner: true }) },
    listing: {
      findMany: async (a: Row) => {
        if (a.where.updatedAt) return []
        if (a.where.sellerId) return h.rows.map((r) => ({ ...r, purchaseLink: { url: r.staff ?? null } }))
        return []
      },
      updateMany: async () => ({ count: 0 }),
    },
    $queryRaw: async (q: { sql: string }) => { h.sql.push(q.sql.replace(/\s+/g, ' ')); return [] },
    $executeRaw: async (q: { sql: string }) => { h.sql.push(q.sql.replace(/\s+/g, ' ')); return 0 },
  },
}))

const { GET } = await import('./route')
const run = async () => {
  const res = await GET(new Request('https://eno.vn/api/cron/affiliate-crawl', { headers: { authorization: 'Bearer cron-secret' } }))
  return { status: res.status, body: await res.json() }
}
const LINK = (u: string) => `https://go.isclix.com/deep_link/7053736680188167797/5229340396064683522?url=${encodeURIComponent(u)}`

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  process.env.ACCESSTRADE_KEY = 'k'
  process.env.ACCESSTRADE_CRAWL_CAMPAIGNS = 'hoanghamobile'
  h.crawlCalls = []
  h.feedCalls = 0
  h.enoRun = true
  h.complete = true
  h.newSkus = new Set()
  h.soldOutSkus = new Set()
  h.soldOutDistrusted = 0
  h.sql = []
  const url = 'https://hoanghamobile.com/kho-san-pham-cu/iphone-13-128gb-p70001'
  // A crawl title does not say "cũ" — the used-wording rule must NOT judge it (the section is the evidence).
  h.rows = [{ id: 'L1', externalId: '70001', price: 9_000_000, affiliateUrl: null, status: 'active', condition: 'used', staff: LINK(url) }]
  h.prices = new Map([['70001', { price: 8_500_000, affiliateUrl: LINK(url), name: 'iPhone 13 128GB', url }]])
})

describe('affiliate-crawl — the crawl campaigns, chat only', () => {
  it('reads a crawl campaign with its allow-listed id and reprices it — no datafeed call, no used-wording filter', async () => {
    const { status, body } = await run()
    expect(status).toBe(200)
    expect(h.crawlCalls).toEqual([{ campaign: 'hoanghamobile', campaignId: '5229340396064683522' }])
    expect(h.feedCalls).toBe(0)
    const r = body.results[0]
    expect(r.crawl).toMatchObject({ rows: 1, fatal: false })
    expect(r.feedNotUsed).toBe(0)
    expect(r.soldNotUsed).toBe(0)
    expect(r.enoRun).toBe(true)
    // The price write keeps the public column NULL (chat only).
    const priceWrite = h.sql.find((s) => s.includes('"affiliateUrl"') && s.includes('price'))
    expect(priceWrite).toBeDefined()
  })

  it('⛔ refuses a chat-only campaign whose storefront is not a pinned eno-run pair — BEFORE any read or write', async () => {
    h.enoRun = false
    const { status, body } = await run()
    expect(status).toBe(502)
    expect(body.results).toEqual([{ campaign: 'hoanghamobile', error: 'chat_only_not_eno_run' }])
    expect(h.crawlCalls).toEqual([])
    expect(h.sql).toEqual([])
  })

  it('⛔ refuses a datafeed campaign named in the crawl list (never crawled)', async () => {
    process.env.ACCESSTRADE_CRAWL_CAMPAIGNS = 'cellphones_cps'
    const { status, body } = await run()
    expect(status).toBe(502)
    expect(body.results).toEqual([{ campaign: 'cellphones_cps', error: 'wrong_source' }])
    expect(h.crawlCalls).toEqual([])
  })

  it('⛔ an INCOMPLETE crawl is a failed night (502): what it saw is repriced, but the unit must go red', async () => {
    h.complete = false
    const { status, body } = await run()
    expect(status).toBe(502)
    expect(body.blocked).toBe(1)
    expect(body.results[0].mayRetire).toBe(false)
  })

  it('a unit whose title now DECLARES new goods leaves the used shelf as positive evidence (the not-used path), not as "missing"', async () => {
    h.newSkus = new Set(['70001'])
    const { body } = await run()
    expect(body.results[0].feedNotUsed).toBe(1)
    expect(body.results[0].soldNotUsed).toBeGreaterThanOrEqual(0)
    expect(h.sql.some((s) => s.includes("SET status = 'sold'"))).toBe(true)
  })

  it('⛔ a complete crawl whose retire is HELD by a floor, with units to retire, is a red night too', async () => {
    h.prices = new Map() // the shop no longer lists our one unit — but 1 matched < the 20-row floor holds the retire
    const { status, body } = await run()
    expect(status).toBe(502)
    expect(body.results[0]).toMatchObject({ mayRetire: false, retireCandidates: 1 })
  })

  it('⛔ a COMPLETE crawl over the cap DRAINS up to the cap (one device per row never relists) — and still goes red', async () => {
    const url = (n: number) => `https://hoanghamobile.com/kho-san-pham-cu/u-p${n}`
    h.rows = Array.from({ length: 100 }, (_, n) => ({ id: `L${n}`, externalId: String(80000 + n), price: 1_000_000, affiliateUrl: null, status: 'active', condition: 'used', staff: LINK(url(n)) }))
    // 60 of 100 still listed (≥ 50 % floor, ≥ 20 rows); 40 gone > the cap of 25 (MAX_RETIRE_FLOOR).
    h.prices = new Map(h.rows.slice(0, 60).map((r: Row, n: number) => [r.externalId, { price: 1_000_000, affiliateUrl: r.staff, name: 'x', url: url(n) }]))
    const { status, body } = await run()
    expect(status).toBe(502)
    expect(body.results[0]).toMatchObject({ mayRetire: false, cappedOut: true, retireCandidates: 40, drained: 25 })
  })

  it('⚖️ below the 50 % floor nothing is drained (a flaky empty grid must not sell live units) — the night is red', async () => {
    const url = (n: number) => `https://hoanghamobile.com/kho-san-pham-cu/u-p${n}`
    h.rows = Array.from({ length: 100 }, (_, n) => ({ id: `L${n}`, externalId: String(90000 + n), price: 1_000_000, affiliateUrl: null, status: 'active', condition: 'used', staff: LINK(url(n)) }))
    h.prices = new Map(h.rows.slice(0, 40).map((r: Row, n: number) => [r.externalId, { price: 1_000_000, affiliateUrl: r.staff, name: 'x', url: url(n) }]))
    const { status, body } = await run()
    expect(status).toBe(502)
    expect(body.results[0]).toMatchObject({ mayRetire: false, retireCandidates: 60 })
    expect(body.results[0].drained).toBeUndefined()
  })

  // Owner 2026-11-23: "check should be on availability like this product is out of stock" (ShopDunk: 165 of 214 sold out).
  const shelf = (n: number) => {
    const url = (i: number) => `https://shopdunk.com/p-${i}`
    h.rows = Array.from({ length: n }, (_, i) => ({ id: `S${i}`, externalId: String(7000 + i), price: 1_000_000, affiliateUrl: null, status: 'active', condition: 'used', staff: LINK(url(i)) }))
    return url
  }
  it('units the shop SHOWS sold out go to sold as positive evidence — outside the 50 % floor that would hold a 77 % sold-out shelf', async () => {
    const url = shelf(100)
    h.prices = new Map(h.rows.slice(0, 23).map((r: Row, i: number) => [r.externalId, { price: 1_000_000, affiliateUrl: r.staff, name: 'x', url: url(i) }]))
    h.soldOutSkus = new Set(h.rows.slice(23).map((r: Row) => r.externalId))
    const { status, body } = await run()
    // 77 > the night's budget of 25 → done, and the night is red so a person looks.
    expect(status).toBe(502)
    expect(body.results[0]).toMatchObject({ soldOutAlarm: true, retireCandidates: 0, mayRetire: true, activeHeld: 23, matchedActive: 23 })
    const retire = h.sql.find((s) => s.includes("SET status = 'sold'"))
    expect(retire).toBeTruthy()
  })
  it('a few sold out within the budget: sold, a green night', async () => {
    const url = shelf(30)
    h.prices = new Map(h.rows.slice(0, 27).map((r: Row, i: number) => [r.externalId, { price: 1_000_000, affiliateUrl: r.staff, name: 'x', url: url(i) }]))
    h.soldOutSkus = new Set(h.rows.slice(27).map((r: Row) => r.externalId))
    const { status, body } = await run()
    expect(status).toBe(200)
    expect(body.results[0]).toMatchObject({ retireCandidates: 0, mayRetire: true })
    expect(body.results[0].soldOutAlarm).toBeUndefined()
    expect(h.sql.some((s) => s.includes("SET status = 'sold'"))).toBe(true)
  })
  it('⛔ sold-out ids the feed did not trust: nothing sold for them, the night is red', async () => {
    shelf(30)
    h.prices = new Map(h.rows.map((r: Row, i: number) => [r.externalId, { price: 1_000_000, affiliateUrl: r.staff, name: 'x', url: `https://shopdunk.com/p-${i}` }]))
    h.soldOutDistrusted = 4
    const { status, body } = await run()
    expect(status).toBe(502)
    expect(body.results[0]).toMatchObject({ soldOutDistrusted: 4, soldOut: 0 })
    expect(h.sql.some((s) => s.includes("SET status = 'sold'"))).toBe(false)
  })

  it('an empty crawl list reads nothing, as a 200', async () => {
    process.env.ACCESSTRADE_CRAWL_CAMPAIGNS = ''
    const { status, body } = await run()
    expect(status).toBe(200)
    expect(body.skipped).toBe('no_campaigns')
  })
})
