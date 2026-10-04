import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which brands a buyer is offered (src/lib/live-brands.ts): those with live listings, by the feed's own
 * definition, never by the stored `Brand.listingCount`. The 2026-10-04 verify found /brands advertising
 * 66 curated brands with nothing live behind them.
 */
const groupBy = vi.fn(async (_args: unknown): Promise<{ brandSlug: string | null; _count: { _all: number } }[]> => [])
vi.mock('./db', () => ({ db: { listing: { groupBy: (a: unknown) => groupBy(a) } } }))
// The feed's own builder — stubbed to a recognisable where, so the test can see the read is built from it
// (e2e: src/app/api/search/suggest/route.test.ts compares against the REAL builder).
const FEED_WHERE = { AND: [{ verified: true }, { status: 'active' }, { sellerId: { notIn: ['desk'] } }] }
const buildFeedFilters = vi.fn(async (_sp: URLSearchParams) => ({ where: FEED_WHERE }))
vi.mock('@/app/api/listings/feed-query', () => ({ buildFeedFilters: (sp: URLSearchParams) => buildFeedFilters(sp) }))

const { liveCountMap, listedBrands, liveBrandCounts, __resetLiveBrandCounts } = await import('./live-brands')

beforeEach(() => {
  __resetLiveBrandCounts()
  groupBy.mockReset()
  groupBy.mockImplementation(async () => [])
  buildFeedFilters.mockClear()
})

const brand = (slug: string, name: string, extra: Record<string, unknown> = {}) => ({ slug, name, ...extra })

describe('listedBrands — the rule every buyer-facing brand list applies', () => {
  it('a curated brand with no live listing is not listed, however it is curated', () => {
    const rows = [
      brand('casio', 'Casio', { curatedAt: new Date('2026-07-01'), listingCount: 0 }),
      brand('apple', 'Apple', { curatedAt: new Date('2026-07-01'), listingCount: 120 }),
    ]
    expect(listedBrands(rows, new Map([['apple', 97]])).map((b) => b.slug)).toEqual(['apple'])
  })

  it('a stored count with nothing live behind it does not list a brand either (sold or hidden since the recount)', () => {
    const rows = [brand('adidas', 'Adidas', { listingCount: 14 })]
    expect(listedBrands(rows, new Map())).toEqual([])
  })

  it('the number shown is the LIVE count, not the stored one — the count the click returns', () => {
    const rows = [brand('apple', 'Apple', { listingCount: 900 })]
    expect(listedBrands(rows, new Map([['apple', 97]]))).toEqual([{ slug: 'apple', name: 'Apple', listingCount: 900, count: 97 }])
  })

  it('a curated brand comes back by itself once one of its listings is live — curation is never cleared', () => {
    const casio = brand('casio', 'Casio', { curatedAt: new Date('2026-07-01') })
    expect(listedBrands([casio], new Map())).toEqual([])
    expect(listedBrands([casio], new Map([['casio', 1]]))).toEqual([{ ...casio, count: 1 }])
  })

  it('most live listings first, then by name', () => {
    const rows = [brand('b', 'Bose'), brand('a', 'Asus'), brand('s', 'Samsung'), brand('x', 'Xiaomi')]
    const live = new Map([['b', 3], ['a', 3], ['s', 40], ['x', 0]])
    expect(listedBrands(rows, live).map((b) => b.name)).toEqual(['Samsung', 'Asus', 'Bose'])
  })
})

describe('liveCountMap', () => {
  it('drops the null-brand group and empty groups', () => {
    const m = liveCountMap([
      { brandSlug: 'apple', _count: { _all: 5 } },
      { brandSlug: null, _count: { _all: 900 } },
      { brandSlug: 'ghost', _count: { _all: 0 } },
    ])
    expect([...m]).toEqual([['apple', 5]])
  })
})

describe('liveBrandCounts — the read', () => {
  it('groups the FEED\'S OWN where (buildFeedFilters, no parameters) plus "has a brand" — not a restatement of it', async () => {
    groupBy.mockImplementationOnce(async () => [{ brandSlug: 'apple', _count: { _all: 3 } }])
    const live = await liveBrandCounts()
    expect(live.get('apple')).toBe(3)
    expect([...buildFeedFilters.mock.calls[0][0].keys()]).toEqual([])
    const args = groupBy.mock.calls[0][0] as { by: string[]; where: unknown }
    expect(args.by).toEqual(['brandSlug'])
    expect(args.where).toEqual({ AND: [FEED_WHERE, { brandSlug: { not: null } }] })
  })

  it('is read once per window and shared in flight (the typeahead calls it on every keystroke)', async () => {
    await Promise.all([liveBrandCounts(), liveBrandCounts()])
    await liveBrandCounts()
    expect(groupBy).toHaveBeenCalledTimes(1)
  })

  it('a failed read rethrows and is not cached', async () => {
    groupBy.mockImplementationOnce(async () => { throw new Error('down') })
    await expect(liveBrandCounts()).rejects.toThrow('down')
    groupBy.mockImplementationOnce(async () => [{ brandSlug: 'apple', _count: { _all: 2 } }])
    expect((await liveBrandCounts()).get('apple')).toBe(2)
    expect(groupBy).toHaveBeenCalledTimes(2)
  })

  it('re-reads after a minute', async () => {
    vi.useFakeTimers()
    try {
      await liveBrandCounts()
      await liveBrandCounts()
      vi.advanceTimersByTime(30_000)
      await liveBrandCounts()
      expect(groupBy).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(30_001)
      await liveBrandCounts()
      expect(groupBy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
