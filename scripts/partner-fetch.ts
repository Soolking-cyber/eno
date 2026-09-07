/**
 * FETCH A PARTNER SHOP'S CATALOGUE — the shops that are NOT on an affiliate network.
 *
 *   npx tsx scripts/partner-fetch.ts --store phuongtin.vn            # DRY RUN, prints a sample
 *   npx tsx scripts/partner-fetch.ts --store phuongtin.vn --out x.json
 *   npx tsx scripts/partner-fetch.ts --all --out staging.json
 *
 * ⛔ IT FETCHES AND STAGES. IT DOES NOT PUBLISH. Writing these products into `Listing` rows is a
 * separate, deliberate step (`--apply` on the importer that consumes this file), because every one
 * of these shops is marked "Not contact yet" in the owner's own sheet. Their photos and copy are
 * theirs; a staged JSON the owner can read is the artefact that lets a partnership conversation
 * happen BEFORE anything of theirs appears on a licensed sàn TMĐT under their name.
 *
 * ⛔ WHY THERE ARE ONLY THREE ADAPTERS FOR TWENTY-ODD SHOPS. Recon measured the platforms: they are
 * overwhelmingly WooCommerce and Haravan/Sapo, both of which ship a STANDARD read-only product API.
 * One adapter each covers most of the list, and neither parses HTML — so a shop redesigning its
 * theme does not break the import. Only the custom-PHP and Next.js shops need the slower
 * sitemap→JSON-LD path, which is deliberately not in this first cut.
 *
 * ⚠️ EVERY CONFIG IN partner-stores.json WAS PROVEN BY FETCHING TWO REAL PRODUCTS THROUGH IT.
 * A guessed endpoint that 404s is worse than an honest gap, so nothing is listed there on
 * inference — see each entry's `note` for what was measured and what it cost.
 */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type StoreConfig = {
  domain: string
  name: string
  city: string
  adapter: 'woocommerce' | 'haravan' | 'sapo' | 'sitemap-jsonld'
  /** sitemap-jsonld only: the sitemap(s) to enumerate, and a regex a product URL must match. */
  sitemaps?: string[]
  urlMatch?: string
  endpoint: string
  note?: string
}

/** The one shape every adapter normalises to — deliberately the same fields the AccessTrade feed
 *  row carries, so the writer that consumes this file is the one already proven on 9,700 rows. */
export type PartnerProduct = {
  domain: string
  externalId: string
  name: string
  price: number
  url: string
  /**
   * ⛔ UP TO FIVE, NOT ONE — owner, 2026-09-08: *"also fetch at least 5 images for each new
   * listings"*. It is also what the app's own publish gate wants: `assertEnoughAngles`
   * (publish-guard.ts) requires ≥3 DIFFERENT-angle photos on a human's listing, and a one-photo
   * imported listing looks thinner than anything a real seller can post.
   * ⚠️ The FIRST entry stays the cover; order is the merchant's own.
   */
  images: string[]
  desc: string
  inStock: boolean
}

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const ALL = process.argv.includes('--all')
const STORE = arg('store')
const OUT = arg('out')
const LIMIT = Number(arg('limit') ?? 0)

/**
 * ⚠️ A TRUTHFUL USER-AGENT, AND IT IS NOT A COURTESY. These shops are prospective PARTNERS, and the
 * marketplace fetching them is identifying itself so a sysadmin who looks at a log can tell what
 * this is and, if they object, block it. Spoofing a browser to look like a person is the thing that
 * turns an integration into an incident.
 */
