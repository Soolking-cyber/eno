import { clean } from './partner-fetch'
import {
  available, decodeEntities, inputValue, nameOf, normUrl, offerFacts, productNodes, samePage, unavailable, unknown, vndAmount,
  type PageRead, type Verdict,
} from './secondhand-page'

/**
 * ── EACH PARTNER SHOP'S OWN "IS IT STILL FOR SALE" RULES (the second-hand showcase check, owner 2026-10-17) ─────────
 *
 * ⛔ JSON-LD "InStock" IS NOT EVIDENCE ON MOST OF THESE SHOPS. Measured 2026-10-17 (research workflow wf_ffc74bf0-015,
 * GET-only with eno's honest user-agent, ~50 product pages per shop, notes under ~/eno-secondhand-2026-10/research/):
 * Máy Ảnh 24h hard-codes InStock on 41/41 pages, 30 of them sold out; 24hStore on 48/48, 11 of them not stocked at all;
 * Minh Tuấn Mobile on 15 pages that cannot be bought; Laptop Trung Hậu on 12/12 (it unpublishes sold units instead).
 * Each rule below reads the signal the shop's OWN page uses for the main product — a stock label, a hidden input, a
 * disabled buy button, a "not found" shell — scoped to that product, never a page-wide keyword: "hết hàng", "Liên hệ"
 * and "đã bán" sit in every page's templates, customer Q&A and related-product widgets.
 *
 * A rule is called only for an HTTP 200 (classifyProductPage handles 404, bot walls and errors first) and answers UNKNOWN
 * whenever its page is not the product it expects — a redirect elsewhere, a missing block, signals that disagree.
 *
 * Reasons (src/lib/secondhand-showcase.ts RETIRING_REASONS): `shop-not-found` the shop's own "no such product" page;
 * `shop-sold` its explicit sold / discontinued / not-stocked state; `shop-preorder` pre-order or order-only; `buy-disabled`
 * its buy control switched off; `no-price` contact-for-price; `zero-stock` no unit in any sellable warehouse (computed,
 * so it retires only on a run that also saw a live page of the shop — RULE_DEPENDENT).
 */

type Rule = (read: PageRead) => Verdict

/**
 * Minh Tuấn Mobile — the desktop main form (`pdinfo_faddcart product-detail-wrapper-item` … `product-detail-right-sticky`,
 * once per page, 2.5–20.5 KB). Sold unit: the stop-sell price box "Sản phẩm ngừng kinh doanh" (11 pages; it wins over a
 * stale InStock). Notify-only model page: the `--modal` faction with a disabled or absent "Mua ngay" (21 pages). Buyable:
 * the `--addtocart` faction, an enabled "Mua ngay", JSON-LD InStock with a price (16/16 agreed).
 */
