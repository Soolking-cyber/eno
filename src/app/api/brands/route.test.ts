import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /api/brands — the brand rail's tiles and the post wizard's catalogue. ⛔ The rail on "All" used to read
 * the catalogue branch (stored `listingCount`, never lowered by a sale or a hide), so it could offer a
 * brand the feed beside it had nothing for. It now groups the live rows like every other category.
 */
const groupBy = vi.fn(async (_a: any): Promise<any[]> => [])
const brandFindMany = vi.fn(async (_a: any): Promise<any[]> => [])
vi.mock('@/lib/db', () => ({
  db: { listing: { groupBy: (a: any) => groupBy(a) }, brand: { findMany: (a: any) => brandFindMany(a) } },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: any) => ({ AND: [w, { sellerId: { notIn: ['desk'] } }] }) }))
vi.mock('@/lib/api/handler', () => ({
  route: (_opts: unknown, fn: (ctx: { req: Request }) => unknown) => (req: Request) => fn({ req }),
}))

const { GET } = await import('./route')
const get = async (qs: string) => (await (GET as unknown as (r: Request) => Promise<Response>)(new Request(`https://eno.vn/api/brands?${qs}`))).json()

// The brand table: two brands with live rows, one curated brand with nothing live.
const TABLE = [
  { slug: 'apple', name: 'Apple', iconSlug: 'apple', logoPath: null, listingCount: 120 },
  { slug: 'samsung', name: 'Samsung', iconSlug: 'samsung', logoPath: null, listingCount: 80 },
  { slug: 'casio', name: 'Casio', iconSlug: 'casio', logoPath: null, listingCount: 0 },
]

beforeEach(() => {
  groupBy.mockReset()
  brandFindMany.mockReset()
  groupBy.mockImplementation(async () => [
    { brandSlug: 'samsung', _count: { _all: 40 }, _sum: { views: 10, contactCount: 0 } },
    { brandSlug: 'apple', _count: { _all: 12 }, _sum: { views: 900, contactCount: 50 } },
  ])
  brandFindMany.mockImplementation(async (a: any) => (a.where.slug ? TABLE.filter((b) => a.where.slug.in.includes(b.slug)) : TABLE))
})

describe('category=all — the rail on "All"', () => {
  it('lists only brands with LIVE rows, most-listed first — never a curated brand with nothing live', async () => {
    const body = await get('category=all&subcategory=all&limit=40')
    expect(body.brands.map((b: any) => [b.slug, b.count])).toEqual([['samsung', 40], ['apple', 12]])
    // The live read: verified, active, branded, inside the edition scope — and NOT narrowed to a category.
    const where = groupBy.mock.calls[0][0].where
    expect(where.AND[0]).toEqual({ verified: true, status: 'active', brandSlug: { not: null } })
    expect(where.AND[1]).toEqual({ sellerId: { notIn: ['desk'] } })
    expect(brandFindMany.mock.calls[0][0].where).toEqual({ status: 'active', slug: { in: ['samsung', 'apple'] } })
  })

  it('a storefront\'s "All" rail is that shop\'s brands (the seller scope reaches the live read)', async () => {
    await get('category=all&subcategory=all&limit=40&seller=shop-1')
    expect(groupBy.mock.calls[0][0].where.AND[0]).toMatchObject({ sellerId: 'shop-1' })
  })

  it('nothing live → an empty rail, not the catalogue', async () => {
    groupBy.mockImplementation(async () => [])
    expect((await get('category=all&limit=40')).brands).toEqual([])
    expect(brandFindMany).not.toHaveBeenCalled()
  })
})

describe('a real category — unchanged', () => {
  it('narrows to the category and subcategory and ranks by demand', async () => {
    const body = await get('category=electronics&subcategory=phones-tablets&limit=40')
    expect(groupBy.mock.calls[0][0].where.AND[0]).toMatchObject({ category: { slug: 'electronics' }, subcategorySlug: 'phones-tablets' })
    expect(body.brands.map((b: any) => b.slug)).toEqual(['apple', 'samsung'])
  })
})

describe('no category — the post wizard\'s catalogue (exempt on purpose)', () => {
  it('offers every active brand, curated ones with nothing live included, ordered by the stored count', async () => {
    const body = await get('limit=120')
    expect(groupBy).not.toHaveBeenCalled()
    expect(brandFindMany.mock.calls[0][0]).toMatchObject({ where: { status: 'active' }, orderBy: [{ listingCount: 'desc' }, { name: 'asc' }] })
    expect(body.brands.map((b: any) => b.slug)).toContain('casio')
  })
})
