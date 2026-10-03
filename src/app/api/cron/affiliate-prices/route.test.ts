import { beforeEach, describe, expect, it, vi } from 'vitest'

// The affiliate-prices cron's RESTORE (sold → active) is screened (2026-10-01): a banned row is not
// restored and is hidden, an ambiguous one is restored and reported, and a tombstone ('removed') is
// never a candidate — nor is its price refreshed. The restock screen and the SQL builders are the real
// ones; only the network and the database are faked.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  feedCalls: 0,
  rows: [] as Row[],
  feed: new Map<string, { price: number; affiliateUrl: string | null }>(),
  sql: [] as Array<{ text: string; values: unknown[] }>,
  updateMany: [] as Row[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/affiliate-price-refresh', async (orig) => ({
  ...(await orig<typeof import('@/lib/affiliate-price-refresh')>()),
  campaignIdFor: async () => '123',
  fetchFeedPrices: async () => { h.feedCalls++; return { prices: h.feed, seenIds: new Set(h.feed.keys()), seen: h.feed.size, complete: true, total: h.feed.size, dropped: 0 } },
}))

vi.mock('@/lib/db', () => ({
  db: {
    seller: { findFirst: async () => ({ id: 's1' }) },
    listing: {
      findMany: async (a: Row) => {
        if (a.where.updatedAt) return [] // flushRecent
        if (a.where.sellerId) return h.rows.map((r) => ({ id: r.id, externalId: r.externalId, price: r.price, affiliateUrl: null, status: r.status }))
        // The restock screen's read: by id, still sold.
        return h.rows.filter((r) => a.where.id.in.includes(r.id) && r.status === a.where.status)
          .map((r) => ({ id: r.id, title: r.title, titleVi: null, description: null, descriptionVi: null, subcategorySlug: null, category: { slug: 'home-living' } }))
      },
      updateMany: async (a: Row) => {
        h.updateMany.push(a)
        const hit = h.rows.filter((r) => a.where.id.in.includes(r.id) && r.status === a.where.status)
        for (const r of hit) Object.assign(r, a.data)
        return { count: hit.length }
      },
    },
    $executeRaw: async (q: { sql: string; values: unknown[] }) => { h.sql.push({ text: q.sql.replace(/\s+/g, ' '), values: q.values }); return 0 },
  },
}))

const { GET } = await import('./route')
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
  h.feed = new Map(h.rows.map((r) => [r.externalId, { price: 200, affiliateUrl: null }]))
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
    h.feed.set('e-hid', { price: 200, affiliateUrl: null })
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
