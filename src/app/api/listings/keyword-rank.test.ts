import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * keywordRank — the keyword path's relevance order (S-RANK, 2026-09-29). The db is an in-memory table
 * that honours the three shapes this module sends (`id in`, `id notIn`, and pool B's title clause),
 * so pagination is exercised end to end: ranked slice, then the tail, over five pages.
 */

type Row = {
  id: string; sellerId: string; title: string; titleVi: string | null; model: string | null; brandSlug: string | null
  subcategorySlug: string | null; sellerTrustScore: number; postedAt: Date; rankScore: number
  category: { slug: string; name: string; nameVi: string }
}
const CAT = { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }
const posted = new Date('2026-09-01T00:00:00Z')
// 20 WEAK rows (the word only in a description) rank HIGHER by rankScore than the 30 strong ones —
// exactly the production shape: without relevance, they led.
const weak: Row[] = Array.from({ length: 20 }, (_, i) => ({
  id: `w${String(i).padStart(2, '0')}`, sellerId: `ws${i}`, title: `Phone case ${i}`, titleVi: null, model: null, brandSlug: null,
  subcategorySlug: null, sellerTrustScore: 100, postedAt: posted, rankScore: 0.9 - i / 1000, category: CAT,
}))
const strong: Row[] = Array.from({ length: 30 }, (_, i) => ({
  id: `s${String(i).padStart(2, '0')}`, sellerId: `ss${i % 5}`, title: `iPhone ${10 + (i % 8)} 128GB`, titleVi: null, model: `iPhone ${10 + (i % 8)}`,
  brandSlug: 'apple', subcategorySlug: null, sellerTrustScore: 60 + i, postedAt: posted, rankScore: 0.5 - i / 1000, category: CAT,
}))
const TABLE = [...weak, ...strong]

/** Every `id: { in | notIn }` constraint anywhere in an AND tree. */
function idConstraints(w: any, acc: { in?: string[]; notIn: string[] } = { notIn: [] }) {
  if (!w || typeof w !== 'object') return acc
  if (w.id?.in) acc.in = w.id.in
  if (w.id?.notIn) acc.notIn.push(...w.id.notIn)
  for (const c of w.AND ?? []) idConstraints(c, acc)
  return acc
}
const byRank = (a: Row, b: Row) => b.rankScore - a.rankScore || (a.id < b.id ? 1 : -1)

const findMany = vi.fn(async (args: any) => {
  const ids = idConstraints(args.where)
  const titleHits = JSON.stringify(args.where).includes('"mode":"insensitive"')
  let rows = TABLE.filter((r) => (!ids.in || ids.in.includes(r.id)) && !ids.notIn.includes(r.id))
  if (titleHits) rows = rows.filter((r) => /iphone/i.test(r.title))
  rows = rows.sort(byRank).slice(args.skip ?? 0)
  return args.take != null ? rows.slice(0, args.take) : rows
})
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: (a: any) => findMany(a) } } }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))

const { keywordRank, relevanceOrder, __resetKeywordRankCache } = await import('./keyword-rank')
const { parseSearchQuery, scoreRow } = await import('@/lib/text-relevance')
const { searchScore } = await import('@/lib/ranking-formula')

const WHERE = { AND: [{ verified: true }, { status: 'active' }] }
const ORDER = [{ rankScore: 'desc' as const }, { id: 'desc' as const }]
const page = (offset: number, over: Partial<Parameters<typeof keywordRank>[0]> = {}) =>
  keywordRank({ q: 'iphone', looseMatch: false, featuredOnly: false, sort: 'newest', offset, limit: 12, where: WHERE, orderBy: ORDER, ...over })

beforeEach(() => {
  __resetKeywordRankCache()
  findMany.mockClear()
})

