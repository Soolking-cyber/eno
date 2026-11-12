import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sparse-search "More in" rail (UI climb 2026-11-09, hunt #9): which answers ask for it, which category it is, and
 * that its rows come through Trending's public base — the edition scope, verified + active, linked listings INCLUDED (owner,
 * 2026-11-09) — with the answer and the viewer's blocked shops out of the pool, at least three, in the picker's order,
 * card-shaped.
 */
const h = vi.hoisted(() => ({
  picked: [] as string[], pickedSub: [] as string[], pickArgs: [] as unknown[], calls: [] as unknown[][], found: [] as unknown[], findWhere: null as unknown,
  /** Every card load's where-clause, in order (the subcategory's and the aisle's both land here). */
  loads: [] as unknown[],
  /** The whole-aisle pick rejects; the subcategory pick rejects. */
  wholeRejects: false, subRejects: false,
  logged: [] as { op: string; message: string }[],
}))
vi.mock('@/lib/log', () => ({ logError: (e: Error, ctx: { op: string }) => { h.logged.push({ op: ctx.op, message: e.message }) } }))
vi.mock('@/lib/taxonomy', () => ({
  subcategoriesFor: (c: string) => (c === 'rentals'
    ? [{ slug: 'apartment-rental', name: 'Apartment', nameVi: 'Căn hộ' }, { slug: 'motorbike-rental', name: 'Motorbike', nameVi: 'Xe máy' }, { slug: 'rental-other', name: 'Other', nameVi: 'Khác' }]
    : c === 'electronics' ? [{ slug: 'phones', name: 'Phones', nameVi: 'Điện thoại' }] : []),
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => ({ scoped: w }) }))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: { card: true }, serializeListingCard: (r: object) => ({ ...r, serialized: true }) }))
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: vi.fn(async (a: { where: unknown }) => { h.findWhere = a.where; h.loads.push(a.where); return h.found }) } } }))
vi.mock('./trending-rail', () => ({
  TRENDING_ORDER: ['trending-order'],
  // A subcategory-narrowed pick answers from `pickedSub`, a category pick from `picked`; every call is recorded.
  pickRailIds: vi.fn(async (...a: unknown[]) => {
    h.calls.push(a)
    h.pickArgs = h.calls[0]
    const narrowed = JSON.stringify(a[0]).includes('subcategorySlug')
    if (!narrowed && h.wholeRejects) throw new Error('pool exhausted')
    if (narrowed && h.subRejects) throw new Error('statement timeout')
    return narrowed ? h.pickedSub : h.picked
  }),
}))

import { relatedCategorySlug, relatedRail, relatedSubcategorySlug, wantsRelatedRail, withinDeadline, RELATED_DEADLINE_MS, RELATED_MAX_TOTAL, WIDEN_TO_CATEGORY } from './related-rail'

const row = (id: string, slug = 'electronics', name = 'Electronics', nameVi = 'Điện tử', subcategorySlug: string | null = 'phones') =>
  ({ id, category: { slug, name, nameVi }, subcategorySlug })
const rental = (id: string, sub: string) => row(id, 'rentals', 'Rentals', 'Cho thuê', sub)