const UA = 'Mozilla/5.0 (compatible; eno-partner-fetch/1.0; +https://eno.vn)'
/** Politeness gap between requests to the SAME host. These are small shops on shared hosting. */
const DELAY_MS = 1200
/** Owner asked for at least 5; the cap keeps a 40-photo gallery from costing 40 uploads. */
const MAX_IMAGES = 5
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * ⛔ TITLES CARRY HTML, NOT JUST DESCRIPTIONS — and the first cut only cleaned the description.
 * Measured on the very first live fetch: WooCommerce returned `Dell Precision 3480<br />(i7 1370P/
 * 16GB/ SSD 512GB…` and `Panasonic Let&#8217;s Note CF-SV1`. Those would have become listing
 * titles verbatim — a `<br />` rendered as literal text, and a mojibake apostrophe — across every
 * product of every WooCommerce shop on the list.
 *
 * ⚠️ TAGS BECOME A SPACE, NOT NOTHING. `3480<br />(i7` collapses to "3480(i7" if the tag is simply
 * deleted; the separator it stood for is part of the meaning.
 *
 * ⚠️ ENTITIES ARE DECODED AFTER STRIPPING, never before — decoding first would turn an encoded
 * `&lt;script&gt;` into a real tag that the stripper then removes, which is the wrong order for a
 * value that ends up in a title.
 */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—',
}
function clean(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()
}

async function get(url: string): Promise<Response> {
  return fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(45_000) })
}

/**
 * WooCommerce Store API — the public, read-only one (`/wp-json/wc/store/...`), which needs no key
 * and is a documented part of WooCommerce rather than anything reverse-engineered.
 *
 * ⚠️ PRICES ARE MINOR UNITS AND MUST BE DIVIDED. `prices.price` is a STRING in the smallest unit
 * with `prices.currency_minor_unit` saying how many decimals — for VND that is 0, but several of
 * these shops report 2, so a raw Number() would list a 15,000,000 ₫ laptop at 1,500,000,000 ₫.
 * The divisor is read per response, never assumed.
 *
 * ⚠️ PAGINATION STOPS ON THE HEADER, NOT ON A GUESS. `X-WP-TotalPages` is authoritative; the empty
 * -array check is the belt-and-braces second condition. Two of these shops also emit a MANGLED
 * `Link: rel="next"` (`...&page=2#038;per_page=100`), so that header is deliberately not followed.
 */
async function fetchWoo(cfg: StoreConfig): Promise<PartnerProduct[]> {
  const out: PartnerProduct[] = []
  let totalPages = 1
  for (let page = 1; page <= totalPages; page++) {
    const res = await get(cfg.endpoint.replace('{page}', String(page)))
    if (!res.ok) { console.error(`  ${cfg.domain} page ${page}: HTTP ${res.status}`); break }
    if (page === 1) {
      const tp = Number(res.headers.get('x-wp-totalpages') || '1')
      totalPages = Number.isFinite(tp) && tp > 0 ? tp : 1
      console.log(`  ${cfg.domain}: X-WP-Total=${res.headers.get('x-wp-total') ?? '?'} pages=${totalPages}`)
    }
    const rows = (await res.json()) as Record<string, unknown>[]
    if (!Array.isArray(rows) || !rows.length) break
    for (const r of rows) {
      const prices = (r.prices ?? {}) as Record<string, unknown>
      const minor = Number(prices.currency_minor_unit ?? 0)
      const raw = Number(prices.price ?? NaN)
      const price = Number.isFinite(raw) ? raw / 10 ** (Number.isFinite(minor) ? minor : 0) : NaN
      const images = (r.images ?? []) as { src?: string }[]
      const srcs = images.map((i) => i?.src).filter((u): u is string => !!u && u.startsWith('http')).slice(0, MAX_IMAGES)
      out.push({
        domain: cfg.domain,
        externalId: String(r.id ?? ''),
        name: clean(String(r.name ?? '')),
        price,
        url: String(r.permalink ?? ''),
        images: srcs,
        desc: clean(String(r.short_description ?? r.description ?? '')),
        inStock: r.is_in_stock !== false,
      })
    }
    if (LIMIT && out.length >= LIMIT) break
    await sleep(DELAY_MS)
  }
  return out
}

/**
 * Haravan and Sapo both serve Shopify's `/collections/<handle>/products.json`.
 *
 * ⛔ THE SERVER CAPS THE PAGE AT 50 REGARDLESS OF `limit=250`, MEASURED ON BOTH PLATFORMS. So the
 * stop condition is "fewer than 50 came back", NOT "fewer than the limit I asked for" — the latter
 * stops on the very first page and imports 50 of 178 products while reporting success.
 *
 * ⚠️ Haravan 404s the ROOT `/products.json` that Shopify serves; only the per-collection form
 * works, which is why every Haravan entry in the config names a collection handle.
 */
