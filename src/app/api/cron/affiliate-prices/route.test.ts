import { beforeEach, describe, expect, it, vi } from 'vitest'

// The affiliate-prices cron's RESTORE (sold → active) is screened (2026-10-01): a banned row is not
// restored and is hidden, an ambiguous one is restored and reported, and a tombstone ('removed') is
// never a candidate — nor is its price refreshed. The restock screen and the SQL builders are the real
// ones; only the network and the database are faked.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  feedCalls: 0,
  rows: [] as Row[],
  feed: new Map<string, { price: number; affiliateUrl: string | null; name: string; url: string }>(),
  throwFor: '',
  budgets: [] as { deadline: number }[],
  sql: [] as Array<{ text: string; values: unknown[] }>,
  updateMany: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/affiliate-price-refresh', async (orig) => ({
  ...(await orig<typeof import('@/lib/affiliate-price-refresh')>()),
  campaignIdFor: async () => '123',
  fetchFeedPrices: async (campaign: string, _k: string, _id: string, _p: unknown, budget: { deadline: number }) => { h.feedCalls++; h.budgets.push(budget); if (campaign === h.throwFor) throw new Error('datafeeds page 2: HTTP 429'); return { prices: h.feed, seenIds: new Set(h.feed.keys()), seen: h.feed.size, complete: true, total: h.feed.size, dropped: 0 } },
}))

vi.mock('@/lib/db', () => ({
  db: {
    seller: { findFirst: async () => ({ id: 's1' }) },
    listing: {
      findMany: async (a: Row) => {
        if (a.where.updatedAt) return [] // flushRecent
        if (a.where.sellerId) return h.rows.map((r) => ({ id: r.id, externalId: r.externalId, price: r.price, affiliateUrl: null, status: r.status, condition: r.condition ?? 'used' }))
        // The restock screen's read: by id, still sold.
        return h.rows.filter((r) => a.where.id.in.includes(r.id) && r.status === a.where.status)
          .map((r) => ({ id: r.id, title: r.title, titleVi: null, description: null, descriptionVi: null, subcategorySlug: null, category: { slug: 'home-living' } }))
      },
      updateMany: async (a: Row) => {
        h.updateMany.push(a)
        const st = a.where.status
        const hit = h.rows.filter((r) => a.where.id.in.includes(r.id) && (typeof st === 'string' ? r.status === st : st.in.includes(r.status)))
        for (const r of hit) Object.assign(r, a.data)
        return { count: hit.length }
      },
    },
    $executeRaw: async (q: { sql: string; values: unknown[] }) => {
      h.sql.push({ text: q.sql.replace(/\s+/g, ' '), values: q.values })
      // The retire statement reports the rows it moved (the budget test reads it); everything else, none.
      return q.sql.includes("SET status = 'sold'") ? q.values.length : 0
    },
  },
}))

const { GET } = await import('./route')
const USED = { name: 'iPhone 12 128GB - Cũ đẹp', url: 'https://cellphones.com.vn/iphone-12-128gb-cu.html' }
const run = async () => (await GET(new Request('https://eno.vn/api/cron/affiliate-prices', { headers: { authorization: 'Bearer cron-secret' } }))).json()

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  process.env.ACCESSTRADE_KEY = 'k'
  // Named explicitly: an unset ACCESSTRADE_CAMPAIGNS walks nothing (see the last describe below).
  process.env.ACCESSTRADE_CAMPAIGNS = 'cellphones_cps'
  h.rows = [
    { id: 'ok', externalId: 'e-ok', price: 100, status: 'sold', title: 'Áo thun nam cotton' },
    { id: 'ban', externalId: 'e-ban', price: 100, status: 'sold', title: 'Bình sữa Pigeon 240ml' },
    { id: 'soju', externalId: 'e-soju', price: 100, status: 'sold', title: 'Soju Jinro vị đào' },
    { id: 'gone', externalId: 'e-gone', price: 100, status: 'removed', title: 'Áo thun nam cotton' },
  ]
  // Both campaigns are used-only since 2026-11-14, so the feed calls every row used (the route keeps only those).
  h.feed = new Map(h.rows.map((r) => [r.externalId, { price: 200, affiliateUrl: null, ...USED }]))
  h.throwFor = ''
  h.budgets = []
  h.sql = []
  h.updateMany = []
  h.feedCalls = 0
})

