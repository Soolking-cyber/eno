import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE TYPEAHEAD IS THE PREVIEW OF WHAT ENTER RETURNS, SO IT MUST READ A DISTRICT THE SAME WAY.
 * Measured on production 2026-09-24: for "Quận 1" the dropdown's six listings were the same six as
 * for "Quận 7", and 0 of them were in Quận 1 — the query had been reduced to the token `quan`.
 */

const findMany = vi.fn(async (_args: any) => [])
const groupBy = vi.fn(async (_args: any): Promise<any[]> => [])
const categories = vi.fn(async (_args: any): Promise<any[]> => [])
const brandFindMany = vi.fn(async (_args: any): Promise<any[]> => [])
const brandFindUnique = vi.fn(async (_args: any): Promise<any> => null)
// Every grouped read lands in `groupBy` (the tests tell the line count, by: [categoryId], from the
// aisle count, by: [categoryId, subcategorySlug]); these two record WHICH client asked.
const appGroupBy = vi.fn((a: any) => groupBy(a))
const aisleGroupBy = vi.fn((a: any) => groupBy(a))
vi.mock('./aisle-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aisle-db')>()),
  aisleDb: () => ({ listing: { groupBy: (a: any) => aisleGroupBy(a) } }),
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: { findMany: (a: any) => findMany(a), groupBy: (a: any) => appGroupBy(a) },
    category: { findMany: (a: any) => categories(a) },
    brand: { findMany: (a: any) => brandFindMany(a), findUnique: (a: any) => brandFindUnique(a) },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: any) => w, marketplaceListingScope: async () => ({}), teacherExclusion: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/api/handler', () => ({
  route: (_opts: unknown, fn: (ctx: { req: Request }) => unknown) => (req: Request) => fn({ req }),
}))

const { GET } = await import('./route')
const { __resetSuggestEntityCaches } = await import('./suggest-entities')
const { __resetLiveBrandCounts } = await import('@/lib/live-brands')
const { districtScopeForSlug } = await import('@/lib/district-slug')
const { textClauses, wordStart } = await import('@/lib/search-match')

/**
 * The typeahead reads two candidate pools (keyword-rank.ts rankCandidates): pool A is the plain
 * WHERE (it carries `verified` at the top), pool B narrows it with the title-hit clause. The district
 * tests below are about the WHERE, so they read pool A's calls.
 */
const poolA = () => findMany.mock.calls.filter((c) => c[0].where.verified === true)

const suggest = (q: string) =>
  (GET as unknown as (r: Request) => Promise<Response>)(new Request(`https://eno.vn/api/search/suggest?q=${encodeURIComponent(q)}`))

beforeEach(() => {
  findMany.mockClear()
  for (const f of [groupBy, categories, brandFindMany, brandFindUnique]) f.mockReset()
  appGroupBy.mockClear()
  aisleGroupBy.mockClear()
  groupBy.mockImplementation(async () => [])
  categories.mockImplementation(async () => [])
  brandFindMany.mockImplementation(async () => [])
  brandFindUnique.mockImplementation(async () => null)
  __resetSuggestEntityCaches()
  __resetLiveBrandCounts()
})

describe('suggest — a district in the query', () => {
  it('"Quận 1" asks for listings in the d1 scope, not for the token "quan"', async () => {
    await suggest('Quận 1')
    // No words left, so no title hits to look for: pool A alone.
    expect(findMany.mock.calls).toHaveLength(1)
    expect(poolA()[0][0].where.AND).toEqual([await districtScopeForSlug('d1')])
  })

  it('"căn hộ quận 7" keeps its words as text beside the d7 scope — "căn hộ" as ONE unit (S-RECALL)', async () => {
    await suggest('căn hộ quận 7')
    expect(poolA()[0][0].where.AND).toEqual([...textClauses('can ho'), await districtScopeForSlug('d7')])
    expect(textClauses('can ho')).toHaveLength(1)
  })

  it('a bare shorthand stays text, exactly as Enter reads it — a short token at a word start', async () => {
    await suggest('Q7')
    expect(poolA()[0][0].where.AND).toEqual([wordStart('q7')])
  })

  it('a long token is searched exactly as before', async () => {
    await suggest('iphone 7')
    expect(poolA()[0][0].where.AND).toEqual([{ searchText: { contains: 'iphone' } }])
  })

  /**
   * ⛔ THE FEED'S SAFETY NET, IN THE PREVIEW TOO (resolveFeedFilters). "Hồi ức Phú Nhuận" is a book: read
   * as Phú Nhuận it suggests nothing, while Enter now serves the plain words — so the dropdown asks
   * again with the plain words rather than preview an empty set.
   */
  it('asks again with the plain words when the district reading suggests nothing', async () => {
    await suggest('Hồi ức Phú Nhuận')
    expect(poolA()).toHaveLength(2)
    expect(poolA()[1][0].where.AND).toEqual(textClauses('hoi uc phu nhuan'))
  })

  it('does not ask again when the district reading has suggestions, or for a bare numbered district', async () => {
    findMany.mockImplementationOnce(async () => [{ id: 'a', images: '[]', category: { slug: 'rentals' } }] as any)
    await suggest('Hồi ức Phú Nhuận')
    expect(poolA()).toHaveLength(1)
    findMany.mockClear()
    // A housing search never asks again: its zero is honest (hasPlainTextFallback).
    await suggest('phòng trọ Phú Nhuận')
    expect(poolA()).toHaveLength(1)
    findMany.mockClear()
    await suggest('Quận 1')
    expect(poolA()).toHaveLength(1)
  })
})

