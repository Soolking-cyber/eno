import { describe, expect, it } from 'vitest'
import {
  BRAND_RECOUNT_READ_SQL, BRAND_RECOUNT_ROLLBACK_SQL, BRAND_RECOUNT_SQL, LIVE_BRAND_COUNTS_SQL, brandColumns, brandCountChanges, laterRecountJournals, splitRecountRead,
  parseBrandRecountJournal, summarizeBrandChanges,
} from './brand-recount'

describe('brandCountChanges', () => {
  const brands = [
    { slug: 'apple', listingCount: 2312 },
    { slug: 'tiki-only', listingCount: 40 },
    { slug: 'honda', listingCount: 3 },
    { slug: 'fresh', listingCount: 0 },
  ]
  const live = [{ slug: 'apple', n: 1353 }, { slug: 'honda', n: 3 }, { slug: 'fresh', n: 2 }, { slug: 'no-brand-row', n: 9 }]

  it('lists only brands whose stored count is wrong; a brand with nothing live goes to 0', () => {
    const c = brandCountChanges(brands, live)
    expect(c).toEqual([
      { slug: 'apple', prior: 2312, next: 1353 },
      { slug: 'tiki-only', prior: 40, next: 0 },
      { slug: 'fresh', prior: 0, next: 2 },
    ])
    expect(summarizeBrandChanges(c)).toEqual({ brands: 3, toZero: 1, up: 1, down: 2, priorTotal: 2352, nextTotal: 1355 })
  })

  it('a live slug with no Brand row is not invented', () => {
    expect(brandCountChanges(brands, live).some((x) => x.slug === 'no-brand-row')).toBe(false)
  })
})

describe('the SQL', () => {
  it('counts what the admin merge counts: verified, active, by brandSlug', () => {
    expect(LIVE_BRAND_COUNTS_SQL).toContain('verified = true AND status = \'active\'')
    expect(LIVE_BRAND_COUNTS_SQL).toContain('"brandSlug"')
    // One statement, so the stored and the live count come from the same snapshot (commit-gate review).
    expect(BRAND_RECOUNT_READ_SQL).toContain(LIVE_BRAND_COUNTS_SQL)
    expect(BRAND_RECOUNT_READ_SQL).toContain('LEFT JOIN')
  })
  it('splitRecountRead: a brand with no live row is a stored count only (→ 0)', () => {
    const { brands, live } = splitRecountRead([{ slug: 'apple', listingCount: 9, live: 4 }, { slug: 'tiki-brand', listingCount: 3, live: 0 }])
    expect(brandCountChanges(brands, live)).toEqual([{ slug: 'apple', prior: 9, next: 4 }, { slug: 'tiki-brand', prior: 3, next: 0 }])
  })
  it('writes conditionally on the value it replaces, and rolls back conditionally on the value it wrote', () => {
    expect(BRAND_RECOUNT_SQL).toContain('b."listingCount" = j.prior')
    expect(BRAND_RECOUNT_SQL).toContain('SET "listingCount" = j.next')
    expect(BRAND_RECOUNT_ROLLBACK_SQL).toContain('b."listingCount" = j.next')
    expect(BRAND_RECOUNT_ROLLBACK_SQL).toContain('SET "listingCount" = j.prior')
    expect(brandColumns([{ slug: 'a', prior: 2, next: 1 }])).toEqual([['a'], [2], [1]])
  })
})

describe('parseBrandRecountJournal', () => {
  it('accepts its own journal and refuses anything else', () => {
    const ok = { kind: 'brand-recount', createdAt: '2026-10-03T05:00:00.000Z', rows: [{ slug: 'apple', prior: 2312, next: 1353 }] }
    expect(parseBrandRecountJournal(JSON.stringify(ok))).toEqual(ok)
    expect(() => parseBrandRecountJournal(JSON.stringify({ ...ok, kind: 'hide-ad-banned' }))).toThrow(/not a brand-recount/)
    expect(() => parseBrandRecountJournal(JSON.stringify({ ...ok, rows: [{ slug: 'x', prior: '1', next: 0 }] }))).toThrow(/bad journal row/)
  })
})

describe('laterRecountJournals — a rollback never undoes a later recount', () => {
  const j = (createdAt: string) => JSON.stringify({ kind: 'brand-recount', createdAt, rows: [] })
  it('names only later brand-recount journals, ignoring itself and other files', () => {
    const siblings = [
      { name: 'a.json', text: j('2026-10-03T10:00:00.000Z') },
      { name: 'b.json', text: j('2026-10-04T10:00:00.000Z') },
      { name: 'old.json', text: j('2026-10-01T10:00:00.000Z') },
      { name: 'hide.json', text: JSON.stringify({ kind: 'hide-ad-banned', createdAt: '2026-10-05T00:00:00.000Z', rows: [] }) },
      { name: 'junk.json', text: '{' },
    ]
    expect(laterRecountJournals({ name: 'a.json', createdAt: '2026-10-03T10:00:00.000Z' }, siblings)).toEqual(['b.json'])
    expect(laterRecountJournals({ name: 'b.json', createdAt: '2026-10-04T10:00:00.000Z' }, siblings)).toEqual([])
  })
})
