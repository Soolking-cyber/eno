import { decodeEntities } from '@/lib/feed-text'
import { newAppleLine, type NewAppleShop } from '@/lib/new-apple'

/**
 * ── READING A NEW-APPLE ROW'S OWN PRODUCT PAGE ───────────────────────────────────────────────────────────────────────
 *
 * The import and the nightly (src/lib/new-apple-night.ts) both decide price and stock from the shop's PRODUCT PAGE, never
 * from absence and never from a datafeed (plan review, 2026-11-26):
 *   · shops keep a sold-out new SKU listed ("Tạm hết hàng", "Liên hệ"), so "not in the feed" says nothing about stock;
 *   · AccessTrade's datafeed has no stock field, and Hoàng Hà's iPhone 18 rows in it were last updated 2026-10-18 (measured:
 *     feed 41,490,000 ₫, the page 40,990,000 ₫ the same day) — a nightly reading it would write five-week-old prices.
 * So a row goes to `sold` only on POSITIVE evidence: the page answers 404/410, or its own markup says out of stock. Anything
 * the reader cannot establish is UNKNOWN — the row is left as it is and the night counts it.
 *
 * What each shop's page carries (measured 2026-11-26, iPhone 18 Pro Max 256GB at all three):
 *   · CellphoneS, Hoàng Hà: a schema.org Product in JSON-LD with an Offer — price, priceCurrency VND, itemCondition
 *     NewCondition, availability. (Hoàng Hà's says InStock while some colours read "Tạm hết hàng": the page is in stock.)
 *   · ShopDunk: no JSON-LD; microdata `itemprop=price` and `itemprop=availability` — but ShopDunk's microdata says InStock
 *     for every product (measured on its used units, 2026-11-23), so its availability is NOT read. In stock = the page's
 *     own "Mua ngay" add-to-cart button for this product id; out = its primary action slot offers "Đăng ký nhận tin"
 *     (notify me) instead; neither = UNKNOWN, never sold.
 */

export type PageRead =
  | { kind: 'in'; price: number; name: string | null; images: string[] }
  | { kind: 'out'; name: string | null }
  | { kind: 'gone'; status: number }
  | { kind: 'unknown'; why: string }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

/** The page, or why not. A redirect to another product or to the home page is UNKNOWN, not gone (a shop re-slugs pages). */
export async function fetchProductPage(url: string, timeoutMs = 15_000): Promise<{ status: number; html: string; finalUrl: string } | { error: string }> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'vi-VN,vi;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(Math.floor(timeoutMs)) })
    const html = res.ok ? await res.text() : ''
    return { status: res.status, html, finalUrl: res.url || url }
  } catch (e) {
    return { error: (e as Error).message.slice(0, 120) }
  }
}

/** A printed đồng amount ("37.990.000₫", "37,990,000 đ") — thousands grouped by dots or commas. */
export function vndText(s: string): number | null {
  const m = s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,}/)
  if (!m) return null
  const n = Number(m[0].replace(/[.,]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

type LdProduct = { name?: unknown; image?: unknown; offers?: unknown }

/** Every schema.org Product node in the page's JSON-LD (top level, arrays and @graph). */
export function ldProducts(html: string): LdProduct[] {
  const out: LdProduct[] = []
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown
    try { data = JSON.parse(m[1].trim()) } catch { continue }
    const nodes: unknown[] = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { '@graph'?: unknown[] })['@graph']) ? (data as { '@graph': unknown[] })['@graph'] : [data]
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue
      const t = (n as { '@type'?: unknown })['@type']
      if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) out.push(n as LdProduct)
    }
  }
  return out
}

const AVAIL_OUT = /schema\.org\/(?:OutOfStock|SoldOut|Discontinued)$/i
const AVAIL_IN = /schema\.org\/(?:InStock|LimitedAvailability|OnlineOnly|InStoreOnly)$/i

function ldImages(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [v]
  return list.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? (x as { url?: unknown }).url : null))
    .filter((x): x is string => typeof x === 'string' && /^https:\/\//.test(x))
    .map((x) => x.replace(/;p=zoom$/, ''))
}

/** CellphoneS / Hoàng Hà: the page's one Product. Two Products, or none, is UNKNOWN. */
export function readLdPage(html: string): PageRead {
  const products = ldProducts(html)
  if (products.length !== 1) return { kind: 'unknown', why: `${products.length} JSON-LD products` }
  const p = products[0]
  const offers = Array.isArray(p.offers) ? p.offers : [p.offers]
  if (offers.length !== 1 || !offers[0] || typeof offers[0] !== 'object') return { kind: 'unknown', why: 'not one offer' }
  const o = offers[0] as { price?: unknown; lowPrice?: unknown; priceCurrency?: unknown; availability?: unknown; itemCondition?: unknown }
  const name = typeof p.name === 'string' ? decodeEntities(p.name).trim() : null
  const availability = String(o.availability ?? '')
  if (AVAIL_OUT.test(availability)) return { kind: 'out', name }
  if (!AVAIL_IN.test(availability)) return { kind: 'unknown', why: `availability "${availability.slice(0, 40)}"` }
  if (String(o.priceCurrency ?? '').toUpperCase() !== 'VND') return { kind: 'unknown', why: 'not VND' }
  if (o.itemCondition != null && !/NewCondition$/i.test(String(o.itemCondition))) return { kind: 'unknown', why: 'not NewCondition' }
  const price = num(o.price ?? o.lowPrice)
  if (price == null) return { kind: 'unknown', why: 'no price' }
  return { kind: 'in', price, name, images: ldImages(p.image) }
}