async function fetchHaravan(cfg: StoreConfig): Promise<PartnerProduct[]> {
  const out: PartnerProduct[] = []
  const PAGE_CAP = 50
  for (let page = 1; page <= 200; page++) {
    const res = await get(cfg.endpoint.replace('{page}', String(page)))
    if (!res.ok) { console.error(`  ${cfg.domain} page ${page}: HTTP ${res.status}`); break }
    const body = (await res.json()) as { products?: Record<string, unknown>[] }
    const rows = body.products ?? []
    if (!rows.length) break
    for (const r of rows) {
      const variants = (r.variants ?? []) as Record<string, unknown>[]
      /**
       * ⛔ SAPO SERVES THE SAME ENDPOINT WITH A DIFFERENT SCHEMA, AND THE FIRST CUT ASSUMED
       * SHOPIFY'S. Measured on hshop.vn: `title` is `name`, `images` is an array of PLAIN STRINGS
       * rather than `{src}` objects, `handle` is `alias`, and a ready-made `url` is supplied.
       * Every one of its 1,089 rows came back with an empty title and was dropped — 1,089 fetched,
       * 0 usable. The drop was correct (a blank-titled listing is worse than none) but the cause
       * was this mapping, not the shop. Both shapes are read now; neither platform is guessed at.
       */
      const title = clean(String(r.title ?? r.name ?? ''))
      const rawImages = (r.images ?? []) as unknown[]
      const srcs = rawImages
        .map((i) => (typeof i === 'string' ? i : (i as { src?: string } | undefined)?.src))
        .filter((u): u is string => !!u && u.startsWith('http'))
        .slice(0, MAX_IMAGES)
      const slug = String(r.handle ?? r.alias ?? '')
      const url = typeof r.url === 'string' && r.url.startsWith('http')
        ? r.url
        : `https://${cfg.domain}/products/${slug}`
      // The cheapest priced variant is the shop's own headline price; 0 means "Liên hệ".
      const prices = variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0)
      const productPrice = Number(r.price)
      out.push({
        domain: cfg.domain,
        externalId: String(r.id ?? ''),
        name: title,
        // ⚠️ Sapo also carries a product-level `price`; it is the fallback for a row whose
        // variants are all unpriced, not a replacement for the per-variant minimum.
        price: prices.length ? Math.min(...prices) : (Number.isFinite(productPrice) ? productPrice : 0),
        url,
        images: srcs,
        desc: clean(String(r.body_html ?? r.content ?? r.summary ?? '')),
        inStock: variants.some((v) => v.available !== false) || r.available === true,
      })
    }
    if (rows.length < PAGE_CAP) break
    if (LIMIT && out.length >= LIMIT) break
    await sleep(DELAY_MS)
  }
  return out
}

/**
 * SITEMAP → JSON-LD, for the shops with no product API.
 *
 * ⛔ SLOW BY CONSTRUCTION AND THAT IS THE POINT. One HTTP request PER PRODUCT, spaced by the same
 * politeness delay as everything else — 500 products is ten minutes. The API adapters above fetch
 * a hundred products per request; this one exists only for shops that offer no such thing, and the
 * configs deliberately point it at each shop's USED subset rather than its whole catalogue, because
 * "3,276 products at 1.2s each" is 65 minutes of someone else's bandwidth for stock we did not ask
 * them about.
 *
 * ⛔ A SITEMAP IS NOT A CENSUS, AND ONE OF THESE SHOPS PROVES IT. laptoptrunghau.com's sitemap is
 * stale since 2022 and its dead slugs return HTTP 200 with an EMPTY page shell — a soft 404 whose
 * JSON-LD is `@type: NewsArticle` with a placeholder image. Anything without a real Product block
 * and a positive price is dropped rather than imported as a blank listing; that check is what
 * stands between a stale sitemap and a poisoned catalogue.
 *
 * ⚠️ JSON-LD COMES IN THREE SHAPES and all three are live on these sites: a bare Product object, an
 * @graph array containing one, and a top-level array. Handling only the first finds nothing on
 * roughly half of them.
 */
