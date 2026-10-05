import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * App Store gate `app-ai-notice`: from either app, typed search words never reach Google — GET /api/listings tells
 * semanticRank `noAi`, which skips Vertex AI Search, and an answer that differs from a browser's is not edge-cached.
 * Gate off ⇒ `noAi` is false for everyone and the Cache-Control is unchanged. Mocks follow route.spell.test.ts.
 */

const h = vi.hoisted(() => ({
  totals: {} as Record<string, number>,
  semantic: vi.fn(async (args: { noAi?: boolean }) => ({ semanticListings: null, semanticTotal: 0, aiSkipped: args.noAi === true })),
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
    countListingsCached: async (w: { q?: string }) => h.totals[w.q ?? ''] ?? 0,
  }
})
vi.mock('@/lib/spell-correct', () => ({ correctQuery: async (q: string) => (q === 'iphnoe' ? 'iphone' : null) }))
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
vi.mock('@/lib/facet-counts', () => ({ computeFacetCounts: async () => ({}), subcategoryDimension: () => ({}) }))
vi.mock('./semantic-rank', () => ({ semanticRank: (args: { noAi?: boolean }) => h.semantic(args) }))
vi.mock('./keyword-rank', () => ({ keywordRank: async () => ({ keywordListings: null }) }))
vi.mock('./resolve-seller', () => ({}))
vi.mock('@/lib/publish-funnel', () => ({}))

import { NextRequest } from 'next/server'
import { GET } from './route'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const get = (qs: string, ua: string) => GET(new NextRequest(`https://www.eno.forum/api/listings?${qs}`, { headers: { 'user-agent': ua } }))
const noAiFlags = () => h.semantic.mock.calls.map(([a]) => a.noAi)

beforeEach(() => {
  h.totals = { 'road bike': 12, iphone: 3439 }
  h.semantic.mockClear()
  vi.unstubAllEnvs()
})

describe('GET /api/listings — typed search and Google, by gate and client', () => {
  it('gate OFF: nobody is held back — the app included — and the edge may cache it', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    for (const ua of [IOS_APP, ANDROID_APP, DESKTOP]) {
      const res = await get('q=road+bike&facets=0', ua)
      expect(res.headers.get('cache-control')).toBe('public, max-age=15, s-maxage=60, stale-while-revalidate=300')
    }
    expect(noAiFlags()).toEqual([false, false, false])
  })

  it('gate ON, a browser: unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    const res = await get('q=road+bike&facets=0', DESKTOP)
    expect(noAiFlags()).toEqual([false])
    expect(res.headers.get('cache-control')).toBe('public, max-age=15, s-maxage=60, stale-while-revalidate=300')
  })

  it('gate ON, either app: no Vertex, and the keyword answer is never edge-cached for browsers', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    for (const ua of [IOS_APP, ANDROID_APP]) {
      const res = await get('q=road+bike&facets=0', ua)
      expect(res.headers.get('cache-control')).toBe('private, no-store')
    }
    expect(noAiFlags()).toEqual([true, true])
  })

  it('gate ON, the app: the spelling retry is held back too', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    await get('q=iphnoe&spell=1&facets=0', IOS_APP)
    expect(noAiFlags()).toEqual([true, true])
  })
})
