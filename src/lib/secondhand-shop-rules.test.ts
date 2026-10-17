import { describe, expect, it } from 'vitest'
import { SHOP_FOLLOW_UPS, SHOP_PAGE_RULES, inventory24h } from './secondhand-shop-rules'
import type { PageRead } from './secondhand-page'

/**
 * Each partner shop's measured "still for sale?" rules (research 2026-10-17, wf_ffc74bf0-015). The fixtures are cut down
 * from the shops' real markup; each case states the trap it guards. JSON-LD "InStock" alone proves nothing on these shops.
 */

const ld = (node: unknown) => `<script type="application/ld+json">${JSON.stringify(node)}</script>`
const read = (url: string, html: string, finalUrl = url): PageRead => ({ url, status: 200, finalUrl, html })
const rule = (domain: string) => SHOP_PAGE_RULES[domain]

describe('minhtuanmobile.com — the desktop main form decides, not the JSON-LD', () => {
  const url = 'https://minhtuanmobile.com/oppo-reno15-5g-12gb-256gb-trang-cu-dep-15310/'
  const page = (main: string, availability = 'InStock', after = '') =>
    ld({ '@type': 'Product', name: 'OPPO Reno15 5G 12GB 256GB Trắng - Cũ đẹp', offers: { availability: `https://schema.org/${availability}`, price: 9490000 } })
    + `<form class="pdinfo_faddcart product-detail-wrapper-item d-none d-lg-block" action="https://minhtuanmobile.com/cart/add/">${main}</form><div class="product-detail-right-sticky"></div>${after}`
  const buyable = '<div class="prodetail_pricebox_main"><b class="price">9,490,000đ</b></div><div class="prodetail-faction prodetail-faction--addtocart"><button type="submit" class="btn-pdetail-muangay btn"><b>Mua ngay</b></button></div>'
  it('add-to-cart faction + an enabled "Mua ngay" + InStock → available at the JSON-LD price', () => {
    expect(rule('minhtuanmobile.com')(read(url, page(buyable)))).toMatchObject({ state: 'available', price: 9490000 })
  })
  it('⛔ the stop-sell price box wins over a stale InStock (the shop’s sold unit)', () => {
    const sold = '<div class="prodetail_pricebox_main"><p class="prodetail__price prodetail__price--stopsell bold text-danger">Sản phẩm ngừng kinh doanh</p></div><div class="prodetail-faction prodetail-faction--addtocart"></div>'
    expect(rule('minhtuanmobile.com')(read(url, page(sold)))).toMatchObject({ state: 'unavailable', reason: 'shop-sold' })
  })
  it('⛔ a notify-only model page (modal faction, disabled "Mua ngay") is not buyable though its JSON-LD says InStock', () => {
    const modal = '<div class="prodetail-faction prodetail-faction--modal"><button type="submit" class="btn-pdetail-muangay disabled" disabled="disabled">Mua ngay</button><button class="btn-pdetail-modal-quantam">NGỪNG KINH DOANH</button></div>'
    expect(rule('minhtuanmobile.com')(read(url, page(modal)))).toMatchObject({ state: 'unavailable', reason: 'buy-disabled' })
  })
  it('OutOfStock → unavailable; a stop-sell box OUTSIDE the main form (another product) is not read', () => {
    expect(rule('minhtuanmobile.com')(read(url, page('<div class="prodetail_pricebox_main"></div>', 'OutOfStock')))).toMatchObject({ reason: 'jsonld-out-of-stock' })
    expect(rule('minhtuanmobile.com')(read(url, page(buyable, 'InStock', '<p class="prodetail__price--stopsell">x</p>')))).toMatchObject({ state: 'available' })
  })
  it('the selected variant’s proprice status must agree where the page carries it (the key is prodetail_current, not the slug)', () => {
    const js = (status: string) => `<script>var prodetail_current = 'oppo-128-15310'; proprice.set('oppo-128-15310', { id: '31804', status: '${status}', active: 9490000 });</script>`
    expect(rule('minhtuanmobile.com')(read(url, page(buyable) + js('1')))).toMatchObject({ state: 'available' })
    expect(rule('minhtuanmobile.com')(read(url, page(buyable) + js('')))).toEqual({ state: 'unknown', reason: 'signals-disagree' })
  })
  it('no main form, or a redirect elsewhere → unknown', () => {
    expect(rule('minhtuanmobile.com')(read(url, ld({ '@type': 'Product', name: 'x' })))).toEqual({ state: 'unknown', reason: 'main-block-missing' })
    expect(rule('minhtuanmobile.com')(read(url, page(buyable), 'https://minhtuanmobile.com/hang-cu/dien-thoai/'))).toEqual({ state: 'unknown', reason: 'redirected' })
  })
})

