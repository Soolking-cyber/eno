import { describe, expect, it } from 'vitest'
import { isSeededFeed, parseFilterParams, readExplorerUrl } from './explorer-url'

/**
 * The explorer's one URL reader (E-BACK, 2026-09-29). `applyParams` sets exactly what this returns,
 * and a client-side mount seeds its initial state from it — so every axis `applyParams` used to read
 * inline is pinned here, with the rules it carried.
 */
describe('readExplorerUrl', () => {
  it('an empty URL is the undirected, seeded home', () => {
    const s = readExplorerUrl('')
    expect(s).toEqual({
      query: '', looseMatch: false, category: 'all', district: 'all', subcategory: 'all', brand: 'all',
      model: 'all', line: '', listingType: 'all', condition: 'all', goodPrice: false, sort: 'newest',
      priceRange: 'all', customFilters: {}, view: null, province: '', ward: '', directed: false,
    })
    expect(isSeededFeed(s)).toBe(true)
  })

  it('reads every axis applyParams sets, with or without the leading "?"', () => {
    const qs = 'q=iphone&match=any&category=electronics&subcategory=phones&brand=apple&model=iPhone+15&line=iPhone&type=sell&condition=used&deal=good&sort=price-low&priceMin=1000000&priceMax=9000000'
    for (const search of [qs, `?${qs}`]) {
      const s = readExplorerUrl(search)
      expect(s).toMatchObject({
        query: 'iphone', looseMatch: true, category: 'electronics', subcategory: 'phones', brand: 'apple',
        model: 'iPhone 15', line: 'iPhone', listingType: 'sell', condition: 'used', goodPrice: true,
        sort: 'price-low', priceRange: '1000000-9000000', directed: true,
      })
    }
  })

  it('keeps the allowlists: only deal=good, only the four non-default sorts, only real views', () => {
    const s = readExplorerUrl('deal=cheap&sort=random&view=table')
    expect(s.goodPrice).toBe(false)
    expect(s.sort).toBe('newest')
    expect(s.view).toBeNull()
    for (const sort of ['recent', 'price-low', 'price-high', 'popular'] as const) expect(readExplorerUrl(`sort=${sort}`).sort).toBe(sort)
    for (const view of ['compact', 'grid', 'map', 'video'] as const) expect(readExplorerUrl(`view=${view}`).view).toBe(view)
  })

  it('an open-ended price range keeps its empty side', () => {
    expect(readExplorerUrl('priceMin=500000').priceRange).toBe('500000-')
    expect(readExplorerUrl('priceMax=500000').priceRange).toBe('-500000')
  })

  it('an explicit district strips a district phrase from the words, as the server does', () => {
    const s = readExplorerUrl(`q=${encodeURIComponent('căn hộ quận 7')}&district=d7`)
    expect(s.district).toBe('d7')
    expect(s.query).toBe('căn hộ')
    // …and without one the words are left exactly as typed (the server reads the district itself).
    expect(readExplorerUrl(`q=${encodeURIComponent('căn hộ quận 7')}`).query).toBe('căn hộ quận 7')
  })

  it('migrates a moved subcategory before reading (hobbies-sports/books → books-stationery)', () => {
    const s = readExplorerUrl('category=hobbies-sports&subcategory=books&attr_bookLanguage=en')
    expect(s.category).toBe('books-stationery')
    expect(s.subcategory).toBe('all')
    expect(s.customFilters).toEqual({})
  })

  it('sort and match alone do not direct the feed — they reorder or loosen the same set', () => {
    expect(readExplorerUrl('sort=recent').directed).toBe(false)
    expect(readExplorerUrl('match=any').directed).toBe(false)
    // …but a non-default sort is not the seeded feed either (the seed is the default order).
    expect(isSeededFeed(readExplorerUrl('sort=recent'))).toBe(false)
  })

  it('a view directs the feed (the ?view= reader opens the results view) without leaving the seed', () => {
    const s = readExplorerUrl('view=map')
    expect(s.directed).toBe(true)
    expect(isSeededFeed(s)).toBe(true)
  })

  it('every filter axis both directs the feed and leaves the seed', () => {
    for (const qs of ['q=honda', 'category=rentals', 'district=d1', 'category=electronics&subcategory=phones', 'brand=apple', 'model=iPhone+15', 'type=free', 'condition=new', 'deal=good', 'priceMin=1']) {
      const s = readExplorerUrl(qs)
      expect(s.directed, qs).toBe(true)
      expect(isSeededFeed(s), qs).toBe(false)
    }
  })

  it('the area travels as unit codes (NAV-2): a province or ward directs the feed and leaves the seed', () => {
    const s = readExplorerUrl('province=79&ward=26734')
    expect(s).toMatchObject({ province: '79', ward: '26734', directed: true })
    expect(isSeededFeed(s)).toBe(false)
    expect(readExplorerUrl('province=01')).toMatchObject({ province: '01', ward: '', directed: true })
  })

  it('a ward without its province, or a code that is not one, is no place at all', () => {
    expect(readExplorerUrl('ward=26734')).toMatchObject({ province: '', ward: '', directed: false })
    for (const qs of ['province=Ho+Chi+Minh', 'province=79%3Bx', 'province=', 'province=79&ward=abc']) {
      const s = readExplorerUrl(qs)
      expect(s.ward, qs).toBe('')
      if (qs !== 'province=79&ward=abc') expect(s.province, qs).toBe('')
    }
    expect(isSeededFeed(readExplorerUrl('ward=26734'))).toBe(true)
  })

  it('never reads a "near you" circle — the URL carries no coordinates (PDPL)', () => {
    const s = readExplorerUrl('lat=10.7&lng=106.7&radiusKm=5&near=10.7,106.7,5')
    expect(s.directed).toBe(false)
    expect(Object.keys(s)).not.toEqual(expect.arrayContaining(['near', 'lat', 'lng', 'radiusKm', 'nearby']))
  })

  it('whitespace-only words are no search at all', () => {
    const s = readExplorerUrl('q=%20%20')
    expect(s.directed).toBe(false)
    expect(isSeededFeed(s)).toBe(true)
  })
})

describe('parseFilterParams', () => {
  it('keys range facets back by facet key from their column', () => {
    expect(parseFilterParams(new URLSearchParams('range_year=2015-2020'), 'vehicles', 'all')).toEqual({ year: '2015-2020' })
  })

  it('keeps an attr_ chip only where this view offers the facet', () => {
    // bedrooms belongs to the apartment/house/room subcategories, not the bare rentals aisle.
    expect(parseFilterParams(new URLSearchParams('attr_bedrooms=2'), 'rentals', 'all')).toEqual({})
    expect(parseFilterParams(new URLSearchParams('attr_bedrooms=2'), 'rentals', 'apartment-rental')).toEqual({ bedrooms: '2' })
  })

  it('ignores a range column no facet of this view owns', () => {
    expect(parseFilterParams(new URLSearchParams('range_nope=1-2'), 'vehicles', 'all')).toEqual({})
  })
})
