import { describe, expect, it, vi } from 'vitest'

/**
 * field-03 (UX program 2): condition words typed into the search box leave the text — and, since the
 * commit gate (2026-10-04), FILTER NOTHING: the post wizard labels the stored value 'new' "Mới / Như mới"
 * (new / like new), so members' like-new second-hand items are condition='new', and a "not new" filter
 * dropped exactly those. "second hand furniture" searches "furniture"; "second hand" alone is the goods
 * browse (items for sale); "nhà củ chi" (Củ Chi, an HCMC district) is untouched.
 */

vi.mock('@/lib/db', () => ({
  db: {
    listing: { groupBy: vi.fn(async () => []), findFirst: vi.fn(async () => ({ id: 'x' })) },
    category: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: any) => w,
  marketplaceListingScope: async () => ({}),
  teacherExclusion: async () => null,
}))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: any) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: any) => l }))

import { buildFeedFilters } from './feed-query'
import { conditionWhere } from '@/lib/listing-condition'

const build = (qs: string) => buildFeedFilters(new URLSearchParams(qs))
const has = (andFilters: unknown[], clause: unknown) => andFilters.some((f) => JSON.stringify(f) === JSON.stringify(clause))
/** Any clause that reads the condition column — there must be none unless the reader picked one. */
const readsCondition = (andFilters: unknown[]) => andFilters.some((f) => JSON.stringify(f).includes('"condition"'))
const SALE = { listingType: 'sell' }

describe('buildFeedFilters — condition words in q', () => {
  it('"second hand furniture" is exactly a "furniture" search: same text, no condition filter, no scope', async () => {
    const a = await build('q=second hand furniture')
    const b = await build('q=furniture')
    expect(a.q).toBe('furniture')
    expect(a.pgTextFilter).toEqual(b.pgTextFilter)
    expect(a.andFilters).toEqual(b.andFilters)
    expect(readsCondition(a.andFilters)).toBe(false)
    expect(a.saleScopeFromWords).toBe(false)
  })

  it('"iphone 13 pro max cũ" keeps every other word and filters no condition — a like-new phone stays', async () => {
    const f = await build(`q=${encodeURIComponent('iphone 13 pro max cũ')}`)
    expect(f.q).toBe('iphone 13 pro max')
    expect(readsCondition(f.andFilters)).toBe(false)
    expect(has(f.andFilters, SALE)).toBe(false)
  })

  it('"second hand" / "đồ cũ" alone is the goods browse: no text, items for sale, no condition filter', async () => {
    for (const q of ['second hand', 'đồ cũ', 'used']) {
      const f = await build(`q=${encodeURIComponent(q)}`)
      expect(f.q).toBeUndefined()
      expect(f.pgTextFilter).toBeNull()
      expect(has(f.andFilters, SALE)).toBe(true)
      expect(readsCondition(f.andFilters)).toBe(false)
      expect(f.saleScopeFromWords).toBe(true)
    }
  })

  it('"đồ cũ quận 7": the district scope plus the goods browse', async () => {
    const f = await build(`q=${encodeURIComponent('đồ cũ quận 7')}`)
    expect(f.inferredDistrict).toBe('d7')
    expect(f.q).toBeUndefined()
    expect(has(f.andFilters, SALE)).toBe(true)
  })

  it('"nhà củ chi" stays a Củ Chi search — the district reader takes it, never the condition split', async () => {
    const f = await build(`q=${encodeURIComponent('nhà củ chi')}`)
    expect(f.inferredDistrict).toBeTruthy()
    expect(f.q).toBe('nhà')
    expect(has(f.andFilters, SALE)).toBe(false)
    expect(f.saleScopeFromWords).toBe(false)
  })

  it.each(['củ đậu', 'iphone 13 cu'])('"%s" keeps its words: only the accented "cũ" is a condition word', async (q) => {
    const f = await build(`q=${encodeURIComponent(q)}`)
    expect(f.q).toBe(q)
    expect(f.saleScopeFromWords).toBe(false)
  })

  it('an explicit ?condition= applies as usual — beside the words, and beside the goods browse', async () => {
    const f = await build(`condition=new&q=${encodeURIComponent('iphone cũ')}`)
    expect(f.q).toBe('iphone')
    expect(has(f.andFilters, conditionWhere('new'))).toBe(true)
    const g = await build(`condition=used&q=${encodeURIComponent('đồ cũ')}`)
    expect(has(g.andFilters, conditionWhere('used'))).toBe(true)
    expect(has(g.andFilters, SALE)).toBe(true)
  })

  it('an explicit ?type= replaces the words\' sale scope (and nothing is flagged for the facet bases)', async () => {
    const f = await build(`type=rent&q=${encodeURIComponent('đồ cũ')}`)
    expect(has(f.andFilters, { listingType: 'rent' })).toBe(true)
    expect(has(f.andFilters, SALE)).toBe(false)
    expect(f.saleScopeFromWords).toBe(false)
    // `type=all` is the explorer's "no type": the words' scope applies.
    expect((await build(`type=all&q=${encodeURIComponent('đồ cũ')}`)).saleScopeFromWords).toBe(true)
  })

  it('a query without condition words is untouched', async () => {
    const f = await build('q=furniture')
    expect(f.saleScopeFromWords).toBe(false)
    expect(has(f.andFilters, SALE)).toBe(false)
  })
})
