import { describe, expect, it } from 'vitest'
import {
  RETIRING_REASONS, RULE_DEPENDENT, classifyApiRow, classifyFeedRow, classifyProductPage, priceDecision, sameItem, sameItemScore,
  type FeedFacts, type PageRead, type Verdict,
} from './secondhand-showcase'

/**
 * The second-hand showcase's evidence rules (owner, 2026-10-17). The one property every case below protects: only
 * per-row evidence retires a live listing — a blocked crawler, a broken page, a redirect, a sold COLOUR or a product
 * re-filed out of the used category never does.
 */

const ld = (node: object) => `<script type="application/ld+json">${JSON.stringify(node)}</script>`
const product = (offers: unknown, name = 'iPhone 16 128GB Xanh Ultramarine Cũ') => ld({ '@type': 'Product', name, offers })
const page = (html: string, over: Partial<PageRead> = {}): PageRead => ({ url: 'https://shop.example/iphone-16/', status: 200, finalUrl: 'https://shop.example/iphone-16/', html, ...over })
const generic = (read: PageRead) => classifyProductPage(read, { domain: 'shop.example' })
const seen: Verdict[] = []
const keep = <T extends Verdict | 'absent'>(v: T): T => { if (v !== 'absent') seen.push(v as Verdict); return v }

describe('classifyProductPage — the transport answers first, then the shop’s own rules, else the JSON-LD', () => {
  it('404 / 410 → unavailable (the shop removed it)', () => {
    expect(keep(generic(page('', { status: 404 })))).toEqual({ state: 'unavailable', reason: 'http-404' })
    expect(keep(generic(page('', { status: 410 })))).toEqual({ state: 'unavailable', reason: 'http-404' })
  })
  it('⛔ a Cloudflare page is a block on the crawler, never evidence (ZShop, 2026-10-17)', () => {
    expect(keep(generic(page('<title>Attention Required! | Cloudflare</title>', { status: 403 })))).toEqual({ state: 'unknown', reason: 'blocked', blocked: true })
  })
  it('⛔ a 5xx, a timeout, a 200 with no product data → unknown', () => {
    expect(keep(generic(page('', { status: 502 }))).state).toBe('unknown')
    expect(keep(generic(page('', { status: 0, error: 'The operation was aborted due to timeout' }))).state).toBe('unknown')
    expect(keep(generic(page('<html><title>Máy cũ</title></html>')))).toEqual({ state: 'unknown', reason: 'no-product-node' })
  })
  it('generic: every offer out of stock → unavailable; one colour in stock → available; PreOrder → unknown', () => {
    expect(keep(generic(page(product([{ availability: 'OutOfStock' }]))))).toMatchObject({ state: 'unavailable', reason: 'jsonld-out-of-stock' })
    expect(generic(page(product([{ availability: 'OutOfStock' }, { availability: 'InStock', price: 1 }]))).state).toBe('available')
    expect(keep(generic(page(product({ availability: 'https://schema.org/PreOrder', price: 1 }))))).toEqual({ state: 'unknown', reason: 'jsonld-PreOrder' })
  })
  it('a shop with its own rules is read by them (Máy Ảnh 24h: its InStock JSON-LD is not believed)', () => {
    const v = classifyProductPage(page(product({ availability: 'InStock', price: 1 }), { url: 'https://mayanh24h.com/x-cu', finalUrl: 'https://mayanh24h.com/x-cu' }), { domain: 'mayanh24h.com' })
    expect(keep(v)).toEqual({ state: 'unknown', reason: 'not-a-product-page' })
  })
})

