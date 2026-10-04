import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ C7 — THE HOME FEED'S GOODS SEATS, END TO END: the home page's server render (the real
 * `(home)/page.tsx`) and `GET /api/listings` (the real route) over ONE in-memory catalogue, with the real
 * feed-window.ts and feed-diversity.ts between them. What it proves:
 *   · the server-rendered twelve carry at least two goods in the first four and four in the first twelve;
 *   · the explorer's page 1 from the API is those same twelve, in the same order (no hydration reshuffle);
 *   · page 2 onwards never repeats a server-rendered card and, walked to the end, serves every listing
 *     exactly once — also when the goods had to be fetched into the window (the head runs past sixty);
 *   · a request with any filter is the plain seller deal, unchanged.
 * Nothing reaches a database: `db.listing` is a small evaluator over the rows below, implementing exactly
 * the predicate shapes the window and the route build (AND / OR / equality / in / notIn, with SQL's
 * NULL-in-NOT-IN behaviour, and the category relation).
 */

type Row = {
  id: string
  sellerId: string
  rankScore: number
  listingType: string
  condition: string | null
  category: { slug: string }
  subcategorySlug: string | null
  verified: boolean
  status: string
  price: number
}

const h = vi.hoisted(() => ({ rows: [] as unknown[] }))

/** Does `row` satisfy a Prisma-shaped `where`? Throws on a shape it does not implement, so a test cannot pass by ignoring a clause. */
function matches(row: Record<string, unknown>, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  return Object.entries(where as Record<string, unknown>).every(([key, cond]) => {
    if (key === 'AND') return (cond as unknown[]).every((w) => matches(row, w))
    if (key === 'OR') return (cond as unknown[]).some((w) => matches(row, w))
    const value = row[key]
    if (cond === null) return value === null || value === undefined
    if (typeof cond !== 'object') return value === cond
    if (value && typeof value === 'object') return matches(value as Record<string, unknown>, cond) // a relation
    const f = cond as { in?: unknown[]; notIn?: unknown[] }
    // SQL: NULL IN (…) and NULL NOT IN (…) are both NULL — false.
    if (f.in) return value != null && f.in.includes(value)
    if (f.notIn) return value != null && !f.notIn.includes(value)
    throw new Error(`the test evaluator does not implement ${key}: ${JSON.stringify(cond)}`)
  })
}

function sorted(rows: Row[], orderBy: Record<string, 'asc' | 'desc'>[] = []): Row[] {
  const keys = orderBy.flatMap((o) => Object.entries(o)) as [keyof Row, 'asc' | 'desc'][]
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      if (a[k] === b[k]) continue
      const c = (a[k] as number | string) < (b[k] as number | string) ? -1 : 1
      return dir === 'desc' ? -c : c
    }
    return 0
  })
}

vi.mock('@/lib/db', () => {
  const all = () => h.rows as Row[]
  const where = (w: unknown) => all().filter((r) => matches(r as unknown as Record<string, unknown>, w))
  return {
    db: {
      listing: {
        findMany: async ({ where: w, orderBy, skip = 0, take }: { where: unknown; orderBy?: Record<string, 'asc' | 'desc'>[]; skip?: number; take?: number }) =>
          sorted(where(w), orderBy).slice(skip, take === undefined ? undefined : skip + take),
        count: async ({ where: w }: { where: unknown }) => where(w).length,
        aggregate: async ({ where: w }: { where: unknown }) => {
          const r = where(w)
          return { _max: { rankScore: r.length ? Math.max(...r.map((x) => x.rankScore)) : null } }
        },
        groupBy: async ({ where: w, take }: { where: unknown; take?: number }) => {
          const best = new Map<string, number>()
          for (const r of where(w)) best.set(r.sellerId, Math.max(best.get(r.sellerId) ?? -Infinity, r.rankScore))
          // orderBy: [{ _max: { rankScore: 'desc' } }, { sellerId: 'desc' }] — the only grouping the window asks for.
          const groups = [...best].map(([sellerId, max]) => ({ sellerId, _max: { rankScore: max } }))
            .sort((a, b) => (a._max.rankScore === b._max.rankScore ? (a.sellerId < b.sellerId ? 1 : -1) : b._max.rankScore - a._max.rankScore))
          return take === undefined ? groups : groups.slice(0, take)
        },
      },
    },
  }
})

