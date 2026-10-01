import { beforeEach, describe, expect, it, vi } from 'vitest'

// The partner-stock cron's writes (2026-10-01): a RESTOCK (sold → active) goes through the content
// screen (src/lib/restock-screen.ts — the real one, unmocked), a banned row is hidden instead, a
// tombstone ('removed') is never touched, and every write is conditional on the status it was read
// with, so a removal landing between the read and the write is not overwritten.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  products: [] as Array<{ externalId: string; price: number; inStock: boolean }>,
  complete: false,
  writes: [] as Row[],
  /** Status changes applied by "someone else" right after the job's first read — the race. */
  afterRead: {} as Record<string, string>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: Row) => w }))
vi.mock('@/lib/partner-stores', () => ({ PARTNER_STORES: [{ name: 'Shop', domain: 'shop.example' }] }))
vi.mock('@/lib/partner-fetch', () => ({
  fetchStore: async () => ({ products: h.products, complete: h.complete, seenExternalIds: new Set(h.products.map((p) => p.externalId)) }),
  mayReconcile: () => h.complete,
}))

function matches(r: Row, where: Row): boolean {
  if (typeof where.id === 'string' && r.id !== where.id) return false
  if (where.id?.in && !where.id.in.includes(r.id)) return false
  if (where.status !== undefined && r.status !== where.status) return false
  return true
}

vi.mock('@/lib/db', () => ({
  db: {
    seller: { findFirst: async () => ({ id: 's1' }) },
    listing: {
      findMany: async (a: Row) => {
        // The job's catalogue read (by sellerId) vs the restock screen's text read (by id + status).
        if (a.where.sellerId) {
          const out = h.rows.map((r) => ({ id: r.id, externalId: r.externalId, price: r.price, status: r.status }))
          for (const [id, status] of Object.entries(h.afterRead)) { const r = h.rows.find((x) => x.id === id); if (r) r.status = status }
          return out
        }
        return h.rows.filter((r) => matches(r, a.where)).map((r) => ({ id: r.id, title: r.title, titleVi: null, description: null, descriptionVi: null, subcategorySlug: null, category: { slug: 'home-living' } }))
      },
      updateMany: async (a: Row) => {
        h.writes.push(a)
        const hit = h.rows.filter((r) => matches(r, a.where))
        for (const r of hit) Object.assign(r, a.data)
        return { count: hit.length }
      },
      update: async () => { throw new Error('unconditional update by id — must not be used') },
    },
  },
}))

const { GET } = await import('./route')
const run = async () => (await GET(new Request('https://eno.vn/api/cron/partner-stock', { headers: { authorization: 'Bearer cron-secret' } }))).json()
const status = (id: string) => h.rows.find((r) => r.id === id)?.status

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  h.rows = []
  h.products = []
  h.complete = false
  h.writes = []
  h.afterRead = {}
})

describe('GET /api/cron/partner-stock — restocks are screened', () => {
  it('an ok sold row restocks; a banned one is hidden instead and reported', async () => {
    h.rows = [
      { id: 'ok', externalId: 'e-ok', price: 100, status: 'sold', title: 'Áo thun nam cotton' },
      { id: 'ban', externalId: 'e-ban', price: 100, status: 'sold', title: 'Rượu Vodka Hà Nội 29.5%' },
    ]
    h.products = [{ externalId: 'e-ok', price: 100, inStock: true }, { externalId: 'e-ban', price: 100, inStock: true }]
    const out = await run()
    expect(status('ok')).toBe('active')
    expect(status('ban')).toBe('hidden')
    expect(out.results[0]).toMatchObject({ restocked: 1, restockScreen: { hidden: 1, hiddenRows: [{ id: 'ban', rule: 'spirits' }] } })
  })

  it("an ambiguous ('review') row restocks and is listed for a human", async () => {
    h.rows = [{ id: 'soju', externalId: 'e1', price: 100, status: 'sold', title: 'Soju Jinro vị đào' }]
    h.products = [{ externalId: 'e1', price: 100, inStock: true }]
    const out = await run()
    expect(status('soju')).toBe('active')
    expect(out.results[0].restockScreen).toMatchObject({ hidden: 0, review: 1 })
  })
})

describe('GET /api/cron/partner-stock — tombstones are never touched', () => {
  it('a removed row in the feed (in stock, new price) keeps its status and price', async () => {
    h.rows = [{ id: 'gone', externalId: 'e1', price: 100, status: 'removed', title: 'Áo thun nam cotton' }]
    h.products = [{ externalId: 'e1', price: 250, inStock: true }]
    await run()
    expect(h.rows[0]).toMatchObject({ status: 'removed', price: 100 })
    expect(h.writes).toEqual([])
  })

  it('⛔ removed BETWEEN the read and the writes: no restock, no price write, no retire lands on it', async () => {
    h.rows = [
      { id: 'restock', externalId: 'e1', price: 100, status: 'sold', title: 'Áo thun nam cotton' },
      { id: 'priced', externalId: 'e2', price: 100, status: 'active', title: 'Áo thun nam cotton' },
      // 21 other active rows in the feed so the reconcile is allowed to retire `absent`.
      ...Array.from({ length: 21 }, (_, i) => ({ id: `a${i}`, externalId: `a${i}`, price: 1, status: 'active', title: 'Áo' })),
      { id: 'absent', externalId: 'gone-from-feed', price: 1, status: 'active', title: 'Áo' },
    ]
    h.products = [
      { externalId: 'e1', price: 100, inStock: true },
      { externalId: 'e2', price: 999, inStock: true },
      ...Array.from({ length: 21 }, (_, i) => ({ externalId: `a${i}`, price: 1, inStock: true })),
    ]
    h.complete = true
    h.afterRead = { restock: 'removed', priced: 'removed', absent: 'removed' }
    const out = await run()
    expect([status('restock'), status('priced'), status('absent')]).toEqual(['removed', 'removed', 'removed'])
    expect(h.rows.find((r) => r.id === 'priced')!.price).toBe(100)
    // priced/soldOut count only writes that changed a row (2026-10-01 review) — the raced one did not.
    expect(out.results[0]).toMatchObject({ restocked: 0, retired: 0, priced: 0, soldOut: 0 })
    // Every write names the status it expects to find.
    for (const w of h.writes) expect(w.where.status).toBeDefined()
  })
})

describe('GET /api/cron/partner-stock — the counters report what was written', () => {
  it('priced and soldOut count a row only when its conditional write changed it', async () => {
    h.rows = [
      { id: 'p', externalId: 'e1', price: 100, status: 'active', title: 'Áo' }, // price moves
      { id: 'o', externalId: 'e2', price: 100, status: 'active', title: 'Áo' }, // sells out
      { id: 'po', externalId: 'e3', price: 100, status: 'active', title: 'Áo' }, // both
      { id: 'raced', externalId: 'e4', price: 100, status: 'active', title: 'Áo' }, // hidden by a human after the read
    ]
    h.products = [
      { externalId: 'e1', price: 120, inStock: true },
      { externalId: 'e2', price: 100, inStock: false },
      { externalId: 'e3', price: 130, inStock: false },
      { externalId: 'e4', price: 140, inStock: false },
    ]
    h.afterRead = { raced: 'hidden' }
    const out = await run()
    expect(out.results[0]).toMatchObject({ priced: 2, soldOut: 2 })
    expect(h.rows.find((r) => r.id === 'raced')).toMatchObject({ status: 'hidden', price: 100 })
  })
})