describe('mayanh24h.com — window.info and the main product’s "Tình trạng" label must agree', () => {
  const url = 'https://mayanh24h.com/canon-eos-r50v-cu'
  const page = (status: string, label: string, special = 0, price = 15990000, href = url) =>
    ld({ '@type': 'Product', name: 'Canon EOS R50V', offers: { availability: 'https://schema.org/InStock', price: String(special || price) } })
    + `<script>window.info = ${JSON.stringify({ id: 123, href, name: 'Canon EOS R50V Hàng cũ', stock_status_id: status, name_stock: label, org_special: special, org_price: price })};window.products = [];</script>`
    + `<div id="product"><input type="hidden" name="product_id" value="123"/><p>Tình trạng: <span class="text-success">${label}</span></p></div>`
    + '<div class="related"><span class="stock-status">Còn hàng</span></div>'
  it('⛔ "Hết hàng" is sold out though the JSON-LD says InStock (30 of 41 pages)', () => {
    expect(rule('mayanh24h.com')(read(url, page('3', 'Hết hàng')))).toMatchObject({ state: 'unavailable', reason: 'shop-sold' })
  })
  it('"Còn hàng" with a price → available at org_special, else org_price; no price → no-price', () => {
    expect(rule('mayanh24h.com')(read(url, page('1', 'Còn hàng', 15000000)))).toMatchObject({ state: 'available', price: 15000000 })
    expect(rule('mayanh24h.com')(read(url, page('1', 'Còn hàng')))).toMatchObject({ state: 'available', price: 15990000 })
    expect(rule('mayanh24h.com')(read(url, page('1', 'Còn hàng', 0, 0)))).toMatchObject({ state: 'unavailable', reason: 'no-price' })
  })
  it('⛔ a price it cannot read is unknown, never no-price (which retires); a dot-grouped one is read', () => {
    const swap = (html: string, v: string) => html.replace('"org_price":15990000', `"org_price":${v}`)
    expect(rule('mayanh24h.com')(read(url, swap(page('1', 'Còn hàng'), '"Liên hệ"')))).toEqual({ state: 'unknown', reason: 'price-unreadable' })
    expect(rule('mayanh24h.com')(read(url, swap(page('1', 'Còn hàng'), 'null')))).toEqual({ state: 'unknown', reason: 'price-unreadable' })
    expect(rule('mayanh24h.com')(read(url, swap(page('1', 'Còn hàng'), '"15.990.000"')))).toMatchObject({ state: 'available', price: 15990000 })
    // A special price there but unreadable: on sale, and the regular price is not written in its place.
    const odd = rule('mayanh24h.com')(read(url, page('1', 'Còn hàng').replace('"org_special":0', '"org_special":"Giá sốc"')))
    expect(odd).toMatchObject({ state: 'available' })
    expect((odd as { price?: number }).price).toBeUndefined()
  })
  it('"Đặt hàng" (order and wait) → pre-order; a page of another product (href) → unknown; the shop’s not-found title → gone', () => {
    expect(rule('mayanh24h.com')(read(url, page('2', 'Đặt hàng')))).toMatchObject({ reason: 'shop-preorder' })
    expect(rule('mayanh24h.com')(read(url, page('1', 'Còn hàng', 0, 1, 'https://mayanh24h.com/other-cu')))).toEqual({ state: 'unknown', reason: 'identity-mismatch' })
    expect(rule('mayanh24h.com')(read(url, '<title>Trang bạn yêu cầu không tồn tại!</title>'))).toMatchObject({ reason: 'shop-not-found' })
  })
})

