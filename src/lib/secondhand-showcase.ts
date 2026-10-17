import { clean } from './partner-fetch'
import { fold } from './fold'
import { OFF_SITE, available, isBotWall, nameOf, normUrl, offerFacts, productNodes, samePage, unavailable, unknown, type PageRead, type Verdict } from './secondhand-page'
import { SHOP_FOLLOW_UPS, SHOP_PAGE_RULES } from './secondhand-shop-rules'

export type { PageRead, Verdict } from './secondhand-page'

/**
 * ── THE SECOND-HAND SHOWCASE: ONE LIVE LISTING PER CATEGORY, STILL ON SALE AT ITS SHOP ─────────────────────────
 *
 * Owner, 2026-10-16 (the cap — session ffb89afc): "5 per shop" — every partner shop's live second-hand goods were cut to
 * its newest five; the 6,920 others were hidden in one statement and their ids kept in `_hide_secondhand_20261016`.
 * Owner, 2026-10-17: *"check out 2nd hand deals some of them are no longer available replace with available options
 * have a 2nd hand run weekly to check"*.
 *
 * Then, the same day: "also remove most of 2nd hand 1 example for each category is fine" (SHOWCASE_PER_CATEGORY).
 *
 * So, once a week (src/lib/secondhand-showcase-run.ts — the box timer's /api/cron/secondhand-showcase, and
 * scripts/secondhand-showcase.ts by hand):
 *   1. every live partner second-hand row is read at its shop and classified AVAILABLE / UNAVAILABLE / UNKNOWN (this
 *      file, and each shop's own page rules in src/lib/secondhand-shop-rules.ts);
 *   2. an UNAVAILABLE row goes `sold` — the partner-stock semantics: a 200 "this item has been sold" page;
 *   3. each category shelf keeps its one best row; the others are hidden into the cap's pool;
 *   4. a shelf left empty is topped up from that pool — rows that were live, verified and compliance-clear when hidden,
 *      untouched since — each one first proven available at its shop, the same item, sanely priced and clean under the
 *      import screen.
 *
 * ⛔ ONLY PER-ROW EVIDENCE RETIRES A ROW. "The shop did not answer", "the page had no product data", "a redirect", "a
 * Cloudflare page", "absent from the used category" are UNKNOWN, and an unknown row keeps its slot — the measured ways
 * partner shops fail (a timeout, a WAF, a theme change, a product RE-FILED as new: Thế Giới Số 365 moved 3 of its 5
 * showcase laptops out of its used tree on 2026-10-17, still for sale) must never read as "sold". What retires a row is
 * listed in RETIRING_REASONS.
 */

/**
 * ⛔ ONE PER CATEGORY (owner, 2026-10-17, hours after asking for the check: "also remove most of 2nd hand 1 example for
 * each category is fine") — superseding the 2026-10-16 cap of five per shop. A category is a SUBCATEGORY shelf (phones &
 * tablets, laptops & PCs, cameras, sofas, washing machines…), the level a visitor browses; one listing per shelf, from
 * whichever shop has the best one on sale. A row with no subcategory sits on no shelf and keeps no slot.
 * ⚠️ Phones keep TWO: the owner's iPhone price clip of the same day (~/Desktop/eno-iphone-gia) shows two iPhones listed on
 * eno.vn at different prices; one phone would make it untrue.
 */
export const SHOWCASE_PER_CATEGORY = 1
export const CATEGORY_TARGETS: Readonly<Record<string, number>> = { 'electronics/phones-tablets': 2 }
/**
 * The shelves the 2026-10-17 curation left — each is planned every week even when it starts EMPTY (its row sold and no
 * replacement passed last time), so a shelf is refilled the moment the pool has something verified for it (review,
 * 2026-10-17: a shelf known only from its live rows would vanish for good the first week it went empty). A shelf with a
 * live row is planned too, listed or not.
 */
export const SHOWCASE_SHELVES: readonly string[] = [
  'electronics/audio', 'electronics/cables-chargers', 'electronics/cameras', 'electronics/gaming', 'electronics/laptops-pcs',
  'electronics/phones-tablets', 'electronics/power-banks', 'electronics/storage', 'electronics/tv-monitors',
  'furniture-appliances/sofa-seating', 'furniture-appliances/storage', 'furniture-appliances/white-goods',
]