/**
 * ⛔ THE DROPDOWN IS A PREVIEW OF ENTER (S-RANK, K-VARIANTS, K-RENT-UNIT, 2026-09-29). It used to take
 * the six best rows by rankScore alone: for "iphone" an eSIM and a tote bag (each mentions an iPhone
 * in its description) came before the phones.
 */
describe('suggest — the six rows', () => {
  const now = new Date()
  const base = { sellerTrustScore: 100, postedAt: now, rankScore: 0.9, price: 1, currency: 'VND', priceUnit: '', location: 'HCMC', listingType: 'sell', subcategorySlug: null, brandSlug: null, model: null }
  const esim = { ...base, id: 'esim', sellerId: 'viettel', title: 'Viettel eSIM 5GB', titleVi: null, images: '["https://x/e-h0000000000000000.webp"]', rankScore: 0.99, subcategorySlug: 'esim', category: { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' } }
  const tote = { ...base, id: 'tote', sellerId: 'ua', title: 'Under Armour Tote Bag', titleVi: null, images: '["https://x/t-h1111111111111111.webp"]', rankScore: 0.98, category: { slug: 'sports', name: 'Sports', nameVi: 'Thể thao' } }
  const phone = (id: string, model: string, hash: string) => ({ ...base, id, sellerId: 'shop', title: `${model} 256GB`, titleVi: null, brandSlug: 'apple', model, subcategorySlug: 'phones-tablets', images: `["https://x/${id}-h${hash.repeat(16)}.webp"]`, rankScore: 0.5, category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' } })
  const rows = [esim, tote, phone('p1', 'iPhone 18 Pro', '2'), phone('p2', 'iPhone 18 Pro', '3'), phone('p3', 'iPhone 17', '4')]

  it('strong title matches lead; description-only matches follow; one row per model; no seller fields on the wire', async () => {
    findMany.mockImplementation(async () => rows as any)
    const body = await (await suggest('iphone')).json()
    findMany.mockImplementation(async () => [])
    const ids: string[] = body.listings.map((l: any) => l.id)
    // Ties break like the feed (rankScore, then id desc): p3, then ONE of the two iPhone 18 Pro rows.
    expect(ids.slice(0, 2)).toEqual(['p3', 'p2'])
    expect(ids).not.toContain('p1') // same model as p2 — one row per model in the dropdown
    expect(ids.slice(2).sort()).toEqual(['esim', 'tote'])
    for (const l of body.listings) for (const k of ['sellerId', 'brandSlug', 'model', 'rankScore']) expect(l).not.toHaveProperty(k)
  })

  it('a Batdongsan/Rever bare "VND" rent reads VND/month (price-unit.ts displayPriceUnit)', async () => {
    const rever = { ...base, id: 'r', sellerId: 'cmub0wead0000zrq418bqq27m', title: 'Căn hộ 2PN', titleVi: 'Căn hộ 2PN', priceUnit: 'VND', images: '[]', category: { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' } }
    findMany.mockImplementation(async () => [rever] as any)
    const body = await (await suggest('can ho')).json()
    findMany.mockImplementation(async () => [])
    expect(body.listings[0].priceUnit).toBe('VND/month')
  })
})

/**
 * ⛔ THE ENTITY ROWS (S-TYPEAHEAD, 2026-09-29). Measured on production the day they were built: "iph"
 * offered the brand "Qui Phúc" (a substring of "quiphuc") and no way to say "every iPhone"; "sofa" had
 * no way to say "sofas, in the Sofa aisle". The pure halves are in suggest-entities.test.ts; these pin
 * the wiring — what the route asks the database and what reaches the wire.
 */
describe('suggest — brands, product lines and the scoped row', () => {
  const CATS = [
    { id: 'c-el', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
    { id: 'c-svc', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
    { id: 'c-home', slug: 'furniture-appliances', name: 'Home', nameVi: 'Nhà cửa' },
  ]

  it('"iph": the brand group asks for a PREFIX (no Qui Phúc), and the iPhone line comes back counted across ALL its categories', async () => {
    categories.mockImplementation(async () => CATS)
    brandFindUnique.mockImplementation(async (a: any) => (a.where.slug === 'apple' ? { name: 'Apple', status: 'active' } : null))
    groupBy.mockImplementation(async (a: any) => {
      if (a.by.length === 1 && JSON.stringify(a.where).includes('"brandSlug":"apple"') && JSON.stringify(a.where).includes('"model":"iPhone"')) {
        return [{ categoryId: 'c-el', _count: { _all: 943 } }, { categoryId: 'c-svc', _count: { _all: 29 } }]
      }
      return []
    })
    const body = await (await suggest('iph')).json()
    expect(brandFindMany.mock.calls[0][0].where.OR).toEqual([{ normalized: { startsWith: 'iph' } }])
    // 972, not 943: with a brand set the explorer sends the category as a boost, never a filter.
    expect(body.lines).toEqual([{ brand: 'apple', brandName: 'Apple', line: 'iPhone', category: 'electronics', count: 972 }])
    // The iPhone SE line had nothing live, so it is not a row.
    expect(body.lines).toHaveLength(1)
  })

  it('the line count is read through the FEED\'S OWN where for brand + line — the builder /api/listings reads', async () => {
    categories.mockImplementation(async () => CATS)
    brandFindUnique.mockImplementation(async () => ({ name: 'Apple', status: 'active' }))
    await suggest('iphone')
    const lineCall = groupBy.mock.calls.find((c) => c[0].by.length === 1 && c[0].by[0] === 'categoryId')![0]
    const { buildFeedFilters } = await import('@/app/api/listings/feed-query')
    const { where } = await buildFeedFilters(new URLSearchParams({ brand: 'apple', line: 'iPhone' }))
    expect(lineCall.where).toEqual(where)
  })

  it('brand chips come from the LIVE brands only, ranked by their live count — never by the stored listingCount', async () => {
    categories.mockImplementation(async () => CATS)
    groupBy.mockImplementation(async (a: any) => (a.by[0] === 'brandSlug'
      ? [{ brandSlug: 'samyang', _count: { _all: 2 } }, { brandSlug: 'samsung', _count: { _all: 50 } }, { brandSlug: null, _count: { _all: 7 } }]
      : []))
    // The table holds a curated brand with nothing live too; the read must not ask for it.
    brandFindMany.mockImplementation(async (a: any) => [
      { slug: 'samyang', name: 'Samyang', normalized: 'samyang' },
      { slug: 'samsung', name: 'Samsung', normalized: 'samsung' },
      { slug: 'samsonite', name: 'Samsonite', normalized: 'samsonite' },
    ].filter((b) => a.where.slug.in.includes(b.slug)))
    const body = await (await suggest('sam')).json()
    const where = brandFindMany.mock.calls[0][0].where
    expect(where.slug.in.sort()).toEqual(['samsung', 'samyang'])
    expect(where).not.toHaveProperty('listingCount')
    expect(body.brands).toEqual([{ slug: 'samsung', name: 'Samsung' }, { slug: 'samyang', name: 'Samyang' }])
    // The live read IS the feed's where (the real builder /api/listings reads, no parameters) + "has a brand"
    // — so a chip's brand is one the click on it can show.
    const liveCall = groupBy.mock.calls.find((c) => c[0].by[0] === 'brandSlug')![0]
    const { buildFeedFilters } = await import('@/app/api/listings/feed-query')
    const feed = (await buildFeedFilters(new URLSearchParams())).where
    expect(liveCall.where).toEqual({ AND: [feed, { brandSlug: { not: null } }] })
    expect(JSON.stringify(feed)).toContain('"verified":true')
  })

  it('a hidden brand, or a line with fewer than three live rows, is not a row', async () => {
    categories.mockImplementation(async () => CATS)
    brandFindUnique.mockImplementation(async () => ({ name: 'Apple', status: 'hidden' }))
    groupBy.mockImplementation(async (a: any) => (a.by.length === 1 ? [{ categoryId: 'c-el', _count: { _all: 500 } }] : []))
    expect((await (await suggest('iphone')).json()).lines).toEqual([])
    __resetSuggestEntityCaches()
    brandFindUnique.mockImplementation(async () => ({ name: 'Apple', status: 'active' }))
    groupBy.mockImplementation(async (a: any) => (a.by.length === 1 ? [{ categoryId: 'c-el', _count: { _all: 2 } }] : []))
    expect((await (await suggest('iphone')).json()).lines).toEqual([])
  })

  it('"sofa": the scoped row names the aisle, counted over the typeahead\'s own where', async () => {
    categories.mockImplementation(async () => CATS)
    groupBy.mockImplementation(async (a: any) => (a.by.length === 2
      ? [{ categoryId: 'c-home', subcategorySlug: 'sofa-seating', _count: { _all: 802 } }, { categoryId: 'c-home', subcategorySlug: 'tables-desks', _count: { _all: 46 } }]
      : []))
    const body = await (await suggest('sofa')).json()
    expect(body.scope).toEqual({ category: 'furniture-appliances', subcategory: 'sofa-seating', categoryName: 'Home', categoryNameVi: 'Nhà cửa', subName: 'Sofa', subNameVi: 'Sofa', count: 802 })
    const scopeCall = groupBy.mock.calls.find((c) => c[0].by.length === 2)![0]
    expect(scopeCall.where).toEqual(poolA()[0][0].where)
  })

  it('⛔ the visa product slot is never the scoped row', async () => {
    categories.mockImplementation(async () => CATS)
    groupBy.mockImplementation(async (a: any) => (a.by.length === 2 ? [{ categoryId: 'c-svc', subcategorySlug: 'visa-legal', _count: { _all: 90 } }] : []))
    expect((await (await suggest('visa')).json()).scope).toBeNull()
  })

  it('both entity rows fail SOFT — a failed read drops the row, never the dropdown', async () => {
    categories.mockImplementation(async () => CATS)
    groupBy.mockImplementation(async () => { throw new Error('db down') })
    brandFindUnique.mockImplementation(async () => ({ name: 'Apple', status: 'active' }))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await suggest('iphone')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.lines).toEqual([])
    expect(body.scope).toBeNull()
    // The live-brand read is a grouped read too: it drops the brand chips, not the dropdown.
    expect(body.brands).toEqual([])
    expect(brandFindMany).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('⛔ a SLOW aisle count holds the dropdown for the grace at most: the row is skipped this time and served from the memo next time', async () => {
    categories.mockImplementation(async () => CATS)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    groupBy.mockImplementation(async (a: any) => {
      if (a.by.length !== 2) return []
      await gate
      return [{ categoryId: 'c-home', subcategorySlug: 'sofa-seating', _count: { _all: 802 } }]
    })
    const t0 = Date.now()
    const first = await (await suggest('sofa')).json()
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(first.scope).toBeNull()
    expect(first.listings).toEqual([])
    release()
    await new Promise((r) => setTimeout(r, 0))
    const second = await (await suggest('sofa')).json()
    expect(second.scope?.count).toBe(802)
    // One grouped read for both requests: the late answer filled the memo.
    expect(groupBy.mock.calls.filter((c) => c[0].by.length === 2)).toHaveLength(1)
  })

  it('⛔ a SLOW live-brand read holds the dropdown for the grace at most: no chips this time, chips from the memo next time', async () => {
    categories.mockImplementation(async () => CATS)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    groupBy.mockImplementation(async (a: any) => {
      if (a.by[0] !== 'brandSlug') return []
      await gate
      return [{ brandSlug: 'samsung', _count: { _all: 50 } }]
    })
    brandFindMany.mockImplementation(async (a: any) => [{ slug: 'samsung', name: 'Samsung', normalized: 'samsung' }].filter((b) => a.where.slug.in.includes(b.slug)))
    const t0 = Date.now()
    const first = await (await suggest('sam')).json()
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(first.brands).toEqual([])
    release()
    await new Promise((r) => setTimeout(r, 0))
    const second = await (await suggest('sam')).json()
    expect(second.brands).toEqual([{ slug: 'samsung', name: 'Samsung' }])
    // One grouped read for both requests: the late answer filled the memo.
    expect(groupBy.mock.calls.filter((c) => c[0].by[0] === 'brandSlug')).toHaveLength(1)
  })

  it('a failed BRAND TABLE read drops the chips too, never the dropdown', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    categories.mockImplementation(async () => CATS)
    groupBy.mockImplementation(async (a: any) => (a.by[0] === 'brandSlug' ? [{ brandSlug: 'samsung', _count: { _all: 5 } }] : []))
    brandFindMany.mockImplementation(async () => { throw new Error('brand table down') })
    const res = await suggest('sam')
    expect(res.status).toBe(200)
    expect((await res.json()).brands).toEqual([])
    err.mockRestore()
  })

  /**
   * ⛔ THE AISLE COUNT IS BOUNDED ON THE DATABASE (review, 2026-09-29; suggest-entities.ts). It is a
   * grouped count over every match, and a broad prefix costs 0.4-3.4 s of server time for a row the
   * 150 ms grace then drops. A deadline on the await alone left that count running on a pooled
   * connection; these pin the three bounds.
   */
  const sofaGroups = async (a: any) => (a.by.length === 2 ? [{ categoryId: 'c-home', subcategorySlug: 'sofa-seating', _count: { _all: 802 } }] : [])
  const aisleCalls = () => groupBy.mock.calls.filter((c) => c[0].by.length === 2)
  const pgTimeout = () => Object.assign(new Error('Database error. Code: `57014`. Message: `canceling statement due to statement timeout`'), {
    code: 'P2039',
    meta: { modelName: 'Listing', driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode: '57014', kind: 'postgres' } } },
  })

  it('the count runs on its OWN bounded client (aisle-db.ts), never on the app\'s pool — and the line count stays on the app\'s', async () => {
    categories.mockImplementation(async () => CATS)
    groupBy.mockImplementation(sofaGroups)
    brandFindUnique.mockImplementation(async () => ({ name: 'Apple', status: 'active' }))
    expect((await (await suggest('sofa')).json()).scope?.count).toBe(802)
    expect(aisleGroupBy.mock.calls.map((c) => c[0].by)).toEqual([['categoryId', 'subcategorySlug']])
    expect(appGroupBy.mock.calls.filter((c) => c[0].by.length === 2)).toHaveLength(0)
    await suggest('iphone')
    expect(appGroupBy.mock.calls.filter((c) => c[0].by.length === 1).length).toBeGreaterThan(0)
    expect(aisleGroupBy.mock.calls.every((c) => c[0].by.length === 2)).toBe(true)
  })

  it('a count Postgres CANCELS for its budget is an answer — no row, and the same prefix is not counted again within the minute', async () => {
    categories.mockImplementation(async () => CATS)
    groupBy.mockImplementation(async (a: any) => { if (a.by.length === 2) throw pgTimeout(); return [] })
    const first = await suggest('can ho')
    expect(first.status).toBe(200)
    expect((await first.json()).scope).toBeNull()
    expect((await (await suggest('can ho')).json()).scope).toBeNull()
    expect(aisleCalls()).toHaveLength(1)
  })

  it('any OTHER failure is not memoized — the next request asks again', async () => {
    categories.mockImplementation(async () => CATS)
    groupBy.mockImplementation(async (a: any) => { if (a.by.length === 2) throw new Error('connection reset'); return [] })
    await suggest('sofa')
    await new Promise((r) => setTimeout(r, 0))
    await suggest('sofa')
    expect(aisleCalls()).toHaveLength(2)
  })

  it('at most SCOPE_MAX_IN_FLIGHT counts run at once; past that a keystroke gets no aisle row and starts no count', async () => {
    const { SCOPE_MAX_IN_FLIGHT } = await import('./suggest-entities')
    expect(SCOPE_MAX_IN_FLIGHT).toBe(2)
    categories.mockImplementation(async () => CATS)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    groupBy.mockImplementation(async (a: any) => {
      if (a.by.length !== 2) return []
      await gate
      return sofaGroups(a)
    })
    // Sequential, so the order is certain: each answers after the grace with its count still running.
    for (const q of ['sofa', 'laptop']) expect((await (await suggest(q)).json()).scope).toBeNull()
    expect(aisleCalls()).toHaveLength(2)
    expect((await (await suggest('fridge')).json()).scope).toBeNull()
    expect(aisleCalls()).toHaveLength(2) // no third count
    release()
    await new Promise((r) => setTimeout(r, 0))
    // The slots are free again, and the skipped prefix was not memoized as "no row".
    expect((await (await suggest('fridge')).json()).scope?.count).toBe(802)
    expect(aisleCalls()).toHaveLength(3)
  })

  it('every payload carries the two new keys, the short-query one included', async () => {
    expect(await (await suggest('i')).json()).toEqual({ q: 'i', listings: [], categories: [], brands: [], lines: [], scope: null })
  })
})