describe('24hstore.vn — #is_stocking and the warehouse blob, never the JSON-LD', () => {
  const url = 'https://24hstore.vn/apple-airpods-2-cu/tai-nghe-khong-day-apple-airpods-2-cu-p5144'
  const blob = (resp: string) => `<input type="hidden" id="products_sub" data-sku="x" value='[{price_old : 0, id: 9, response: "${resp}"}]'>`
  const page = (stocking: string, inv: string) => `<link rel="canonical" href="${url}"/>`
    + `<input type="hidden" name="is_stocking" id="is_stocking" value="${stocking}"><input type="hidden" id="data_price" value="1190000"><input type="hidden" id="data_priceGg" value="1390000">`
    + inv + ld({ '@graph': [{ '@type': 'Product', name: 'Tai nghe AirPods 2 Cũ', offers: { availability: 'https://schema.org/InStock', price: '1190000' } }] })
  const unit = '[{\\"NOTE\\":\\"625A-1.KTB\\",\\"QUANTITY\\":1},{\\"NOTE\\":\\"KHO-TEST\\",\\"QUANTITY\\":3}]'
  it('a unit on a store floor → available at the unconditional "Giá Mua Ngay" (#data_priceGg), not the trade-in price', () => {
    expect(rule('24hstore.vn')(read(url, page('1', blob(unit))))).toMatchObject({ state: 'available', price: 1390000 })
  })
  it('⛔ only a QC unit (KHO-TEST) is zero sellable stock; is_stocking=0 is not stocked; a removed id lands on the home page', () => {
    expect(rule('24hstore.vn')(read(url, page('1', blob('[{\\"NOTE\\":\\"KHO-TEST\\",\\"QUANTITY\\":1}]'))))).toMatchObject({ state: 'unavailable', reason: 'zero-stock' })
    expect(rule('24hstore.vn')(read(url, page('0', '')))).toMatchObject({ state: 'unavailable', reason: 'shop-sold' })
    expect(rule('24hstore.vn')(read(url, '<title>24hStore.vn</title>', 'https://24hstore.vn/'))).toMatchObject({ reason: 'shop-not-found' })
  })
  it('⛔ price inputs gone (a changed template) are unknown, never no-price (which retires); a zero price is no-price', () => {
    const noPrices = page('1', blob(unit)).replace(/<input type="hidden" id="data_price(?:Gg)?" value="\d+">/g, '')
    expect(rule('24hstore.vn')(read(url, noPrices))).toEqual({ state: 'unknown', reason: 'price-unreadable' })
    const zero = page('1', blob(unit)).replace('value="1190000"', 'value="0"').replace('value="1390000"', 'value="0"')
    expect(rule('24hstore.vn')(read(url, zero))).toMatchObject({ state: 'unavailable', reason: 'no-price' })
    // ⛔ The buy-now price gone but the trade-in one there: on sale, and the trade-in price is NOT written.
    const tradeOnly = page('1', blob(unit)).replace(/<input type="hidden" id="data_priceGg" value="\d+">/, '')
    const v = rule('24hstore.vn')(read(url, tradeOnly))
    expect(v).toMatchObject({ state: 'available' })
    expect((v as { price?: number }).price).toBeUndefined()
  })
  it('an unreadable blob or another product’s canonical → unknown', () => {
    expect(rule('24hstore.vn')(read(url, page('1', blob('{oops'))))).toEqual({ state: 'unknown', reason: 'inventory-unreadable' })
    expect(rule('24hstore.vn')(read(url, page('1', blob(unit)).replace('-p5144"', '-p9999"')))).toEqual({ state: 'unknown', reason: 'identity-mismatch' })
  })
  it('inventory24h reads both response shapes', () => {
    expect(inventory24h(blob('{\\"LoadProductInfo\\":[{\\"QUANTITY\\":0,\\"STOREID\\":\\"0001\\"}],\\"responseCode\\":\\"00\\"}'))).toMatchObject({ variants: 1, sellable: 0, lpi: 0 })
    expect(inventory24h(blob('[{\\"NOTE\\":\\"1. KHO-ONL\\",\\"QUANTITY\\":2}]'))).toMatchObject({ sellable: 2 })
  })
})

