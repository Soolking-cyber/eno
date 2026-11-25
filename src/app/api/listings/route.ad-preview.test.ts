import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The creative ads' private test (src/lib/ads/creative-gate.ts): GET /api/listings hands `adpreview=1` to pickAd as
 * `preview`, and a response to such a request is `private, no-store` whether or not a creative was picked — the edge keys
 * on the URL, so a cached preview could be served to anyone who guessed it. Without the param, nothing changes.
 * Mocks follow route.no-ai.test.ts; the ad server is a stub that records what it was asked.
 */

const h = vi.hoisted(() => ({
  pickOpts: [] as { creatives?: boolean; preview?: boolean }[],
  creative: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/db', () => ({ db: { listing: { findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) } } }))
vi.mock('./feed-query', () => {
  const filters = async (sp: URLSearchParams) => ({
    histogram: sp.get('histogram') === '1', where: { q: sp.get('q') ?? '' }, andFilters: [], pgTextFilter: null,
    subcategoryFilter: null, offset: 0, limit: 24, sort: 'newest', q: sp.get('q') ?? undefined, inferredDistrict: null,
  })
  return {
    idsFastPath: async () => null,
    buildFeedFilters: filters,
    resolveFeedFilters: filters,
    buildFeedOrderBy: () => [],
    getSubcategoryCounts: async () => [],
    countListingsCached: async () => 3,
  }
})
vi.mock('@/lib/ads/serve', () => ({
  adEligibleRequest: () => true,
  pickAd: async (_w: unknown, _l: unknown, _n: unknown, opts: { creatives?: boolean; preview?: boolean }) => {
    h.pickOpts.push(opts)
    return { listing: null, creative: h.creative }
  },
  withAd: (l: unknown[]) => l,
}))
vi.mock('@/lib/spell-correct', () => ({ correctQuery: async () => null }))
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
vi.mock('./semantic-rank', () => ({ semanticRank: async () => ({ semanticListings: null, semanticTotal: 0, aiSkipped: false }) }))
vi.mock('./keyword-rank', () => ({ keywordRank: async () => ({ keywordListings: null }) }))
vi.mock('./resolve-seller', () => ({}))
vi.mock('@/lib/publish-funnel', () => ({}))

import { NextRequest } from 'next/server'
import { GET } from './route'

const get = (qs: string) => GET(new NextRequest(`https://eno.vn/api/listings?${qs}`))
const CREATIVE = { adId: 'ad7', advertiserName: 'Bean', headline: 'Coffee', body: null, imageUrl: 'https://sb.example/ads/1.webp', clickUrl: 'https://bean.vn/' }

beforeEach(() => {
  h.pickOpts = []
  h.creative = null
})

describe('GET /api/listings — the creative ads\' preview', () => {
  it('adpreview=1 reaches pickAd as `preview`, beside the adc=1 opt-in', async () => {
    await get('adc=1&adpreview=1&facets=0')
    await get('adc=1&facets=0')
    await get('adpreview=1&facets=0')
    expect(h.pickOpts).toEqual([{ creatives: true, preview: true }, { creatives: true, preview: false }, { creatives: false, preview: true }])
  })

  it('⛔ a preview response is never edge-cached: with a creative picked or none', async () => {
    h.creative = CREATIVE
    const withAd = await get('adc=1&adpreview=1&facets=0')
    expect(withAd.headers.get('cache-control')).toBe('private, no-store')
    expect((await withAd.json()).adCreative).toMatchObject({ adId: 'ad7' })
    h.creative = null
    expect((await get('adc=1&adpreview=1&facets=0')).headers.get('cache-control')).toBe('private, no-store')
  })

  it('without the param, unchanged: 45 s at the edge with a creative, the ordinary feed tier without', async () => {
    h.creative = CREATIVE
    expect((await get('adc=1&facets=0')).headers.get('cache-control')).toBe('public, max-age=15, s-maxage=45')
    h.creative = null
    expect((await get('adc=1&facets=0')).headers.get('cache-control')).toBe('public, max-age=15, s-maxage=60, stale-while-revalidate=300')
  })
})
