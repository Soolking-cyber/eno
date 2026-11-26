import { describe, expect, it } from 'vitest'
import { NEW_APPLE_SHOPS } from './new-apple'
import { pageUrlOfTrackingLink, readLdPage, readPage, readShopDunkPage, shopDunkCards, vndText } from './new-apple-read'

const [SD, CPS] = NEW_APPLE_SHOPS
const ld = (offer: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'iPhone 18 Pro Max 256GB', image: ['https://x.vn/a.jpg;p=zoom'], offers: { '@type': 'Offer', priceCurrency: 'VND', itemCondition: 'https://schema.org/NewCondition', ...offer }, ...extra })}</script></html>`

describe('readLdPage — CellphoneS / Hoàng Hà JSON-LD (measured shape 2026-11-26)', () => {
  it('in stock', () => {
    expect(readLdPage(ld({ price: '41690000', availability: 'https://schema.org/InStock' }))).toEqual({ kind: 'in', price: 41_690_000, name: 'iPhone 18 Pro Max 256GB', images: ['https://x.vn/a.jpg'] })
    expect(readLdPage(ld({ price: 40990000.0, availability: 'https://schema.org/InStock' }))).toMatchObject({ kind: 'in', price: 40_990_000 })
  })
  it('out of stock is positive evidence', () => {
    expect(readLdPage(ld({ price: '41690000', availability: 'https://schema.org/OutOfStock' }))).toEqual({ kind: 'out', name: 'iPhone 18 Pro Max 256GB' })
    expect(readLdPage(ld({ availability: 'http://schema.org/SoldOut' })).kind).toBe('out')
  })
  it('anything unclear is unknown', () => {
    expect(readLdPage(ld({ price: '41690000', availability: 'https://schema.org/PreOrder' })).kind).toBe('unknown')
    expect(readLdPage(ld({ price: '41690000', availability: 'https://schema.org/InStock', priceCurrency: 'USD' })).kind).toBe('unknown')
    expect(readLdPage(ld({ price: '41690000', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/UsedCondition' })).kind).toBe('unknown')
    expect(readLdPage(ld({ availability: 'https://schema.org/InStock' })).kind).toBe('unknown')
    expect(readLdPage('<html>no json-ld</html>').kind).toBe('unknown')
    expect(readLdPage(ld({ price: 1, availability: 'https://schema.org/InStock' }) + ld({ price: 2, availability: 'https://schema.org/InStock' })).kind).toBe('unknown')
  })
})

const sdPage = (opts: { button?: boolean; price?: string; name?: string } = {}) =>
  `<div class=product-name><h1><span class=main-name>${opts.name ?? 'iPhone 18 Pro Max 256GB'}</span></h1></div>` +
  `<meta itemprop=price content=${opts.price ?? '40990000.00'}><meta itemprop=availability content=http://schema.org/InStock>` +
  `<meta property=og:image content=https://shopdunk.com/images/thumbs/0070522_iphone-18-pro-max-256gb_550.webp>` +
  (opts.button === false ? '' : `<button type=button id=add-to-cart-button-6980 class="button-1 add-to-cart-button">Mua ngay</button>`) +
  // the out-of-stock popup template ships on every page, in a script
  `<script>var n='<p class="heading_tb_hethang">Sản phẩm tạm hết<\\/p>'</script>`

