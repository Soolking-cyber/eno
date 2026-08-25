import { describe, expect, it } from 'vitest'
import { diffPrices, feedPrice, merchantNameFor, repairAffLink, type ExistingListing } from './affiliate-price-refresh'

const feed = (rows: [string, number, string | null][]) =>
  new Map(rows.map(([id, price, affiliateUrl]) => [id, { price, affiliateUrl }]))

describe('feedPrice', () => {
  it('prefers the discounted price when the discount flag is set', () => {
    expect(feedPrice({ price: 30_000_000, discount: 25_990_000, status_discount: 1 })).toBe(25_990_000)
  })
  it('ignores the discount when the flag is off', () => {
    expect(feedPrice({ price: 30_000_000, discount: 1, status_discount: 0 })).toBe(30_000_000)
  })
  // ⛔ A zero price renders as "Free / Miễn phí". Refusing it is the whole reason this is a
  // function and not an inline expression.
  it('refuses zero, negative and unparseable prices', () => {
    expect(feedPrice({ price: 0 })).toBeNull()
    expect(feedPrice({ price: -5 })).toBeNull()
    expect(feedPrice({ price: 'liên hệ' })).toBeNull()
    expect(feedPrice({})).toBeNull()
  })
})

describe('repairAffLink', () => {
  it('inserts the campaign id into the shape the feed hands out', () => {
    expect(repairAffLink('https://go.isclix.com/deep_link/123?url=x', '456'))
      .toBe('https://go.isclix.com/deep_link/123/456?url=x')
  })
  it('leaves an already well-formed link alone', () => {
    const ok = 'https://go.isclix.com/deep_link/123/456?url=x'
    expect(repairAffLink(ok, '999')).toBe(ok)
  })
  it('refuses a shape it does not recognise rather than shipping it', () => {
    expect(repairAffLink('https://example.com/whatever', '456')).toBeNull()
    expect(repairAffLink(undefined, '456')).toBeNull()
  })
})

describe('diffPrices', () => {
  const rows = (...l: ExistingListing[]) => l
  it('updates only what moved', () => {
    const r = diffPrices(
      rows({ id: 'a', externalId: 'SKU1', price: 100, affiliateUrl: 'L1' },
           { id: 'b', externalId: 'SKU2', price: 200, affiliateUrl: 'L2' }),
      feed([['SKU1', 150, 'L1'], ['SKU2', 200, 'L2']]),
    )
    expect(r.changes).toEqual([{ id: 'a', externalId: 'SKU1', from: 100, to: 150, affiliateUrl: null }])
    expect(r.unchanged).toBe(1)
  })
  it('carries a moved affiliate link even when the price held', () => {
    const r = diffPrices(rows({ id: 'a', externalId: 'SKU1', price: 100, affiliateUrl: 'OLD' }), feed([['SKU1', 100, 'NEW']]))
    expect(r.changes[0]).toMatchObject({ id: 'a', to: 100, affiliateUrl: 'NEW' })
  })
  // ⛔ The reason a listing absent from the feed is COUNTED and not hidden: one failed page of a
  // 49-page walk would otherwise read as thousands of delisted products.
  it('counts feed-absent listings without changing them', () => {
    const r = diffPrices(rows({ id: 'a', externalId: 'GONE', price: 100, affiliateUrl: 'L' }), feed([]))
    expect(r.changes).toEqual([])
    expect(r.missingFromFeed).toBe(1)
  })
  it('passes null for an unchanged link so the writer COALESCEs the existing one', () => {
    const r = diffPrices(rows({ id: 'a', externalId: 'SKU1', price: 100, affiliateUrl: 'L' }), feed([['SKU1', 120, 'L']]))
    expect(r.changes[0].affiliateUrl).toBeNull()
  })
})

describe('merchantNameFor', () => {
  it('maps the campaign to the storefront the importer created', () => {
    expect(merchantNameFor('cellphones_cps')).toBe('CellphoneS')
    expect(merchantNameFor('other_cps')).toBe('other_cps')
  })
})