describe('classifyFeedRow — the WooCommerce and Haravan shops', () => {
  const feed = (over: Partial<FeedFacts> = {}): FeedFacts => ({
    complete: true,
    byId: new Map([['1', { inStock: true, price: 1480000, name: 'Sofa Băng Cũ' }], ['2', { inStock: false, price: 1, name: 'Tủ cũ' }], ['4', { inStock: true, price: 1, name: 'Kệ', backorder: true }]]),
    seen: new Set(['1', '2', '3', '4']),
    ...over,
  })
  it('in the feed: in stock → available; out of stock → unavailable; backorder → unknown (never restored)', () => {
    expect(classifyFeedRow(feed(), '1')).toMatchObject({ state: 'available', price: 1480000 })
    expect(keep(classifyFeedRow(feed(), '2'))).toMatchObject({ state: 'unavailable', reason: 'feed-out-of-stock' })
    expect(keep(classifyFeedRow(feed(), '4'))).toEqual({ state: 'unknown', reason: 'backorder' })
  })
  it('⛔ filed under the shop’s sold category → unavailable even while the feed lists it in stock (banghethanhly 58532)', () => {
    expect(keep(classifyFeedRow(feed({ soldIds: new Set(['1']) }), '1'))).toEqual({ state: 'unavailable', reason: 'api-sold-category' })
  })
  it('listed without a price → unknown; absent from a complete read → confirm per row; incomplete → unknown', () => {
    expect(keep(classifyFeedRow(feed(), '3'))).toEqual({ state: 'unknown', reason: 'listed-unpriced' })
    expect(classifyFeedRow(feed(), '9')).toBe('absent')
    expect(keep(classifyFeedRow(feed({ complete: false }), '9'))).toEqual({ state: 'unknown', reason: 'feed-incomplete' })
  })
})

describe('classifyApiRow — confirming an absence, row by row', () => {
  it('404 (deleted) and out of stock (Woo is_in_stock, every Haravan variant) → unavailable', () => {
    expect(keep(classifyApiRow({ status: 404 }, undefined))).toEqual({ state: 'unavailable', reason: 'api-404' })
    expect(keep(classifyApiRow({ status: 200, json: { name: 'Tủ', is_in_stock: false } }, undefined))).toMatchObject({ reason: 'api-out-of-stock' })
    expect(keep(classifyApiRow({ status: 200, json: { product: { title: 'Sony', variants: [{ available: false }] } } }, undefined))).toMatchObject({ reason: 'api-out-of-stock' })
  })
  it('⛔ a TRASHED product still answers 200 "in stock" — the slug, the permalink or not purchasable at a real price give it away', () => {
    const trashed = { name: 'iPhone', is_in_stock: true, slug: 'iphone-13__trashed', permalink: 'https://tuannguyenmobile.com/?post_type=product&p=9642', is_purchasable: false, prices: { price: '9000000', currency_minor_unit: 0 } }
    expect(keep(classifyApiRow({ status: 200, json: trashed }, undefined))).toMatchObject({ state: 'unavailable', reason: 'api-trashed' })
    expect(classifyApiRow({ status: 200, json: { ...trashed, slug: 'iphone-13', permalink: 'https://x/p/' } }, undefined)).toMatchObject({ reason: 'api-trashed' })
  })
  it('⛔ re-filed out of the used category but still for sale → unknown, never sold (Thế Giới Số 365, 3 of 5 showcase rows)', () => {
    const moved = { name: '[New Outlet] Dell XPS 13', is_in_stock: true, is_purchasable: true, slug: 'dell-xps-13', permalink: 'https://thegioiso365.vn/san-pham/dell-xps-13/', categories: [{ id: 100, slug: 'laptop-moi' }], prices: { price: '33990000', currency_minor_unit: 0 } }
    expect(keep(classifyApiRow({ status: 200, json: moved }, undefined))).toEqual({ state: 'unknown', reason: 'absent-from-feed-but-served' })
  })
  it('an empty categories array means the hidden sold category only where the shop declares it (banghethanhly)', () => {
    const bare = { name: 'Bàn', is_in_stock: true, categories: [] }
    expect(keep(classifyApiRow({ status: 200, json: bare }, { emptyCategoriesMeansSold: true }))).toMatchObject({ reason: 'api-sold-category' })
    expect(classifyApiRow({ status: 200, json: bare }, undefined).state).toBe('unknown')
  })
  it('401 / a timeout → unknown', () => {
    expect(keep(classifyApiRow({ status: 401, json: { code: 'tglh_login_required' } }, undefined)).state).toBe('unknown')
    expect(keep(classifyApiRow({ status: 0, error: 'timeout' }, undefined)).state).toBe('unknown')
  })
})