describe('readShopDunkPage — microdata price + this product\'s own Mua ngay button', () => {
  it('in stock with a button', () => {
    expect(readShopDunkPage(sdPage(), '6980')).toEqual({ kind: 'in', price: 40_990_000, name: 'iPhone 18 Pro Max 256GB', images: ['https://shopdunk.com/images/thumbs/0070522_iphone-18-pro-max-256gb_550.webp'] })
  })
  it('the notify-me button in the primary slot is OUT (measured on MacBook Pro 14 M6, 7231)', () => {
    const out = `<span class=main-name>MacBook Pro 14-inch M6 12CPU 12GPU 16GB 1TB</span><meta itemprop=price content=54990000.00>` +
      `<div class="product-detail-action-button normal" id=cart-button-prd><div class=first-add-to-cart><div class=add-to-cart><button type=button class="button-1 add-to-cart-button subcribe-button">Đăng ký nhận tin</button></div>` +
      `<div class="add-to-cart deposit"><a class="button-preorder d-none" id=combination-preorder target=_blank> Đặt cọc ngay</a></div></div>` +
      `<div class="add-to-cart subcribe d-none for-desktop"><button type=button id=subcribe-button-7231 class="button-1 add-to-cart-button subcribe-button">Đăng ký nhận tin</button></div></div>`
    expect(readShopDunkPage(out, '7231')).toEqual({ kind: 'out', name: 'MacBook Pro 14-inch M6 12CPU 12GPU 16GB 1TB' })
    // an in-stock page also carries a (hidden) subscribe block — it is not read as out
    const inStock = `<span class=main-name>iPhone 18 Pro Max 256GB</span><meta itemprop=price content=40990000.00>` +
      `<div class=first-add-to-cart><div class=add-to-cart><div class=add-to-cart-panel><button type=button id=add-to-cart-button-6980 class="button-1 add-to-cart-button">Mua ngay</button></div></div></div>` +
      `<div class="add-to-cart subcribe d-none for-desktop"><button type=button id=subcribe-button-6980 class="button-1 add-to-cart-button subcribe-button">Đăng ký nhận tin</button></div>`
    expect(readShopDunkPage(inStock, '6980').kind).toBe('in')
  })

  it('no button is UNKNOWN, never sold (ShopDunk microdata says InStock for everything)', () => {
    expect(readShopDunkPage(sdPage({ button: false }), '6980').kind).toBe('unknown')
    expect(readShopDunkPage(sdPage(), '6981').kind).toBe('unknown')
  })
})

describe('readPage — the page must still name the stored line', () => {
  it('a re-used URL for another model is unknown', () => {
    expect(readPage(SD, sdPage(), '6980', 'iPhone 18 Pro Max').kind).toBe('in')
    expect(readPage(SD, sdPage(), '6980', 'iPhone 18 Pro').kind).toBe('unknown')
    expect(readPage(CPS, ld({ price: '41690000', availability: 'https://schema.org/InStock' }), '141654', 'iPhone Duo').kind).toBe('unknown')
  })
})

describe('helpers', () => {
  it('pageUrlOfTrackingLink', () => {
    const page = 'https://shopdunk.com/dien-thoai-iphone-18-pro-max-256gb'
    expect(pageUrlOfTrackingLink(`https://go.isclix.com/deep_link/7053736680188167797/6800497735607325103?url=${encodeURIComponent(page)}`)).toBe(page)
    expect(pageUrlOfTrackingLink(`https://evil.example/deep_link/x?url=${encodeURIComponent(page)}`)).toBeNull()
    expect(pageUrlOfTrackingLink('https://go.isclix.com/deep_link/1/2?url=http%3A%2F%2Fshopdunk.com%2Fx')).toBeNull()
    expect(pageUrlOfTrackingLink(null)).toBeNull()
  })
  it('vndText reads dotted đồng', () => {
    expect(vndText('37.990.000₫')).toBe(37_990_000)
    expect(vndText('37,990,000 đ')).toBe(37_990_000)
    expect(vndText('Liên hệ')).toBeNull()
  })
  it('shopDunkCards pairs each id with its own title (one chunk per card)', () => {
    const card = (id: string, slug: string, name: string, price: string) =>
      `<div class=product-item data-productid=${id}><div class=product_tag><img src=/images/uploaded/icon/san-hang-n.png></div><div class=picture><a href=/${slug}><img alt="x" src=https://www.shopdunk.com/images/thumbs/00_${slug}_550.png></a></div><div class=details><h3 class=product-title><a href=/${slug}>${name}</a></h3><div class=prices><span class="price old-price">1.000.000&#x20AB;</span> <span class="price actual-price">${price}&#x20AB;</span></div></div></div>`
    const cards = shopDunkCards(card('6977', 'dien-thoai-iphone-18-pro-256gb', 'iPhone 18 Pro 256GB', '37.990.000') + card('6978', 'dien-thoai-iphone-18-pro-512gb', 'iPhone 18 Pro 512GB', '44.490.000'))
    expect(cards).toEqual([
      { productId: '6977', url: 'https://shopdunk.com/dien-thoai-iphone-18-pro-256gb', name: 'iPhone 18 Pro 256GB', price: 37_990_000, image: 'https://www.shopdunk.com/images/thumbs/00_dien-thoai-iphone-18-pro-256gb_550.png' },
      { productId: '6978', url: 'https://shopdunk.com/dien-thoai-iphone-18-pro-512gb', name: 'iPhone 18 Pro 512GB', price: 44_490_000, image: 'https://www.shopdunk.com/images/thumbs/00_dien-thoai-iphone-18-pro-512gb_550.png' },
    ])
  })
})
