import { describe, expect, it } from 'vitest'
import { ENTITY_MIN, SCOPE_SHARE, brandWhere, isStatementTimeout, lineCandidates, lineKey, pickScope, rankBrands, type ScopeGroup } from './suggest-entities'

/**
 * The typeahead's entity rows (S-TYPEAHEAD, 2026-09-29) — the pure halves, no database. Every case
 * here is a query measured on production data the day the rows were built.
 */

describe('brands match at the START of the name', () => {
  it('"iph" no longer offers Qui Phúc, "ren" no longer Serenys: under five characters it is a prefix only', () => {
    expect(brandWhere('iph', []).OR).toEqual([{ normalized: { startsWith: 'iph' } }])
    expect(brandWhere('ren', []).OR).toEqual([{ normalized: { startsWith: 'ren' } }])
  })

  it('from five characters an infix is almost always the brand itself ("vuitton" → Louis Vuitton), so it is allowed back', () => {
    expect(brandWhere('vuitton', []).OR).toEqual([{ normalized: { startsWith: 'vuitton' } }, { normalized: { contains: 'vuitton' } }])
  })

  it('only brands with LIVE listings — the live set, never the stored `listingCount` (a sale never lowers it)', () => {
    const where = brandWhere('sam', ['samsung', 'samyang'])
    expect(where).toMatchObject({ status: 'active', slug: { in: ['samsung', 'samyang'] } })
    expect(where).not.toHaveProperty('listingCount')
    // Nothing live → nothing can match, rather than every brand.
    expect(brandWhere('sam', [])).toMatchObject({ slug: { in: [] } })
  })

  it('prefix hits lead, then the most LIVE listings; two shown', () => {
    const rows = [
      { slug: 'louis-vuitton', normalized: 'louisvuitton' },
      { slug: 'vuitton-vintage', normalized: 'vuittonvintage' },
      { slug: 'vuitton', normalized: 'vuitton' },
    ]
    const live = new Map([['louis-vuitton', 900], ['vuitton-vintage', 3], ['vuitton', 40]])
    expect(rankBrands(rows, 'vuitton', live).map((b) => b.normalized)).toEqual(['vuitton', 'vuittonvintage'])
    // The live count decides between two prefix hits, whatever the stored counter once said.
    const two = [{ slug: 'samyang', normalized: 'samyang' }, { slug: 'samsung', normalized: 'samsung' }]
    expect(rankBrands(two, 'sam', new Map([['samyang', 2], ['samsung', 50]])).map((b) => b.slug)).toEqual(['samsung', 'samyang'])
  })
})

describe('product lines the query names', () => {
  const lines = (q: string) => lineCandidates(q).map((c) => `${c.brand}:${c.line}`)

  it('"iph" and "iphone" name the iPhone line — the whole line first, then the shortest completion', () => {
    expect(lines('iph')).toEqual(['apple:iPhone', 'apple:iPhone SE'])
    expect(lines('iPhone')).toEqual(['apple:iPhone', 'apple:iPhone SE'])
  })

  it('a query that continues a line names that line ("iphone 17" → iPhone)', () => {
    expect(lines('iphone 17')).toEqual(['apple:iPhone'])
  })

  it('"ipad" leads with iPad itself, then its shortest sub-lines; at most three are counted', () => {
    const got = lines('ipad')
    expect(got[0]).toBe('apple:iPad')
    expect(got).toHaveLength(3)
  })

  it('nothing under three characters — "ip" is every iPad and iPhone at once', () => {
    expect(lineCandidates('ip')).toEqual([])
  })

  it('⛔ a Vietnamese word is never read as a Latin line: "bàn" (a table) does not name Huawei "Band"', () => {
    expect(lines('bàn')).toEqual([])
    // …while the unaccented spelling still reaches it, because then it IS what was typed.
    expect(lines('band')).toContain('huawei:Band')
    expect(lineKey('  iPhone   17 ')).toBe('iphone 17')
  })
})

