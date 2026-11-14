import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HH_ORIGIN, SD_ORIGIN, hoangHaDesc, hoangHaNextPage, isHoangHaListing, isHoangHaModelGone, isNewGoodsTitle, isShopDunkListing,
  parseHoangHaCategoryLinks, parseHoangHaGallery, parseHoangHaModelLinks, parseHoangHaUnitIds, parseHoangHaUnits,
  parseShopDunkCards, parseShopDunkCategoryLinks, parseShopDunkGallery, parseShopDunkProduct, readHoangHaUsed,
  readShopDunkUsed, type CrawlOpts,
} from './accesstrade-crawl'
import { UA } from './partner-fetch'

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__/accesstrade-crawl', name), 'utf8')
const HH = {
  index: fixture('hh-index.html'), cat: fixture('hh-cat.html'), model: fixture('hh-model.html'),
  empty: fixture('hh-model-empty.html'), unit: fixture('hh-unit.html'),
}
const SD = {
  index: fixture('sd-index.html'), cat: fixture('sd-cat.html'), catEnd: fixture('sd-cat-end.html'),
  prod: fixture('sd-prod.html'), prodMin: fixture('sd-prod-min.html'),
}

afterEach(() => { vi.restoreAllMocks() })

// ── A fake site: each URL answers with its replies in turn, the last one repeating ────────────────────

type Reply = string | number | Error | { status: number; location?: string }
function fakeSite(routes: Record<string, Reply | Reply[]>, onCall?: (n: number) => void) {
  const calls: { url: string; init?: RequestInit }[] = []
  const queues = new Map(Object.entries(routes).map(([url, r]) => [url, Array.isArray(r) ? [...r] : [r]]))
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    onCall?.(calls.length)
    const q = queues.get(url)
    if (!q) return new Response('not in the fake site', { status: 404 })
    const r = q.length > 1 ? q.shift()! : q[0]
    if (r instanceof Error) throw r
    if (typeof r === 'number') return new Response('', { status: r })
    if (typeof r === 'string') return new Response(r, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    return new Response('', { status: r.status, headers: r.location ? { location: r.location } : {} })
  }) as typeof fetch
  const sleeps: number[] = []
  const opts = (over: Partial<CrawlOpts> = {}): CrawlOpts => ({
    deadline: Date.now() + 3_600_000, fetchImpl, delayMs: 7, sleep: async (ms) => { sleeps.push(ms) }, ...over,
  })
  return { calls, sleeps, opts, urls: () => calls.map((c) => c.url) }
}

const vnd = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

// ── Hoàng Hà builders (a real card as the template) ───────────────────────────────────────────────────

const CARD = /<article[\s\S]*?<\/article>/.exec(HH.model)![0]
const hhUnitUrl = (id: string) => `${HH_ORIGIN}/kho-san-pham-cu/dien-thoai-di-dong-sumo-4g-t2-den-black-t2blk-may-cu-p${id}`
function hhCard(id: string, o: { name?: string; price?: number | null } = {}) {
  let html = CARD.replace(/69333/g, id)
  if (o.name) html = html.replace(/(<h3[\s\S]*?<a\b[^>]*>)[\s\S]*?(<\/a>)/, `$1${o.name}$2`)
  if (o.price === null) html = html.replace('380.000&#x111;', 'Liên hệ')
  else if (o.price) html = html.replace('380.000&#x111;', `${vnd(o.price)}&#x111;`)
  return html
}
const pager = (next?: number) => `<div data-category-pager>${next ? `<button type="button" data-category-more data-next-page="${next}">Xem thêm</button>` : ''}</div>`
const hhModelPage = (cards: string[], next?: number) =>
  `<div class="grid" data-category-products>${cards.join('\n')}</div>${cards.length ? '' : '<div data-category-empty></div>'}${pager(next)}`
const hhCatPage = (models: string[], next?: number) =>
  `<div class="grid" data-category-products>${models.map((m, i) => `<article data-category-product data-product-id="${i}"><a href="${m}">x</a></article>`).join('')}</div>${pager(next)}`
const hhIndex = (cats: string[]) => `<nav>${cats.map((c) => `<a href="${c}">c</a>`).join('')}</nav>`

const A = '/kho-san-pham-cu/a'
const B = '/kho-san-pham-cu/b'
const M1 = '/kho-san-pham-cu/dien-thoai/m1'
const M2 = '/kho-san-pham-cu/dien-thoai-di-dong/m2'
const M3 = '/kho-san-pham-cu/dien-thoai/m3'
/** Two categories sharing a model, a unit on two models, a paginated model, an empty model: 12 pages. */
const hhRoutes = (): Record<string, Reply | Reply[]> => ({
  [`${HH_ORIGIN}/kho-san-pham-cu`]: hhIndex([A, B]),
  [HH_ORIGIN + A]: hhCatPage([M1, M2], 2),
  [`${HH_ORIGIN}${A}?p=2`]: hhCatPage([M2, M3]),
  [`${HH_ORIGIN}${A}?p=3`]: hhCatPage([M3]),
  [HH_ORIGIN + B]: hhCatPage([M1]),
  [`${HH_ORIGIN}${B}?p=2`]: hhCatPage([M1]),
  [HH_ORIGIN + M1]: hhModelPage([hhCard('1', { price: 1_500_000 }), hhCard('2', { price: 2_000_000 })], 2),
  [`${HH_ORIGIN}${M1}?p=2`]: hhModelPage([hhCard('3')]),
  [`${HH_ORIGIN}${M1}?p=3`]: hhModelPage([]),
  [HH_ORIGIN + M2]: hhModelPage([hhCard('2', { price: 999_000 }), hhCard('4')]),
  [`${HH_ORIGIN}${M2}?p=2`]: hhModelPage([hhCard('2', { price: 999_000 }), hhCard('4')]),
  [HH_ORIGIN + M3]: hhModelPage([]),
})