describe('GET /api/cron/affiliate-prices — the restore is screened', () => {
  it('restores ok + review rows only; the banned one is hidden; the tombstone is not a candidate', async () => {
    const out = await run()
    const restore = h.sql.find((q) => q.text.includes("SET status = 'active'"))!
    expect(restore.values).toEqual(['ok', 'soju'])
    expect(restore.text).toContain("AND status = 'sold'")
    expect(h.rows.find((r) => r.id === 'ban')!.status).toBe('hidden')
    expect(h.rows.find((r) => r.id === 'gone')!.status).toBe('removed')
    expect(h.updateMany).toEqual([{ where: { id: { in: ['ban'] }, status: 'sold' }, data: { status: 'hidden' } }])
    expect(out.results[0].restockScreen).toMatchObject({ hidden: 1, hiddenRows: [{ id: 'ban', rule: 'feeding_bottle' }], review: 1 })
  })

  // ⛔ A hidden row (the ad-ban sweep's journaled hide) still matches the feed, so the diff still moves its
  // price — and the write used to land, bumping "updatedAt" so the hide's --rollback refused it. The UPDATE
  // now lands on active + sold rows only; tombstones and hidden rows keep what they had.
  it("⛔ the nightly price write lands on active and sold rows only — never a tombstone or a hidden row", async () => {
    h.rows.push({ id: 'hid', externalId: 'e-hid', price: 100, status: 'hidden', title: 'Áo thun nam cotton' })
    h.feed.set('e-hid', { price: 200, affiliateUrl: null, ...USED })
    await run()
    const price = h.sql.find((q) => q.text.includes('SET price = v.price'))!
    expect(price.text).toContain("WHERE l.id = v.id AND l.status IN ('active', 'sold')")
    expect(price.text).not.toContain("<> 'removed'")
    // The hidden row is not a restore candidate either (only 'sold' is), and keeps its status.
    expect(h.rows.find((r) => r.id === 'hid')!.status).toBe('hidden')
    expect(h.sql.find((q) => q.text.includes("SET status = 'active'"))!.values).not.toContain('hid')
  })
})

// ⛔ SECOND-HAND FOCUS, 2026-10-03: the route read `ACCESSTRADE_CAMPAIGNS || 'cellphones_cps'`, so emptying
// the env to stop the job re-armed CellphoneS. Unset or empty now walks nothing — and still answers 200.
describe('GET /api/cron/affiliate-prices — the campaign list', () => {
  it.each([undefined, '', ' , '])('ACCESSTRADE_CAMPAIGNS=%j walks no feed and writes nothing', async (value) => {
    if (value === undefined) delete process.env.ACCESSTRADE_CAMPAIGNS
    else process.env.ACCESSTRADE_CAMPAIGNS = value
    const out = await run()
    expect(out).toEqual({ ok: true, results: [], skipped: 'no_campaigns' })
    expect(h.feedCalls).toBe(0)
    expect(h.sql).toEqual([])
    expect(h.updateMany).toEqual([])
  })

  it('walks exactly the campaigns named', async () => {
    process.env.ACCESSTRADE_CAMPAIGNS = 'cellphones_cps,dienthoaivui'
    const out = await run()
    expect(out.results.map((r: Row) => r.campaign)).toEqual(['cellphones_cps', 'dienthoaivui'])
    expect(h.feedCalls).toBe(2)
  })
})

