import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sparse-search "More in" rail (UI climb 2026-11-09, hunt #9): which answers ask for it, which category it is, and
 * that its rows come through Trending's public base — the edition scope, verified + active, only listings dealt on eno —
 * with the answer and the viewer's blocked shops out of the pool, at least three, in the picker's order, card-shaped.
 */
const h = vi.hoisted(() => ({
  picked: [] as string[], pickedSub: [] as string[], pickArgs: [] as unknown[], calls: [] as unknown[][], found: [] as unknown[], findWhere: null as unknown,
}))
vi.mock('@/lib/taxonomy', () => ({
  subcategoriesFor: (c: string) => (c === 'rentals'
    ? [{ slug: 'apartment-rental', name: 'Apartment', nameVi: 'Căn hộ' }, { slug: 'motorbike-rental', name: 'Motorbike', nameVi: 'Xe máy' }, { slug: 'rental-other', name: 'Other', nameVi: 'Khác' }]
    : c === 'electronics' ? [{ slug: 'phones', name: 'Phones', nameVi: 'Điện thoại' }] : []),
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => ({ scoped: w }) }))
vi.mock('@/lib/in-app-listing', () => ({ inAppOnly: (w: object) => ({ inApp: w }) }))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: { card: true }, serializeListingCard: (r: object) => ({ ...r, serialized: true }) }))
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: vi.fn(async (a: { where: unknown }) => { h.findWhere = a.where; return h.found }) } } }))
vi.mock('./trending-rail', () => ({
  TRENDING_ORDER: ['trending-order'],
  // A subcategory-narrowed pick answers from `pickedSub`, a category pick from `picked`; every call is recorded.
  pickRailIds: vi.fn(async (...a: unknown[]) => {
    h.calls.push(a)
    h.pickArgs = h.calls[0]
    return JSON.stringify(a[0]).includes('subcategorySlug') ? h.pickedSub : h.picked
  }),
}))

import { relatedCategorySlug, relatedRail, relatedSubcategorySlug, wantsRelatedRail, withinDeadline, RELATED_DEADLINE_MS, RELATED_MAX_TOTAL } from './related-rail'

const row = (id: string, slug = 'electronics', name = 'Electronics', nameVi = 'Điện tử', subcategorySlug: string | null = 'phones') =>
  ({ id, category: { slug, name, nameVi }, subcategorySlug })
const rental = (id: string, sub: string) => row(id, 'rentals', 'Rentals', 'Cho thuê', sub)

beforeEach(() => { h.picked = []; h.pickedSub = []; h.pickArgs = []; h.calls = []; h.found = []; h.findWhere = null })

describe('wantsRelatedRail', () => {
  it('words, page 1, 1-7 found — the explorer\'s recovery window', () => {
    expect(RELATED_MAX_TOTAL).toBe(7)
    expect(wantsRelatedRail({ offset: 0, q: 'iphone', total: 1 })).toBe(true)
    expect(wantsRelatedRail({ offset: 0, q: 'iphone', total: 7 })).toBe(true)
  })
  it.each([
    [{ offset: 0, q: 'iphone', total: 0 }], [{ offset: 0, q: 'iphone', total: 8 }], [{ offset: 24, q: 'iphone', total: 3 }],
    [{ offset: 0, q: '', total: 3 }], [{ offset: 0, q: '   ', total: 3 }], [{ offset: 0, q: undefined, total: 3 }],
  ])('not for %o', (a) => { expect(wantsRelatedRail(a)).toBe(false) })
})