/** The shelf key of a row: `<category>/<subcategory>`, or `<category>/-` for a row on no subcategory shelf (target 0). */
export const shelfKey = (category: string | null, subcategory: string | null) => `${category ?? '-'}/${subcategory ?? '-'}`
export const shelfTarget = (key: string) => (key.endsWith('/-') ? 0 : CATEGORY_TARGETS[key] ?? SHOWCASE_PER_CATEGORY)

/**
 * The other shelves the owner trimmed the same day, held at their size by the same weekly run — TRIM ONLY: the newest
 * extras (a new import, a revival) go hidden; nothing is topped up. Owner, 2026-10-17: "esims only leave best options up
 * to 10max total 1-2 from each prvider, also car rental leave few from each shop best suitable options". Which ones are
 * the best was picked once, by hand (scripts/curate-shelf.ts); the weekly trim keeps the earliest-listed, i.e. those.
 */
export const SHELF_CAPS: readonly { shelf: string; subcategory: string; sellers: readonly string[]; perSeller: number; total: number }[] = [
  { shelf: 'esim', subcategory: 'esim', sellers: ['iTel', 'Local', 'MobiFone', 'SIM FPT', 'Vietnamobile', 'Viettel', 'VinaPhone', 'VNSKY', 'Wintel'], perSeller: 2, total: 10 },
  { shelf: 'car-rental', subcategory: 'car-rental', sellers: ['Mioto', 'BonbonCar'], perSeller: 3, total: 6 },
]

/** The cap's own record of what it hid — the only rows a top-up may publish (provenance: untouched since). */
export const CAP_POOL_TABLE = '_hide_secondhand_20261016'

/**
 * ⚠️ A PRICE THAT MOVES MORE THAN THIS IN A WEEK IS REPORTED, NOT WRITTEN. A second-hand shop's price does move — 12.59M →
 * 9.99M was measured on 2026-10-17 — but a 10× jump is a parsing error (a minor-unit price, a "from" price, an accessory
 * rail) far more often than a real repricing, and a wrong price on a live listing is a promise to a buyer.
 */
export const MAX_PRICE_SWING = 0.5

/** How many pool rows one shelf may test in one run before it reports `short` — a dead pool must not run for an hour. */
export const CANDIDATE_BUDGET = 25

/** A shop's showcase settings beside its adapter config (StoreConfig.showcase, src/lib/partner-stores.ts). */
export type ShowcaseSignals = {
  /** A feed shop whose feed is refused (Điện Máy Sài Gòn: Store API 401 since 2026-10) is read through its product pages. */
  pageFallback?: boolean
  /**
   * WooCommerce: the category a sold product is filed under, whatever its is_in_stock says (banghethanhly.vn: 15 "Đã bán",
   * slug chua-phan-loai — 7,373 products; 9 of 20 sampled still report in stock). Read by an `include` query (one request
   * per 100 ids): the Store API never lists this category in a product's own `categories`.
   */
  soldCategoryId?: number
  /** WooCommerce: a product the API serves with NO category is in the sold category only (banghethanhly — none of 4,224 live rows). */
  emptyCategoriesMeansSold?: boolean
}

/**
 * The reasons that may retire a live row — per-row evidence only. Anything else a classifier says is reported, never
 * acted on; a test pins this list against what the classifiers return.
 */
export const RETIRING_REASONS = [
  'http-404', 'jsonld-out-of-stock', 'shop-not-found', 'shop-sold', 'shop-preorder', 'buy-disabled', 'no-price', 'zero-stock',
  'feed-out-of-stock', 'api-404', 'api-out-of-stock', 'api-trashed', 'api-sold-category', 'different-item',
] as const

/**
 * Computed evidence rather than the shop's own statement: a change in the shop's data (a renamed warehouse, a reworded
 * title) could make it fire on every row. These retire a row only in a run that also read a live page of the same shop
 * as AVAILABLE — proof the rule still spares what is on sale.
 */
export const RULE_DEPENDENT = new Set<string>(['zero-stock', 'different-item'])

/**
 * Classify one product page. `read.url` is the URL we hold for the listing; `read.finalUrl` where it ended.
 * A shop with its own rules (SHOP_PAGE_RULES) is read by them; any other by its JSON-LD alone — every offer out of stock
 * is unavailable, an in-stock offer with a price is available, anything else unknown.
 */