function findProductNode(json: unknown): Record<string, unknown> | null {
  const isProduct = (n: unknown): n is Record<string, unknown> => {
    if (!n || typeof n !== 'object') return false
    const t = (n as Record<string, unknown>)['@type']
    return t === 'Product' || (Array.isArray(t) && t.includes('Product'))
  }
  if (isProduct(json)) return json
  if (Array.isArray(json)) { for (const n of json) { const f = findProductNode(n); if (f) return f } return null }
  if (json && typeof json === 'object') {
    const g = (json as Record<string, unknown>)['@graph']
    if (Array.isArray(g)) { for (const n of g) { const f = findProductNode(n); if (f) return f } }
  }
  return null
}

/** `offers` is an object, an array, or an AggregateOffer — price lives in a different place in each. */
function priceFrom(node: Record<string, unknown>): number {
  const offers = node.offers
  const pick = (o: unknown): number => {
    if (!o || typeof o !== 'object') return NaN
    const r = o as Record<string, unknown>
    for (const k of ['price', 'lowPrice', 'highPrice']) {
      const v = Number(String(r[k] ?? '').replace(/[^\d.]/g, ''))
      if (Number.isFinite(v) && v > 0) return v
    }
    return NaN
  }
  if (Array.isArray(offers)) { for (const o of offers) { const v = pick(o); if (Number.isFinite(v)) return v } return NaN }
  return pick(offers)
}

/** ⚠️ JSON-LD `image` is a string, an array of strings, an ImageObject, or an array of those. */
function imagesFrom(node: Record<string, unknown>): string[] {
  const one = (v: unknown): string =>
    typeof v === 'string' ? v : (v && typeof v === 'object' ? String((v as Record<string, unknown>).url ?? '') : '')
  const img = node.image
  const list = Array.isArray(img) ? img.map(one) : [one(img)]
  return list.filter((u) => u.startsWith('http')).slice(0, MAX_IMAGES)
}

/**
 * Gallery images from the page HTML we already hold.
 *
 * ⛔ JSON-LD USUALLY CARRIES ONE IMAGE, so the Product block alone cannot satisfy "at least 5".
 * These shops do have galleries — they just do not describe them in structured data. This reads
 * `og:image` plus the `<img>` tags already in the response, so it costs NO extra request.
 *
 * ⚠️ SAME-HOST AND SAME-DIRECTORY AS THE PRODUCT IMAGE, which is the filter that keeps logos,
 * banners, payment badges and "related product" thumbnails out. Without it a gallery harvest turns
 * every listing's second photo into the shop's own logo — worse than having one honest photo.
 */