describe('bachlongstore.vn — the buy control with a price; its stock flag is always "1"', () => {
  const url = 'https://bachlongstore.vn/apple-iphone-14-128gb-cu.html'
  const page = (name: string, shown: string, price: number) => `<div class="protitle"><h1 class="bk-product-name">${name}</h1></div>`
    + `<div class="prodconts" id="proDetail"><div class="pnews bk-product-price" id="ext_price">${shown}</div><a onclick="vnTCart.do_AddCart(481,1)"><span class="tm">Mua ngay</span></a></div>`
    + `<script>var cat_id = '9'; var pro_id = 481 ; var pro_name = "x"; var price = ${price}; var stock = "1";</script>`
    + `<script>js_lang['mess_empty_stock'] = "Sản phẩm <b>{p_name}</b> đã hết hàng hoặc không cho đặt hàng";</script>`
  it('⛔ "đã hết hàng" in every page’s js_lang is not evidence; the buy control with a matching price → available', () => {
    expect(rule('bachlongstore.vn')(read(url, page('Apple IPhone 14 128GB cũ', '9.750.000  đ', 9750000)))).toMatchObject({ state: 'available', price: 9750000 })
  })
  it('the not-found shell → gone; a pre-order name → pre-order; "Liên hệ" with price 0 → no-price', () => {
    expect(rule('bachlongstore.vn')(read(url, '<div class="boxNotFound"><div class="mess_notfound">Sản phẩm này không tồn tại , hết hạn hoặc đã ngừng giao dịch</div></div>'))).toMatchObject({ reason: 'shop-not-found' })
    expect(rule('bachlongstore.vn')(read(url, page('Apple iPhone Duo 256GB Hàng Đặt Trước', '30.000.000 đ', 30000000)))).toMatchObject({ reason: 'shop-preorder' })
    expect(rule('bachlongstore.vn')(read(url, page('Apple IPhone 14 Pro 1TB cũ', 'Liên hệ', 0)))).toMatchObject({ reason: 'no-price' })
    expect(rule('bachlongstore.vn')(read(url, '<title>Sản phẩm</title>'))).toEqual({ state: 'unknown', reason: 'not-a-product-page' })
  })
})

describe('laptoptrunghau.com — a sold unit is unpublished into a byte-identical shell', () => {
  const url = 'https://laptoptrunghau.com/laptop-dell-gia-re-nhat-sai-gon-dell-latitude-5490.htm'
  const shell = '\r\n\r\n<script>window.location=\'https://laptoptrunghau.com/404.html\'</script><!doctype html><html><head><title></title><link rel="canonical" href="https://laptoptrunghau.com/.htm"/>'
    + ld({ '@type': 'NewsArticle', headline: '' })
  const live = ld({ '@type': 'Product', name: 'Dell Latitude 5490', offers: { availability: 'https://schema.org/InStock', price: '5200000' } })
    + '<h1 class="product-name">Dell Latitude 5490</h1><form name="frmOrder"><input type="hidden" name="price" value="5200000"><input type="submit" name="bottomBuy" value="Mua ngay"></form><div class="nxMargin product"></div>'
  it('the shell → gone; a live unit (InStock, hidden price = offer price, buy inputs) → available', () => {
    expect(rule('laptoptrunghau.com')(read(url, shell))).toMatchObject({ state: 'unavailable', reason: 'shop-not-found' })
    expect(rule('laptoptrunghau.com')(read(url, live))).toMatchObject({ state: 'available', price: 5200000 })
  })
  it('a category page (a NewsArticle with a headline, no Product) → unknown, never gone', () => {
    expect(rule('laptoptrunghau.com')(read(url, '<title>Laptop cũ</title>' + ld({ '@type': 'NewsArticle', headline: 'Laptop cũ' })))).toEqual({ state: 'unknown', reason: 'no-product-node' })
  })
})