// ── ShopDunk builders ─────────────────────────────────────────────────────────────────────────────────

const sdCard = (sku: string, name: string, price: number) =>
  `<div class=item-box><div class=product-item data-productid=${sku}><div class=picture><a href=/p-${sku} title="${name}"> <img src=https://shopdunk.com/images/thumbs/00${sku}_p-${sku}_550.png> </a></div><div class=details><h3 class=product-title><a href=/p-${sku}>${name}</a></h3><div class=add-info><div class=prices><span class="price actual-price">${vnd(price)}&#x20AB;</span></div></div></div></div></div>`
const sdListing = (cards: string[]) =>
  `<div class=products-container><div class=products-wrapper>${cards.length ? `<div class=product-grid><div class=item-grid>${cards.join('')}</div></div>` : '<div class=no-result>Không tìm thấy</div>'}</div></div>`
const sdProduct = (sku: string, price: number, availability = 'InStock', name = '') =>
  `<div itemprop=offers itemscope itemtype=http://schema.org/Offer><meta itemprop=price content=${price}.00><meta itemprop=availability content=http://schema.org/${availability}></div><div data-productid=${sku}><h1><span class=main-name>${name}</span></h1></div>`
const sdIndex = (cats: string[]) => cats.map((c) => `<h2 class=title><a href=${c}> x </a></h2>`).join('')

// ═════════════════════════════════════════════════════════════════════════════════════════════════════

describe('isNewGoodsTitle', () => {
  it.each([
    'iPhone 15 | 128GB | Nguyên Seal', 'iPhone 16 New Seal', 'iPad Air M2 chưa kích hoạt', 'AirPods 4 Mới 100%', 'Watch S10 mới 100 %',
    'iPhone 15 Nguyên seal', // decomposed, the way ShopDunk writes titles
    'iPhone 15 Brand New', 'iPhone 15 brand-new', 'iPhone 15 Sealed', 'iPhone 15 Hàng mới', 'Máy mới chính hãng', 'Fullbox mới',
    'New iPhone 15 128GB', 'iPhone 15 unopened',
  ])('skips %s', (t) => { expect(isNewGoodsTitle(t)).toBe(true) })
  it.each(['Sumo T2 Mới 99%', 'iPhone 13 Like new', 'Trôi bảo hành', 'iPhone 17 Pro | 256GB | Trôi BH', 'Cũ đẹp 99%', 'Trôi BH',
    'Máy mới 99%', 'Hàng mới về - iPhone 12 cũ',
  ])(
    'keeps %s', (t) => { expect(isNewGoodsTitle(t)).toBe(false) })
})