/** ShopDunk: microdata price + this product's own add-to-cart button. */
export function readShopDunkPage(html: string, productId: string): PageRead {
  if (!/^\d{1,9}$/.test(productId)) return { kind: 'unknown', why: 'bad product id' }
  const price = num(html.match(/<meta\s+itemprop=["']?price["']?\s+content=["']?([\d.,]+)/i)?.[1]?.replace(/,\d+$/, '').replace(/\.00$/, ''))
  const name = decodeEntities(html.match(/<span class=["']?main-name["']?>([^<]+)<\/span>/i)?.[1] ?? '').trim() || null
  const button = new RegExp(`id=["']?add-to-cart-button-${productId}["'\\s>]`).test(html)
  const image = html.match(/<meta\s+property=["']?og:image["']?\s+content=["']?(https:\/\/[^"' >]+)/i)?.[1] ?? null
  if (!button) {
    // ⛔ OUT OF STOCK = THE PRIMARY ACTION SLOT HOLDS "Đăng ký nhận tin" (notify me) INSTEAD OF "Mua ngay" (commit gate, opus:
    // without it a ShopDunk unit that sells out stays up for good). Measured 2026-11-26 on MacBook Pro 14 M6 (7231): the
    // `first-add-to-cart` slot's own button is the subscribe one; on an in-stock page (6980) that slot holds the add-to-cart
    // button and the subscribe block sits elsewhere with `d-none`. Anything else without the button stays UNKNOWN.
    const slot = html.match(/<div class=["']?first-add-to-cart["']?>\s*<div class=["']?add-to-cart["']?>\s*(<button[^>]*>[^<]*<\/button>)/i)?.[1] ?? ''
    if (/subcribe-button/.test(slot) && /Đăng ký nhận tin/.test(slot)) return { kind: 'out', name }
    return { kind: 'unknown', why: 'no add-to-cart button' }
  }
  if (price == null) return { kind: 'unknown', why: 'no price' }
  return { kind: 'in', price, name, images: image ? [image] : [] }
}

/**
 * ⛔ A PAGE THAT NO LONGER NAMES THE SAME LINE IS UNKNOWN. Shops reuse a URL for the next model, or redirect a retired one
 * to its successor; a price read off it would be another product's. The stored model must match the page's own name.
 */
export function readPage(shop: NewAppleShop, html: string, productId: string, model: string): PageRead {
  const r = shop.campaign === 'shopdunk_web' ? readShopDunkPage(html, productId) : readLdPage(html)
  if (r.kind === 'in' || r.kind === 'out') {
    if (!r.name) return r.kind === 'in' ? { kind: 'unknown', why: 'no product name' } : r
    const line = newAppleLine(r.name)
    if (line?.model !== model) return { kind: 'unknown', why: `page names "${r.name.slice(0, 60)}"` }
  }
  return r
}

/** One product page, read and judged. 404/410 is GONE; any other failure UNKNOWN. */
export async function readProduct(shop: NewAppleShop, url: string, productId: string, model: string): Promise<PageRead> {
  const u = (() => { try { return new URL(url) } catch { return null } })()
  if (!u || u.protocol !== 'https:' || u.hostname.replace(/^www\./, '') !== shop.host) return { kind: 'unknown', why: 'url not on the shop' }
  const page = await fetchProductPage(u.toString())
  if ('error' in page) return { kind: 'unknown', why: page.error }
  if (page.status === 404 || page.status === 410) return { kind: 'gone', status: page.status }
  if (page.status !== 200) return { kind: 'unknown', why: `HTTP ${page.status}` }
  const final = (() => { try { return new URL(page.finalUrl) } catch { return null } })()
  if (!final || final.hostname.replace(/^www\./, '') !== shop.host || final.pathname !== u.pathname) return { kind: 'unknown', why: `redirected to ${page.finalUrl.slice(0, 80)}` }
  return readPage(shop, page.html, productId, model)
}

/** The shop's product page URL out of a tracking link (`…/deep_link/<pub>/<campaign>?url=<encoded>`), or null. */
export function pageUrlOfTrackingLink(link: string | null | undefined): string | null {
  if (!link) return null
  try {
    const u = new URL(link)
    if (u.hostname !== 'go.isclix.com') return null
    const inner = u.searchParams.get('url')
    return inner && /^https:\/\//.test(inner) ? inner : null
  } catch { return null }
}

/** ShopDunk category cards: product id, page path, name, price, image. Server-rendered (measured 2026-11-26). */
export type ShopDunkCard = { productId: string; url: string; name: string; price: number | null; image: string | null }
export function shopDunkCards(html: string): ShopDunkCard[] {
  const out = new Map<string, ShopDunkCard>()
  // ⚠️ ONE CARD PER CHUNK: a regex spanning cards pairs one card's id with the next card's name (measured: a 256GB id with a
  // 512GB title). Each `product-item` div is cut out first, then read on its own.
  for (const chunk of html.split(/<div class=["']?product-item["']?\s+/).slice(1)) {
    const productId = chunk.match(/^data-productid=["']?(\d+)/)?.[1]
    const a = chunk.match(/<h3 class=["']?product-title["']?>\s*<a href=["']?([^"' >]+)["']?>([^<]+)<\/a>/)
    if (!productId || !a || out.has(productId)) continue
    const image = chunk.match(/<img[^>]*?src=["']?(https:\/\/(?:www\.)?shopdunk\.com\/images\/thumbs\/[^"' >]+)/)?.[1] ?? null
    const price = vndText(decodeEntities(chunk.match(/actual-price["']?>([^<]+)</)?.[1] ?? ''))
    out.set(productId, { productId, url: new URL(a[1], 'https://shopdunk.com/').toString(), name: decodeEntities(a[2]).trim(), price, image })
  }
  return [...out.values()]
}
