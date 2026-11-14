import { describe, expect, it, vi } from 'vitest'

vi.mock('./accesstrade-crawl', () => ({ readHoangHaUsed: async () => { throw new Error('not in tests') }, readShopDunkUsed: async () => { throw new Error('not in tests') } }))
const { crawlToFeed, trackingLink, hasCrawlReader } = await import('./accesstrade-crawl-feed')

const row = (sku: string, over: Record<string, unknown> = {}) => ({ sku, name: `n${sku}`, price: 1_000_000, url: `https://shopdunk.com/p-${sku}`, inStock: true, images: [], desc: '', ...over })
const read = (rows: ReturnType<typeof row>[], extra: Record<string, unknown> = {}) => ({
  rows: new Map(rows.map((r) => [r.sku, r])), unknown: new Set<string>(), skippedNew: 0, newSkus: new Set<string>(), complete: true,
  log: { pages: 1, failed: 0, fatal: false }, ...extra,
})

describe('trackingLink — built, never minted (measured landing 2026-11-15)', () => {
  it('is the deep-link shape AccessTrade serves: publisher, campaign, then the encoded product url', () => {
    expect(trackingLink('6800497735607325103', 'https://shopdunk.com/iphone-13?x=1'))
      .toBe('https://go.isclix.com/deep_link/7053736680188167797/6800497735607325103?url=https%3A%2F%2Fshopdunk.com%2Fiphone-13%3Fx%3D1')
  })
  it('refuses a non-id campaign or a non-https product', () => {
    expect(() => trackingLink('abc', 'https://shopdunk.com/x')).toThrow(/campaign/)
    expect(() => trackingLink('6800497735607325103', 'http://shopdunk.com/x')).toThrow(/https/)
  })
})

describe('crawlToFeed — the reader\'s verdict, in the feed shape the night reconciles', () => {
  it('in stock + priced → present (price + tracking link); out of stock → MISSING; unknown and unpriced → SEEN, never retired', () => {
    const f = crawlToFeed(read([row('1'), row('2', { inStock: false }), row('3', { price: 0 })], { unknown: new Set(['4']) }), '6800497735607325103')
    expect([...f.prices.keys()]).toEqual(['1'])
    expect(f.prices.get('1')!.affiliateUrl).toMatch(/^https:\/\/go\.isclix\.com\/deep_link\/7053736680188167797\/6800497735607325103\?url=/)
    expect([...f.seenIds].sort()).toEqual(['1', '3', '4'])
    expect(f.seenIds.has('2')).toBe(false)
    expect([...f.unpriced.keys()]).toEqual(['3'])
  })
  it('carries the reader\'s completeness verbatim — an incomplete read retires nothing downstream', () => {
    expect(crawlToFeed(read([row('1')], { complete: false, log: { pages: 9, failed: 1, fatal: true, reason: 'x' } }), '6800497735607325103'))
      .toMatchObject({ complete: false, read: { fatal: true, reason: 'x' } })
  })
  it('passes the new-goods ids through as positive evidence (the night retires them uncapped, never as "missing")', () => {
    expect([...crawlToFeed(read([row('1')], { newSkus: new Set(['9']), skippedNew: 1 }), '6800497735607325103').newSkus]).toEqual(['9'])
  })
  it('has a reader for exactly the two crawl campaigns (a Map: no prototype names)', () => {
    expect(hasCrawlReader('hoanghamobile')).toBe(true)
    expect(hasCrawlReader('shopdunk_web')).toBe(true)
    expect(hasCrawlReader('cellphones_cps')).toBe(false)
    expect(hasCrawlReader('constructor')).toBe(false)
  })
})