describe('Hoàng Hà parsers (real pages)', () => {
  it('index → the single-segment category links, not filters, models or unit links', () => {
    const cats = parseHoangHaCategoryLinks(HH.index)
    expect(cats).toHaveLength(30)
    expect(cats[0]).toBe('/kho-san-pham-cu/dien-thoai')
    expect(cats.every((c) => /^\/kho-san-pham-cu\/[a-z0-9-]+$/.test(c))).toBe(true)
    expect(HH.index).toContain('href="/kho-san-pham-cu?filters=')
    expect(parseHoangHaCategoryLinks('<a href="/kho-san-pham-cu/may-cu-p69333">u</a><a href="/kho-san-pham-cu/loa">l</a>')).toEqual(['/kho-san-pham-cu/loa'])
  })

  it('category page → model links (two segments, deduped) and its pager', () => {
    expect(parseHoangHaModelLinks(HH.cat)).toEqual([
      '/kho-san-pham-cu/dien-thoai/iphone-16-pro-max-512gb', '/kho-san-pham-cu/dien-thoai/iphone-16-pro-max',
      '/kho-san-pham-cu/dien-thoai/xiaomi-redmi-note-17-pro-5g', '/kho-san-pham-cu/dien-thoai/iphone-17-pro-max',
    ])
    expect(hoangHaNextPage(HH.cat)).toBe(2)
    expect(isHoangHaListing(HH.cat)).toBe(true)
  })

  it('model page → unit cards: id, decoded name, MAIN price not the was-price, badges, warranty, store', () => {
    const units = parseHoangHaUnits(HH.model)
    expect(units.map((u) => u.sku)).toEqual(['69333', '70025', '72331', '77699', '77700', '77701'])
    expect(parseHoangHaUnitIds(HH.model)).toHaveLength(6)
    const u = units[0].unit!
    expect(u).toEqual({
      sku: '69333',
      name: 'Điện thoại di động Sumo 4G T2 đen (Black)_T2BLK - máy cũ',
      price: 380_000, // the struck-through 690.000đ is the was-price
      url: 'https://hoanghamobile.com/kho-san-pham-cu/dien-thoai-di-dong-sumo-4g-t2-den-black-t2blk-may-cu-p69333',
      badges: ['Trôi bảo hành', 'Mới 99%'],
      spec: 'Mặc định · Đen · Đầy đủ hộp phụ kiện đi kèm theo máy ạ',
      warranty: 'Bảo hành đến 17/09/2026',
      store: '101 Kim Mã',
      thumb: 'https://i.hoanghamobile.vn/Uploads/2025/06/17/7bd278ddf28245dc1c93.jpg',
    })
    expect(HH.model).toContain('690.000&#x111;')
    expect(hoangHaDesc(u)).toBe('Trôi bảo hành · Mới 99%\nMặc định · Đen · Đầy đủ hộp phụ kiện đi kèm theo máy ạ\nBảo hành đến 17/09/2026\nCửa hàng: 101 Kim Mã')
    expect(units[2].unit!.warranty).toBe('Còn bảo hành')
    expect(units[1].unit!.badges).toEqual(['Trôi bảo hành', 'Mới 95%'])
    expect(hoangHaNextPage(HH.model)).toBe(2)
  })

  it('a model page past its end is a valid listing with no units and no pager', () => {
    expect(isHoangHaListing(HH.empty)).toBe(true)
    expect(parseHoangHaUnitIds(HH.empty)).toEqual([])
    expect(hoangHaNextPage(HH.empty)).toBeNull()
  })

  it('a card that will not parse keeps its id with unit=null', () => {
    expect(parseHoangHaUnits(hhCard('5', { price: null }))).toEqual([{ sku: '5', unit: null }])
  })

  it('unit page → the unit\'s own photos only (not the promo slider, not related units), bare URLs', () => {
    expect(HH.unit).toContain('iphone-18-cat-082925094.png;p=slider')
    expect(parseHoangHaGallery(HH.unit)).toEqual([
      'https://i.hoanghamobile.vn/Uploads/2025/06/17/7bd278ddf28245dc1c93.jpg',
      'https://i.hoanghamobile.vn/Uploads/2025/06/17/4104b203385c8f02d64d.jpg',
      'https://i.hoanghamobile.vn/Uploads/2025/06/17/e53517369d692a377378.jpg',
      'https://i.hoanghamobile.vn/Uploads/2025/06/17/e9037217f8484f161659.jpg',
    ])
  })

  it('gallery: drops ;p= sizes and _<digits> re-encodes, keeps order, ≤5; the maker\'s photos only without real ones', () => {
    const U = 'https://i.hoanghamobile.vn/Uploads/2026/01/01/'
    const real = ['a.jpg;p=thumb-xs', 'a.jpg;p=zoom', 'b_638610465261235374.jpg;p=zoom', 'b.jpg;p=thumb-sm', 'c.png', 'd.webp', 'e.jpeg', 'f.jpg']
    const page = (r: string[], s: string[]) =>
      `<div data-used-device-gallery-panel="real">${r.map((x) => `<img src="${U}${x}">`).join('')}</div>` +
      `<div data-used-device-gallery-panel="source">${s.map((x) => `<img src="${U}${x}">`).join('')}</div>`
    expect(parseHoangHaGallery(page(real, ['stock.jpg']))).toEqual(
      ['a.jpg', 'b_638610465261235374.jpg', 'c.png', 'd.webp', 'e.jpeg'].map((x) => U + x))
    expect(parseHoangHaGallery(page([], ['stock.jpg;p=zoom']))).toEqual([`${U}stock.jpg`])
    expect(parseHoangHaGallery('<html>no gallery</html>')).toEqual([])
  })
})