describe('sameItem — the same unit, not the same URL', () => {
  it('the merchant’s title, re-spaced, re-cased, accents or not, a serial added', () => {
    expect(sameItem('iPhone 16 128GB Xanh Ultramarine Cũ', 'IPHONE 16 128GB XANH ULTRAMARINE CU')).toBe(true)
    expect(sameItem('Samsung Galaxy Z Fold7 12GB 256GB Xanh Navy - Cũ đẹp (*********24582)', 'Samsung Galaxy Z Fold7 12GB 256GB Xanh Navy - Cũ đẹp')).toBe(true)
  })
  it('⛔ another model at the same slug is a different item (score under 0.3)', () => {
    expect(sameItemScore('Dell Latitude 5490 | CORE I7 8650U | RAM 8GB', 'HP EliteBook 840 G5 Ryzen 5')).toBeLessThan(0.3)
    expect(sameItem('Máy lạnh Panasonic 1.5 HP', '')).toBe(false)
    expect(sameItem(null, 'x')).toBe(false)
  })
})

describe('priceDecision', () => {
  it('a moved price inside ±50% is written; the same price, no price or a zero is not', () => {
    expect(priceDecision(12590000, 9990000)).toEqual({ next: 9990000 })
    expect(priceDecision(12000000, 12000000)).toEqual({})
    expect(priceDecision(12000000, undefined)).toEqual({})
    expect(priceDecision(12000000, 0)).toEqual({})
  })
  it('⛔ a swing past 50% is refused and said — a minor-unit price, a "from" price, an accessory rail', () => {
    expect(priceDecision(12000000, 1200000000).refused).toMatch(/moves more than 50%/)
    expect(priceDecision(12000000, 4000000).refused).toBeDefined()
  })
})

describe('RETIRING_REASONS — the only reasons that may retire a row', () => {
  it('every unavailable verdict above carries a listed reason, and no unknown one does', () => {
    const unavailable = seen.filter((v) => v.state === 'unavailable').map((v) => v.reason)
    const unknown = seen.filter((v) => v.state === 'unknown').map((v) => v.reason)
    expect(unavailable.length).toBeGreaterThan(7)
    for (const r of unavailable) expect(RETIRING_REASONS as readonly string[]).toContain(r)
    for (const r of unknown) expect(RETIRING_REASONS as readonly string[]).not.toContain(r)
    for (const r of RULE_DEPENDENT) expect(RETIRING_REASONS as readonly string[]).toContain(r)
  })
})

describe('classifyFeedRow — a sold list that could not be read', () => {
  it('⛔ an in-stock feed row whose sold-category read failed is unknown, never available (banghethanhly lists sold goods)', () => {
    const feed = { complete: false, byId: new Map([['7', { inStock: true, price: 900000, name: 'Ghế xoay cũ' }]]), seen: new Set(['7']), soldUnknown: new Set(['7']) }
    expect(classifyFeedRow(feed, '7')).toEqual({ state: 'unknown', reason: 'sold-list-unread' })
    expect(classifyFeedRow({ ...feed, soldUnknown: undefined, soldIds: new Set(['7']) }, '7')).toMatchObject({ state: 'unavailable', reason: 'api-sold-category' })
  })
})