export function classifyProductPage(read: PageRead, cfg: { domain: string }): Verdict {
  // Left the partner shops (a redirect elsewhere, an address that is not the shop's): no evidence — and not a passing failure.
  if (read.error === OFF_SITE) return unknown('off-site')
  if (read.error) return unknown(`fetch-error: ${read.error.slice(0, 80)}`)
  if (read.status === 404 || read.status === 410) return unavailable('http-404')
  if (isBotWall(read)) return { state: 'unknown', reason: 'blocked', blocked: true }
  if (read.status !== 200) return unknown(`http-${read.status}`)
  const rule = SHOP_PAGE_RULES[cfg.domain]
  if (rule) return rule(read)
  // ⛔ THE PAGE'S OWN PRODUCT: the node naming this address, else the only one — a page carrying several (related products)
  // with none naming the address says nothing about ours (review, 2026-10-17).
  const nodes = productNodes(read.html)
  const here = normUrl(read.finalUrl || read.url)
  const named = (n: Record<string, unknown>) => normUrl(String(n.url ?? n['@id'] ?? ''))
  // The only node counts unless it names ANOTHER address (a related product on an error page).
  const node = nodes.find((n) => named(n) === here) ?? (nodes.length === 1 && (!named(nodes[0]) || named(nodes[0]) === here) ? nodes[0] : undefined)
  if (!node) return unknown(nodes.length > 1 ? 'several-products' : nodes.length ? 'product-elsewhere' : 'no-product-node')
  const facts = offerFacts(node)
  // ⛔ A redirect elsewhere is UNKNOWN, not a sale: the page out of stock may be another product's (review, 2026-10-17).
  if (facts.availability === 'out') return samePage(read) ? unavailable('jsonld-out-of-stock', nameOf(node)) : unknown('redirected')
  if (facts.availability === 'in' && facts.price) return available('jsonld-in-stock', facts.onePrice, nameOf(node), read.finalUrl && read.finalUrl !== read.url ? read.finalUrl : undefined)
  return unknown(facts.availability === 'other' ? `jsonld-${facts.values.join('+')}` : 'no-availability')
}

/** The second look a shop's rule asked for (`followUp`): only that shop's own follow-up rule may decide it. */
export function classifyFollowUp(domain: string, page: PageRead, data: PageRead): Verdict {
  const rule = SHOP_FOLLOW_UPS[domain]
  return rule ? rule(page, data) : unknown('no-follow-up-rule')
}

/** What a shop's feed says about the products it lists (WooCommerce Store API / Haravan collection). */
export type FeedFacts = {
  /** Every requested product was answered for (a feed page or an `include` query that failed makes this false). */
  complete: boolean
  /** `price` only where the shop names ONE price for the product (a variable product's range is not one). */
  byId: Map<string, { inStock: boolean; price?: number; name: string; backorder?: boolean }>
  /** Listed, priced or not (a "Liên hệ" product is listed without a usable price). */
  seen: Set<string>
  /** Products the shop has filed under its sold category (ShowcaseSignals.soldCategoryId). */
  soldIds?: Set<string>
  /** Products whose sold-category read FAILED: their feed rows say nothing either way. */
  soldUnknown?: Set<string>
}

/**
 * Presence in the feed is the WooCommerce/Haravan shops' evidence. `absent` is not a verdict: the caller confirms it per
 * row (classifyApiRow) — a feed that dropped one page must not retire what was on it.
 */
export function classifyFeedRow(feed: FeedFacts, externalId: string): Verdict | 'absent' {
  if (feed.soldIds?.has(externalId)) return unavailable('api-sold-category')
  if (feed.soldUnknown?.has(externalId)) return unknown('sold-list-unread')
  const p = feed.byId.get(externalId)
  if (p) {
    // "Cho phép đặt hàng trước": stock at or below zero on a one-off used item — never restored, never retired on it,
    // whatever the in-stock flag beside it says (checked FIRST — review, 2026-10-17).
    if (p.backorder) return unknown('backorder')
    if (!p.inStock) return unavailable('feed-out-of-stock', p.name)
    return available('feed-in-stock', p.price, p.name)
  }
  if (feed.seen.has(externalId)) return unknown('listed-unpriced')
  return feed.complete ? 'absent' : unknown('feed-incomplete')
}

/** The shop's per-product API answer for a row the feed did not list. */
export type ApiRead = { status: number; json?: Record<string, unknown> | null; error?: string }

/**
 * Per-row confirmation of an absence (measured on all eight feed shops, 2026-10-17):
 *   · 404 — deleted or unpublished (WooCommerce `woocommerce_rest_product_invalid_id`; Haravan an empty 404);
 *   · out of stock, or every Haravan variant unavailable;
 *   · TRASHED — WooCommerce still answers 200 and even "in stock" for a trashed product; the tells are a `__trashed` slug,
 *     a `?post_type=product&p=` permalink, or not purchasable at a real price (tuannguyenmobile row 9642);
 *   · banghethanhly only: no category at all (the sold category is the one the API hides).
 * A product the API still serves as in stock and purchasable is UNKNOWN — a category move (Thế Giới Số 365 re-filed its
 * "[New Outlet]" laptops as new), not a sale.
 */