describe('ShopDunk parsers (real pages)', () => {
  it('/may-cu → the six used categories, nothing else', () => {
    expect(parseShopDunkCategoryLinks(SD.index)).toEqual(['/iphone-cu-dep', '/ipad-cu-dep', '/macbook-cu', '/apple-watch-cu', '/airpods-cu-dep', '/phu-kien-apple-cu'])
  })

  it('category page → cards with composed names, prices, links (HOT block included)', () => {
    const cards = parseShopDunkCards(SD.cat)
    expect(cards).toHaveLength(10)
    expect(new Set(cards.map((c) => c.sku)).size).toBe(9) // 4368 is both HOT and in the grid
    expect(cards[0].card).toEqual({
      sku: '5939', name: 'iPhone 17 Pro | 256GB | Trôi BH', price: 28_390_000,
      url: 'https://shopdunk.com/dien-thoai-iphone-17-pro-256gb-troi-bh',
      thumb: 'https://shopdunk.com/images/thumbs/0053064_iphone-17-pro-256gb-troi-bh_550.png',
    })
    expect(SD.cat).toContain('Tro&#x302;i BH') // decomposed on the page
    expect(cards[1].card!.name).toBe('iPhone 17 | 512GB | Cũ đẹp (Đủ hộp,PK)')
    expect(isShopDunkListing(SD.cat)).toBe(true)
  })

  it('page 2 is the same HOT block over an empty grid', () => {
    const page1 = new Set(parseShopDunkCards(SD.cat).map((c) => c.sku))
    const page2 = parseShopDunkCards(SD.catEnd).map((c) => c.sku)
    expect(page2).toEqual(['5939', '6776', '6780', '4368'])
    expect(page2.every((s) => page1.has(s))).toBe(true)
    expect(isShopDunkListing(SD.catEnd)).toBe(true)
  })

  it('product page → microdata price and stock; the outstock JS template is NOT a sold-out signal', () => {
    expect(SD.prod).toContain('outstock')
    expect(SD.prod).toContain('tbhethang')
    expect(parseShopDunkProduct(SD.prod, '5939')).toEqual({
      name: 'iPhone 17 Pro | 256GB | Trôi BH', price: 28_390_000, availability: 'InStock', inStock: true,
      images: ['0053064', '0053065', '0053066'].map((n) => `https://shopdunk.com/images/thumbs/${n}_iphone-17-pro-256gb-troi-bh.png`),
      desc: 'Dòng sản phẩm: iPhone 17 series',
    })
    expect(parseShopDunkProduct(SD.prod, '9999')).toBeNull() // not this product's page
  })

  it('minified product page (unquoted attributes) parses the same', () => {
    expect(parseShopDunkProduct(SD.prodMin, '6633')).toMatchObject({
      name: 'iPhone 11 Pro Max | 64GB | Cũ đẹp (Đủ hộp,PK)', price: 7_590_000, inStock: true,
      images: ['https://shopdunk.com/images/thumbs/0060879_iphone-11-pro-max-64gb-cu-dep-du-hoppk.jpeg'],
    })
  })

  it('OutOfStock is honoured; a page without an Offer is not understood', () => {
    expect(parseShopDunkProduct(SD.prodMin.replace('schema.org/InStock', 'schema.org/OutOfStock'), '6633')).toMatchObject({ inStock: false, availability: 'OutOfStock' })
    expect(parseShopDunkProduct('<div data-productid=6633>Mua ngay</div>', '6633')).toBeNull()
  })

  it('gallery: one image per number, the largest size, ≤5, nothing outside the gallery', () => {
    const T = 'https://shopdunk.com/images/thumbs/'
    const html = `<img src=${T}0000009_menu_240.png><div class=gallery>` +
      ['0000001_x_100.png', '0000001_x_550.png', '0000001_x.png', '0000002_x_100.jpg', '0000002_x_550.jpg', '0000003_x_550.webp', '0000004_x_100.png', '0000005_x_550.png', '0000006_x_550.png']
        .map((f) => `<img src=${T}${f}>`).join('') + '</div><div class=overview><img src=' + T + '0000007_y_550.png></div>'
    expect(parseShopDunkGallery(html)).toEqual(['0000001_x.png', '0000002_x_550.jpg', '0000003_x_550.webp', '0000004_x_100.png', '0000005_x_550.png'].map((f) => T + f))
  })
})

