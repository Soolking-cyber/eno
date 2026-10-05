import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * App Store gate `app-ai-notice`: semanticRank's `noAi` skips the Vertex AI Search path WHOLE — no call, no budget charge,
 * no cached Vertex ranking reused — and says so (`aiSkipped`), so the route can keep that answer off the edge. Without it
 * the path runs exactly as before. Only a search that WOULD have gone to Vertex reports `aiSkipped`.
 */

const h = vi.hoisted(() => ({
  vertex: vi.fn(async (): Promise<string[] | null> => ['a', 'b']),
  budget: vi.fn(async () => ({ success: true })),
}))
vi.mock('@/lib/vertex-search', () => ({ vertexSearchListingIds: h.vertex, vertexConfigured: () => true }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: h.budget }))
vi.mock('@/lib/db', () => ({
  db: { listing: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) } },
}))
vi.mock('./ranked-page', () => ({ RANKED_SET_TTL: 900_000, pageRankedThenTail: vi.fn(async () => []) }))

import { semanticRank } from './semantic-rank'

const base = {
  looseMatch: false, featuredOnly: false, sort: 'newest', category: undefined, priceMin: NaN, priceMax: NaN,
  offset: 0, limit: 24, andFilters: [], pgTextFilter: null, orderBy: [],
}

beforeEach(() => {
  h.vertex.mockClear()
  h.budget.mockClear()
})

describe('semanticRank — noAi', () => {
  it('noAi on a search Vertex would rank: nothing sent, nothing charged, aiSkipped', async () => {
    const r = await semanticRank({ ...base, q: 'road bike under 8m', noAi: true })
    expect(r).toEqual({ semanticListings: null, semanticTotal: 0, aiSkipped: true })
    expect(h.vertex).not.toHaveBeenCalled()
    expect(h.budget).not.toHaveBeenCalled()
  })

  it('noAi does not reuse a ranking cached by an earlier browser search for the same words', async () => {
    await semanticRank({ ...base, q: 'mountain bike' }) // a browser: ranks and caches
    expect(h.vertex).toHaveBeenCalledTimes(1)
    const r = await semanticRank({ ...base, q: 'mountain bike', noAi: true })
    expect(r.aiSkipped).toBe(true)
    expect(r.semanticListings).toBeNull()
  })

  it('without noAi: Vertex as before', async () => {
    const r = await semanticRank({ ...base, q: 'city scooter' })
    expect(h.vertex).toHaveBeenCalledTimes(1)
    expect(r.aiSkipped).toBe(false)
  })

  it('a search that would not have gone to Vertex is not "skipped" (short words, another sort)', async () => {
    expect((await semanticRank({ ...base, q: 'tv', noAi: true })).aiSkipped).toBe(false)
    expect((await semanticRank({ ...base, q: 'road bike', sort: 'price_asc', noAi: true })).aiSkipped).toBe(false)
    expect(h.vertex).not.toHaveBeenCalled()
  })
})