describe('relatedCategorySlug', () => {
  it('the category asked for wins', () => { expect(relatedCategorySlug([row('a', 'vehicles')], 'electronics')).toBe('electronics') })
  it('else the one most rows are in', () => {
    expect(relatedCategorySlug([row('a', 'vehicles'), row('b', 'electronics'), row('c', 'electronics')], null)).toBe('electronics')
    expect(relatedCategorySlug([row('a', 'vehicles'), row('b', 'electronics')], 'all')).toBe('vehicles') // a tie: the first, best-ranked row
    // A tie reached late is still the first SEEN, not the first to reach the top count (commit review).
    expect(relatedCategorySlug([row('a', 'vehicles'), row('b', 'electronics'), row('c', 'electronics'), row('d', 'vehicles')], null)).toBe('vehicles')
  })
  it('⛔ never teachers, asked for or inferred', () => {
    expect(relatedCategorySlug([row('a')], 'teachers')).toBeNull()
    expect(relatedCategorySlug([row('a', 'teachers'), row('b', 'teachers'), row('c', 'jobs')], null)).toBeNull()
  })
  it('rows without a category and no ask: none', () => { expect(relatedCategorySlug([{ category: null }], undefined)).toBeNull() })
})

describe('relatedSubcategorySlug', () => {
  it('the one asked for wins', () => { expect(relatedSubcategorySlug([rental('a', 'apartment-rental')], 'rentals', 'motorbike-rental')).toBe('motorbike-rental') })
  it('else the one most of the answer\'s rows IN THIS CATEGORY share; rows of other categories do not vote', () => {
    expect(relatedSubcategorySlug([rental('a', 'motorbike-rental'), rental('b', 'apartment-rental'), rental('c', 'apartment-rental')], 'rentals', null)).toBe('apartment-rental')
    expect(relatedSubcategorySlug([row('a', 'vehicles', 'V', 'V', 'cars'), row('b', 'vehicles', 'V', 'V', 'cars'), rental('c', 'room-rental')], 'rentals', null)).toBe('room-rental')
  })
  it('a late tie is the first seen', () => {
    expect(relatedSubcategorySlug([rental('a', 'room-rental'), rental('b', 'apartment-rental'), rental('c', 'apartment-rental'), rental('d', 'room-rental')], 'rentals', null)).toBe('room-rental')
  })
  it('no subcategory on any row: none', () => { expect(relatedSubcategorySlug([row('a', 'electronics', 'Electronics', 'Điện tử', null)], 'electronics', undefined)).toBeNull() })
})