function galleryFrom(html: string, seed: string, productUrl: string): string[] {
  const out: string[] = []
  const push = (u: string) => { if (u.startsWith('http') && !out.includes(u)) out.push(u) }
  for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi)) push(m[1])

  /**
   * ⛔ READ `data-src` TOO — THE GALLERY IS LAZY-LOADED. Measured on minhtuanmobile: the product
   * page carries 320 `<img src>` tags (chrome, icons, related-product thumbnails) and the actual
   * gallery lives in NINE `data-src` attributes. A `src`-only harvest returns the page furniture
   * and misses every real photo.
   */
  const attrs = /(?:\bsrc|\bdata-src|\bdata-lazy|\bdata-original)=["']([^"']+)["']/gi

  /**
   * ⛔ SAME REGISTRABLE DOMAIN, NOT SAME DIRECTORY — the first version compared path prefixes and
   * found nothing, because these shops serve the gallery from a CDN SUBDOMAIN on a different path:
   * the Product image is `minhtuanmobile.com/uploads/products/…` while the gallery is
   * `static.minhtuanmobile.com/uploads/editer/…`. Matching the last two domain labels keeps the
   * merchant's own images and still excludes third-party CDNs.
   */
  let root = ''
  try { root = new URL(seed).hostname.split('.').slice(-2).join('.') } catch { /* seed may be empty */ }
  if (!root) return out.slice(0, MAX_IMAGES)

  /**
   * ⛔ A PRODUCT PAGE IS MOSTLY OTHER PRODUCTS. Measured on one iPhone X page: 265 candidate images
   * survived the host and junk filters, and they were MONITORS — `man-hinh-asus`, `dell`, `aoc`,
   * `viewsonic` — from the "related products" carousel. Host, extension and filename-keyword rules
   * cannot tell a recommendation from the gallery, so slicing the first five shipped badges and
   * other people's monitors as this phone's photos.
   *
   * The signal that does work is the product's own SLUG: a real gallery image is named after the
   * product it belongs to (`iphone-x-64gb-cu-dep-6.png` under `/iphone-x-cu-dep/`), a carousel
   * thumbnail is not. Two shared tokens is the threshold — one is too loose ("cu" appears in half
   * this catalogue), three misses images that abbreviate the name.
   */
  const tokens = (productUrl.replace(/\/+$/, '').split('/').pop() ?? '')
    .split('-').filter((t) => t.length >= 3)
  for (const m of html.matchAll(attrs)) {
    const u = m[1]
    if (tokens.length) {
      const file = (u.split('/').pop() ?? '').toLowerCase()
      if (tokens.filter((t) => file.includes(t)).length < 2) continue
    }
    if (!/^https?:\/\//.test(u)) continue
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(u)) continue
    // ⚠️ `slide` is in this list because the measured page serves its homepage BANNER carousel from
    // /uploads/slide/ via the same lazy attribute — a promo image would otherwise become a product photo.
    if (/logo|banner|icon|avatar|placeholder|no-?img|sprite|slide|thumb_|payment|qr-/i.test(u)) continue
    try { if (!new URL(u).hostname.endsWith(root)) continue } catch { continue }
    push(u)
  }
  return out.slice(0, MAX_IMAGES)
}

async function fetchSitemapJsonLd(cfg: StoreConfig): Promise<PartnerProduct[]> {
  const urls = new Set<string>()
  const match = cfg.urlMatch ? new RegExp(cfg.urlMatch) : null
  for (const sm of cfg.sitemaps ?? []) {
    const res = await get(sm)
    if (!res.ok) { console.error(`  sitemap ${sm}: HTTP ${res.status}`); continue }
    const xml = await res.text()
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const u = m[1]
      if (!match || match.test(u)) urls.add(u)
    }
    await sleep(DELAY_MS)
  }
  const list = [...urls].slice(0, LIMIT || undefined)
  console.log(`  ${cfg.domain}: ${urls.size} product URLs matched${LIMIT ? `, taking ${list.length}` : ''}`)

  const out: PartnerProduct[] = []
  let noLd = 0
  for (const url of list) {
    try {
      const res = await get(url)
      if (!res.ok) { await sleep(DELAY_MS); continue }
      const html = await res.text()
      let node: Record<string, unknown> | null = null
      for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        try { node = findProductNode(JSON.parse(m[1].trim())) } catch { /* a malformed block is not fatal */ }
        if (node) break
      }
      if (!node) { noLd++; await sleep(DELAY_MS); continue }
      out.push({
        domain: cfg.domain,
        /**
         * ⚠️ THE URL FALLBACK STRIPS A TRAILING SLASH FIRST. Several of these shops serve
         * `/iphone-x-cu-dep/`, where a bare `split('/').pop()` returns the EMPTY STRING — so every
         * product without a SKU would collapse onto one blank externalId and overwrite each other
         * on import. Measured: minhtuanmobile publishes real SKUs so the fallback never fires
         * there, but the next shop may not, and the failure is silent.
         */
        externalId: String(node.sku || node.mpn || node.productID || url.replace(/\/+$/, '').split('/').pop() || ''),
        name: clean(String(node.name ?? '')),
        price: priceFrom(node),
        url,
        // JSON-LD first (the merchant's declared product image), then the page gallery to reach 5.
        images: [...new Set([...imagesFrom(node), ...galleryFrom(html, imagesFrom(node)[0] ?? '', url)])].slice(0, MAX_IMAGES),
        desc: clean(String(node.description ?? '')),
        inStock: !/OutOfStock|SoldOut/i.test(JSON.stringify(node.offers ?? '')),
      })
    } catch { /* one bad page must not end the run */ }
    await sleep(DELAY_MS)
  }
  if (noLd) console.log(`  ${cfg.domain}: ${noLd} pages had no Product JSON-LD (stale sitemap entries / soft 404s)`)
  return out
}