export function classifyApiRow(read: ApiRead, s: ShowcaseSignals | undefined): Verdict {
  if (read.error) return unknown(`api-error: ${read.error.slice(0, 80)}`)
  if (read.status === 404 || read.status === 410) return unavailable('api-404')
  if (read.status !== 200 || !read.json) return unknown(`api-http-${read.status}`)
  const j = read.json
  const product = (j.product && typeof j.product === 'object' ? j.product : j) as Record<string, unknown>
  const name = clean(String(product.name ?? product.title ?? '')) || undefined
  const prices = (product.prices ?? {}) as Record<string, unknown>
  const price = Number(prices.price ?? NaN) / 10 ** (Number(prices.currency_minor_unit ?? 0) || 0)
  if (String(product.slug ?? '').endsWith('__trashed') || String(product.permalink ?? '').includes('?post_type=product&p=')
    || (product.is_purchasable === false && price > 0)) return unavailable('api-trashed', name)
  if (product.is_in_stock === false) return unavailable('api-out-of-stock', name)
  const variants = Array.isArray(product.variants) ? (product.variants as Record<string, unknown>[]) : null
  if (variants && variants.length && variants.every((v) => v.available === false)) return unavailable('api-out-of-stock', name)
  if (s?.emptyCategoriesMeansSold && Array.isArray(product.categories) && product.categories.length === 0) return unavailable('api-sold-category', name)
  return unknown('absent-from-feed-but-served')
}

const words = (t: string) => new Set(fold(clean(t)).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 2))
/** A title's model marks: its digit runs ("13", "128", "1165") and its standalone capital letters ("iPhone X", "Galaxy S"). */
const modelMarks = (t: string) => new Set([...(fold(clean(t)).match(/\d+/g) ?? []), ...(clean(t).match(/(?<![\p{L}\p{N}])[A-Z](?![\p{L}\p{N}])/gu) ?? []).map((c) => c.toLowerCase())])

/** The share of the shorter title's words the other title also has (folded: case, accents and "đ" do not matter). */
export function sameItemScore(stored: string | null | undefined, fresh: string | null | undefined): number {
  if (!stored || !fresh) return 0
  const a = words(stored)
  const b = words(fresh)
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  const score = shared / Math.min(a.size, b.size)
  // ⛔ MODEL MARKS THAT CONFLICT — each title has one the other lacks ("iPhone X" / "iPhone 8", 128GB / 256GB) — are not the
  // same item however many words they share: at most "maybe" (unknown — never restored, never retired on it). One title
  // adding marks ("… 99%") is no conflict. Measured on the 6,968 stored title pairs (each row's own two languages): 0.14%
  // conflict, every one a dimension written two ways or a real mistranslation (review, 2026-10-17).
  const ma = modelMarks(stored), mb = modelMarks(fresh)
  if (ma.size && mb.size && [...ma].some((w) => !mb.has(w)) && [...mb].some((w) => !ma.has(w))) return Math.min(score, 0.5)
  return score
}

/**
 * ⚠️ THE SAME ITEM, NOT THE SAME URL. A second-hand shop re-uses a slug for the next unit (Laptop Trung Hậu edited two
 * listings in place on 2026-10-17 to sell different laptops), and a top-up that publishes a September listing over a
 * different October machine advertises something nobody has. ≥ 60% of the shorter title's words shared is the same item;
 * under 30% is a different one (a live row: `different-item`, RULE_DEPENDENT); between, unknown.
 */
export function sameItem(stored: string | null | undefined, fresh: string | null | undefined): boolean {
  return sameItemScore(stored, fresh) >= 0.6
}

/** The price to write, if any: a fresh positive price that differs, inside MAX_PRICE_SWING — otherwise why not. */
export function priceDecision(stored: number, fresh: number | undefined): { next?: number; refused?: string } {
  if (fresh === undefined || !(fresh > 0)) return {}
  const next = Math.round(fresh)
  if (next === Math.round(stored)) return {}
  if (!(stored > 0) || Math.abs(next - stored) / stored > MAX_PRICE_SWING) return { refused: `price ${stored} → ${next} moves more than ${MAX_PRICE_SWING * 100}%` }
  return { next }
}