describe('relatedRail', () => {
  it('Trending\'s public base for the answer\'s subcategory, the answer and the blocked shops out of the pool, cards in the picker\'s order', async () => {
    h.pickedSub = ['r2', 'r1', 'r3']
    h.found = [row('r1'), row('r3'), row('r2')]
    const rail = await relatedRail({ rows: [row('a1'), row('a2')], category: null, hiddenSellerIds: ['s9'] })
    expect(h.calls).toHaveLength(1)
    const [scoped, order, opts] = h.calls[0] as [unknown, unknown, { pool: number; take: number; excludeIds: string[] }]
    // The blocked shops are their OWN AND element beside the scoped where, never a key inside it.
    const base = { inApp: { AND: [{ scoped: { verified: true, status: 'active', category: { slug: 'electronics' } } }, { sellerId: { notIn: ['s9'] } }] } }
    expect(scoped).toEqual({ AND: [base, { subcategorySlug: 'phones' }] })
    expect(order).toEqual(['trending-order'])
    expect(opts.excludeIds).toEqual(['a1', 'a2'])
    expect(opts).toMatchObject({ pool: 48, take: 12 })
    expect(h.findWhere).toEqual({ AND: [scoped, { id: { in: ['r2', 'r1', 'r3'] } }] })
    expect(rail?.listings.map((l) => l.id)).toEqual(['r2', 'r1', 'r3'])
    expect(rail).toMatchObject({ slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', subcategory: 'phones', subName: 'Phones', subNameVi: 'Điện thoại' })
    expect(rail?.listings.every((l) => (l as unknown as { serialized: boolean }).serialized)).toBe(true)
  })
  it('no blocked shops: no seller clause', async () => {
    h.pickedSub = ['r1', 'r2', 'r3']
    h.found = [row('r1'), row('r2'), row('r3')]
    await relatedRail({ rows: [row('a1')], category: 'electronics', hiddenSellerIds: [] })
    expect(h.calls[0][0]).toEqual({ AND: [{ inApp: { scoped: { verified: true, status: 'active', category: { slug: 'electronics' } } } }, { subcategorySlug: 'phones' }] })
  })
  it('"vespa" found a motorbike rental: more motorbike rentals, named by the taxonomy, not apartments', async () => {
    h.pickedSub = ['m1', 'm2', 'm3']
    h.found = [rental('m1', 'motorbike-rental'), rental('m2', 'motorbike-rental'), rental('m3', 'motorbike-rental')]
    const rail = await relatedRail({ rows: [rental('a1', 'motorbike-rental')], category: null, hiddenSellerIds: [] })
    expect(JSON.stringify(h.calls[0][0])).toContain('"subcategorySlug":"motorbike-rental"')
    expect(rail).toMatchObject({ slug: 'rentals', name: 'Rentals', subcategory: 'motorbike-rental', subName: 'Motorbike', subNameVi: 'Xe máy' })
  })
  it('the subcategory asked for wins over the answer\'s own', async () => {
    h.pickedSub = ['m1', 'm2', 'm3']
    h.found = [rental('m1', 'apartment-rental'), rental('m2', 'apartment-rental'), rental('m3', 'apartment-rental')]
    await relatedRail({ rows: [rental('a1', 'motorbike-rental')], category: 'rentals', subcategory: 'apartment-rental', hiddenSellerIds: [] })
    expect(JSON.stringify(h.calls[0][0])).toContain('"subcategorySlug":"apartment-rental"')
  })
  it('⛔ never the whole category: too few in the subcategory, a "-other" catch-all, an unknown or missing subcategory — null, Trending stays', async () => {
    h.pickedSub = ['m1', 'm2']
    expect(await relatedRail({ rows: [rental('a1', 'motorbike-rental')], category: null, hiddenSellerIds: [] })).toBeNull()
    h.pickedSub = ['m1', 'm2', 'm3']
    h.found = [rental('m1', 'motorbike-rental'), rental('m2', 'motorbike-rental')]
    expect(await relatedRail({ rows: [rental('a1', 'motorbike-rental')], category: null, hiddenSellerIds: [] })).toBeNull() // picked 3, 2 still there
    h.calls = []
    expect(await relatedRail({ rows: [rental('a1', 'rental-other')], category: null, hiddenSellerIds: [] })).toBeNull()
    expect(await relatedRail({ rows: [rental('a1', 'legacy-sub')], category: null, hiddenSellerIds: [] })).toBeNull()
    expect(await relatedRail({ rows: [row('a1', 'electronics', 'Electronics', 'Điện tử', null)], category: null, hiddenSellerIds: [] })).toBeNull()
    expect(h.calls).toEqual([])
  })
  it('teachers: null without a query', async () => {
    expect(await relatedRail({ rows: [row('a1', 'teachers')], category: null, hiddenSellerIds: [] })).toBeNull()
    expect(h.calls).toEqual([])
  })
})

describe('withinDeadline — the rail never costs the answer more than RELATED_DEADLINE_MS', () => {
  it('the value when it comes first, the fallback when the clock does; a rejection passes through', async () => {
    vi.useFakeTimers()
    try {
      expect(RELATED_DEADLINE_MS).toBe(300)
      await expect(withinDeadline(Promise.resolve('rail'), 300, null)).resolves.toBe('rail')
      const slow = withinDeadline(new Promise<string>(() => {}), 300, null)
      await vi.advanceTimersByTimeAsync(300)
      await expect(slow).resolves.toBeNull()
      await expect(withinDeadline(Promise.reject(new Error('x')), 300, null)).rejects.toThrow('x')
    } finally {
      vi.useRealTimers()
    }
  })
})
