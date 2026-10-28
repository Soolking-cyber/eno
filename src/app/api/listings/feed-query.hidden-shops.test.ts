import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `xs=<shop ids>` — THE SHOPS THE VIEWER BLOCKED LEAVE THE FEED SERVER-SIDE (App Store 1.2, 2026-10-29). One imported shop
 * filled the whole first page of "scooter", so hiding its cards alone left a count over an empty grid. The explorer sends
 * the blocker's hidden shops (src/lib/hidden-sellers.ts); buildFeedFilters turns them into ONE `notIn` element of the AND
 * array every count, facet and page is built from — plain ids only, capped, and only while `ugc-safety` is on.
 */
vi.mock('@/lib/db', () => ({
  db: {
    listing: { groupBy: vi.fn(async () => []) },
    category: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: unknown) => w,
  marketplaceListingScope: async () => ({}),
  teacherExclusion: async () => null,
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: unknown) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: unknown) => l }))

import { buildFeedFilters } from './feed-query'
import { MAX_HIDDEN_IN_QUERY } from '@/lib/hidden-sellers'

const notIn = async (qs: string) => {
  const f = await buildFeedFilters(new URLSearchParams(qs))
  return (f.andFilters as Array<{ sellerId?: { notIn?: string[] } }>).filter((x) => x.sellerId?.notIn).map((x) => x.sellerId!.notIn)
}

afterEach(() => vi.unstubAllEnvs())

describe('buildFeedFilters — the viewer\'s hidden shops (xs)', () => {
  it('leaves those shops out as ONE notIn element of the AND array', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect(await notIn('q=scooter&xs=vehicle-import-seller-janmotorbike,cmabc123')).toEqual([['vehicle-import-seller-janmotorbike', 'cmabc123']])
  })

  it('drops anything that is not a plain shop id, and caps the list', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect(await notIn('xs=ok1,"bad",a b,ok1')).toEqual([['ok1']])
    const many = Array.from({ length: MAX_HIDDEN_IN_QUERY + 20 }, (_, i) => `s${i}`).join(',')
    expect((await notIn(`xs=${many}`))[0]).toHaveLength(MAX_HIDDEN_IN_QUERY)
  })

  it('adds nothing without the param, with an empty one, or while ugc-safety is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    expect(await notIn('q=scooter')).toEqual([])
    expect(await notIn('xs=')).toEqual([])
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect(await notIn('xs=ok1')).toEqual([])
  })
})