describe('readHoangHaUsed', () => {
  it('walks index → categories → models: one row per unit, deduped by id (first wins), complete', async () => {
    const site = fakeSite(hhRoutes())
    const read = await readHoangHaUsed(site.opts())
    expect([...read.rows.keys()]).toEqual(['1', '2', '3', '4'])
    expect(read.rows.get('2')!.price).toBe(2_000_000) // m1's card, not m2's 999.000
    expect(read.rows.get('1')).toMatchObject({ price: 1_500_000, url: hhUnitUrl('1'), inStock: true, images: ['https://i.hoanghamobile.vn/Uploads/2025/06/17/7bd278ddf28245dc1c93.jpg'] })
    expect(read.rows.get('1')!.desc).toContain('Cửa hàng: 101 Kim Mã')
    expect(read).toMatchObject({ complete: true, skippedNew: 0, log: { pages: 12, failed: 0, fatal: false } })
    expect(read.unknown.size).toBe(0)
    expect(site.urls().filter((u) => u.includes('?p=4'))).toEqual([]) // each walk stops at the first page with nothing unseen
  })

  it('every request: the truthful UA, no redirect following, a 30 s timeout signal; a delayMs gap between requests', async () => {
    const site = fakeSite(hhRoutes())
    await readHoangHaUsed(site.opts())
    for (const { init } of site.calls) {
      expect((init!.headers as Record<string, string>)['User-Agent']).toBe(UA)
      expect(init!.redirect).toBe('manual')
      expect(init!.signal).toBeInstanceOf(AbortSignal)
    }
    expect(site.sleeps).toEqual(Array(site.calls.length - 1).fill(7))
  })

  it('a page failing twice then answering is fine (2 s, 6 s backoff)', async () => {
    const site = fakeSite({ ...hhRoutes(), [HH_ORIGIN + M1]: [503, new TypeError('fetch failed'), hhRoutes()[HH_ORIGIN + M1] as string] })
    const read = await readHoangHaUsed(site.opts())
    expect(read).toMatchObject({ complete: true, log: { pages: 12, failed: 0, fatal: false } })
    expect(site.sleeps).toContain(2_000)
    expect(site.sleeps).toContain(6_000)
    expect(read.rows.size).toBe(4)
  })

  it('a model page failing 3 times → fatal, incomplete; the other models are still read', async () => {
    const site = fakeSite({ ...hhRoutes(), [HH_ORIGIN + M2]: 503 })
    const read = await readHoangHaUsed(site.opts())
    expect(read).toMatchObject({ complete: false, log: { fatal: true, failed: 1 } })
    expect(read.log.reason).toContain(M2)
    expect([...read.rows.keys()]).toEqual(['1', '2', '3'])
    expect(site.urls().filter((u) => u === HH_ORIGIN + M2)).toHaveLength(3)
  })

  it.each([
    ['a 404 on a model linked that night', { status: 404 }],
    ['a redirect anywhere but a category (it would land on a 200 "not found" page)', { status: 302, location: '/' }],
    ['a redirect off the site', { status: 301, location: 'https://example.com/kho-san-pham-cu/dien-thoai' }],
  ])('%s → fatal', async (_, reply) => {
    const read = await readHoangHaUsed(fakeSite({ ...hhRoutes(), [HH_ORIGIN + M3]: reply }).opts())
    expect(read.complete).toBe(false)
    expect(read.log.fatal).toBe(true)
    expect(read.log.reason).toMatch(/HTTP (404|302|301)/)
  })

  it('a model page redirecting to a category (measured live) is an empty model: not retried, still complete', async () => {
    const extra = Array.from({ length: 10 }, (_, i) => `/kho-san-pham-cu/x/empty-${i}`) // 1 gone of 13 models, under 10%
    const routes = { ...hhRoutes(), [HH_ORIGIN + M3]: { status: 301, location: '/kho-san-pham-cu/dien-thoai' }, [HH_ORIGIN + B]: hhCatPage([M1, ...extra]) }
    for (const m of extra) routes[HH_ORIGIN + m] = hhModelPage([])
    const site = fakeSite(routes)
    const read = await readHoangHaUsed(site.opts())
    expect(read).toMatchObject({ complete: true, log: { pages: 22, failed: 0, fatal: false } })
    expect(site.urls().filter((u) => u === HH_ORIGIN + M3)).toHaveLength(1)
    expect([...read.rows.keys()]).toEqual(['1', '2', '3', '4'])
  })

  it('isHoangHaModelGone: only a redirect to the warehouse or one of its categories', () => {
    expect(isHoangHaModelGone(301, '/kho-san-pham-cu/dien-thoai')).toBe(true)
    expect(isHoangHaModelGone(302, 'https://hoanghamobile.com/kho-san-pham-cu')).toBe(true)
    expect(isHoangHaModelGone(301, '/kho-san-pham-cu/dien-thoai/iphone-16')).toBe(false)
    expect(isHoangHaModelGone(301, '/')).toBe(false)
    expect(isHoangHaModelGone(301, null)).toBe(false)
    expect(isHoangHaModelGone(200, '/kho-san-pham-cu/dien-thoai')).toBe(false)
    expect(isHoangHaModelGone(404, '/kho-san-pham-cu/dien-thoai')).toBe(false)
  })

  it('more than 10% of model pages redirecting is a site that changed, not sold-out stock → fatal', async () => {
    const routes = hhRoutes()
    routes[HH_ORIGIN + M2] = { status: 301, location: '/kho-san-pham-cu/a' }
    routes[HH_ORIGIN + M3] = { status: 301, location: '/kho-san-pham-cu/a' }
    const read = await readHoangHaUsed(fakeSite(routes).opts())
    expect(read.complete).toBe(false)
    expect(read.log.reason).toBe('2/3 model pages redirect to a category')
  })

  it('a pager that offered page 2 which then adds nothing → fatal, not the end', async () => {
    const read = await readHoangHaUsed(fakeSite({ ...hhRoutes(), [`${HH_ORIGIN}${M1}?p=2`]: hhModelPage([]) }).opts())
    expect(read.complete).toBe(false)
    expect(read.log.reason).toContain('offered page 2')
  })

  it('a 200 that is not a listing page is retried, then fatal', async () => {
    const site = fakeSite({ ...hhRoutes(), [HH_ORIGIN + M3]: '<html>Đang bảo trì</html>' })
    const read = await readHoangHaUsed(site.opts())
    expect(read.log.fatal).toBe(true)
    expect(site.urls().filter((u) => u === HH_ORIGIN + M3)).toHaveLength(3)
  })

  it('the index failing, or carrying no category, is fatal', async () => {
    for (const reply of [500, '<html>no links</html>']) {
      const read = await readHoangHaUsed(fakeSite({ ...hhRoutes(), [`${HH_ORIGIN}/kho-san-pham-cu`]: reply }).opts())
      expect(read).toMatchObject({ complete: false, log: { fatal: true, pages: 1, failed: 1 } })
      expect(read.rows.size).toBe(0)
    }
  })

  it('new-goods titles are left out and counted', async () => {
    const routes = hhRoutes()
    routes[`${HH_ORIGIN}${M1}?p=2`] = hhModelPage([hhCard('3', { name: 'iPhone 15 128GB Nguyên seal' })])
    const read = await readHoangHaUsed(fakeSite(routes).opts())
    expect(read.skippedNew).toBe(1)
    expect(read.rows.has('3')).toBe(false)
    expect(read.unknown.has('3')).toBe(false)
    expect(read.complete).toBe(true)
  })

  it('an unparsable card is unknown, and more than 2% of them makes the read incomplete', async () => {
    const routes = hhRoutes()
    routes[`${HH_ORIGIN}${M1}?p=2`] = hhModelPage([hhCard('3', { price: null })])
    const read = await readHoangHaUsed(fakeSite(routes).opts())
    expect(read.unknown).toEqual(new Set(['3']))
    expect(read.rows.has('3')).toBe(false)
    expect(read.complete).toBe(false)
    expect(read.log.fatal).toBe(false)
    expect(read.log.reason).toContain('would not parse')
  })

  it('a deadline already past → no request, incomplete, reason deadline', async () => {
    const site = fakeSite(hhRoutes())
    const read = await readHoangHaUsed(site.opts({ deadline: Date.now() - 1 }))
    expect(site.calls).toHaveLength(0)
    expect(read).toMatchObject({ complete: false, log: { fatal: true, reason: 'deadline' } })
  })

  it('a deadline reached mid-walk stops the read', async () => {
    const DEADLINE = 1_800_000_000_000
    let past = false
    vi.spyOn(Date, 'now').mockImplementation(() => (past ? DEADLINE + 1 : DEADLINE - 60_000))
    const site = fakeSite(hhRoutes(), (n) => { if (n === 8) past = true })
    const read = await readHoangHaUsed(site.opts({ deadline: DEADLINE }))
    expect(site.calls).toHaveLength(8)
    expect(read).toMatchObject({ complete: false, log: { fatal: true, reason: 'deadline' } })
    expect([...read.rows.keys()]).toEqual(['1', '2', '3']) // what was read is kept
  })

  it('a host that stops answering: five failed pages in a row end the read', async () => {
    const models = Array.from({ length: 8 }, (_, i) => `/kho-san-pham-cu/x/m${i}`)
    const routes: Record<string, Reply> = {
      [`${HH_ORIGIN}/kho-san-pham-cu`]: hhIndex([A]),
      [HH_ORIGIN + A]: hhCatPage(models),
      [`${HH_ORIGIN}${A}?p=2`]: hhCatPage(models),
    }
    for (const m of models) routes[HH_ORIGIN + m] = 503
    const site = fakeSite(routes)
    const read = await readHoangHaUsed(site.opts())
    expect(read.log.reason).toContain('5 pages in a row failed')
    expect(read).toMatchObject({ complete: false, log: { fatal: true, failed: 5 } })
    expect(site.calls).toHaveLength(3 + 5 * 3)
  })

  it('withPhotos: the unit page gallery; a failing unit page keeps the card thumbnail and the read stays complete', async () => {
    const site = fakeSite({ ...hhRoutes(), [hhUnitUrl('1')]: HH.unit, [hhUnitUrl('2')]: 503, [hhUnitUrl('3')]: HH.unit, [hhUnitUrl('4')]: '<html></html>' })
    const read = await readHoangHaUsed(site.opts({ withPhotos: true }))
    expect(read.rows.get('1')!.images).toHaveLength(4)
    expect(read.rows.get('2')!.images).toEqual(['https://i.hoanghamobile.vn/Uploads/2025/06/17/7bd278ddf28245dc1c93.jpg'])
    expect(read.rows.get('4')!.images).toHaveLength(1)
    expect(read).toMatchObject({ complete: true, log: { pages: 16, failed: 1, fatal: false } })
  })
})