/** The unfiltered feed's predicate, as buildFeedFilters builds it (verified + active). */
const BASE = { AND: [{ verified: true }, { status: 'active' }] }
vi.mock('./feed-query', () => {
  const filters = async (p: URLSearchParams) => ({
    histogram: false, where: BASE, andFilters: BASE.AND, pgTextFilter: null, subcategoryFilter: null, saleScopeFromWords: false,
    offset: Number(p.get('offset') ?? 0), limit: Number(p.get('limit') ?? 24), sort: p.get('sort') || 'newest',
    q: undefined, inferredDistrict: null, category: undefined, featuredOnly: false, looseMatch: false, priorityCategory: undefined,
    priceMin: NaN, priceMax: NaN,
  })
  return {
    idsFastPath: async () => null,
    buildFeedFilters: filters,
    resolveFeedFilters: filters,
    buildFeedOrderBy: () => [{ rankScore: 'desc' }, { id: 'desc' }],
    getSubcategoryCounts: async () => [],
    countListingsCached: async () => h.rows.length,
  }
})
// The licensing scope, as the real one composes it — every read must carry it.
vi.mock('@/lib/edition-scope', () => ({
  DeskResolutionError: class extends Error {},
  scopedListingWhere: async (w: unknown) => ({ AND: [w, { sellerId: { notIn: ['desk'] } }] }),
}))
vi.mock('@/lib/serialize', () => ({
  serializeListingCard: (r: unknown) => r,
  LISTING_CARD_SELECT: { id: true, sellerId: true, subcategorySlug: true, listingType: true, condition: true, price: true, category: { select: { slug: true } } },
}))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: unknown[]) => l }))
vi.mock('@/lib/client-ip', () => ({}))
vi.mock('@/lib/phone', () => ({}))
vi.mock('@/lib/publish-guard', () => ({ PublishBlockedError: class extends Error {} }))
vi.mock('@/lib/handle', () => ({}))
vi.mock('@/lib/admin', () => ({}))
vi.mock('@/lib/enforcement', () => ({}))
vi.mock('@/lib/ratelimit', () => ({}))
vi.mock('@/lib/core/listings', () => ({}))
vi.mock('@/lib/facet-counts', () => ({
  computeFacetCounts: async () => ({}),
  subcategoryDimension: () => ({}),
  subcategoryDropPlan: () => null,
  releasedParams: () => new URLSearchParams(),
}))
vi.mock('./semantic-rank', () => ({ semanticRank: async () => ({ semanticListings: null, semanticTotal: 0 }) }))
vi.mock('./keyword-rank', () => ({ keywordRank: async () => ({ keywordListings: null }) }))
vi.mock('@/lib/spell-correct', () => ({ correctQuery: async () => null }))
vi.mock('./resolve-seller', () => ({}))
vi.mock('@/lib/publish-funnel', () => ({}))
// The home page's other inputs — none of them touch the feed.
vi.mock('@/lib/categories', () => ({ getCategoriesByDemand: async () => [] }))
vi.mock('@/lib/core/business-rail', () => ({ topBusinessListings: async () => [] }))
vi.mock('@/lib/core/trending-rail', () => ({ trendingRailListings: async (o: { excludeIds: Promise<string[]> }) => { await o.excludeIds; return [] } }))
vi.mock('@/components/marketplace/listings-explorer', () => ({ ListingsExplorer: () => null }))
vi.mock('@/app/[lang]/(home)/home-metadata', () => ({ homeMetadata: () => ({}) }))

import { NextRequest } from 'next/server'
import { GET } from './route'
import Home from '@/app/[lang]/(home)/page'
import { __resetFeedWindowCache } from '@/lib/feed-window'
import { SHARED_SEAT_SELLERS, isSecondHandGoods } from '@/lib/feed-diversity'
import { JOB_SELLER_IDS } from '@/lib/job-listing'

/** The vehicle import's storefronts, as the seats read them (feed-diversity.test.ts holds them equal to the importer's). */
const VEHICLE_SELLER_IDS = SHARED_SEAT_SELLERS['vehicle-rentals']