const minhtuan: Rule = (read) => {
  const html = read.html
  if (!samePage(read)) return unknown('redirected')
  const node = productNodes(html)[0]
  if (!node) return unknown('no-product-node')
  const start = /<form\b[^>]*\bclass\s*=\s*["']pdinfo_faddcart product-detail-wrapper-item\b[^"']*["'][^>]*>/i.exec(html)
  const end = start ? html.indexOf('product-detail-right-sticky', start.index + start[0].length) : -1
  if (!start || end < 0 || end - start.index > 60_000) return unknown('main-block-missing')
  const b = html.slice(start.index + start[0].length, end)
  const name = nameOf(node)
  if (/\bprodetail__price--stopsell\b/i.test(b)) return unavailable('shop-sold', name)
  const btn = /<button\b[^>]*\bclass\s*=\s*["'][^"']*\bbtn-pdetail-muangay\b[^>]*>/i.exec(b)
  const enabled = !!btn && !/\bdisabled\b/i.test(btn[0])
  if (/<div\b[^>]*\bclass\s*=\s*["']prodetail-faction prodetail-faction--modal\b/i.test(b) && !enabled) return unavailable('buy-disabled', name)
  const addToCart = /<div\b[^>]*\bclass\s*=\s*["']prodetail-faction prodetail-faction--addtocart\b(?![^"']*modal-redirect)/i.test(b)
  const facts = offerFacts(node)
  if (facts.availability === 'out') return addToCart && enabled ? unknown('signals-disagree') : unavailable('jsonld-out-of-stock', name)
  if (addToCart && enabled && facts.availability === 'in' && facts.price) {
    // The fourth signal, where the page carries it: the server-selected variant's `proprice` status ('1' = Còn hàng). The
    // key is `prodetail_current`, NOT the URL slug — a model page pre-selects an in-stock variant.
    const cur = /var\s+prodetail_current\s*=\s*(["'])([^"']+)\1/.exec(html)?.[2]
    const body = cur ? new RegExp(`proprice\\.set\\(\\s*(["'])${cur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1\\s*,\\s*\\{([\\s\\S]*?)\\}\\s*\\)\\s*;`).exec(html)?.[2] : undefined
    const status = body ? /(?:^|[\s,{])status\s*:\s*(["'])([^"']*)\1/.exec(body)?.[2] : undefined
    if (status !== undefined && status !== '1') return unknown('signals-disagree')
    return available('buy-control', facts.onePrice, name)
  }
  return unknown('no-clear-state')
}

/**
 * Máy Ảnh 24h — the `window.info = {…}; window.products =` blob (stock_status_id 1 Còn hàng, 2 Đặt hàng, 3 Hết hàng) and
 * the first "Tình trạng: <span>…</span>" after `<div id="product">`, which must agree; identity: the hidden product_id
 * equals info.id and info.href is the URL we hold (41/41). Price: org_special, else org_price; both 0 = "Liên hệ".
 */
const mayanh24h: Rule = (read) => {
  const h = read.html.normalize('NFC')
  if (/<title>\s*(?:Trang bạn yêu cầu không tồn tại!|không tìm thấy sản phẩm nào!)\s*<\/title>/i.test(h)) return unavailable('shop-not-found')
  const d = h.search(/<div id=["']product["']>/)
  const m = /window\.info\s*=\s*(\{[\s\S]*?\})\s*;\s*window\.products\s*=/.exec(h)
  if (d < 0 || !m) return unknown('not-a-product-page')
  let info: Record<string, unknown>
  try { info = JSON.parse(m[1]) } catch { return unknown('info-unparsable') }
  const pid = /<input type=["']hidden["'] name=["']product_id["'] value=["'](\d+)["']/.exec(h.slice(d, d + 600))?.[1]
  const bare = (u: unknown) => normUrl(String(u ?? '')).replace(/\.html$/, '')
  if (pid !== String(info.id) || bare(info.href) !== bare(read.url) || !samePage(read)) return unknown('identity-mismatch')
  const label = /Tình trạng:\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/.exec(h.slice(d))?.[1]?.trim()
  const status = String(info.stock_status_id)
  const name = clean(String(info.name ?? '')) || undefined
  if (label === 'Hết hàng' && status === '3') return unavailable('shop-sold', name)
  if (label === 'Đặt hàng' && status === '2') return unavailable('shop-preorder', name)
  if (label === 'Còn hàng' && status === '1') {
    const special = vndAmount(info.org_special)
    const regular = vndAmount(info.org_price)
    if (special > 0) return available('stock-label', Math.round(special), name)
    // A special price there but unreadable: on sale, and the regular price is never written in its place.
    if (info.org_special != null && info.org_special !== '' && special !== 0) return available('stock-label', undefined, name)
    // ⛔ `no-price` (which retires) only on a price READ as zero — an absent or unreadable one is unknown.
    if (Number.isNaN(regular)) return unknown('price-unreadable')
    return regular > 0 ? available('stock-label', Math.round(regular), name) : unavailable('no-price', name)
  }
  return unknown('stock-label-unclear')
}

const HOME_24H = /^https?:\/\/(?:www\.)?24hstore\.vn\/?(?:[?#].*)?$/i
/** Warehouses that sell: a store floor (`<store>-1.KTB`, `256-3/2-1.TB`) or the online warehouse (`1. KHO-ONL`). */
const SELLABLE_24H = /^(?:\d+\.\s*)?KHO-ONL$|-\d+\.K?TB$/

/**
 * 24hStore — the hidden `#is_stocking` (0: not stocked, the buy button is not rendered — 11 pages) and the per-variant
 * warehouse blob `#products_sub`: a unit in a store floor or the online warehouse is AVAILABLE; none anywhere is
 * `zero-stock` (29 of 36 stocked pages — the shop leaves an order button on these evergreen model pages, so it is
 * computed evidence and RULE_DEPENDENT). A removed id 301s to the home page. Price: the unconditional "Giá Mua Ngay"
 * (`#data_priceGg`) — the JSON-LD price eno imported is the trade-in-conditional "Giá lên đời", ~500k lower.
 */
const h24: Rule = (read) => {
  const html = read.html
  if (HOME_24H.test(read.finalUrl) && /-p\d+(?:[/?#]|$)/.test(read.url)) return unavailable('shop-not-found')
  const reqId = /-p(\d+)(?:[/?#]|$)/.exec(read.url)?.[1]
  const canonId = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(html)?.[1]?.match(/-p(\d+)\/?$/)?.[1]
  if (!reqId || canonId !== reqId) return unknown('identity-mismatch')
  const name = nameOf(productNodes(html)[0])
  const stocking = inputValue(html, 'is_stocking')
  if (stocking === '0') return unavailable('shop-sold', name)
  if (stocking !== '1') return unknown('no-stock-flag')
  const inv = inventory24h(html)
  if (!inv.variants || inv.parseErrors) return unknown('inventory-unreadable')
  if (inv.sellable > 0) {
    const buyNow = vndAmount(inputValue(html, 'data_priceGg'))
    const tradeIn = vndAmount(inputValue(html, 'data_price'))
    if (buyNow > 1000) return available('warehouse-stock', Math.round(buyNow), name)
    // ⛔ `no-price` (which retires) only on prices READ as zero; and the trade-in price (#data_price, ~500k lower) is never
    // written in the buy-now price's place — on sale, priced by nothing (review, 2026-10-17).
    if (buyNow === 0 && tradeIn === 0) return unavailable('no-price', name)
    return tradeIn > 1000 ? available('warehouse-stock', undefined, name) : unknown('price-unreadable')
  }
  return inv.lpi === 0 ? unavailable('zero-stock', name) : unknown('stock-unclear')
}

export function inventory24h(html: string): { variants: number; parseErrors: number; sellable: number; lpi: number } {
  const out = { variants: 0, parseErrors: 0, sellable: 0, lpi: 0 }
  const m = /\bid\s*=\s*["']products_sub["'][^>]*?\bvalue\s*=\s*(?:'([^']*)'|"([^"]*)")/i.exec(html)
  if (!m) return out
  const blob = decodeEntities(m[1] ?? m[2] ?? '')
  for (const r of blob.matchAll(/response\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    out.variants++
    let j: unknown
    try { j = JSON.parse(r[1].replace(/\\"/g, '"')) } catch { out.parseErrors++; continue }
    if (Array.isArray(j)) {
      for (const x of j as Record<string, unknown>[]) if (SELLABLE_24H.test(String(x.NOTE ?? '').trim())) out.sellable += Number(x.QUANTITY) || 0
    } else if (j && typeof j === 'object' && Array.isArray((j as Record<string, unknown>).LoadProductInfo)) {
      for (const x of (j as { LoadProductInfo: Record<string, unknown>[] }).LoadProductInfo) out.lpi += Number(x.QUANTITY) || 0
    } else out.parseErrors++
  }
  return out
}

/**
 * Bạch Long Store — a removed product is a 200 "mess_notfound" shell ("Sản phẩm này không tồn tại , hết hạn hoặc đã
 * ngừng giao dịch", 13 of 16 removed) or a 404. Its stock flag is "1" on every page, so a live product is the buy control
 * `vnTCart.do_AddCart(<pro_id>,` with a price (`#ext_price` = `var price`) — 37/37; a pre-order name ("Hàng Đặt Trước")
 * or contact-for-price ("Liên hệ" with `var price = 0`) is not purchasable as listed.
 */
const bachlong: Rule = (read) => {
  const html = read.html
  const product = /id=["']proDetail["']/.test(html)
  if (/class=["']mess_notfound["']/.test(html) && !product) return unavailable('shop-not-found')
  if (!samePage(read)) return unknown('redirected')
  const pid = /var\s+pro_id\s*=\s*(\d+)\s*;/.exec(html)
  if (!product || !pid) return unknown('not-a-product-page')
  const tail = html.slice(pid.index, pid.index + 20_000)
  const vp = /var\s+price\s*=\s*(\d+)\s*;/.exec(tail)
  const ep = /id=["']ext_price["'][^>]*>\s*([^<]*?)\s*<\/div>/.exec(html)
  const name = (/<h1[^>]*class=["']bk-product-name["'][^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, '').normalize('NFC').trim() || undefined
  if (name && /đặt\s*trước|pre-?order/iu.test(name)) return unavailable('shop-preorder', name)
  if (ep && !/\d/.test(ep[1]) && vp && Number(vp[1]) === 0) return unavailable('no-price', name)
  const price = vp ? Number(vp[1]) : 0
  const shown = ep ? Number(ep[1].replace(/\D/g, '')) : NaN
  if (price > 0 && shown === price && /var\s+stock\s*=\s*["']?1["']?\s*;/.test(tail) && html.includes(`vnTCart.do_AddCart(${pid[1]},`)) {
    return available('buy-control', price, name)
  }
  return unknown('no-clear-state')
}

/**
 * Laptop Trung Hậu — it unpublishes a sold unit: the slug then serves a byte-identical 200 shell that opens with
 * `<script>window.location='https://laptoptrunghau.com/404.html'</script>`, an empty <title> and a canonical of
 * `https://laptoptrunghau.com/.htm` (all 5 showcase rows and 13 of 25 pool rows on 2026-10-17). A live unit: the one
 * Product node InStock with a price equal to the hidden price in `form[name=frmOrder]`, and its buy inputs (12/12).
 */
const laptoptrunghau: Rule = (read) => {
  const html = read.html
  const nodes = productNodes(html)
  const shell = /^\s*<script[^>]*>\s*window\.location(?:\.href)?\s*=\s*["']https?:\/\/(?:www\.)?laptoptrunghau\.com\/404\.html?["']/i.test(html.slice(0, 512))
    || (/<title>\s*<\/title>/i.test(html) && /<link\s+rel=["']canonical["']\s+href=["']https?:\/\/(?:www\.)?laptoptrunghau\.com\/\.htm["']/i.test(html))
  if (shell && !nodes.length) return unavailable('shop-not-found')
  if (/\/404\.html?$/i.test(new URL(read.finalUrl || read.url).pathname)) return unavailable('shop-not-found')
  const node = nodes[0]
  if (!node) return unknown('no-product-node')
  if (!samePage(read)) return unknown('redirected')
  const facts = offerFacts(node)
  const h1 = /<h1\s+class=["']product-name["']\s*>/i.exec(html)
  const block = h1 ? html.slice(h1.index).split(/<div\s+class=["']nxMargin product["']/i)[0] : ''
  const form = /<form\b[^>]*\bname=["']frmOrder["'][^>]*>([\s\S]*?)<\/form>/i.exec(block)?.[1] ?? ''
  const hidden = Number(/<input\b(?=[^>]*\bname=["']price["'])[^>]*\bvalue=["'](\d+)["']/i.exec(form)?.[1])
  const buy = /<input\b(?=[^>]*\bname=["'](?:bottomBuy|bottomaddcart)["'])(?![^>]*\bdisabled\b)[^>]*>/i.test(form)
  if (facts.availability === 'in' && facts.price && hidden === facts.price && buy) return available('buy-control', facts.price, nameOf(node))
  return unknown('no-clear-state')
}

/**
 * Điện Thoại Giá Kho — a Next.js pages-router site. The Product node is pinned by `sku` = the URL's trailing id, and the
 * main product's record in `__NEXT_DATA__` (pageProps.fallback['@"<slug>","detail",'] and its options) must agree:
 * InStock + publish + not outOfStock + a variant with stock → AVAILABLE (29/29); PreOrder + outOfStock + no stock → sold
 * out, shown as pre-order (10); Discontinued + publish:false → unpublished (3). ⚠️ A page not pre-rendered comes back as
 * the framework's fallback SHELL (200, the site's default title, no JSON-LD) — also for a product published after the
 * last deploy — so a shell is UNKNOWN, never gone (the data route that would decide it is not read in v1).
 */
const dienthoaigiakho: Rule = (read) => {
  const html = read.html
  let nd: Record<string, unknown> | null = null
  try { nd = JSON.parse(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? 'null') } catch { return unknown('next-data-unparsable') }
  if (!nd) return unknown('no-next-data')
  const slug = new URL(read.finalUrl || read.url).pathname.replace(/^\/+|\/+$/g, '')
  if (nd.isFallback === true) {
    // The page's own data route decides a shell (3/3 real shells answered publish:false; a fabricated id 404s with
    // {"notFound":true}). `buildId` comes from the shell itself, so it is the build that served it.
    return typeof nd.buildId === 'string' && /^[\w-]+$/.test(nd.buildId) && slug && samePage(read)
      ? { state: 'unknown', reason: 'fallback-shell', followUp: `https://dienthoaigiakho.vn/_next/data/${nd.buildId}/${slug}.json` }
      : unknown('fallback-shell')
  }
  if (!samePage(read)) return unknown('redirected')
  const id = /-(\d{9,})$/.exec(slug)?.[1]
  const prod = productNodes(html).filter((n) => id && String(n.sku) === id)
  if (prod.length !== 1) return unknown('product-node-unpinned')
  const pp = ((nd.props as Record<string, unknown> | undefined)?.pageProps ?? {}) as Record<string, unknown>
  const fallback = (pp.fallback ?? {}) as Record<string, unknown>
  const det = fallback[`@"${slug}","detail",`] as Record<string, unknown> | undefined
  const opts = (det ? fallback[`@"${det.id}","options",`] : undefined) as Record<string, unknown>[] | undefined
  const live = (opts ?? []).filter((o) => Number(o.stock) > 0 && o.deletedAt == null && o.disabledOrdering !== true)
  const off = [prod[0].offers].flat()[0] as Record<string, unknown> | undefined
  const avail = String(off?.availability ?? '').split(/[/#]/).pop()
  const name = nameOf(prod[0])
  if (avail === 'Discontinued' && det?.publish === false) return unavailable('shop-sold', name)
  if (avail === 'PreOrder' && det?.outOfStock === true && live.length === 0) return unavailable('shop-preorder', name)
  const price = Number(off?.price)
  // The price WRITTEN only when the variants on sale agree (secondhand-page.ts offerFacts' onePrice rule).
  if (avail === 'InStock' && det?.publish === true && det.outOfStock === false && live.length > 0 && price > 0) return available('stock', agreed(live, Math.round(price)), name)
  return unknown('signals-disagree')
}

/**
 * Điện Thoại Giá Kho's data route for a fallback shell: 200 JSON with the same pageProps (pageType 1 = a product) — the
 * same detail/options test, priced only where the variants in stock agree; 404 `{"notFound":true}` — no such product; a 404 in
 * HTML is Next's own page, i.e. a stale buildId (proven with a wrong one), so UNKNOWN.
 */
/** The one price the in-stock variants agree on (else `fallback` when none carries one) — never the cheapest of several. */
function agreed(live: Record<string, unknown>[], fallback?: number): number | undefined {
  const prices = new Set(live.map((o) => Math.round(Number(o.salePrice))).filter((n) => n > 0))
  return prices.size === 1 ? [...prices][0] : prices.size === 0 ? fallback : undefined
}

const dienthoaigiakhoData = (page: PageRead, data: PageRead): Verdict => {
  if (data.error) return unknown(`data-fetch-error: ${data.error.slice(0, 60)}`)
  if (data.status === 404) return data.html.trim() === '{"notFound":true}' ? unavailable('shop-not-found') : unknown('stale-build')
  if (data.status !== 200) return unknown(`data-http-${data.status}`)
  let j: Record<string, unknown>
  try { j = JSON.parse(data.html) } catch { return unknown('data-unparsable') }
  const pp = (j.pageProps ?? {}) as Record<string, unknown>
  if (pp.pageType !== 1) return unknown('data-not-a-product')
  const slug = new URL(page.finalUrl || page.url).pathname.replace(/^\/+|\/+$/g, '')
  const fallback = (pp.fallback ?? {}) as Record<string, unknown>
  const det = fallback[`@"${slug}","detail",`] as Record<string, unknown> | undefined
  const opts = (det ? fallback[`@"${det.id}","options",`] : undefined) as Record<string, unknown>[] | undefined
  const live = (opts ?? []).filter((o) => Number(o.stock) > 0 && o.deletedAt == null && o.disabledOrdering !== true)
  const name = typeof det?.name === 'string' ? clean(det.name) || undefined : undefined
  if (det?.publish === false) return unavailable('shop-sold', name)
  if (det?.outOfStock === true && live.length === 0) return unavailable('shop-preorder', name)
  const priced = live.some((o) => Number(o.salePrice) > 0)
  if (det?.publish === true && det.outOfStock === false && priced) return available('stock-data', agreed(live), name)
  return unknown('signals-disagree')
}

/**
 * Di Động Việt — its JSON-LD is honest (47/47 reads agreed with the RSC payload and the buy row) once pinned to the
 * page: the Product whose url is the FINAL URL (a renamed slug 308s to the same phone). OutOfStock pages have no
 * "MUA NGAY"; an OutOfStock beside one is a contradiction, so UNKNOWN.
 */
const didongviet: Rule = (read) => {
  const html = read.html
  if (/<html[^>]*\sid=["']__next_error__["']/i.test(html)) return unknown('error-shell')
  const page = normUrl(read.finalUrl || read.url)
  const node = productNodes(html).find((n) => normUrl(String(n.url ?? n['@id'] ?? '')) === page)
  if (!node) return unknown('no-scoped-product')
  const facts = offerFacts(node)
  const name = nameOf(node)
  const buyNow = />\s*MUA NGAY\s*</.test(html)
  if (facts.availability === 'out') return buyNow ? unknown('signals-disagree') : unavailable('jsonld-out-of-stock', name)
  if (facts.availability === 'in' && facts.price) return available('jsonld-in-stock', facts.onePrice, name, samePage(read) ? undefined : read.finalUrl)
  return unknown('no-clear-state')
}

/** A rule's second look, for the shops whose rules can hand back a `followUp` URL: (the page, the follow-up's answer). */
export const SHOP_FOLLOW_UPS: Record<string, (page: PageRead, data: PageRead) => Verdict> = {
  'dienthoaigiakho.vn': dienthoaigiakhoData,
}

/** The shops whose pages need their own reading; every other shop gets the generic JSON-LD reader. */
export const SHOP_PAGE_RULES: Record<string, Rule> = {
  'minhtuanmobile.com': minhtuan,
  'mayanh24h.com': mayanh24h,
  '24hstore.vn': h24,
  'bachlongstore.vn': bachlong,
  'laptoptrunghau.com': laptoptrunghau,
  'dienthoaigiakho.vn': dienthoaigiakho,
  'didongviet.vn': didongviet,
}
