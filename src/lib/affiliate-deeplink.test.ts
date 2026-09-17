import { describe, expect, it } from 'vitest'
import { embeddedProductUrl } from './affiliate-deeplink'

const PRODUCT = 'https://supersports.com.vn/products/giay-chay-bo-nam-on-running-cloudsurfer-max'
const link = (params: string) => `https://go.isclix.com/deep_link/7053736680188167797/5883902897773910283?${params}`

describe('embeddedProductUrl', () => {
  it('recovers the product URL the affiliate link was minted for', () => {
    expect(embeddedProductUrl(link(`url=${encodeURIComponent(PRODUCT)}&sub4=oneatweb&sub5=pub-api`))).toBe(PRODUCT)
  })

  it('says nothing for a campaign that already deep-links', () => {
    // CellphoneS: same shape, different campaign — its links land on the product, so a second step
    // would point at the page the shopper is already reading.
    const other = `https://go.isclix.com/deep_link/7053736680188167797/4751584435713464237?url=${encodeURIComponent(PRODUCT)}`
    expect(embeddedProductUrl(other)).toBe(null)
  })

  it('refuses anything that is not a known merchant product page', () => {
    // the shop's home is exactly where the tracker already dumped them
    expect(embeddedProductUrl(link(`url=${encodeURIComponent('https://supersports.com.vn/en')}`))).toBe(null)
    // an open redirect is the failure mode this validation exists for
    expect(embeddedProductUrl(link(`url=${encodeURIComponent('https://evil.example/products/x')}`))).toBe(null)
    expect(embeddedProductUrl(link(`url=${encodeURIComponent('http://supersports.com.vn/products/x')}`))).toBe(null)
    expect(embeddedProductUrl(link('url=not-a-url'))).toBe(null)
    expect(embeddedProductUrl(link('sub4=oneatweb'))).toBe(null)
  })

  it('ignores links that are not AccessTrade deep links at all', () => {
    expect(embeddedProductUrl('https://supersports.com.vn/products/x')).toBe(null)
    expect(embeddedProductUrl('https://evil.example/deep_link/1/5883902897773910283?url=' + encodeURIComponent(PRODUCT))).toBe(null)
    expect(embeddedProductUrl('')).toBe(null)
    expect(embeddedProductUrl(null)).toBe(null)
    expect(embeddedProductUrl('not a url')).toBe(null)
  })
})
