import { describe, expect, it } from 'vitest'
import { decodeEntities, inputValue, isBotWall, offerFacts, productNodes, samePage, vndAmount } from './secondhand-page'

const ld = (node: unknown) => `<script type="application/ld+json">${JSON.stringify(node)}</script>`

describe('offerFacts — every offer is a variant', () => {
  it('one InStock offer → in, with its price', () => {
    expect(offerFacts({ offers: { availability: 'https://schema.org/InStock', price: '12000000' } })).toMatchObject({ availability: 'in', price: 12000000 })
  })
  it('⛔ one sold colour among several is a product still on sale — and its price is not the price on offer', () => {
    const f = offerFacts({ offers: [{ availability: 'https://schema.org/OutOfStock', price: 9000000 }, { availability: 'http://schema.org/InStock', price: 9500000 }] })
    expect(f).toMatchObject({ availability: 'in', price: 9500000 })
  })
  it('every offer out of stock (or discontinued) → out; PreOrder only → other; no offers → none', () => {
    expect(offerFacts({ offers: [{ availability: 'OutOfStock' }, { availability: 'Discontinued' }] }).availability).toBe('out')
    expect(offerFacts({ offers: { availability: 'https://schema.org/PreOrder' } }).availability).toBe('other')
    expect(offerFacts({}).availability).toBe('none')
  })
  it('reads priceSpecification and skips the struck-through ListPrice (Điện Máy Sài Gòn)', () => {
    expect(offerFacts({ offers: [{ availability: 'https://schema.org/InStock', priceSpecification: [
      { price: '5000000', priceType: 'https://schema.org/ListPrice' }, { price: '4198000', priceCurrency: 'VND' },
    ] }] }).price).toBe(4198000)
  })
  it('an AggregateOffer’s nested offers are read', () => {
    expect(offerFacts({ offers: { '@type': 'AggregateOffer', lowPrice: 1, offers: [{ availability: 'OutOfStock' }] } }).availability).toBe('out')
  })
})

describe('vndAmount — a VND price as a shop writes it', () => {
  it('plain, decimal, dot- or comma-grouped (with a currency sign) — and NaN, never 0, for what it cannot read', () => {
    expect([12990000, '12990000', '12990000.0000', '12.990.000', '12,990,000 ₫', '12.990.000đ', '990.000'].map(vndAmount))
      .toEqual([12990000, 12990000, 12990000, 12990000, 12990000, 12990000, 990000])
    expect(['', undefined, null, 'Liên hệ', '12.990.000,00', '1.2.3'].map(vndAmount).every(Number.isNaN)).toBe(true)
    expect(vndAmount('0')).toBe(0)
  })
  it('⛔ onePrice (the only price a run writes) is set only when every in-stock offer agrees', () => {
    const offer = (price: number, a = 'InStock') => ({ availability: `https://schema.org/${a}`, price })
    expect(offerFacts({ offers: [offer(15_000_000), offer(17_000_000)] })).toMatchObject({ price: 15_000_000, onePrice: undefined })
    expect(offerFacts({ offers: [offer(15_000_000), offer(15_000_000)] })).toMatchObject({ price: 15_000_000, onePrice: 15_000_000 })
    expect(offerFacts({ offers: [offer(15_000_000), offer(9_000_000, 'OutOfStock')] })).toMatchObject({ onePrice: 15_000_000 })
  })
  it('an AggregateOffer’s single nested offer (an object, not an array) is read', () => {
    expect(offerFacts({ offers: { '@type': 'AggregateOffer', offers: { availability: 'https://schema.org/InStock', price: 4990000 } } })).toMatchObject({ availability: 'in', price: 4990000 })
  })
  it('⚠️ offerFacts reads a dot-grouped JSON-LD price (it used to read NaN and drop it)', () => {
    expect(offerFacts({ offers: { availability: 'https://schema.org/InStock', price: '12.990.000' } })).toMatchObject({ availability: 'in', price: 12990000 })
  })
})

describe('productNodes — all three JSON-LD shapes, a @type word or URI', () => {
  it('a bare object, an @graph and a top-level array; a malformed block is skipped', () => {
    const html = ld({ '@type': 'BreadcrumbList' }) + ld({ '@type': 'http://schema.org/Product', name: 'A' }) + ld({ '@graph': [{ '@type': 'Organization' }, { '@type': ['Product'], name: 'B' }] })
      + ld([{ '@type': 'IndividualProduct', name: 'C' }]) + '<script type="application/ld+json">{oops</script>'
    expect(productNodes(html).map((n) => n.name)).toEqual(['A', 'B', 'C'])
  })
})

describe('the small readers', () => {
  it('isBotWall: a Cloudflare interstitial, not a plain 403', () => {
    expect(isBotWall({ status: 403, html: '<title>Attention Required! | Cloudflare</title>' })).toBe(true)
    expect(isBotWall({ status: 503, html: '<title>Just a moment...</title>' })).toBe(true)
    expect(isBotWall({ status: 403, html: 'Forbidden' })).toBe(false)
  })
  it('inputValue: either quote style, the id before the value', () => {
    expect(inputValue(`<input type="hidden" name="is_stocking" id="is_stocking" value="0">`, 'is_stocking')).toBe('0')
    expect(inputValue(`<input type='hidden' id='data_priceGg' value='8590000' />`, 'data_priceGg')).toBe('8590000')
    expect(inputValue('<input id="x">', 'is_stocking')).toBeUndefined()
  })
  it('samePage ignores the scheme, www., the query and a trailing slash', () => {
    expect(samePage({ url: 'https://shop.vn/a/', finalUrl: 'https://www.shop.vn/a?x=1', status: 200, html: '' })).toBe(true)
    expect(samePage({ url: 'https://shop.vn/a', finalUrl: 'https://shop.vn/', status: 200, html: '' })).toBe(false)
  })
  it('decodeEntities', () => {
    expect(decodeEntities('&quot;a&quot; &amp; &#039;b&#39;')).toBe(`"a" & 'b'`)
  })
})
