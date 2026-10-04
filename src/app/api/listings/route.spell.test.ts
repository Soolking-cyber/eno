import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `GET /api/listings` answers a ZERO-result search for its likely spelling (S-RECALL, 2026-09-29:
 * "iphnoe" found 0 while "iphone" found 3,439) — and never second-guesses a search that found anything.
 * ⛔ Only for a request that opts in with `spell=1`: a client that cannot say "Showing results for …"
 * must get the literal zero, never another word's results in silence.
 * Mocks follow route.inferred-district.test.ts: nothing reaches a database. The fake filters carry the
 * query in `where`, so the mocked count can answer per query.
 */

const h = vi.hoisted(() => ({
  totals: {} as Record<string, number>,
  prices: {} as Record<string, number[]>,
  correct: vi.fn(async (_q: string): Promise<string | null> => null),
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async ({ where }: { where: { q?: string } }) =>
        (h.prices[where.q ?? ''] ?? []).map((price) => ({ price, _count: { _all: 1 } }))),
    },
  },
}))
vi.mock('./feed-query', () => {
  const filters = async (sp: URLSearchParams) => ({
    histogram: sp.get('histogram') === '1', where: { q: sp.get('q') ?? '' }, andFilters: [], pgTextFilter: null,
    subcategoryFilter: null, offset: 0, limit: 24, sort: 'recent', q: sp.get('q') ?? undefined, inferredDistrict: null,
  })
  return {
    idsFastPath: async () => null,
    buildFeedFilters: filters,
    resolveFeedFilters: filters,
    buildFeedOrderBy: () => [],
    getSubcategoryCounts: async () => [],
    countListingsCached: async (w: { q?: string }) => h.totals[w.q ?? ''] ?? 0,
  }
})
vi.mock('@/lib/spell-correct', () => ({ correctQuery: (q: string) => h.correct(q) }))
vi.mock('@/lib/taxonomy', () => ({ migrateLegacyCategoryParams: (p: URLSearchParams) => p }))
vi.mock('@/lib/client-ip', () => ({}))
vi.mock('@/lib/feed-diversity', () => ({ diversityAppliesTo: () => false, diversifyBySeller: (r: unknown[]) => r, sharedSeatsFor: () => true, goodsSeatsFor: () => false }))
vi.mock('@/lib/feed-window', () => ({}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/serialize', () => ({ serializeListingCard: (r: unknown) => r, LISTING_CARD_SELECT: {} }))
vi.mock('@/lib/phone', () => ({}))
vi.mock('@/lib/publish-guard', () => ({ PublishBlockedError: class extends Error {} }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: unknown[]) => l }))
vi.mock('@/lib/handle', () => ({}))
vi.mock('@/lib/admin', () => ({}))
vi.mock('@/lib/enforcement', () => ({}))
vi.mock('@/lib/ratelimit', () => ({}))
vi.mock('@/lib/core/listings', () => ({}))
vi.mock('@/lib/facet-counts', () => ({ computeFacetCounts: async () => ({}), subcategoryDimension: () => ({}) }))
vi.mock('./semantic-rank', () => ({ semanticRank: async () => ({ semanticListings: null, semanticTotal: 0 }) }))
vi.mock('./keyword-rank', () => ({ keywordRank: async () => ({ keywordListings: null }) }))
vi.mock('./resolve-seller', () => ({}))
vi.mock('@/lib/publish-funnel', () => ({}))

import { NextRequest } from 'next/server'
import { GET } from './route'

const get = async (qs: string) => (await GET(new NextRequest(`https://eno.vn/api/listings?${qs}`))).json()

beforeEach(() => {
  h.totals = { iphone: 3439 }
  h.prices = { iphone: [1_000_000, 20_000_000] }
  h.correct.mockReset()
  h.correct.mockImplementation(async (q: string) => (q === 'iphnoe' ? 'iphone' : null))
})

describe('GET /api/listings — a zero-result search is answered for its likely spelling', () => {
  it('a search that finds anything is never corrected — the speller is not even asked', async () => {
    const body = await get('q=iphone&spell=1&facets=0')
    expect(h.correct).not.toHaveBeenCalled()
    expect(body.total).toBe(3439)
    expect(body.correctedQuery).toBeNull()
  })

  it('"iphnoe" → the "iphone" set, and says so', async () => {
    const body = await get('q=iphnoe&spell=1&facets=0')
    expect(h.correct).toHaveBeenCalledWith('iphnoe')
    expect(body.total).toBe(3439)
    expect(body.correctedQuery).toBe('iphone')
  })

  it('⛔ without spell=1 the zero is literal — a client with no "Showing results for" line is never silently corrected', async () => {
    for (const qs of ['q=iphnoe&facets=0', 'q=iphnoe&spell=0&facets=0']) {
      const body = await get(qs)
      expect(body.total).toBe(0)
      expect(body.correctedQuery).toBeNull()
    }
    expect(h.correct).not.toHaveBeenCalled()
    // …and the price histogram follows the same opt-in.
    expect((await get('q=iphnoe&histogram=1')).total).toBe(0)
  })

  it('a correction that also finds nothing is not served', async () => {
    h.correct.mockImplementation(async () => 'qwzy')
    const body = await get('q=qwzx&spell=1&facets=0')
    expect(body.total).toBe(0)
    expect(body.correctedQuery).toBeNull()
  })

  it('a query naming a district is never corrected (district-query.ts owns those words)', async () => {
    const body = await get(`q=${encodeURIComponent('iphnoe quận 7')}&spell=1&facets=0`)
    expect(h.correct).not.toHaveBeenCalled()
    expect(body.correctedQuery).toBeNull()
  })

  it('⛔ the price histogram is never corrected from its OWN zero — it is asked for the word the feed answered', async () => {
    // Its zero is not the feed's (no price band, no semantic set), so a decision made here could name
    // another word than the grid (review, 2026-09-29). The explorer sends `q=<correctedQuery>` instead.
    const own = await get('q=iphnoe&spell=1&histogram=1')
    expect(own.total).toBe(0)
    expect(h.correct).not.toHaveBeenCalled()
    const asked = await get('q=iphone&histogram=1')
    expect(asked.total).toBe(2)
    expect(asked).not.toHaveProperty('correctedQuery')
  })
})