/** `n` rows of one seller, its best at `best`, each next one a hair lower (so rank order is total). */
function stock(sellerId: string, n: number, best: number, kind: { listingType: string; slug: string; sub?: string | null; price?: number; condition?: string | null }): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${sellerId}-${String(i).padStart(2, '0')}`, sellerId, rankScore: best - i / 10_000,
    listingType: kind.listingType, condition: kind.condition ?? null, category: { slug: kind.slug }, subcategorySlug: kind.sub ?? null,
    verified: true, status: 'active', price: kind.price ?? 1_000_000,
  }))
}
const RENT = { listingType: 'rent', slug: 'rentals' }
const SELL = (slug = 'electronics', condition: string | null = 'used') => ({ listingType: 'sell', slug, condition })

/**
 * PRODUCTION'S SHAPE ON 2026-10-05 (read-only): the importers and the shared catalogues out-rank every goods
 * shop, so the seller deal puts the first goods card ninth or later. VinWonders' tickets are `sell` rows in
 * tickets-travel — for sale and NOT goods, which is what keeps them out of the seats.
 */
function productionShape(): Row[] {
  return [
    ...stock('bds', 30, 0.551, RENT),
    ...JOB_SELLER_IDS.slice(0, 4).flatMap((s) => stock(s, 3, 0.55, { listingType: 'job', slug: 'jobs', price: 0 })),
    ...VEHICLE_SELLER_IDS.slice(0, 3).flatMap((s) => stock(s, 8, 0.53, { ...RENT, sub: 'motorbike-rental' })),
    ...['mobifone', 'viettel'].flatMap((s) => stock(s, 5, 0.508, { listingType: 'service', slug: 'services', sub: 'esim' })),
    ...stock('nhatot', 20, 0.5019, RENT),
    ...stock('muaban', 20, 0.5005, RENT),
    ...stock('rever', 10, 0.4892, RENT),
    ...stock('honeycomb', 10, 0.4756, RENT),
    ...stock('vinwonders', 5, 0.47, { listingType: 'sell', slug: 'tickets-travel' }),
    // A new-stock shop out-ranking every second-hand one: for sale, in a goods category, and still NOT a goods
    // seat — the published sentence says second-hand (isSecondHandGoods reads `condition: 'used'`).
    ...stock('newstock', 6, 0.4635, SELL('electronics', 'new')),
    ...stock('banghe', 15, 0.4629, SELL('furniture-appliances')),
    ...stock('tgs', 12, 0.4628, SELL()),
    ...stock('zshop', 10, 0.4627, SELL()),
    ...stock('tuan', 8, 0.4621, SELL()),
    ...stock('minh', 8, 0.4619, SELL()),
    ...stock('h24', 8, 0.4616, SELL()),
    ...stock('vnlaptop', 8, 0.4612, SELL()),
  ]
}

const EXPLORER = (offset: number) => `sort=newest&verified=true&limit=12&offset=${offset}&lang=en`
async function apiPage(qs: string): Promise<Row[]> {
  const res = await GET(new NextRequest(`https://eno.vn/api/listings?${qs}`))
  return (await res.json()).listings as Row[]
}
/** What the home page server-renders: the real page component's seed for the explorer. */
async function ssrPage(): Promise<Row[]> {
  const el = (await Home()) as { props: { initialListings: Row[] } }
  return el.props.initialListings
}
/** The explorer scrolling the API from page 2 until it runs dry. */
async function scrollFromPage2(): Promise<Row[]> {
  const out: Row[] = []
  for (let offset = 12; offset < 2000; offset += 12) {
    const page = await apiPage(EXPLORER(offset))
    if (!page.length) break
    out.push(...page)
  }
  return out
}
const ids = (rows: Row[]) => rows.map((r) => r.id)
const goodsIn = (rows: Row[], n: number) => rows.slice(0, n).filter(isSecondHandGoods).length

beforeEach(() => {
  __resetFeedWindowCache()
})