describe('keywordRank', () => {
  it('30 strong + 20 weak over 5 pages of 12: 50 distinct ids, every strong row first', async () => {
    const ids: string[] = []
    for (let off = 0; off < 60; off += 12) {
      const { keywordListings } = await page(off)
      ids.push(...keywordListings!.map((r) => r.id))
    }
    expect(ids).toHaveLength(50)
    expect(new Set(ids).size).toBe(50)
    expect(ids.slice(0, 30).every((id) => id.startsWith('s'))).toBe(true)
    // The weak rows follow in the feed's own order (rankScore).
    expect(ids.slice(30)).toEqual(weak.map((r) => r.id))
  })

  it('strong rows follow searchScore: more trust ranks higher at equal relevance', async () => {
    const { keywordListings } = await page(0)
    const trust = keywordListings!.map((r) => TABLE.find((t) => t.id === r.id)!.sellerTrustScore)
    expect(trust[0]).toBeGreaterThanOrEqual(trust[11])
  })

  it('ranks ONCE per query: later pages reuse the ranked set instead of re-reading the candidates', async () => {
    await page(0)
    const candidateReads = () => findMany.mock.calls.filter(([a]) => a.select?.sellerTrustScore).length
    expect(candidateReads()).toBe(2) // pool A + pool B
    await page(12)
    await page(24)
    expect(candidateReads()).toBe(2)
  })

  it('re-applies the query\'s WHERE to the ranked page, so a row hidden since ranking drops out', async () => {
    await page(0)
    const pageRead = findMany.mock.calls.map(([a]) => a).find((a) => idConstraints(a.where).in)!
    expect(JSON.stringify(pageRead.where)).toContain(JSON.stringify(WHERE))
  })

  it.each([
    ['an explicit sort', { sort: 'price-low' }],
    ['match=any', { looseMatch: true }],
    ['featured only', { featuredOnly: true }],
    ['no query', { q: undefined }],
    ['a query with no word to rank', { q: '7' }],
  ])('answers null — the feed as before — for %s', async (_label, over) => {
    expect((await page(0, over)).keywordListings).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('fails soft: a failed read answers null (the old order), never a 500', async () => {
    findMany.mockImplementationOnce(async () => { throw new Error('connection reset') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await page(0)).keywordListings).toBeNull()
    err.mockRestore()
  })
})

/**
 * ⛔ home-09 (UX program 2): the 'title' tier leads, inside it the owner's searchScore — so a trusted
 * seller's air conditioner (strong only through the aisle "tủ lạnh" names) can no longer open a fridge
 * search, and the tie-dealing (A6 × A2) never lifts an 'aside' row above a 'title' one.
 */
describe('relevanceOrder — title tier first', () => {
  const HOME = { slug: 'home-living', name: 'Home & Living', nameVi: 'Nhà cửa' }
  const r = (id: string, title: string, titleVi: string | null, trust: number, sellerId = id) => ({
    id, sellerId, title, titleVi, model: null as string | null, brandSlug: null, subcategorySlug: 'white-goods',
    sellerTrustScore: trust, postedAt: posted, rankScore: 0.5, category: HOME,
  })
  const aircons = [r('ac1', 'Daikin air conditioner 1HP', 'Máy lạnh Daikin', 100), r('ac2', 'Panasonic aircon 2HP', 'Máy lạnh Panasonic', 98)]
  const fridges = [r('f1', 'Toshiba refrigerator 180L', 'Tủ lạnh Toshiba', 20), r('f2', 'Sharp fridge 150L', 'Tủ lạnh Sharp', 15), r('f3', 'LG refrigerator', 'Tủ lạnh LG', 10)]
  const now = posted.getTime()

  it('the top 3 for "tủ lạnh" and "fridge" are refrigerators, the aircons follow', () => {
    for (const q of ['tủ lạnh', 'fridge']) {
      const { strong, titleCount } = relevanceOrder([...aircons, ...fridges], parseSearchQuery(q), now)
      expect(strong.slice(0, 3).map((x) => x.id).sort()).toEqual(['f1', 'f2', 'f3'])
      expect(strong.slice(3).map((x) => x.id).sort()).toEqual(['ac1', 'ac2'])
      expect(titleCount).toBe(3)
    }
  })

  it('a tie run never crosses the tier boundary', () => {
    // 3 'title' rows from ONE seller and 3 'aside' rows from three sellers, at the SAME searchScore
    // (the aside rows' higher trust makes up their lower relevance). As one run, the seller deal-out
    // would put an aside row second.
    const q = parseSearchQuery('fridge')
    const key = (row: ReturnType<typeof r>) => Math.round(searchScore({ relevance: scoreRow(row, q).relevance, sellerTrustScore: row.sellerTrustScore, postedAt: row.postedAt }, now) * 1000)
    // One product in three listings (same seller, same model): the deal-out alternates it with others.
    const title = ['t1', 't2', 't3'].map((id) => ({ ...r(id, 'Fridge Samsung RT20', null, 30, 'shop'), model: 'RT20' }))
    let trust = 30
    while (trust <= 100 && key(r('a', 'Freezer box', null, trust)) !== key(title[0])) trust += 0.01
    expect(trust).toBeLessThanOrEqual(100) // the fixture really ties across the tiers
    const aside = [r('a1', 'Freezer box', null, trust, 'x'), r('a2', 'Freezer chest', null, trust, 'y'), r('a3', 'Ice maker', null, trust, 'z')]
    const { strong } = relevanceOrder([...title, ...aside], q, now)
    expect(strong.slice(0, 3).map((x) => x.id).sort()).toEqual(['t1', 't2', 't3'])
  })
})

/**
 * Review, 2026-10-04: the row's own aisle NAME counts as naming the word (text-relevance.ts AISLE_NAMES).
 * Without it the tier put a title-matching accessory or rental above EVERY real item whose title does
 * not repeat the aisle's name — whatever the seller's trust. With it both are 'title', and the owner's
 * searchScore decides between them exactly as it did before the tiers.
 */
describe('relevanceOrder — an item filed in the aisle the word names shares the title tier', () => {
  const EL = { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }
  const VEH = { slug: 'vehicles', name: 'Vehicles', nameVi: 'Xe cộ' }
  const RENT = { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' }
  const mk = (id: string, title: string, subcategorySlug: string, category: typeof EL, trust: number) => ({
    id, sellerId: id, title, titleVi: null, model: null as string | null, brandSlug: null as string | null, subcategorySlug,
    sellerTrustScore: trust, postedAt: posted, rankScore: 0.5, category,
  })
  const now = posted.getTime()
  const order = (rows: ReturnType<typeof mk>[], q: string) => relevanceOrder(rows, parseSearchQuery(q), now)

  it('"điện thoại": a trusted seller\'s iPhone (filed in Phones) is no longer buried under a phone case', () => {
    const iphone = mk('iphone', 'iPhone 15 Pro Max 256GB', 'phones-tablets', EL, 120)
    const kase = mk('case', 'Ốp lưng điện thoại iPhone 15', 'phone-cases', EL, 50)
    for (const q of ['điện thoại', 'phone']) {
      const { strong, titleCount } = order([kase, iphone], q)
      expect(titleCount).toBe(2)
      expect(strong.map((r) => r.id)).toEqual(['iphone', 'case'])
    }
  })

  it('"laptop": a MacBook (filed in Laptops) beside the laptop stand, by searchScore', () => {
    const mac = mk('mac', 'MacBook Air M2 2022', 'laptops-pcs', EL, 120)
    const stand = mk('stand', 'Laptop stand aluminium', 'accessories', EL, 50)
    const { strong, titleCount } = order([stand, mac], 'laptop')
    expect(titleCount).toBe(2)
    expect(strong[0].id).toBe('mac')
  })

  it('"xe máy": the motorbike for sale shares the tier with the rental and the helmet', () => {
    const bike = mk('bike', 'Honda Vision 2022', 'motorbike', VEH, 120)
    const rent = mk('rent', 'Thuê xe máy Honda Vision', 'motorbike-rental', RENT, 60)
    const helmet = mk('helmet', 'Mũ bảo hiểm xe máy 3/4', 'parts-gear', VEH, 55)
    const { strong, titleCount } = order([rent, helmet, bike], 'xe máy')
    expect(titleCount).toBe(3)
    expect(strong[0].id).toBe('bike')
  })
})

describe('keywordRank — matchClass per row', () => {
  it("labels the ranked strong rows 'title' and the tail 'aside'", async () => {
    const res = await page(0, { limit: 50 })
    const rows = res.keywordListings!
    expect(rows.filter((x) => res.matchClassOf!(x.id) === 'title')).toHaveLength(30)
    expect(rows.slice(30).every((x) => res.matchClassOf!(x.id) === 'aside')).toBe(true)
  })
})
