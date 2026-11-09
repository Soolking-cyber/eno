import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE SPARSE-SEARCH "MORE IN" RAIL RIDES IN THE ANSWER (UI climb 2026-11-09, hunt #9; src/lib/core/related-rail.ts): words that
 * found 1-7 things, page 1, carry `related` in the same /api/listings body, so the explorer never fetches a rail after the
 * answer. Nothing else asks for it, a failure leaves the answer whole, and its inputs come from the URL only (the category
 * asked for, the viewer's blocked shops in `xs`) — the response is edge-cached by URL.
 * Mocks follow route.spell.test.ts: nothing reaches a database.
 */

const h = vi.hoisted(() => ({
  total: 2,
  rows: [] as { id: string; category: { slug: string } }[],
  related: vi.fn(),
  logged: vi.fn(),
  failLocalizeRelated: false,
}))

vi.mock('@/lib/db', () => ({ db: { listing: { findMany: vi.fn(async () => h.rows), groupBy: vi.fn(async () => []) } } }))
vi.mock('./feed-query', () => {
  const filters = async (sp: URLSearchParams) => ({
    histogram: sp.get('histogram') === '1', where: { q: sp.get('q') ?? '' }, andFilters: [], pgTextFilter: null,
    subcategoryFilter: null, offset: Number(sp.get('offset') ?? 0), limit: 24, sort: 'recent', q: sp.get('q') ?? undefined,
    inferredDistrict: null, category: sp.get('category') ?? undefined,
  })
  return {
    idsFastPath: async () => null,
    buildFeedFilters: filters,
    resolveFeedFilters: filters,
    buildFeedOrderBy: () => [],
    getSubcategoryCounts: async () => [],
    countListingsCached: async () => h.total,
    hiddenShopsParam: (sp: URLSearchParams) => (sp.get('xs') ? sp.get('xs')!.split(',') : []),
  }
})
vi.mock('@/lib/core/related-rail', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/core/related-rail')>()
  return { ...real, relatedRail: (a: unknown) => h.related(a) }
})
vi.mock('@/lib/log', () => ({ logError: (e: unknown, ctx: unknown) => h.logged(e, ctx) }))
vi.mock('@/lib/spell-correct', () => ({ correctQuery: async () => null }))
vi.mock('@/lib/taxonomy', () => ({ migrateLegacyCategoryParams: (p: URLSearchParams) => p }))
vi.mock('@/lib/client-ip', () => ({}))
vi.mock('@/lib/feed-diversity', () => ({ diversityAppliesTo: () => false, diversifyBySeller: (r: unknown[]) => r, sharedSeatsFor: () => true, goodsSeatsFor: () => false }))
vi.mock('@/lib/feed-window', () => ({}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/serialize', () => ({ serializeListingCard: (r: unknown) => r, LISTING_CARD_SELECT: {} }))
vi.mock('@/lib/phone', () => ({}))
vi.mock('@/lib/publish-guard', () => ({ PublishBlockedError: class extends Error {} }))
// Marks what it localized, so the test can see the rail's cards went through it too.
vi.mock('@/lib/translate', () => ({
  localizeListingTitles: async (l: { id: string }[], lang?: string) => {
    if (h.failLocalizeRelated && l.some((x) => x.id.startsWith('r'))) throw new Error('mt down')
    return l.map((x) => ({ ...x, localizedFor: lang ?? null }))
  },
}))
vi.mock('@/lib/handle', () => ({}))
vi.mock('@/lib/admin', () => ({}))
vi.mock('@/lib/enforcement', () => ({}))
vi.mock('@/lib/ratelimit', () => ({}))
vi.mock('@/lib/core/listings', () => ({}))
// With a category the payload also plans its subcategory chips; an empty plan keeps that path quiet.
vi.mock('@/lib/facet-counts', () => ({ computeFacetCounts: async () => ({}), subcategoryDimension: () => ({}), subcategoryDropPlan: () => new Map(), releasedParams: (p: URLSearchParams) => new URLSearchParams(p) }))
vi.mock('./semantic-rank', () => ({ semanticRank: async () => ({ semanticListings: null, semanticTotal: 0 }) }))
vi.mock('./keyword-rank', () => ({ keywordRank: async () => ({ keywordListings: null }) }))
vi.mock('./resolve-seller', () => ({}))
vi.mock('@/lib/publish-funnel', () => ({}))

import { NextRequest } from 'next/server'
import { GET } from './route'

const get = async (qs: string) => (await GET(new NextRequest(`https://eno.vn/api/listings?${qs}`))).json()
const RAIL = { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', listings: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] }

beforeEach(() => {
  h.total = 2
  h.rows = [{ id: 'a1', category: { slug: 'electronics' } }, { id: 'a2', category: { slug: 'electronics' } }]
  h.related.mockReset()
  h.related.mockResolvedValue(RAIL)
  h.logged.mockReset()
  h.failLocalizeRelated = false
})

describe('GET /api/listings — related rides with a sparse search answer', () => {
  it('words that found 2: the answer carries "related", built from its own rows, the category asked for and the blocked shops', async () => {
    const body = await get('q=iphone&category=electronics&subcategory=phones&xs=s9&lang=ko&facets=0')
    expect(h.related).toHaveBeenCalledTimes(1)
    expect(h.related.mock.calls[0][0]).toMatchObject({ category: 'electronics', subcategory: 'phones', hiddenSellerIds: ['s9'] })
    expect((h.related.mock.calls[0][0] as { rows: { id: string }[] }).rows.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(body.related).toMatchObject({ slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' })
    // Its cards' titles are localized for the URL's language, like the answer's own.
    expect(body.related.listings).toEqual(RAIL.listings.map((l) => ({ ...l, localizedFor: 'ko' })))
    expect(body.total).toBe(2)
  })

  it.each([
    ['eight found (the explorer shows no rail there)', 'q=iphone', 8],
    ['none found', 'q=iphone', 0],
    ['a later page', 'q=iphone&offset=24', 2],
    ['a filter-only page (a browse, not words)', 'category=electronics', 2],
  ])('%s: never asked, no key', async (_label, qs, total) => {
    h.total = total
    const body = await get(`${qs}&facets=0`)
    expect(h.related).not.toHaveBeenCalled()
    expect('related' in body).toBe(false)
  })

  it('nothing to show (null): no key — the explorer keeps Trending', async () => {
    h.related.mockResolvedValue(null)
    const body = await get('q=iphone&facets=0')
    expect('related' in body).toBe(false)
  })

  it('a failure localizing the rail\'s own titles is the rail\'s failure too: logged, the answer whole, no key', async () => {
    h.failLocalizeRelated = true
    const body = await get('q=iphone&lang=ko&facets=0')
    expect(body.listings.map((l: { id: string }) => l.id)).toEqual(['a1', 'a2'])
    expect('related' in body).toBe(false)
    expect(h.logged).toHaveBeenCalledWith(expect.any(Error), { op: 'feed.related-rail' })
  })

  it('a rail that never answers: the answer goes without it after the deadline, whole', async () => {
    h.related.mockReturnValue(new Promise(() => {}))
    const t0 = Date.now()
    const body = await get('q=iphone&facets=0')
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(body.listings.map((l: { id: string }) => l.id)).toEqual(['a1', 'a2'])
    expect('related' in body).toBe(false)
  })

  it('a failure is logged and the answer stays whole, with no key', async () => {
    h.related.mockRejectedValue(new Error('db down'))
    const body = await get('q=iphone&facets=0')
    expect(body.total).toBe(2)
    expect(body.listings.map((l: { id: string }) => l.id)).toEqual(['a1', 'a2'])
    expect('related' in body).toBe(false)
    expect(h.logged).toHaveBeenCalledWith(expect.any(Error), { op: 'feed.related-rail' })
  })
})
