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

const { keywordRank, __resetKeywordRankCache } = await import('./keyword-rank')

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