// Commit gate 2026-11-14: the two shelves are used-only, and one shop's failure is that shop's.
describe('GET /api/cron/affiliate-prices — used-only shelves', () => {
  const NEW = { name: 'iPhone 17 Pro Max 256GB VN/A', url: 'https://cellphones.com.vn/iphone-17-pro-max.html' }
  const soldSql = () => h.sql.filter((q) => q.text.includes("SET status = 'sold'"))
  it('⛔ a SKU the shop now sells as NEW goes to sold if active, stays sold if sold — never repriced or restocked as used', async () => {
    h.rows.push({ id: 'new-sold', externalId: 'e-new1', price: 100, status: 'sold', title: 'Áo thun nam cotton' })
    h.rows.push({ id: 'new-live', externalId: 'e-new2', price: 100, status: 'active', title: 'Áo thun nam cotton' })
    h.feed.set('e-new1', { price: 200, affiliateUrl: null, ...NEW })
    h.feed.set('e-new2', { price: 200, affiliateUrl: null, ...NEW })
    const out = await run()
    // Through the retire's own statement (AND status = 'active'), so the restock can bring it back once it is used again.
    expect(soldSql().map((q) => q.values)).toContainEqual(['new-live'])
    expect(JSON.stringify(soldSql().map((q) => q.values))).not.toContain('new-sold')
    // ⛔ Never hidden: hidden is a state no nightly path reads back.
    expect(JSON.stringify(h.updateMany)).not.toMatch(/new-(sold|live)/)
    expect(h.sql.find((q) => q.text.includes("SET status = 'active'"))!.values).not.toContain('new-sold')
    expect(JSON.stringify(h.sql.find((q) => q.text.includes('SET price = v.price'))?.values ?? [])).not.toMatch(/new-(sold|live)/)
    expect(out.results[0]).toMatchObject({ feedNotUsed: 2, nowNewAlarm: false })
  })
  it('a feed row with no name is no evidence: its listing is left exactly as it is — not repriced, restocked or retired', async () => {
    h.rows.push({ id: 'noname', externalId: 'e-noname', price: 100, status: 'active', title: 'Áo thun nam cotton' })
    h.rows.push({ id: 'noname-sold', externalId: 'e-noname2', price: 100, status: 'sold', title: 'Áo thun nam cotton' })
    h.feed.set('e-noname', { price: 200, affiliateUrl: null, name: '', url: '' })
    h.feed.set('e-noname2', { price: 200, affiliateUrl: null, name: ' ', url: '' })
    const out = await run()
    expect(JSON.stringify(soldSql().map((q) => q.values))).not.toContain('noname')
    expect(JSON.stringify(h.sql.find((q) => q.text.includes('SET price = v.price'))?.values ?? [])).not.toContain('noname')
    expect(h.sql.find((q) => q.text.includes("SET status = 'active'"))!.values).not.toContain('noname-sold')
    expect(out.results[0].feedNotUsed).toBe(0)
  })
  it('one retire budget a night: the not-used pass spends first, the ordinary retire gets what is left', async () => {
    h.rows = []
    h.feed = new Map()
    for (let i = 0; i < 20; i++) { h.rows.push({ id: `nn${i}`, externalId: `e-nn${i}`, price: 100, status: 'active', title: 'x' }); h.feed.set(`e-nn${i}`, { price: 200, affiliateUrl: null, ...NEW }) }
    for (let i = 0; i < 30; i++) { h.rows.push({ id: `u${i}`, externalId: `e-u${i}`, price: 100, status: 'active', title: 'x' }); h.feed.set(`e-u${i}`, { price: 100, affiliateUrl: null, ...USED }) }
    for (let i = 0; i < 6; i++) h.rows.push({ id: `gone${i}`, externalId: `e-gone${i}`, price: 100, status: 'active', title: 'x' })
    const out = await run()
    // 56 active → a night's budget of 25; 20 spent on the not-used pass, so the 6 vanished rows exceed the 5 left.
    expect(out.results[0]).toMatchObject({ soldNotUsed: 20, retireCap: 5, retireCandidates: 6, cappedOut: true, mayRetire: false })
    expect(JSON.stringify(soldSql().map((q) => q.values))).not.toContain('gone')
  })
  it('more not-used rows than a night\'s budget still go to sold (never left up as used) — and the unit goes red', async () => {
    for (let i = 0; i < 30; i++) {
      h.rows.push({ id: `n${i}`, externalId: `e-n${i}`, price: 100, status: 'active', title: 'Áo thun nam cotton' })
      h.feed.set(`e-n${i}`, { price: 200, affiliateUrl: null, ...NEW })
    }
    const res = await GET(new Request('https://eno.vn/api/cron/affiliate-prices', { headers: { authorization: 'Bearer cron-secret' } }))
    expect(res.status).toBe(502)
    const out = await res.json()
    expect(out).toMatchObject({ ok: false, failed: 0, blocked: 1 })
    expect(out.results[0]).toMatchObject({ feedNotUsed: 30, soldNotUsed: 30, nowNewAlarm: true, retireCap: 0 })
    expect(soldSql().flatMap((q) => q.values)).toEqual(expect.arrayContaining(Array.from({ length: 30 }, (_, i) => `n${i}`)))
    expect(JSON.stringify(h.updateMany)).not.toMatch(/"n\d+"/)
  })
  it('one campaign that throws does not stop the next, and the answer is a 502 carrying both', async () => {
    process.env.ACCESSTRADE_CAMPAIGNS = 'cellphones_cps,dienthoaivui'
    h.throwFor = 'cellphones_cps'
    const res = await GET(new Request('https://eno.vn/api/cron/affiliate-prices', { headers: { authorization: 'Bearer cron-secret' } }))
    expect(res.status).toBe(502)
    const out = await res.json()
    expect(out).toMatchObject({ ok: false, failed: 1, blocked: 0 })
    expect(out.results[0]).toEqual({ campaign: 'cellphones_cps', error: 'datafeeds page 2: HTTP 429' })
    expect(out.results[1].campaign).toBe('dienthoaivui')
    expect(out.results[1].error).toBeUndefined()
    expect(h.feedCalls).toBe(2)
  })
  it('⛔ a sold row stored as NEW is never restocked on a used-only shelf, even when the feed says used', async () => {
    h.rows.push({ id: 'stored-new', externalId: 'e-sn', price: 100, status: 'sold', title: 'Áo thun nam cotton', condition: 'new' })
    h.feed.set('e-sn', { price: 200, affiliateUrl: null, ...USED })
    await run()
    expect(h.sql.find((q) => q.text.includes("SET status = 'active'"))!.values).not.toContain('stored-new')
  })
  it('⛔ an ACTIVE row stored as new on a used-only shelf goes to sold and is never repriced (owner: 2nd hand only)', async () => {
    h.rows.push({ id: 'live-new', externalId: 'e-ln', price: 100, status: 'active', title: 'Áo thun nam cotton', condition: 'new' })
    h.feed.set('e-ln', { price: 200, affiliateUrl: null, ...USED })
    await run()
    expect(soldSql().map((q) => q.values)).toContainEqual(['live-new'])
    expect(JSON.stringify(h.sql.find((q) => q.text.includes('SET price = v.price'))?.values ?? [])).not.toContain('live-new')
  })
  it('rows moved to sold are purged even when a later step of that campaign throws', async () => {
    h.rows.push({ id: 'nn-a', externalId: 'e-nna', price: 100, status: 'active', title: 'Áo thun nam cotton' })
    h.feed.set('e-nna', { price: 200, affiliateUrl: null, ...NEW })
    const refresh = await import('@/lib/affiliate-price-refresh')
    const spy = vi.spyOn(refresh, 'applyPriceChanges').mockRejectedValue(new Error('db down'))
    const revalidate = await import('@/lib/revalidate-lang')
    const purge = vi.spyOn(revalidate, 'revalidatePublicPath')
    const res = await GET(new Request('https://eno.vn/api/cron/affiliate-prices', { headers: { authorization: 'Bearer cron-secret' } }))
    expect(res.status).toBe(502)
    expect(soldSql().map((q) => q.values)).toContainEqual(['nn-a'])
    expect(purge.mock.calls.map((c) => c[0])).toContain('/listings/nn-a')
    spy.mockRestore(); purge.mockRestore()
  })
  it('a later throw still purges what the campaign committed — the 48-hour sweep, even with nothing moved to sold', async () => {
    const refresh = await import('@/lib/affiliate-price-refresh')
    const spy = vi.spyOn(refresh, 'applyStockReconcile').mockRejectedValue(new Error('db down'))
    const dbm = (await import('@/lib/db')).db as unknown as { listing: { findMany: (a: Row) => Promise<unknown> } }
    const reads: Row[] = []
    const orig = dbm.listing.findMany
    dbm.listing.findMany = async (a: Row) => { reads.push(a); return orig(a) }
    const res = await GET(new Request('https://eno.vn/api/cron/affiliate-prices', { headers: { authorization: 'Bearer cron-secret' } }))
    expect(res.status).toBe(502)
    // flushRecent's sweep: every row of the storefront whose updatedAt moved in the window.
    expect(reads.some((a) => a.where?.updatedAt)).toBe(true)
    dbm.listing.findMany = orig; spy.mockRestore()
  })
  it('a configured campaign with no approved AccessTrade campaign is a failure: 502, not a green night', async () => {
    const refresh = await import('@/lib/affiliate-price-refresh')
    const spy = vi.spyOn(refresh, 'campaignIdFor').mockResolvedValue(null)
    const res = await GET(new Request('https://eno.vn/api/cron/affiliate-prices', { headers: { authorization: 'Bearer cron-secret' } }))
    expect(res.status).toBe(502)
    expect((await res.json()).results[0]).toEqual({ campaign: 'cellphones_cps', error: 'not_an_approved_campaign' })
    spy.mockRestore()
  })
  it('each campaign walks on a fair share of the night\'s 12 minutes: the first cannot spend the second\'s', async () => {
    process.env.ACCESSTRADE_CAMPAIGNS = 'cellphones_cps,dienthoaivui'
    const start = Date.now()
    await run()
    const [first, second] = h.budgets.map((b) => b.deadline - start)
    expect(first).toBeLessThanOrEqual(6 * 60_000 + 1_000)
    expect(first).toBeGreaterThan(5 * 60_000)
    expect(second).toBeGreaterThan(11 * 60_000)
    expect(second).toBeLessThanOrEqual(12 * 60_000 + 1_000)
    // Whole milliseconds, for AbortSignal.timeout.
    expect(h.budgets.every((b) => Number.isInteger(b.deadline))).toBe(true)
  })
})