describe('the home feed’s goods seats — server render and API agree, and pages stay exact', () => {
  it('⛔ the server-rendered twelve: two goods in the first four, four in the first twelve (the plain deal: 0 and 2)', async () => {
    h.rows = productionShape()
    // The same catalogue under a filter is the plain seller deal — the shape the seats correct.
    const plain = await apiPage('sort=newest&verified=true&limit=12&offset=0&district=d1')
    expect(goodsIn(plain, 4)).toBe(0)
    // 2, not 3: the new-stock shop takes a seller turn, and its rows are not second-hand goods.
    expect(goodsIn(plain, 12)).toBe(2)
    const ssr = await ssrPage()
    expect(ssr).toHaveLength(12)
    expect(goodsIn(ssr, 4)).toBe(2)
    expect(goodsIn(ssr, 12)).toBe(4)
    // Latest deadline: the feed's own first two cards stay, and the goods are four different shops.
    expect(ids(ssr).slice(0, 2)).toEqual(ids(plain).slice(0, 2))
    expect(new Set(ssr.filter(isSecondHandGoods).map((r) => r.sellerId)).size).toBe(4)
    // The tickets are for sale but not goods: no seat for them.
    expect(ssr.filter(isSecondHandGoods).some((r) => r.sellerId === 'vinwonders')).toBe(false)
    // ⛔ The new-stock shop out-ranks every second-hand shop and still takes neither goods seat: the
    // seats are cards 3-4, and both hold second-hand goods.
    expect(ssr.slice(2, 4).every(isSecondHandGoods)).toBe(true)
    expect(ssr.slice(2, 4).map((r) => r.sellerId)).not.toContain('newstock')
  })

  it('⛔ the API’s page 1 is the server-rendered twelve, card for card — no reshuffle on hydration', async () => {
    h.rows = productionShape()
    const ssr = await ssrPage()
    expect(ids(await apiPage(EXPLORER(0)))).toEqual(ids(ssr))
  })

  it('⛔ page 2 repeats no server-rendered card, and the scroll serves every listing exactly once', async () => {
    h.rows = productionShape()
    const ssr = await ssrPage()
    const page2 = await apiPage(EXPLORER(12))
    expect(page2).toHaveLength(12)
    expect(page2.filter((r) => ids(ssr).includes(r.id))).toEqual([])
    const all = [...ssr, ...(await scrollFromPage2())]
    expect(new Set(ids(all)).size).toBe(all.length)
    expect(all).toHaveLength(h.rows.length)
  })

  it('⛔ goods out of the window: fetched in, seated, and pages still exact past a head longer than sixty', async () => {
    // Fourteen rental importers now out-rank every goods shop, so the twelve-seller window holds no goods.
    h.rows = [
      ...Array.from({ length: 14 }, (_, i) => stock(`importer${String(i).padStart(2, '0')}`, 6, 0.6 - i / 1000, RENT)).flat(),
      ...stock('banghe', 9, 0.46, SELL('furniture-appliances')),
      ...stock('tgs', 9, 0.459, SELL()),
      ...stock('zshop', 9, 0.458, SELL()),
      ...stock('tuan', 9, 0.457, SELL()),
      ...stock('minh', 9, 0.456, SELL()),
    ]
    const plain = await apiPage('sort=newest&verified=true&limit=12&offset=0&type=all&q=&district=d1')
    expect(goodsIn(plain, 12)).toBe(0)
    const ssr = await ssrPage()
    expect(ssr.flatMap((r, i) => (isSecondHandGoods(r) ? [i] : []))).toEqual([2, 3, 10, 11])
    expect(new Set(ssr.filter(isSecondHandGoods).map((r) => r.sellerId))).toEqual(new Set(['banghe', 'tgs', 'zshop', 'tuan']))
    expect(ids(await apiPage(EXPLORER(0)))).toEqual(ids(ssr))
    const all = [...ssr, ...(await scrollFromPage2())]
    expect(new Set(ids(all)).size).toBe(all.length)
    expect(all).toHaveLength(h.rows.length)
  })

  it('⛔ not enough goods: the one goods listing takes card 3, everything else fills normally, pages exact', async () => {
    h.rows = [...productionShape().filter((r) => !isSecondHandGoods(r)), ...stock('solo', 1, 0.2, SELL('baby-kids'))]
    const ssr = await ssrPage()
    expect(ssr.flatMap((r, i) => (isSecondHandGoods(r) ? [i] : []))).toEqual([2])
    expect(ids(await apiPage(EXPLORER(0)))).toEqual(ids(ssr))
    const all = [...ssr, ...(await scrollFromPage2())]
    expect(new Set(ids(all)).size).toBe(all.length)
    expect(all).toHaveLength(h.rows.length)
  })

  it('no goods at all: the home feed is exactly the plain seller deal', async () => {
    h.rows = productionShape().filter((r) => !isSecondHandGoods(r))
    const plain = await apiPage('sort=newest&verified=true&limit=12&offset=0&district=d1')
    expect(ids(await ssrPage())).toEqual(ids(plain))
  })
})