describe('dienthoaigiakho.vn — JSON-LD pinned by sku, and __NEXT_DATA__ must agree', () => {
  const slug = 'iphone-15-128gb-cu-98-1702868469'
  const url = `https://dienthoaigiakho.vn/${slug}`
  const page = (availability: string, det: object, options: object[], isFallback = false) =>
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ isFallback, page: '/[...slugs]', props: { pageProps: { pageType: 1, fallback: { [`@"${slug}","detail",`]: { id: 77, ...det }, [`@"77","options",`]: options } } } })}</script>`
    + ld({ '@type': 'Product', name: 'iPhone 15 128GB Cũ 99%', sku: '1702868469', offers: { availability: `https://schema.org/${availability}`, price: '12190000' } })
  it('InStock + published + a variant with stock → available', () => {
    expect(rule('dienthoaigiakho.vn')(read(url, page('InStock', { publish: true, outOfStock: false }, [{ stock: 2 }])))).toMatchObject({ state: 'available', price: 12190000 })
  })
  it('⛔ PreOrder with no stock is sold out (shown as pre-order); Discontinued + unpublished is gone from sale', () => {
    expect(rule('dienthoaigiakho.vn')(read(url, page('PreOrder', { publish: true, outOfStock: true }, [{ stock: 0 }])))).toMatchObject({ state: 'unavailable', reason: 'shop-preorder' })
    expect(rule('dienthoaigiakho.vn')(read(url, page('Discontinued', { publish: false, outOfStock: true }, [])))).toMatchObject({ state: 'unavailable', reason: 'shop-sold' })
  })
  it('⛔ the framework’s fallback shell is not a verdict — the page’s own data route decides it', () => {
    const shell = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ isFallback: true, buildId: 'Ab_12-x', page: '/[...slugs]', props: { pageProps: {}, __N_SSG: true } })}</script><title>Dienthoaigiakho.vn - Best Price - Wow Service</title>`
    expect(rule('dienthoaigiakho.vn')(read(url, shell))).toEqual({ state: 'unknown', reason: 'fallback-shell', followUp: `https://dienthoaigiakho.vn/_next/data/Ab_12-x/${slug}.json` })
    const data = (body: string, status = 200) => ({ url: 'x', finalUrl: 'x', status, html: body })
    const props = (det: object, options: object[]) => JSON.stringify({ pageProps: { pageType: 1, fallback: { [`@"${slug}","detail",`]: { id: 77, ...det }, [`@"77","options",`]: options } } })
    const follow = SHOP_FOLLOW_UPS['dienthoaigiakho.vn']
    expect(follow(read(url, shell), data(props({ publish: false, outOfStock: true }, [])))).toMatchObject({ state: 'unavailable', reason: 'shop-sold' })
    expect(follow(read(url, shell), data(props({ publish: true, outOfStock: false }, [{ stock: 1, salePrice: 5990000 }, { stock: 0, salePrice: 1 }])))).toMatchObject({ state: 'available', price: 5990000 })
    // ⛔ Two variants on sale at two prices: available, but NO price to write (never the cheaper variant's).
    const two = follow(read(url, shell), data(props({ publish: true, outOfStock: false }, [{ stock: 1, salePrice: 5990000 }, { stock: 2, salePrice: 6990000 }])))
    expect(two).toMatchObject({ state: 'available' })
    expect((two as { price?: number }).price).toBeUndefined()
    expect(follow(read(url, shell), data('{"notFound":true}', 404))).toMatchObject({ state: 'unavailable', reason: 'shop-not-found' })
    expect(follow(read(url, shell), data('<!DOCTYPE html><html>404</html>', 404))).toEqual({ state: 'unknown', reason: 'stale-build' })
    expect(rule('dienthoaigiakho.vn')(read(url, page('PreOrder', { publish: true, outOfStock: false }, [{ stock: 1 }])))).toEqual({ state: 'unknown', reason: 'signals-disagree' })
  })
})

describe('didongviet.vn — honest JSON-LD, pinned to the final URL', () => {
  const url = 'https://didongviet.vn/may-cu-gia-re/oppo-reno15-5g-8gb-256gb-cu-co-box.html'
  const moved = 'https://didongviet.vn/may-cu-gia-re/oppo-reno15-5g-8gb-256gb-cu-fullbox.html'
  const page = (at: string, availability: string, buy = true) => ld({ '@type': 'Product', name: 'OPPO Reno15 5G 256GB Cũ (Fullbox)', url: at, offers: { '@type': 'Offer', availability: `https://schema.org/${availability}`, price: 9990000 } })
    + (buy ? '<button>MUA NGAY</button>' : '')
  it('a 308 to a renamed slug is the same phone: available, and the new URL is reported', () => {
    expect(rule('didongviet.vn')(read(url, page(moved, 'InStock'), moved))).toMatchObject({ state: 'available', price: 9990000, movedTo: moved })
  })
  it('OutOfStock without "MUA NGAY" → unavailable; with it → unknown; a Product of another page → unknown', () => {
    expect(rule('didongviet.vn')(read(url, page(url, 'OutOfStock', false)))).toMatchObject({ state: 'unavailable', reason: 'jsonld-out-of-stock' })
    expect(rule('didongviet.vn')(read(url, page(url, 'OutOfStock', true)))).toEqual({ state: 'unknown', reason: 'signals-disagree' })
    expect(rule('didongviet.vn')(read(url, page('https://didongviet.vn/may-cu-gia-re/other.html', 'InStock')))).toEqual({ state: 'unknown', reason: 'no-scoped-product' })
  })
})