describe('the scoped row — the aisle most of the query lives in', () => {
  const cats = new Map([
    ['c-home', { slug: 'furniture-appliances', name: 'Home', nameVi: 'Nhà cửa' }],
    ['c-el', { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }],
    ['c-svc', { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }],
  ])
  const g = (categoryId: string, subcategorySlug: string | null, n: number): ScopeGroup => ({ categoryId, subcategorySlug, _count: { _all: n } })

  it('"sofa": Home › Sofa, with its count (91% of the matches)', () => {
    expect(pickScope([g('c-home', 'sofa-seating', 802), g('c-home', 'tables-desks', 46), g('c-el', null, 30)], cats)).toEqual({
      category: 'furniture-appliances', subcategory: 'sofa-seating',
      categoryName: 'Home', categoryNameVi: 'Nhà cửa', subName: 'Sofa', subNameVi: 'Sofa', count: 802,
    })
  })

  it(`⛔ "xe máy": the motorbikes carry no aisle, so a 3-row Kitchenware must not stand in for them (< ${SCOPE_SHARE * 100}% share)`, () => {
    expect(pickScope([g('c-home', 'kitchenware', 3), g('c-home', 'storage', 2), g('c-el', null, 73)], cats)).toBeNull()
  })

  it('"samsung": cases ahead of phones at 26% is a plurality, not a destination', () => {
    expect(pickScope([g('c-el', 'phone-cases', 436), g('c-el', 'phones-tablets', 313), g('c-el', null, 907)], cats)).toBeNull()
  })

  it(`fewer than ${ENTITY_MIN} rows is never a row, whatever the share`, () => {
    expect(pickScope([g('c-home', 'sofa-seating', 2)], cats)).toBeNull()
  })

  it('never the visa product slot, on either edition — the next aisle that qualifies is offered instead', () => {
    // 60 of 110 is the plurality AND past the share — and it is still not offered.
    const row = pickScope([g('c-svc', 'visa-legal', 60), g('c-svc', 'language-lessons', 50)], cats)
    expect(row?.subcategory).toBe('language-lessons')
    expect(pickScope([g('c-svc', 'visa-legal', 60)], cats)).toBeNull()
  })

  it('a slug the taxonomy no longer offers is skipped — it would land on a filter the explorer cannot show', () => {
    expect(pickScope([g('c-home', 'retired-aisle', 500)], cats)).toBeNull()
    expect(pickScope([g('c-unknown', 'sofa-seating', 500)], cats)).toBeNull()
  })
})

describe('a statement cancelled for its budget is told apart from a failure', () => {
  it('the shape Prisma 7 + PrismaPg throws for SQLSTATE 57014 (measured against the production database, 2026-09-29)', () => {
    const e = Object.assign(new Error('Invalid `prisma.listing.groupBy()` invocation: Database error. Code: `57014`. Message: `canceling statement due to statement timeout`'), {
      code: 'P2039',
      meta: { modelName: 'Listing', driverAdapterError: { name: 'DriverAdapterError', cause: { originalCode: '57014', kind: 'postgres', code: '57014' } } },
    })
    expect(isStatementTimeout(e)).toBe(true)
    // The cause alone, or the message alone, is enough — either survives a change in the other.
    expect(isStatementTimeout({ meta: { driverAdapterError: { cause: { originalCode: '57014' } } } })).toBe(true)
    expect(isStatementTimeout(new Error('Database error. Code: `57014`.'))).toBe(true)
  })

  it('anything else is a failure, not an answer', () => {
    expect(isStatementTimeout(new Error('connection reset'))).toBe(false)
    expect(isStatementTimeout({ meta: { driverAdapterError: { cause: { originalCode: '57P01' } } } })).toBe(false)
    expect(isStatementTimeout(null)).toBe(false)
    expect(isStatementTimeout(undefined)).toBe(false)
  })
})
