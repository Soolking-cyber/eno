import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { brandSlug: string; categoryId: string; _count: { _all: number } }
const h = vi.hoisted(() => ({ withoutRent: [] as Row[], all: [] as Row[] }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: { groupBy: async ({ where }: { where: { listingType?: unknown } }) => (where.listingType ? h.withoutRent : h.all) },
    category: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, slug: `slug-${id}` })) },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: Record<string, unknown>) => w }))

const { brandHref, dominantCategories } = await import('./brand-category')

beforeEach(() => { h.withoutRent = []; h.all = [] })

/** Seobility 2026-11-23: a bare ?brand= link is rewritten by the explorer after load — a link to a redirect. */
describe('dominantCategories', () => {
  it('picks the category with the most live non-rental listings, else the most live listings; leaves a brand with none out', async () => {
    h.withoutRent = [
      { brandSlug: 'samsung', categoryId: 'el', _count: { _all: 40 } },
      { brandSlug: 'samsung', categoryId: 'fa', _count: { _all: 9 } },
    ]
    h.all = [
      ...h.withoutRent,
      { brandSlug: 'honda', categoryId: 'rent', _count: { _all: 3 } },
    ]
    const m = await dominantCategories(['samsung', 'honda', 'nobody'])
    expect(m.get('samsung')).toBe('slug-el')
    expect(m.get('honda')).toBe('slug-rent') // only rentals: the fallback, as dominantCategory
    expect(m.has('nobody')).toBe(false)
  })
  it('reads nothing for no brands', async () => {
    expect((await dominantCategories([])).size).toBe(0)
  })
})

describe('brandHref', () => {
  it('is the explorer\'s end URL when the category is known, else the bare brand', () => {
    expect(brandHref('samsung', 'electronics')).toBe('/?category=electronics&brand=samsung')
    expect(brandHref('h&m', null)).toBe('/?brand=h%26m')
  })
})