describe('sameItem — model marks that conflict are two items', () => {
  it('⛔ "iPhone X" / "iPhone 8" and 128GB / 256GB are at most "maybe"; one title adding a mark ("99%") is the same item', () => {
    expect(sameItem('iPhone X cũ', 'iPhone 8 cũ')).toBe(false)
    expect(sameItemScore('iPhone 13 Pro Max 128GB', 'iPhone 13 Pro Max 256GB')).toBe(0.5)
    expect(sameItem('iPhone 16 Plus 128GB Hồng cũ', 'iPhone 16 Plus 128GB Hồng - Cũ đẹp 99%')).toBe(true)
    expect(sameItem('Apple IPhone 14 128GB Blue LL/A Pin83', 'Apple iPhone 14 128GB Blue LL/A Pin 83%')).toBe(true)
  })
})

describe('classifyProductPage — the generic reader on a redirect', () => {
  it('⛔ out of stock at ANOTHER address is unknown (another product’s page), never a sale', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Other', offers: { availability: 'https://schema.org/OutOfStock', price: 1 } })}</script>`
    expect(classifyProductPage({ url: 'https://g.example/p/1', status: 200, finalUrl: 'https://g.example/p/2', html }, { domain: 'g.example' })).toEqual({ state: 'unknown', reason: 'redirected' })
    expect(classifyProductPage({ url: 'https://g.example/p/1', status: 200, finalUrl: 'https://g.example/p/1', html }, { domain: 'g.example' })).toMatchObject({ state: 'unavailable', reason: 'jsonld-out-of-stock' })
  })
})

describe('classifyProductPage — the generic reader reads the page’s OWN product', () => {
  const node = (name: string, url: string, availability: string) => ({ '@type': 'Product', name, url, offers: { availability: `https://schema.org/${availability}`, price: 100 } })
  const page = (...nodes: object[]) => nodes.map((n) => `<script type="application/ld+json">${JSON.stringify(n)}</script>`).join('')
  const read = (html: string) => ({ url: 'https://g.example/p/1', status: 200, finalUrl: 'https://g.example/p/1', html })
  it('⛔ several products and none naming this address say nothing (a related item out of stock is not ours)', () => {
    expect(classifyProductPage(read(page(node('Related A', 'https://g.example/p/9', 'OutOfStock'), node('Related B', 'https://g.example/p/8', 'InStock'))), { domain: 'g.example' }))
      .toEqual({ state: 'unknown', reason: 'several-products' })
  })
  it('the node naming this address is the one read, wherever it sits', () => {
    expect(classifyProductPage(read(page(node('Related', 'https://g.example/p/9', 'OutOfStock'), node('Ours', 'https://www.g.example/p/1/', 'InStock'))), { domain: 'g.example' }))
      .toMatchObject({ state: 'available', name: 'Ours' })
  })
  it('an address off the partner shops reads `off-site` — no evidence, and not a passing failure', () => {
    expect(classifyProductPage({ url: 'https://g.example/p/1', status: 0, finalUrl: 'http://10.0.0.1/', html: '', error: 'off-site address' }, { domain: 'g.example' }))
      .toEqual({ state: 'unknown', reason: 'off-site' })
  })
})

describe('classifyFeedRow — a backorder is never a sale', () => {
  it('⛔ backorder wins over the in-stock flag beside it, whichever way that flag points', () => {
    const feed = (inStock: boolean) => ({ complete: true, byId: new Map([['5', { inStock, backorder: true, price: 1, name: 'x' }]]), seen: new Set(['5']) })
    expect(classifyFeedRow(feed(false), '5')).toEqual({ state: 'unknown', reason: 'backorder' })
    expect(classifyFeedRow(feed(true), '5')).toEqual({ state: 'unknown', reason: 'backorder' })
  })
})

describe('classifyProductPage — the only node, naming another address', () => {
  it('⛔ a lone Product naming ANOTHER address (a related item on an error page) says nothing about ours', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Related', url: 'https://g.example/p/9', offers: { availability: 'https://schema.org/OutOfStock', price: 1 } })}</script>`
    expect(classifyProductPage({ url: 'https://g.example/p/1', status: 200, finalUrl: 'https://g.example/p/1', html }, { domain: 'g.example' })).toEqual({ state: 'unknown', reason: 'product-elsewhere' })
  })
})
