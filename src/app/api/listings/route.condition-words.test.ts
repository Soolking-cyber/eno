import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `GET /api/listings` — condition words and the chip counts agree (commit gate, 2026-10-04).
 *
 * Condition words filter nothing (feed-query.ts). A query made ONLY of them is the goods browse — the
 * `listingType: 'sell'` scope, flagged `saleScopeFromWords` — which is structural: it stays in the
 * route's own facet base (subcategory counts, categoryTotal) and the flag reaches computeFacetCounts and
 * every releasedParams, so the bases that never see `q` write it back as `type=sell`.
 * Mocks follow route.inferred-district.test.ts: nothing reaches a database.
 */

const S = { category: { slug: 'furniture-appliances' } } // a structural filter every base keeps
const PG = { searchText: { contains: 'sofa' } }
const SALE = { listingType: 'sell' }

const h = vi.hoisted(() => ({
  shape: 'words' as 'words' | 'alone',
  subBases: [] as unknown[][],
  totals: [] as unknown[],
  facetOpts: [] as { saleScopeFromWords?: boolean }[],
  released: [] as unknown[][],
  plan: null as Map<string, string[]> | null,
}))

vi.mock('@/lib/db', () => ({ db: { listing: { findMany: vi.fn(async () => []) } } }))
vi.mock('./feed-query', () => {
  const filters = async () => {
    const alone = h.shape === 'alone'
    // "second hand sofa" → text "sofa", no other clause; "second hand" → the sale scope, no text.
    const andFilters = alone ? [S, SALE] : [S, PG]
    return {
      histogram: false, where: { AND: andFilters }, andFilters, pgTextFilter: alone ? null : PG,
      saleScopeFromWords: alone, subcategoryFilter: null,
      offset: 0, limit: 24, sort: 'recent', q: alone ? undefined : 'sofa', inferredDistrict: null, category: 'furniture-appliances',
    }
  }
  return {
    idsFastPath: async () => null,
    buildFeedFilters: filters,
    resolveFeedFilters: filters,
    buildFeedOrderBy: () => [],
    getSubcategoryCounts: async (base: unknown[]) => { h.subBases.push(base); return [] },
    countListingsCached: async (where: { AND?: unknown[] }) => { h.totals.push(where); return 0 },
  }
})
vi.mock('@/lib/taxonomy', () => ({ migrateLegacyCategoryParams: (p: URLSearchParams) => p }))
vi.mock('@/lib/client-ip', () => ({}))
vi.mock('@/lib/feed-diversity', () => ({ diversityAppliesTo: () => false, diversifyBySeller: (r: unknown[]) => r, sharedSeatsFor: () => true }))
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
vi.mock('@/lib/facet-counts', () => ({
  computeFacetCounts: async (o: { saleScopeFromWords?: boolean }) => { h.facetOpts.push(o); return {} },
  subcategoryDimension: () => ({}),
  subcategoryDropPlan: () => h.plan,
  releasedParams: (...args: unknown[]) => { h.released.push(args); return new URLSearchParams() },
}))
vi.mock('./semantic-rank', () => ({ semanticRank: async () => ({ semanticListings: null, semanticTotal: 0 }) }))
vi.mock('./keyword-rank', () => ({ keywordRank: async () => ({ keywordListings: null }) }))
vi.mock('@/lib/spell-correct', () => ({ correctQuery: async () => null }))
vi.mock('./resolve-seller', () => ({}))
vi.mock('@/lib/publish-funnel', () => ({}))

import { NextRequest } from 'next/server'
import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`https://eno.vn/api/listings?${qs}`))

beforeEach(() => {
  h.subBases = []
  h.totals = []
  h.facetOpts = []
  h.released = []
  h.plan = null
})

describe('GET /api/listings — condition words in the chip counts', () => {
  it('"second hand sofa": no condition clause anywhere — the facet base is the structural filters alone', async () => {
    h.shape = 'words'
    await get(`category=furniture-appliances&q=${encodeURIComponent('second hand sofa')}`)
    expect(h.subBases.at(-1)).toEqual([S])
    expect(h.totals).toContainEqual({ AND: [S] })
    expect(h.facetOpts.at(-1)).toHaveProperty('saleScopeFromWords', false)
  })

  it('"second hand": the sale scope stays in the facet base, and every other base is told to write it back', async () => {
    h.shape = 'alone'
    await get(`category=furniture-appliances&q=${encodeURIComponent('second hand')}`)
    expect(h.subBases.at(-1)).toEqual([S, SALE])
    expect(h.totals).toContainEqual({ AND: [S, SALE] })
    expect(h.facetOpts.at(-1)).toHaveProperty('saleScopeFromWords', true)
  })

  it('a subcategory drop plan rebuilds its bases with the same flag', async () => {
    h.shape = 'alone'
    h.plan = new Map([['', []]])
    await get(`category=furniture-appliances&q=${encodeURIComponent('đồ cũ')}`)
    expect(h.released.at(-1)).toEqual([expect.any(URLSearchParams), 'subcategory', null, true])
  })
})