describe('readShopDunkUsed', () => {
  const realCards = parseShopDunkCards(SD.cat).map((c) => c.card!)
  /** Two categories over the real page 1 / page 2, every product page answering. */
  const sdRoutes = (): Record<string, Reply | Reply[]> => {
    const r: Record<string, Reply | Reply[]> = {
      [`${SD_ORIGIN}/may-cu`]: sdIndex(['/iphone-cu-dep', '/ipad-cu-dep']),
      [`${SD_ORIGIN}/iphone-cu-dep?pagenumber=1`]: SD.cat,
      [`${SD_ORIGIN}/iphone-cu-dep?pagenumber=2`]: SD.catEnd,
      [`${SD_ORIGIN}/ipad-cu-dep?pagenumber=1`]: sdListing([sdCard('5939', 'dup', 1), sdCard('8001', 'iPad Air M2 | 128GB | Cũ đẹp 99%', 9_990_000)]),
      [`${SD_ORIGIN}/ipad-cu-dep?pagenumber=2`]: sdListing([]),
      [`${SD_ORIGIN}/p-8001`]: sdProduct('8001', 9_890_000),
    }
    for (const c of realCards) r[c.url] = c.sku === '5939' ? SD.prod : sdProduct(c.sku, c.price - 10_000)
    return r
  }

  it('every product page is read: its price and stock are authoritative; one row per product id', async () => {
    const site = fakeSite(sdRoutes())
    const read = await readShopDunkUsed(site.opts())
    expect(read.rows.size).toBe(10)
    expect(read.rows.get('5939')).toMatchObject({ name: 'iPhone 17 Pro | 256GB | Trôi BH', price: 28_390_000, inStock: true, url: 'https://shopdunk.com/dien-thoai-iphone-17-pro-256gb-troi-bh' })
    expect(read.rows.get('6776')).toMatchObject({ price: 26_280_000, name: 'iPhone 17 | 512GB | Cũ đẹp (Đủ hộp,PK)' }) // HOT-only card, product-page price
    expect(read.rows.get('8001')!.price).toBe(9_890_000)
    expect(read.rows.get('5939')!.images).toEqual(['https://shopdunk.com/images/thumbs/0053064_iphone-17-pro-256gb-troi-bh_550.png'])
    expect(read.rows.get('5939')!.desc).toBe('Dòng sản phẩm: iPhone 17 series')
    expect(read).toMatchObject({ complete: true, skippedNew: 0, log: { pages: 1 + 2 + 2 + 10, failed: 0, fatal: false } })
    expect(site.urls().filter((u) => u === 'https://shopdunk.com/dien-thoai-iphone-17-pro-256gb-troi-bh')).toHaveLength(1)
    for (const { init } of site.calls) expect((init!.headers as Record<string, string>)['User-Agent']).toBe(UA)
  })

  it('withPhotos: the product gallery at full size', async () => {
    const read = await readShopDunkUsed(fakeSite(sdRoutes()).opts({ withPhotos: true }))
    expect(read.rows.get('5939')!.images).toHaveLength(3)
    expect(read.rows.get('5939')!.images[0]).toBe('https://shopdunk.com/images/thumbs/0053064_iphone-17-pro-256gb-troi-bh.png')
  })

  it('OutOfStock on the product page → a row with inStock=false', async () => {
    const read = await readShopDunkUsed(fakeSite({ ...sdRoutes(), [`${SD_ORIGIN}/p-8001`]: sdProduct('8001', 9_890_000, 'OutOfStock') }).opts())
    expect(read.rows.get('8001')!.inStock).toBe(false)
    expect(read.complete).toBe(true)
  })

  it('a product page failing twice then answering is fine', async () => {
    const read = await readShopDunkUsed(fakeSite({ ...sdRoutes(), [`${SD_ORIGIN}/p-8001`]: [502, 502, sdProduct('8001', 9_890_000)] }).opts())
    expect(read.rows.has('8001')).toBe(true)
    expect(read.complete).toBe(true)
  })

  it.each([
    ['failing 3 times', 503],
    ['redirected to /page-not-found (measured for a delisted product)', { status: 302, location: '/page-not-found' }],
  ])('a product page %s → its sku is UNKNOWN, never gone; 1 of 10 is over 2% → incomplete', async (_, reply) => {
    const read = await readShopDunkUsed(fakeSite({ ...sdRoutes(), [`${SD_ORIGIN}/p-8001`]: reply }).opts())
    expect(read.unknown).toEqual(new Set(['8001']))
    expect(read.rows.has('8001')).toBe(false)
    expect(read).toMatchObject({ complete: false, log: { fatal: false, failed: 1 } })
    expect(read.log.reason).toBe('1/10 product pages failed')
  })

  it('the 2% rule: 1 failed of 60 is complete, 2 of 60 is not', async () => {
    const cards = Array.from({ length: 60 }, (_, i) => sdCard(String(9000 + i), `iPhone ${i} | Cũ đẹp 99%`, 1_000_000 + i))
    const routes = (failing: number): Record<string, Reply> => {
      const r: Record<string, Reply> = {
        [`${SD_ORIGIN}/may-cu`]: sdIndex(['/iphone-cu-dep']),
        [`${SD_ORIGIN}/iphone-cu-dep?pagenumber=1`]: sdListing(cards),
        [`${SD_ORIGIN}/iphone-cu-dep?pagenumber=2`]: sdListing([]),
      }
      for (let i = 0; i < 60; i++) r[`${SD_ORIGIN}/p-${9000 + i}`] = i < failing ? 500 : sdProduct(String(9000 + i), 2_000_000)
      return r
    }
    const one = await readShopDunkUsed(fakeSite(routes(1)).opts())
    expect(one).toMatchObject({ complete: true })
    expect(one.unknown.size).toBe(1)
    expect(one.rows.size).toBe(59)
    const two = await readShopDunkUsed(fakeSite(routes(2)).opts())
    expect(two.complete).toBe(false)
  })

  it('a category page failing → fatal', async () => {
    const read = await readShopDunkUsed(fakeSite({ ...sdRoutes(), [`${SD_ORIGIN}/ipad-cu-dep?pagenumber=1`]: 503 }).opts())
    expect(read).toMatchObject({ complete: false, log: { fatal: true } })
    expect(read.log.reason).toContain('/ipad-cu-dep page 1: HTTP 503')
  })

  it('a deadline in the product phase: unread products are unknown, not gone', async () => {
    const DEADLINE = 1_800_000_000_000
    let past = false
    vi.spyOn(Date, 'now').mockImplementation(() => (past ? DEADLINE + 1 : DEADLINE - 60_000))
    const site = fakeSite(sdRoutes(), (n) => { if (n === 8) past = true }) // 5 listing pages + 3 product pages
    const read = await readShopDunkUsed(site.opts({ deadline: DEADLINE }))
    expect(read.rows.size).toBe(3)
    expect(read.unknown.size).toBe(7)
    expect(read).toMatchObject({ complete: false, log: { fatal: false, reason: 'deadline' } })
  })

  it('new goods are left out — by the card title (product page never fetched) or by the product page name', async () => {
    const routes = sdRoutes()
    routes[`${SD_ORIGIN}/ipad-cu-dep?pagenumber=1`] = sdListing([sdCard('8001', 'iPad Air M2 | 128GB | Nguyên seal', 9_990_000), sdCard('8002', 'iPad mini 7 | 128GB', 9_000_000)])
    routes[`${SD_ORIGIN}/p-8002`] = sdProduct('8002', 9_000_000, 'InStock', 'iPad mini 7 | 128GB | Chưa kích hoạt')
    const site = fakeSite(routes)
    const read = await readShopDunkUsed(site.opts())
    expect(read.skippedNew).toBe(2)
    expect(read.rows.has('8001') || read.rows.has('8002')).toBe(false)
    expect(site.urls()).not.toContain(`${SD_ORIGIN}/p-8001`)
    expect(read.complete).toBe(true)
  })

  it('a host that stops answering product pages: the read stops after five, every product left is unknown', async () => {
    const routes = sdRoutes()
    for (const c of realCards) routes[c.url] = 503
    routes[`${SD_ORIGIN}/p-8001`] = 503
    const site = fakeSite(routes)
    const read = await readShopDunkUsed(site.opts())
    expect(read.unknown.size).toBe(10)
    expect(read.rows.size).toBe(0)
    expect(read).toMatchObject({ complete: false, log: { fatal: false, failed: 5 } })
    expect(site.calls).toHaveLength(5 + 5 * 3)
  })

  it('a catalogue with no product at all is fatal, never "everything sold"', async () => {
    const read = await readShopDunkUsed(fakeSite({
      [`${SD_ORIGIN}/may-cu`]: sdIndex(['/iphone-cu-dep']),
      [`${SD_ORIGIN}/iphone-cu-dep?pagenumber=1`]: sdListing([]),
    }).opts())
    expect(read).toMatchObject({ complete: false, log: { fatal: true, reason: 'no products on any category page' } })
  })
})

