/**
 * PARTNER-SHOP CATALOGUE ADAPTERS — WooCommerce, Haravan/Sapo, and sitemap→JSON-LD.
 *
 * ⛔ EXTRACTED FROM scripts/partner-fetch.ts SO THE DAILY CRON CAN USE THEM. That script calls
 * `main()` at module load, so importing anything out of it would run a full 9,235-product scrape of
 * thirteen shops as a side effect — the same trap that moved the taxonomy rules into
 * src/lib/feed-taxonomy.ts. The behaviour here is the script's, unchanged: same adapters, same
 * politeness delay, same honest user-agent, same five-image cap.
 *
 * ⛔ THIS MODULE FETCHES. IT DOES NOT WRITE. Turning these products into `Listing` rows is
 * scripts/import-partners.ts, and refreshing price/stock on rows that already exist is
 * /api/cron/partner-stock. Keeping the reader free of database access is what lets both callers
 * share it without either inheriting the other's failure modes.
 *
 * ⚠️ EVERY CONFIG IN scripts/partner-stores.json WAS PROVEN BY FETCHING TWO REAL PRODUCTS THROUGH
 * IT. A guessed endpoint that 404s is worse than an honest gap — see each entry's `note` for what
 * was measured and what it cost.
 */
export type StoreConfig = {
  domain: string
  name: string
  city: string
  adapter: 'woocommerce' | 'haravan' | 'sapo' | 'sitemap-jsonld' | 'collection-crawl'
  /** sitemap-jsonld only: the sitemap(s) to enumerate. */
  sitemaps?: string[]
  /** collection-crawl only: the USED-stock collection pages to page through. */
  collections?: string[]
  /** collection-crawl only: how this theme paginates. `{n}` is the page number. */
  pageParam?: string
  /** collection-crawl only: stop after this many pages per collection (default 40). */
  maxPages?: number
  /** Both URL-discovery adapters: a regex a product URL must match. */
  urlMatch?: string
  /**
   * A regex with ONE capture group holding the price, read from the page HTML when the shop's
   * JSON-LD carries a Product node but no usable `offers`.
   *
   * ⛔ PER-SHOP AND EXPLICIT, NEVER A GENERIC "FIND A NUMBER FOLLOWED BY đ". A product page is
   * full of prices that are not this product's — a struck-through was-price, a discount
   * percentage, an accessory rail, a "customers also bought" row. bachlongstore.vn publishes
   * BOTH `id="ext_price"` and `id="ext_price_old"`, so a loose pattern picks the old price about
   * as often as the real one and nothing downstream can tell. Each shop's selector is proven
   * against real pages before it is written here.
   */
  htmlPrice?: string
  /**
   * Where `externalId` comes from. Default `slug` — the last path segment.
   *
   * ⛔ SET THIS TO `path` FOR ANY SHOP THAT PUTS PART OF THE SPEC IN ITS OWN PATH SEGMENT.
   * bachlongstore.vn writes `/samsung-galaxy-z-fold7-12gb/512gb-cu.html`, so 298 of its 2,517
   * products end in a segment like `512gb-cu.html` that several other products also end in — 38
   * collision groups over 169 products. The slug is not an identity there, and the collision
   * guard would drop every affected row and mark the read incomplete forever. It is a per-shop
   * DECLARATION rather than something detected per run, because identity must not depend on
   * which products a given run happened to fetch.
   */
  idFrom?: 'slug' | 'path'
  endpoint: string
  note?: string
  /** ⚠️ A CLAIM ABOUT THE GOODS, from the endpoint's own evidence — `null` where there is none. */
  condition: 'used' | 'new' | null
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
/**
 * How much of a read may fail before its absences stop meaning anything. A merchant's sitemap
 * carrying a few dead slugs is ordinary; a host that starts refusing halfway through is not.
 */
const MAX_READ_FAILURE_RATE = 0.02
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * ⛔ "THE SHOP NO LONGER LISTS IT" AND "I COULD NOT READ THAT PAGE" ARE THE SAME SHAPE — AN ABSENT
 * PRODUCT — AND ONLY ONE OF THEM MAY RETIRE A LISTING. Every adapter swallows a bad page so one
 * 503 cannot end a 3,596-product read; that is right, but it means a partial catalogue is returned
 * looking exactly like a complete one. The daily job retires what it did not see, so it MUST be
 * able to tell the difference: a shop that rate-limits at 02:00 ICT would otherwise mark its unread
 * tail sold every night, and those rows can never come back because the same tail fails again.
 * Four reviewers converged on this from the diff alone.
 *
 * ⛔ AND IT IS PER-INVOCATION, NOT MODULE STATE. The first cut kept a module-level `Set<domain>`
 * that each call cleared on entry: two overlapping runs of the same shop — a manual re-run beside
 * the nightly timer — had one delete the other's failure flag, and the loser then reported a
 * partial read as complete and retired its unread tail. A tally threaded through the call cannot
 * race, and counting attempts rather than setting a boolean is what lets a single dead URL be
 * distinguished from a shop that stopped answering.
 */
/**
 * ⛔ TWO KINDS OF FAILURE, AND COLLAPSING THEM INTO ONE RATE WAS WRONG IN BOTH DIRECTIONS.
 *
 * `fatal` — an ENUMERATION broke: a paginated endpoint returned an error mid-walk, or a sitemap
 * index would not load. We then do not know WHAT we did not see, only that it was probably a lot.
 * One failed sitemap out of two is a single failed request but can be half the catalogue, so as a
 * rate it dissolved to well under 2% and authorised retiring every product it contained. It is not
 * a rate; it is "this read has an unknown hole in it", and nothing may be retired on the strength
 * of it.
 *
 * `attempted`/`failed` — individual PRODUCT pages, where a rate is exactly right: a merchant's
 * sitemap always carries a few dead slugs, and refusing to reconcile over one permanent 404 would
 * disable the pass for ever, while losing 30% of the pages says nothing about the other 70%.
 */
type ReadLog = { attempted: number; failed: number; fatal: boolean }
/** A fresh tally per `fetchStore` call — see the note above on why this is not module state. */
const newReadLog = (): ReadLog => ({ attempted: 0, failed: 0, fatal: false })

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
async function fetchWoo(cfg: StoreConfig, LIMIT: number, log: ReadLog): Promise<PartnerProduct[]> {
  const out: PartnerProduct[] = []
  let totalPages = 1
  for (let page = 1; page <= totalPages; page++) {
    const res = await get(cfg.endpoint.replace('{page}', String(page)))
    // ⛔ FATAL, NOT A COUNTED FAILURE: the walk stops here and the rest of the catalogue is unread.
    if (!res.ok) { console.error(`  ${cfg.domain} page ${page}: HTTP ${res.status}`); log.fatal = true; break }
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
async function fetchHaravan(cfg: StoreConfig, LIMIT: number, log: ReadLog): Promise<PartnerProduct[]> {
  const out: PartnerProduct[] = []
  const PAGE_CAP = 50
  for (let page = 1; page <= 200; page++) {
    const res = await get(cfg.endpoint.replace('{page}', String(page)))
    // ⛔ FATAL, NOT A COUNTED FAILURE — see fetchWoo. `log.attempted` was never incremented here at
    // all, which forced the rate to 0/0 = 0 and made EVERY partial Haravan read report complete.
    if (!res.ok) { console.error(`  ${cfg.domain} page ${page}: HTTP ${res.status}`); log.fatal = true; break }
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
  /**
   * ⛔ `@type` IS OFTEN THE FULLY-QUALIFIED URI, NOT THE BARE WORD. schema.org permits both, and
   * comparing against the string 'Product' silently rejects every shop that emits the URI form.
   * MEASURED 2026-09-10: zshop.vn publishes `"@type": "http://schema.org/Product"` on every
   * product page, so a crawl that found 70 real product URLs reported "18 of 18 pages had no
   * Product JSON-LD" — a whole shop reading as unreachable because of a prefix. Compare the LAST
   * path segment, which is the type name in either spelling.
   */
  const typeName = (t: unknown) => String(t).split(/[/#]/).pop()
  const isProduct = (n: unknown): n is Record<string, unknown> => {
    if (!n || typeof n !== 'object') return false
    const t = (n as Record<string, unknown>)['@type']
    const names = Array.isArray(t) ? t.map(typeName) : [typeName(t)]
    return names.some((x) => x === 'Product' || x === 'IndividualProduct')
  }
  if (isProduct(json)) return json
  if (Array.isArray(json)) { for (const n of json) { const f = findProductNode(n); if (f) return f } return null }
  if (json && typeof json === 'object') {
    const g = (json as Record<string, unknown>)['@graph']
    if (Array.isArray(g)) { for (const n of g) { const f = findProductNode(n); if (f) return f } }
  }
  return null
}

/**
 * The price a shop prints in its HTML, for the shops whose JSON-LD omits it.
 *
 * ⚠️ MEASURED NEED, NOT A PRECAUTION: bachlongstore.vn publishes a complete Product node — name,
 * brand, description, aggregateRating — and NO `offers` at all, so every one of its 2,500
 * products parsed to price 0 and was dropped. The name comes from JSON-LD and the price from the
 * page.
 *
 * ⚠️ AND THE QUOTE STYLE VARIES WITHIN ONE SHOP — the same template emits id="ext_price" on most
 * pages and id='ext_price' on others, so a double-quote-only pattern reported "no price" on a
 * subset with nothing to distinguish it from a genuinely unpriced product. Selectors written here
 * must accept both.
 */
function htmlPriceFrom(html: string, cfg: StoreConfig): number {
  if (!cfg.htmlPrice) return 0
  const m = new RegExp(cfg.htmlPrice, 'i').exec(html)
  if (!m?.[1]) return 0
  // Vietnamese prices group thousands with dots: "14.750.000 đ" is 14,750,000.
  const n = Number(m[1].replace(/[^0-9]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
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

/**
 * Crawl the shop's own USED-STOCK COLLECTION PAGES for product links.
 *
 * ⛔ WHY THIS EXISTS ALONGSIDE THE SITEMAP ADAPTER. Measured across the owner's shop list
 * 2026-09-10: most of these shops publish a sitemap of CATEGORY pages, not product pages, and
 * several publish no product JSON feed at all — `/products.json`, the Haravan collection
 * variant of it, and the Woo Store API were all tried on every one. Their used stock is reachable only the way
 * a shopper reaches it — by paging through the collection the owner linked.
 *
 * ⛔ AND IT IS WHAT KEEPS A USED-GOODS MARKETPLACE FROM SWALLOWING A NEW-GOODS CATALOGUE. The big
 * retailers (fptshop, thegioididong, dienmaycholon) carry Product JSON-LD on every page and a
 * sitemap enumerating their WHOLE inventory — overwhelmingly new. Pointed at a sitemap they would
 * import tens of thousands of new products. Pointed at `/may-doi-tra` they import the returns
 * counter, which is the thing that was asked for. The collection URL IS the filter.
 *
 * ⚠️ PAGINATION STOPS ON NO-NEW-URLS, not on an empty page. Several of these themes serve the
 * LAST page's markup for any page beyond the end (a 200, fully populated) rather than a 404, so
 * "did this page return products" is not a termination condition — "did it return any product I
 * have not already seen" is.
 */
async function crawlCollections(cfg: StoreConfig, LIMIT: number, log: ReadLog): Promise<Set<string>> {
  const urls = new Set<string>()
  const match = cfg.urlMatch ? new RegExp(cfg.urlMatch) : null
  const pageParam = cfg.pageParam ?? '?page={n}'
  const host = cfg.domain.replace(/^www\./, '')
  for (const base of cfg.collections ?? []) {
    // ⚠️ PER-COLLECTION PROGRESS, not global. Measured against the shared set, a collection whose
    // first pages duplicate an earlier collection's products looks exhausted and stops before its
    // own unseen stock (astra).
    const mine = new Set<string>()
    let emptyRuns = 0
    for (let page = 1; page <= (cfg.maxPages ?? 40); page++) {
      const url = page === 1 ? base : base.replace(/\/+$/, '') + pageParam.replace('{n}', String(page))
      const res = await get(url)
      if (!res.ok) {
        // ⛔ A 404 IS THE END OF A COLLECTION; A 429 OR 5xx IS A FAILED READ. Treating them alike
        // let a rate-limit on page 2 look like "the shop only has 40 products", and a read that
        // short is exactly what must never be allowed to retire the rest (astra).
        if (page === 1) { console.error(`  collection ${url}: HTTP ${res.status}`); log.fatal = true }
        else if (res.status !== 404 && res.status !== 410) {
          console.error(`  collection ${url}: HTTP ${res.status} — pagination cut short`)
          log.fatal = true
        }
        break
      }
      const html = await res.text()
      const before = mine.size
      // ⚠️ BOTH QUOTE STYLES. Half these themes emit href='...'; matching only double quotes read
      // a live shop as empty, with nothing to distinguish that from a sold-out one (codex).
      for (const m of html.matchAll(/href=(?:"([^"#?]+)"|'([^'#?]+)')/g)) {
        let h = m[1] ?? m[2]
        if (h.startsWith('//')) h = 'https:' + h
        else if (h.startsWith('/')) h = `https://${cfg.domain}${h}`
        // ⛔ PARSED-HOST EQUALITY, NOT `includes`. A substring test accepts
        // `https://zshop.vn.attacker.example/x`, so a link in someone else's markup could walk
        // the crawler off-site — and `urlMatch` is optional, so nothing else would stop it.
        let u: URL
        try { u = new URL(h) } catch { continue }
        const hh = u.hostname.replace(/^www\./, '')
        if (hh !== host) continue
        if (match && !match.test(h)) continue
        mine.add(h)
        urls.add(h)
      }
      await sleep(DELAY_MS)
      if (mine.size === before) { if (++emptyRuns >= 2) break } else emptyRuns = 0
      if (LIMIT && urls.size >= LIMIT) break
    }
  }
  return urls
}

async function fetchSitemapJsonLd(cfg: StoreConfig, LIMIT: number, log: ReadLog): Promise<PartnerProduct[]> {
  const urls = new Set<string>()
  const match = cfg.urlMatch ? new RegExp(cfg.urlMatch) : null
  for (const sm of cfg.sitemaps ?? []) {
    const res = await get(sm)
    // ⛔ FATAL: one unreadable sitemap can be half the shop, and as a single counted failure it
    // dissolved to far below the tolerance while its every product looked "removed".
    if (!res.ok) { console.error(`  sitemap ${sm}: HTTP ${res.status}`); log.fatal = true; continue }
    const xml = await res.text()
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const u = m[1]
      if (!match || match.test(u)) urls.add(u)
    }
    await sleep(DELAY_MS)
  }
  return readProductPages(cfg, urls, LIMIT, log)
}

/** The half both URL-discovery strategies share: fetch each product page and read its JSON-LD. */
async function readProductPages(cfg: StoreConfig, urls: Set<string>, LIMIT: number, log: ReadLog): Promise<PartnerProduct[]> {
  const list = [...urls].slice(0, LIMIT || undefined)
  console.log(`  ${cfg.domain}: ${urls.size} product URLs matched${LIMIT ? `, taking ${list.length}` : ''}`)

  const out: PartnerProduct[] = []
  let noLd = 0
  for (const url of list) {
    try {
      const res = await get(url)
      log.attempted++
      if (!res.ok) { log.failed++; await sleep(DELAY_MS); continue }
      const html = await res.text()
      let node: Record<string, unknown> | null = null
      for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        try { node = findProductNode(JSON.parse(m[1].trim())) } catch { /* a malformed block is not fatal */ }
        if (node) break
      }
      /**
       * ⛔ A 200 WITH NO PRODUCT JSON-LD IS AN UNREADABLE PAGE, NOT A REMOVED PRODUCT — and reading
       * it as an absence is how a theme change, a WAF challenge page or a cached fragment (all of
       * which are served as 200) would retire every affected listing overnight, then restock them
       * the next night: a sold/active oscillation, each flip revalidating the page. It counts as a
       * FAILED READ, which is what the completeness rate is for.
       */
      if (!node) { noLd++; log.failed++; await sleep(DELAY_MS); continue }
      out.push({
        domain: cfg.domain,
        /**
         * ⚠️ THE URL FALLBACK STRIPS A TRAILING SLASH FIRST. Several of these shops serve
         * `/iphone-x-cu-dep/`, where a bare `split('/').pop()` returns the EMPTY STRING — so every
         * product without a SKU would collapse onto one blank externalId and overwrite each other
         * on import. Measured: minhtuanmobile publishes real SKUs so the fallback never fires
         * there, but the next shop may not, and the failure is silent.
         */
        /**
         * ⛔ THE URL IS THE IDENTITY HERE, NOT THE SHOP'S SKU — and this must not depend on what
         * a given run happened to fetch. Keying on `sku` looked right until laptoptrunghau.com
         * turned out to publish `"sku": "laptoptrunghau"` (the SHOP's name) on every page, which
         * collapsed 35 laptops into ONE listing under the `@@unique([sellerId, externalId])`
         * upsert and reported it as "6 created, 29 updated".
         *
         * ⛔ AND DETECTING THAT COLLISION PER-RUN WAS WORSE THAN NOT DETECTING IT. A run that
         * fetched two colliding products switched to slugs; a run limited to one product, or one
         * where the sibling 404'd, kept the SKU — so the SAME product changed externalId between
         * runs and the next import wrote to a different row (codex, astra). Identity cannot be a
         * function of the batch. These adapters discover products BY URL, the URL list is a set,
         * so the slug is unique by construction and stable across every run.
         */
        externalId: cfg.idFrom === 'path'
          ? new URL(url).pathname.replace(/^\/+|\/+$/g, '') || url
          : url.replace(/\/+$/, '').split('/').pop() || url,
        name: clean(String(node.name ?? '')),
        price: priceFrom(node) || htmlPriceFrom(html, cfg),
        url,
        // JSON-LD first (the merchant's declared product image), then the page gallery to reach 5.
        images: [...new Set([...imagesFrom(node), ...galleryFrom(html, imagesFrom(node)[0] ?? '', url)])].slice(0, MAX_IMAGES),
        desc: clean(String(node.description ?? '')),
        inStock: !/OutOfStock|SoldOut/i.test(JSON.stringify(node.offers ?? '')),
      })
    } catch { log.failed++ /* one bad page must not end the run — but it is not a complete read */ }
    await sleep(DELAY_MS)
  }
  if (noLd) console.log(`  ${cfg.domain}: ${noLd} pages had no Product JSON-LD (stale sitemap entries / soft 404s)`)

  /**
   * ⚠️ THE SLUG IS UNIQUE BY CONSTRUCTION — this asserts it rather than trusting it. A collision
   * here means the URL list was not a set (a fetch bug, not a shop quirk), and importing would
   * silently overwrite one product with another, so the colliding rows are DROPPED and the read
   * is marked incomplete: an incomplete read never retires anything.
   */
  const seen = new Map<string, number>()
  for (const p of out) seen.set(p.externalId, (seen.get(p.externalId) ?? 0) + 1)
  const dupes = [...seen].filter(([, n]) => n > 1)
  if (dupes.length) {
    console.error(`  ⛔ ${cfg.domain}: ${dupes.length} externalId(s) collide — dropping them and marking the read incomplete`)
    log.fatal = true
    const bad = new Set(dupes.map(([k]) => k))
    return out.filter((p) => !bad.has(p.externalId))
  }
  return out
}

/**
 * ⚠️ `limit` IS A PARAMETER, NOT A MODULE CONSTANT — it read `process.argv`'s LIMIT when these
 * adapters lived in the CLI. A cron has no argv, and a shared module reaching for one caller's
 * flags is how the other caller silently gets a truncated catalogue. 0 means "everything".
 */
export async function fetchStore(cfg: StoreConfig, limit = 0): Promise<{ products: PartnerProduct[]; complete: boolean; seenExternalIds: Set<string> }> {
  const LIMIT = limit
  const log = newReadLog()
  console.log(`\n${cfg.name} (${cfg.domain}) — ${cfg.adapter}`)
  const rows = cfg.adapter === 'woocommerce' ? await fetchWoo(cfg, LIMIT, log)
    : cfg.adapter === 'sitemap-jsonld' ? await fetchSitemapJsonLd(cfg, LIMIT, log)
    : cfg.adapter === 'collection-crawl' ? await readProductPages(cfg, await crawlCollections(cfg, LIMIT, log), LIMIT, log)
    : await fetchHaravan(cfg, LIMIT, log)
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
  /**
   * ⛔ `seenExternalIds` COMES FROM `rows`, BEFORE THE USABILITY FILTER, AND THE DISTINCTION IS
   * WHAT KEEPS A LIVE PRODUCT FROM BEING RETIRED. `priced` answers "may this become a NEW listing"
   * — it drops anything with no price, no image or no title. A product that is plainly still on
   * sale but whose page dropped its image metadata for a day fails that test while being entirely
   * present in the shop; if the daily job read absences from `priced`, it would mark that listing
   * sold and the images we already hold would have been fine. Presence and import-eligibility are
   * different questions and the reconcile pass must ask the first one.
   */
  const seenExternalIds = new Set(rows.map((r) => r.externalId).filter(Boolean))
  /**
   * ⚠️ A TRUNCATED READ IS NOT A COMPLETE ONE EITHER. `--limit` is a CLI convenience for previewing
   * a shop; a caller that passes it has deliberately asked for a slice, and a slice must never be
   * allowed to authorise retiring everything outside it.
   */
  /**
   * ⛔ COMPLETENESS IS A RATE, NOT A BOOLEAN, AND BOTH EXTREMES WERE WRONG. Failing on ANY error
   * meant one dead slug in a merchant's sitemap — an ordinary, permanent 404 on an old URL —
   * disabled retirement for that shop for ever; failing on none meant a host that rate-limited
   * halfway through retired its unread tail. A small tolerance distinguishes the two: a handful of
   * stale URLs is normal, and losing 2% of a read is not evidence about the other 98%.
   */
  const failureRate = log.attempted ? log.failed / log.attempted : 0
  const complete = !log.fatal && failureRate <= MAX_READ_FAILURE_RATE && !LIMIT
  if (!complete) {
    const why = log.fatal ? 'an enumeration failed' : LIMIT ? '--limit was set' : `${log.failed}/${log.attempted} product pages failed`
    console.log(`  ${cfg.domain}: INCOMPLETE read (${why}) — this run may not retire anything`)
  }
  return { products: LIMIT ? priced.slice(0, LIMIT) : priced, complete, seenExternalIds }
}


/**
 * ⛔ MAY THIS RUN RETIRE WHAT IT DID NOT SEE? The most dangerous question in the daily job, and the
 * reason it is a named function with tests rather than two `&&`s in a route handler: answering
 * "yes" wrongly marks a working shop's ENTIRE catalogue sold, and the shop is a prospective partner.
 *
 * "Not in the feed" and "the feed did not load" are the same shape — an absent product — so the
 * only defence is to refuse when the fetch does not look complete:
 *   · a floor on absolute rows, because a handful is what a broken host returns; and
 *   · a floor RELATIVE to what we already hold, because a partial scrape (a sitemap that served
 *     half its pages, a paginated endpoint that stopped early) clears the absolute floor while
 *     still being wrong.
 *
 * ⚠️ A GENUINELY SHRINKING SHOP IS THEREFORE NOT RECONCILED, AND THAT IS THE INTENDED TRADE. Stale
 * listings are a correctable annoyance; a wrongly emptied storefront is a partner conversation that
 * never happens. The route reports `reconcileSkipped` so the case is visible rather than silent.
 */
export function mayReconcile(
  args: { matched: number; activeHeld: number; complete: boolean },
  opts?: { minRows?: number; minFraction?: number },
): boolean {
  const minRows = opts?.minRows ?? 20
  const minFraction = opts?.minFraction ?? 0.5
  /**
   * ⛔ AN ADAPTER THAT COULD NOT READ EVERY PAGE RETIRES NOTHING, WHATEVER THE NUMBERS SAY. This is
   * the check the first cut lacked entirely: a paginated read that died on page 8 of 12 returns 58%
   * of the catalogue, which sailed past a fraction gate and marked the unread 42% sold — nightly,
   * unrecoverably, because the same tail fails again the next night.
   */
  if (!args.complete) return false
  // Nothing active is held, so there is nothing this pass could retire either way.
  if (args.activeHeld === 0) return false
  /**
   * ⛔ MATCHED-AGAINST-ACTIVE, NOT FEED-AGAINST-EVERYTHING. The first cut compared the whole feed
   * (products never imported included) with every held row (rows already `sold` included), while
   * retirement keys on per-row matches — so it was wrong in BOTH directions:
   *   · a shop that re-issues its ids returns a full feed matching ZERO held rows, sailed through
   *     a feed-size gate, and retired the entire storefront in one night;
   *   · banghethanhly.vn — the shop this pass exists for — excludes its "Đã bán" category, so as
   *     products sell the held count grows with sold rows while the feed shrinks. At 7,286 sold of
   *     11,124 the fraction sits at 34%, below the floor for ever: the gate would have refused to
   *     reconcile the one catalogue it was written for, silently, on every run.
   * Counting what the feed actually MATCHED against what is actually ACTIVE asks the real question:
   * did this read account for the listings I am about to retire?
   */
  /**
   * ⛔ THE FLOOR IS CAPPED BY WHAT IS HELD, OR IT IS UNREACHABLE FOR A SMALL SHOP. `matched` counts
   * ACTIVE listings the feed accounted for, so it can never exceed `activeHeld` — a bare
   * `matched >= 20` therefore made reconciliation impossible for any storefront under twenty
   * active rows, permanently, however complete the read. Digiphone has 65 today and one bad month
   * takes it under; the small shops are exactly the ones where a stale listing is most visible.
   * ⚠️ The unit test that "covered" this asserted `matched: 50, activeHeld: 0` — a state the route
   * cannot produce — so it passed while the real bound went untested. It is a real case now.
   */
  /**
   * ⛔ THE ABSOLUTE FLOOR ONLY APPLIES TO A SHOP BIG ENOUGH TO MEET IT. `matched` counts ACTIVE
   * listings the feed accounted for, so it can never exceed `activeHeld` — a bare `matched >= 20`
   * therefore made reconciliation impossible for any storefront under twenty active rows, for
   * ever, however complete the read. Capping the floor at `activeHeld` was the first fix and it was
   * worse: it demanded a PERFECT match, so one genuinely-sold product in a fifteen-listing shop
   * blocked the pass that exists to retire it. Below the floor the FRACTION is the whole test —
   * which is the right instrument at that size, because 50% of fifteen is still a clear signal.
   * ⚠️ The unit test that "covered" this asserted `matched: 50, activeHeld: 0`, a state the route
   * cannot produce, so it passed while the real bound went untested.
   */
  if (args.activeHeld >= minRows && args.matched < minRows) return false
  return args.matched >= args.activeHeld * minFraction
}
