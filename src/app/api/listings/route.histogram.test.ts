import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `GET /api/listings?histogram=1` — the price panel's distribution.
 *
 * ⚠️ WHAT THIS PINS: the branch AGGREGATES every matching price (`groupBy price`) and returns the
 * binned shape from src/lib/price-histogram.ts. It used to `findMany … orderBy price asc take 5000`,
 * i.e. only the 5,000 CHEAPEST prices, which the panel then read as the whole range. The mocked db
 * below has NO `findMany`, so a regression to row-shipping throws here instead of passing.
 *
 * ⚠️ DATA SAFETY — every module in the route's import graph that could reach Postgres, Supabase or
 * Vertex is mocked BY NAME; nothing below relies on one module happening to build its client via
 * another.
 */

const h = vi.hoisted(() => ({
  groupByArgs: [] as unknown[],
  groups: [] as Array<{ price: number; _count: { _all: number } }>,
  where: { AND: [{ verified: true }, { status: 'active' }] },
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      groupBy: vi.fn(async (args: unknown) => {
        h.groupByArgs.push(args)
        return h.groups
      }),
    },
  },
}))
vi.mock('./feed-query', () => ({
  idsFastPath: async () => null,
  buildFeedFilters: async () => ({ histogram: true, where: h.where, andFilters: [], offset: 0, limit: 24 }),
  buildFeedOrderBy: () => ({}),
  getSubcategoryCounts: async () => [],
}))
vi.mock('@/lib/taxonomy', () => ({ migrateLegacyCategoryParams: (p: URLSearchParams) => p }))
vi.mock('@/lib/client-ip', () => ({}))
vi.mock('@/lib/feed-diversity', () => ({}))
vi.mock('@/lib/feed-window', () => ({}))
vi.mock('@/lib/edition-scope', () => ({}))
vi.mock('@/lib/serialize', () => ({}))
vi.mock('@/lib/phone', () => ({}))
vi.mock('@/lib/publish-guard', () => ({ PublishBlockedError: class extends Error {} }))
vi.mock('@/lib/translate', () => ({}))
vi.mock('@/lib/handle', () => ({}))
vi.mock('@/lib/admin', () => ({}))
vi.mock('@/lib/enforcement', () => ({}))
vi.mock('@/lib/ratelimit', () => ({}))
vi.mock('@/lib/core/listings', () => ({}))
vi.mock('@/lib/facet-counts', () => ({}))
vi.mock('./semantic-rank', () => ({}))
vi.mock('./resolve-seller', () => ({}))
vi.mock('@/lib/publish-funnel', () => ({}))

import { NextRequest } from 'next/server'
import { GET } from './route'

const get = () => GET(new NextRequest('https://eno.vn/api/listings?histogram=1&category=electronics'))

beforeEach(() => {
  h.groupByArgs = []
  h.groups = []
})

describe('GET /api/listings?histogram=1', () => {
  it('groups EVERY matching price under the shared where, and bins it', async () => {
    // 7,000 listings — past the old 5,000 cap — with the dearest far above the cheapest slice.
    h.groups = [
      { price: 0, _count: { _all: 2 } },
      { price: 24_000, _count: { _all: 5_000 } },
      { price: 500_000, _count: { _all: 1_997 } },
      { price: 1_450_000_000, _count: { _all: 1 } },
    ]
    const res = await get()
    expect(res.status).toBe(200)
    expect(h.groupByArgs).toEqual([{ by: ['price'], where: h.where, _count: { _all: true } }])
    const body = await res.json()
    expect(body.total).toBe(7_000)
    expect(body.min).toBe(0)
    expect(body.max).toBe(1_450_000_000)
    expect(body.edges[0]).toBe(0)
    expect(body.edges[body.edges.length - 1]).toBe(1_500_000_000)
    expect(body.counts).toHaveLength(body.edges.length - 1)
    expect(body.counts.reduce((a: number, b: number) => a + b, 0)).toBe(7_000)
    // The exact counts at the extremes ride along — 1.45B is not an edge, so `atEdge` cannot carry it.
    expect(body.atMin).toBe(2)
    expect(body.atMax).toBe(1)
    expect(body).not.toHaveProperty('prices')
  })

  it('keeps the edge-cache headers', async () => {
    h.groups = [{ price: 100_000, _count: { _all: 1 } }]
    const res = await get()
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30, s-maxage=120, stale-while-revalidate=300')
  })

  it('zero matches is an empty histogram, not a crash', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ total: 0, min: 0, max: 0, edges: [], counts: [], atEdge: [], atMin: 0, atMax: 0 })
  })
})