describe('stripImei — no device identifier reaches a listing (2026-11-15)', () => {
  it('removes a 15-digit IMEI, with or without its label, and the separator it leaves', async () => {
    const { stripImei } = await import('./accesstrade-crawl')
    expect(stripImei('iPhone 13 128GB - 356789104512345')).toBe('iPhone 13 128GB')
    expect(stripImei('Samsung A54 IMEI: 352345678901234 - máy cũ')).toBe('Samsung A54 - máy cũ')
    expect(stripImei('Sumo 4G T2 đen (Black)_T2BLK - máy cũ')).toBe('Sumo 4G T2 đen (Black)_T2BLK - máy cũ')
    // A 16-digit number or a capacity is not an IMEI.
    expect(stripImei('Thẻ 1234567890123456 / 256GB')).toBe('Thẻ 1234567890123456 / 256GB')
  })
})

describe('parseHoangHaGallery — the last panel stops before the related-units rail (commit gate, 2026-11-15)', () => {
  it('takes only the unit\'s own photos even when the real-photo panel is the last one on the page', async () => {
    const { parseHoangHaGallery } = await import('./accesstrade-crawl')
    const html = `<div data-used-device-gallery-panel="source"><img src="https://i.hoanghamobile.vn/Uploads/2024/01/01/stock-1.jpg"></div>
      <div data-used-device-gallery-panel="real"><img src="https://i.hoanghamobile.vn/Uploads/2025/06/17/own-1.jpg"></div>
      <section><article class="x" data-used-device-id="70002"><img src="https://i.hoanghamobile.vn/Uploads/2025/06/18/other-unit.jpg"></article></section>`
    const photos = parseHoangHaGallery(html)
    expect(photos.some((u) => u.includes('own-1'))).toBe(true)
    expect(photos.some((u) => u.includes('other-unit'))).toBe(false)
  })
})