beforeEach(() => { h.picked = []; h.pickedSub = []; h.pickArgs = []; h.calls = []; h.found = []; h.findWhere = null; h.loads = []; h.wholeRejects = false; h.subRejects = false; h.logged = [] })

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
    // Electronics widens (WIDEN_TO_CATEGORY) only when Phones cannot answer; here it can, so ONE read.
    expect(h.calls).toHaveLength(1)
    const [scoped, order, opts] = h.calls.find((c) => JSON.stringify(c[0]).includes('subcategorySlug')) as [unknown, unknown, { pool: number; take: number; excludeIds: string[] }]
    // The blocked shops are their OWN AND element beside the scoped where, never a key inside it.
    const base = { AND: [{ scoped: { verified: true, status: 'active', category: { slug: 'electronics' } } }, { sellerId: { notIn: ['s9'] } }] }
    expect(scoped).toEqual({ AND: [base, { subcategorySlug: 'phones' }] })
    expect(order).toEqual(['trending-order'])
    expect(opts.excludeIds).toEqual(['a1', 'a2'])
    expect(opts).toMatchObject({ pool: 48, take: 12 })
    // The card load re-applies the public scope (verified, active, edition) beside the picked ids — a row unpublished
    // between the pick and the load stays out. Asserted on EVERY load, the subcategory's and the aisle's.
    expect(h.loads).toContainEqual({ AND: [scoped, { id: { in: ['r2', 'r1', 'r3'] } }] })
    for (const w of h.loads) expect(JSON.stringify(w)).toContain('"verified":true')
    expect(rail?.listings.map((l) => l.id)).toEqual(['r2', 'r1', 'r3'])
    expect(rail).toMatchObject({ slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', subcategory: 'phones', subName: 'Phones', subNameVi: 'Điện thoại' })
    expect(rail?.listings.every((l) => (l as unknown as { serialized: boolean }).serialized)).toBe(true)
  })
  it('no blocked shops: no seller clause', async () => {
    h.pickedSub = ['r1', 'r2', 'r3']
    h.found = [row('r1'), row('r2'), row('r3')]
    await relatedRail({ rows: [row('a1')], category: 'electronics', hiddenSellerIds: [] })
    expect(h.calls.map((c) => c[0])).toContainEqual({ AND: [{ scoped: { verified: true, status: 'active', category: { slug: 'electronics' } } }, { subcategorySlug: 'phones' }] })
  })
  it('linked listings are NOT filtered out (owner 2026-11-09): no affiliateUrl clause in the pick or the load', async () => {
    h.pickedSub = ['r1', 'r2', 'r3']
    h.found = [row('r1'), row('r2'), row('r3')]
    await relatedRail({ rows: [row('a1')], category: 'electronics', hiddenSellerIds: ['s9'] })
    expect(JSON.stringify(h.calls)).not.toContain('affiliateUrl')
    expect(JSON.stringify(h.findWhere)).not.toContain('affiliateUrl')
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
    expect(await relatedRail({ rows: [rental('a1', null as unknown as string)], category: null, hiddenSellerIds: [] })).toBeNull()
    expect(h.calls).toEqual([])
  })

  describe('WIDEN_TO_CATEGORY — a thin goods subcategory gives way to its whole category (2026-11-12)', () => {
    const base = { scoped: { verified: true, status: 'active', category: { slug: 'electronics' } } }
    it('is an explicit allow-list, Electronics only, never a mixed aisle', () => {
      expect([...WIDEN_TO_CATEGORY]).toEqual(['electronics'])
      for (const mixed of ['rentals', 'services', 'jobs', 'community-events', 'tickets-travel', 'food-drink']) expect(WIDEN_TO_CATEGORY.has(mixed)).toBe(false)
    })
    it('"iphone": 2 in Phones, 3+ in Electronics → "More in Electronics", no subcategory named, the picker\'s order kept', async () => {
      h.pickedSub = ['p1', 'p2']
      h.picked = ['e3', 'e1', 'e2']
      h.found = [row('e1'), row('e2'), row('e3')]
      const rail = await relatedRail({ rows: [row('a1'), row('a2')], category: null, hiddenSellerIds: [] })
      expect(rail).toMatchObject({ slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử', subcategory: null, subName: null, subNameVi: null })
      expect(rail?.listings.map((l) => l.id)).toEqual(['e3', 'e1', 'e2'])
      // The category read is the whole aisle — the same public base, no subcategory clause — with the answer left out.
      const whole = h.calls.find((c) => !JSON.stringify(c[0]).includes('subcategorySlug'))!
      expect(whole[0]).toEqual(base)
      expect((whole[2] as { excludeIds: string[] }).excludeIds).toEqual(['a1', 'a2'])
    })
    it('a missing or "-other" subcategory widens too (Electronics only)', async () => {
      h.picked = ['e1', 'e2', 'e3']
      h.found = [row('e1'), row('e2'), row('e3')]
      expect(await relatedRail({ rows: [row('a1', 'electronics', 'Electronics', 'Điện tử', null)], category: null, hiddenSellerIds: [] })).toMatchObject({ subcategory: null })
      expect(await relatedRail({ rows: [row('a1', 'electronics', 'Electronics', 'Điện tử', 'electronics-other')], category: null, hiddenSellerIds: [] })).toMatchObject({ subcategory: null })
    })
    it('⛔ never past a subcategory the reader ASKED for: thin → null, and no category read at all', async () => {
      h.pickedSub = ['p1', 'p2']
      h.picked = ['e1', 'e2', 'e3']
      h.found = [row('e1'), row('e2'), row('e3')]
      expect(await relatedRail({ rows: [row('a1')], category: 'electronics', subcategory: 'phones', hiddenSellerIds: [] })).toBeNull()
      expect(h.calls).toHaveLength(1)
      expect(JSON.stringify(h.calls[0][0])).toContain('"subcategorySlug":"phones"')
    })
    it('the whole category under the floor too → null, Trending stays', async () => {
      h.pickedSub = ['p1']
      h.picked = ['e1', 'e2']
      expect(await relatedRail({ rows: [row('a1')], category: null, hiddenSellerIds: [] })).toBeNull()
    })
    it('⛔ the aisle is read ONLY when the subcategory cannot answer: Phones with enough → one read, no aisle read at all', async () => {
      h.wholeRejects = true // would fail the answer if it were read
      h.pickedSub = ['p1', 'p2', 'p3']
      h.found = [row('p1'), row('p2'), row('p3')]
      expect(await relatedRail({ rows: [row('a1')], category: null, hiddenSellerIds: [] })).toMatchObject({ subcategory: 'phones' })
      expect(h.calls).toHaveLength(1)
      expect(JSON.stringify(h.calls[0][0])).toContain('"subcategorySlug":"phones"')
    })
    it('a thin subcategory, then the aisle — in that order', async () => {
      h.pickedSub = ['p1']
      h.picked = ['e1', 'e2', 'e3']
      h.found = [row('e1'), row('e2'), row('e3')]
      await relatedRail({ rows: [row('a1')], category: null, hiddenSellerIds: [] })
      expect(h.calls.map((c) => JSON.stringify(c[0]).includes('subcategorySlug'))).toEqual([true, false])
    })
    it('a failed subcategory read in a widening aisle is LOGGED, then falls back to the aisle; in a mixed aisle it fails as before', async () => {
      h.subRejects = true
      h.picked = ['e1', 'e2', 'e3']
      h.found = [row('e1'), row('e2'), row('e3')]
      expect(await relatedRail({ rows: [row('a1')], category: null, hiddenSellerIds: [] })).toMatchObject({ subcategory: null })
      expect(h.logged).toEqual([{ op: 'feed.related-rail.subcategory', message: 'statement timeout' }])
      await expect(relatedRail({ rows: [rental('a1', 'motorbike-rental')], category: null, hiddenSellerIds: [] })).rejects.toThrow('statement timeout')
    })
    it('the aisle\'s card load re-applies the public scope too', async () => {
      h.pickedSub = ['p1']
      h.picked = ['e1', 'e2', 'e3']
      h.found = [row('e1'), row('e2'), row('e3')]
      await relatedRail({ rows: [row('a1')], category: null, hiddenSellerIds: [] })
      expect(h.loads).toContainEqual({ AND: [base, { id: { in: ['e1', 'e2', 'e3'] } }] })
    })
    it('a mixed aisle never widens: thin Motorbike stays null with ONE read', async () => {
      h.pickedSub = ['m1', 'm2']
      h.picked = ['x1', 'x2', 'x3']
      expect(await relatedRail({ rows: [rental('a1', 'motorbike-rental')], category: null, hiddenSellerIds: [] })).toBeNull()
      expect(h.calls).toHaveLength(1)
    })
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
