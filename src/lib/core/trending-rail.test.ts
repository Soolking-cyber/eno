import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ⛔ home-07 (UX program 2, 2026-10-04): the home page's "Trending" rail opened on the feed's first
 * card, two rows above it. With `excludeIds` the first feed page's ids leave the pool before the rail
 * chooses, so it still holds 16; without them (GET /api/recommendations) it is exactly the old 16.
 */

const findMany = vi.fn()
const count = vi.fn()
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: (a: unknown) => findMany(a), count: (a: unknown) => count(a) } } }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
// The serializer's own shape is not under test: keep the id so the order can be read.
vi.mock('@/lib/serialize', () => ({
  safeParse: (v: unknown, d: unknown) => (typeof v === 'string' ? JSON.parse(v) : d),
  serializeListing: (r: { id: string }) => ({ id: r.id }),
}))

const { trendingRailListings } = await import('./trending-rail')

/** 40 narrow rows from 40 sellers, distinct covers and no model — diversifyRail keeps them in order. */
const narrow = Array.from({ length: 40 }, (_, i) => ({
  id: `l${i}`, sellerId: `s${i}`, subcategorySlug: null, brandSlug: null, model: null, images: JSON.stringify([`https://x/${i}.webp`]),
}))

beforeEach(() => {
  findMany.mockReset()
  count.mockReset()
  count.mockResolvedValue(500)
  findMany.mockImplementation(async ({ where, select }: any) => {
    if (select) return narrow // the narrow pick read
    const ids: string[] = where.AND[1].id.in // the whole-row read, by id
    return ids.map((id) => ({ id }))
  })
})

describe('trendingRailListings', () => {
  it('without ids: the same 16 the recommendations fallback always served', async () => {
    const rows = await trendingRailListings()
    expect(rows.map((r) => r.id)).toEqual(narrow.slice(0, 16).map((r) => r.id))
  })

  it("drops the first feed page's cards and still fills 16", async () => {
    const firstPage = ['l0', 'l2', 'l5', 'l7', 'l9', 'l11', 'l13', 'l15', 'l17', 'l19', 'l21', 'l23']
    const rows = await trendingRailListings({ excludeIds: Promise.resolve(firstPage) })
    const ids = rows.map((r) => r.id)
    expect(ids).toHaveLength(16)
    expect(ids.filter((id) => firstPage.includes(id))).toEqual([])
    expect(ids[0]).toBe('l1')
  })

  it('still 16 when the feed page IS the rail\'s best twelve (they share their top rows on the home page)', async () => {
    const firstPage = narrow.slice(0, 12).map((r) => r.id)
    const rows = await trendingRailListings({ excludeIds: firstPage })
    expect(rows.map((r) => r.id)).toEqual(narrow.slice(12, 28).map((r) => r.id))
  })

  it('a failed id promise rejects the rail (the home page catches it) without an unhandled rejection', async () => {
    count.mockResolvedValue(3) // thin catalogue: returns before awaiting the ids
    const failing = Promise.reject(new Error('window failed'))
    await expect(trendingRailListings({ excludeIds: failing })).resolves.toEqual([])
    count.mockResolvedValue(500)
    await expect(trendingRailListings({ excludeIds: Promise.reject(new Error('window failed')) })).rejects.toThrow('window failed')
  })
})
