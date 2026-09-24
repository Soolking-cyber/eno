import { describe, expect, it, vi } from 'vitest'

/**
 * `GET /api/listings` says which district it read out of the text query. The explorer derives its
 * chip from the same pure function (src/lib/district-query.ts), but every other client — the native
 * apps, anything reading a shared link — only has the response, and a scope applied silently is a
 * result set nobody can explain. Mocks follow route.histogram.test.ts: nothing reaches a database.
 */

const h = vi.hoisted(() => ({ inferred: null as string | null, facetOpts: [] as { inferredDistrict?: string | null }[] }))

vi.mock('@/lib/db', () => ({ db: { listing: { findMany: vi.fn(async () => []) } } }))
vi.mock('./feed-query', () => {
  const filters = (inferredDistrict: () => string | null) => async () => ({
    histogram: false, where: {}, andFilters: [], pgTextFilter: null, subcategoryFilter: null,
    offset: 0, limit: 24, sort: 'recent', q: undefined, inferredDistrict: inferredDistrict(),
  })
  return {
  idsFastPath: async () => null,
  // ⚠️ The route must read through the RESOLVER (the plain-words safety net); the bare builder here
  // answers something else on purpose, so a route that skipped the resolver fails below.
  buildFeedFilters: filters(() => 'unresolved'),
  resolveFeedFilters: filters(() => h.inferred),
  buildFeedOrderBy: () => [],
  getSubcategoryCounts: async () => [],
  countListingsCached: async () => 0,
  }
})
vi.mock('@/lib/taxonomy', () => ({ migrateLegacyCategoryParams: (p: URLSearchParams) => p }))
vi.mock('@/lib/client-ip', () => ({}))
vi.mock('@/lib/feed-diversity', () => ({ diversityAppliesTo: () => false, diversifyBySeller: (r: unknown[]) => r }))
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
  computeFacetCounts: async (o: { inferredDistrict?: string | null }) => { h.facetOpts.push(o); return {} },
  subcategoryDimension: () => ({}),
}))
vi.mock('./semantic-rank', () => ({ semanticRank: async () => ({ semanticListings: null, semanticTotal: 0 }) }))
vi.mock('./resolve-seller', () => ({}))
vi.mock('@/lib/publish-funnel', () => ({}))

import { NextRequest } from 'next/server'
import { GET } from './route'

describe('GET /api/listings — inferredDistrict', () => {
  it('carries the district the builder read out of the query', async () => {
    h.inferred = 'd7'
    const body = await (await GET(new NextRequest('https://eno.vn/api/listings?q=Qu%E1%BA%ADn%207&facets=0'))).json()
    expect(body.inferredDistrict).toBe('d7')
  })

  it('is null when the query names no district', async () => {
    h.inferred = null
    const body = await (await GET(new NextRequest('https://eno.vn/api/listings?q=iphone&facets=0'))).json()
    expect(body.inferredDistrict).toBeNull()
  })

  /**
   * ⛔ THE CHIP COUNTS ARE HANDED THE ROUTE'S DECISION, NOT LEFT TO RE-READ THE WORDS. When the feed
   * drops a district reading that finds nothing (resolveFeedFilters), counting the chips inside that
   * district would print zeros beside a full grid.
   */
  it('hands its inferredDistrict — null included — to the facet counts', async () => {
    h.facetOpts = []
    h.inferred = null
    await GET(new NextRequest('https://eno.vn/api/listings?q=H%E1%BB%93i%20%E1%BB%A9c%20Ph%C3%BA%20Nhu%E1%BA%ADn'))
    expect(h.facetOpts.at(-1)).toHaveProperty('inferredDistrict', null)
    h.inferred = 'd7'
    await GET(new NextRequest('https://eno.vn/api/listings?q=Qu%E1%BA%ADn%207'))
    expect(h.facetOpts.at(-1)).toHaveProperty('inferredDistrict', 'd7')
  })
})