async function fetchStore(cfg: StoreConfig): Promise<PartnerProduct[]> {
  console.log(`\n${cfg.name} (${cfg.domain}) — ${cfg.adapter}`)
  const rows = cfg.adapter === 'woocommerce' ? await fetchWoo(cfg)
    : cfg.adapter === 'sitemap-jsonld' ? await fetchSitemapJsonLd(cfg)
    : await fetchHaravan(cfg)
  /**
   * ⛔ A ZERO PRICE RENDERS AS "Free / Miễn phí" ON A CARD (src/components/marketplace/price.tsx),
   * so a "Liên hệ" product must be dropped, not imported at zero. Same rule the AccessTrade
   * importer applies, for the same reason. Measured: this drops ~55% of digiphone.vn.
   */
  /**
   * ⛔ AN IMAGE THAT APPEARS ON MANY PRODUCTS IS NOT A PRODUCT PHOTO. The gallery harvest pulled
   * `uploads/items/hot-260414020222.png` — a "HOT" promo badge — as the SECOND image of every
   * minhtuanmobile listing, identical across all of them. No path or filename rule catches that
   * generically (it lives under /uploads/items/ alongside real photos), but the repetition does:
   * a genuine product photo belongs to one product.
   *
   * ⚠️ THE COVER IS NEVER DROPPED. Index 0 is the merchant's declared product image; a small shop
   * legitimately reusing one photo across variants must not lose its only picture.
   */
  const seen = new Map<string, number>()
  for (const r of rows) for (const u of r.images.slice(1)) seen.set(u, (seen.get(u) ?? 0) + 1)
  const SHARED = Math.max(3, Math.ceil(rows.length * 0.02))
  const shared = new Set([...seen].filter(([, n]) => n >= SHARED).map(([u]) => u))
  if (shared.size) console.log(`  ${cfg.domain}: dropped ${shared.size} shared asset(s) (badges/banners on ${SHARED}+ products)`)
  for (const r of rows) r.images = [r.images[0], ...r.images.slice(1).filter((u) => !shared.has(u))].filter(Boolean)

  const priced = rows.filter((r) => Number.isFinite(r.price) && r.price > 0 && r.images.length > 0 && r.name)
  console.log(`  fetched ${rows.length}, usable ${priced.length} (dropped ${rows.length - priced.length}: no price, no image, or no title)`)
  return LIMIT ? priced.slice(0, LIMIT) : priced
}

async function main() {
  const cfgPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'partner-stores.json')
  const stores = JSON.parse(readFileSync(cfgPath, 'utf8')) as StoreConfig[]
  const targets = ALL ? stores : stores.filter((s) => s.domain === STORE)
  if (!targets.length) {
    console.error(STORE ? `no config for "${STORE}"` : 'pass --store <domain> or --all')
    console.error(`known: ${stores.map((s) => s.domain).join(', ')}`)
    process.exit(1)
  }

  const all: PartnerProduct[] = []
  for (const cfg of targets) {
    try { all.push(...(await fetchStore(cfg))) }
    catch (e) { console.error(`  ${cfg.domain} FAILED: ${(e as Error).message}`) }
  }

  console.log(`\n${'='.repeat(60)}\ntotal usable products: ${all.length}`)
  const byDomain = new Map<string, number>()
  for (const p of all) byDomain.set(p.domain, (byDomain.get(p.domain) ?? 0) + 1)
  for (const [d, n] of byDomain) console.log(`  ${d.padEnd(26)} ${n}`)

  if (OUT) {
    writeFileSync(OUT, JSON.stringify(all, null, 1))
    console.log(`\nstaged → ${OUT}   (nothing published; review before importing)`)
  } else {
    console.log('\nsample:')
    for (const p of all.slice(0, 8)) console.log(`  ${String(Math.round(p.price)).padStart(12)} ₫  ${p.name.slice(0, 58)}`)
    console.log('\nno --out given, so nothing was written.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
