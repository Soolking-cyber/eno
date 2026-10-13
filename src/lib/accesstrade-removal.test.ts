import { describe, expect, it } from 'vitest'
import { ACCESSTRADE_KEPT_SELLERS, ACCESSTRADE_SOURCED_SELLERS, accessTradeKeepReason } from './accesstrade-removal'

const CELLPHONES = 'cmt78nvif0000gpq48kvzmxjw'
const VINWONDERS = 'cmt6v9x4o00004fq4v6qokman'
const isclix = 'https://go.isclix.com/deep_link/7053736680188167797/4842412845025484719?url=https%3A%2F%2Fcellphones.com.vn%2Fx'

describe('accessTradeKeepReason', () => {
  it('removes an ownerless storefront row whose buy link is an AccessTrade tracker', () => {
    expect(accessTradeKeepReason({ sellerId: CELLPHONES, affiliateUrl: isclix, ownerId: null })).toBeNull()
    expect(accessTradeKeepReason({ sellerId: 'x', affiliateUrl: 'https://click.accesstrade.vn/abc', ownerId: null })).toBeNull()
  })

  it('keeps VinWonders by the owner\'s decision even though its links are AccessTrade short links', () => {
    expect(ACCESSTRADE_KEPT_SELLERS.has(VINWONDERS)).toBe(true)
    expect(accessTradeKeepReason({ sellerId: VINWONDERS, affiliateUrl: 'https://shorten.asia/eq98JJ5h', ownerId: null })).toMatch(/VinWonders/)
  })

  it('never touches a storefront a person owns', () => {
    expect(accessTradeKeepReason({ sellerId: CELLPHONES, affiliateUrl: isclix, ownerId: 'someone' })).toMatch(/owns/)
  })

  it('removes ANY live row of an AccessTrade-sourced storefront, whatever its link says (provenance)', () => {
    expect(ACCESSTRADE_SOURCED_SELLERS.has(CELLPHONES)).toBe(true)
    for (const url of [null, 'https://cellphones.com.vn/x']) expect(accessTradeKeepReason({ sellerId: CELLPHONES, affiliateUrl: url, ownerId: null })).toBeNull()
  })

  it('leaves other storefronts\' non-AccessTrade and look-alike hosts alone', () => {
    for (const url of [null, 'https://bachlongstore.vn/x', 'https://go.isclix.com.evil.example/x', 'https://notshorten.asia/x', 'https://viettel.vn/esim']) {
      expect(accessTradeKeepReason({ sellerId: 'some-scraped-shop', affiliateUrl: url, ownerId: null })).toBe('not an AccessTrade link')
    }
  })
})
