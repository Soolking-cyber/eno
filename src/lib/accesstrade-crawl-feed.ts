/**
 * A CRAWL CAMPAIGN'S READ, IN THE SHAPE THE NIGHTLY JOB ALREADY RECONCILES (src/lib/affiliate-night.ts).
 *
 * Hoàng Hà and ShopDunk are AccessTrade campaigns whose used stock is not in a datafeed, so their used sections are read
 * from the shops' own pages (src/lib/accesstrade-crawl.ts). This maps that read onto `fetchFeedPrices`' result, so the
 * one hardened per-campaign body — diff, floors, retire cap, restock screen, eno-run staff links, flush — runs unchanged:
 *   · `prices`  = the units/products seen IN STOCK with a usable price (present → price refresh, restock if sold);
 *   · `seenIds` = those + every id whose detail page could not be read (`unknown`) + every unpriced one — seen, so NEVER
 *                 retired on absence; an id the read did not see at all, or saw out of stock, is missing (→ `sold` only
 *                 when the read was complete and the floors hold);
 *   · `complete` = the reader's own verdict (every enumeration page read, product-page failures ≤ 2%, inside the deadline).
 *
 * ⛔ THE TRACKING LINK IS BUILT, NOT MINTED: `https://go.isclix.com/deep_link/<publisher>/<campaign>?url=<product>` is the
 * shape AccessTrade's own feed links take (repairAffLink, affiliate-price-refresh.ts), and on 2026-11-15 one such link per
 * campaign was followed: both tracked through click.accesstrade.vn and landed on the unit/product page itself (Hoàng Hà
 * 200; ShopDunk 200 with utm_source=accesstrade). Building it means a unit whose url changes gets a fresh link the same
 * night (the staff table is upserted only when the link differs). The publisher id is in every public link eno ever
 * served, not a secret. Owner 2026-11-15, asked with the self-purchase risk: "Keep tracking link".
 */
import { readHoangHaUsed, readShopDunkUsed, type CrawlRead } from './accesstrade-crawl'

export const ACCESSTRADE_PUBLISHER_ID = '7053736680188167797'

/** The AccessTrade tracking link for one product page of one campaign. https product pages only. */
export function trackingLink(campaignId: string, productUrl: string): string {
  if (!/^\d{10,25}$/.test(campaignId)) throw new Error(`trackingLink: not a campaign id: ${campaignId}`)
  const u = new URL(productUrl)
  if (u.protocol !== 'https:') throw new Error(`trackingLink: not an https product url: ${productUrl}`)
  return `https://go.isclix.com/deep_link/${ACCESSTRADE_PUBLISHER_ID}/${campaignId}?url=${encodeURIComponent(u.toString())}`
}

type Reader = (opts: { deadline: number; withPhotos?: boolean }) => Promise<CrawlRead>
/** A Map, never an object index (the MERCHANT_NAMES lesson: `READERS['constructor']` is a function). */
const READERS: ReadonlyMap<string, Reader> = new Map<string, Reader>([
  ['hoanghamobile', readHoangHaUsed],
  ['shopdunk_web', readShopDunkUsed],
])

export function hasCrawlReader(campaign: string): boolean {
  return READERS.has(campaign)
}

export type CrawlFeed = {
  prices: Map<string, { price: number; affiliateUrl: string | null; name: string; url: string }>
  unpriced: Map<string, { name: string; url: string }>
  seenIds: Set<string>
  seen: number
  complete: boolean
  dropped: number
  /** Ids whose title now DECLARES new goods — the night's not-used set (retired uncapped, alarmed), never "missing". */
  newSkus: Set<string>
  /**
   * Ids the shop itself shows as SOLD OUT (a ShopDunk product with no unit — "Sản phẩm tạm hết", or microdata OutOfStock):
   * POSITIVE evidence like `newSkus` (owner 2026-11-23: "check should be on availability like this product is out of stock"),
   * so the night sends them to `sold` outside the absence floors (affiliate-night.ts). Empty unless the read is TRUSTED for
   * it (soldOutTrusted); an untrusted read's sold-out ids are UNKNOWN instead (in `seenIds`: never retired as missing).
   */
  soldOutSkus: Set<string>
  /** Sold-out ids this read saw but did not trust (soldOutTrusted false) — the night goes red. */
  soldOutDistrusted: number
  /** What the reader reported, for the night's result line. */
  read: { rows: number; unknown: number; skippedNew: number; pages: number; failed: number; fatal: boolean; reason?: string }
}

/**
 * A read is trusted for its sold-out ids only with at least this many products IN stock… (low on purpose — opus review: at
 * 20 a shelf that legitimately thinned out would go red every night and keep its sold-out units up; the failure this guards
 * against is a unit list answering empty for EVERYTHING, which 5 catches)
 */
export const SOLD_OUT_MIN_IN_STOCK = 5
/** …and at most this share of what it read sold out (MEASURED 2026-11-23: 165 of 214, 77 %). */
export const SOLD_OUT_MAX_SHARE = 0.98

/**
 * ⛔ "SOLD OUT" FROM A BROKEN PAGE MUST NOT EMPTY THE SHELF. The sold-out ids skip the absence floors (they are positive
 * evidence), so the read itself must look sane first: COMPLETE, at least SOLD_OUT_MIN_IN_STOCK products in stock, and no
 * more than SOLD_OUT_MAX_SHARE of them sold out. A unit list that starts answering empty for everything (a site change)
 * fails the first floor; one that answers half-empty and half-broken is incomplete (> 2 % unknown).
 */
export function soldOutTrusted(read: CrawlRead): boolean {
  const out = [...read.rows.values()].filter((r) => !r.inStock).length
  return read.complete && read.rows.size - out >= SOLD_OUT_MIN_IN_STOCK && out <= read.rows.size * SOLD_OUT_MAX_SHARE
}

export function crawlToFeed(read: CrawlRead, campaignId: string): CrawlFeed {
  const prices: CrawlFeed['prices'] = new Map()
  const unpriced: CrawlFeed['unpriced'] = new Map()
  const seenIds = new Set<string>(read.unknown)
  const soldOutSkus = new Set<string>()
  const trusted = soldOutTrusted(read)
  let soldOutDistrusted = 0
  let dropped = 0
  for (const [sku, r] of read.rows) {
    // Seen SOLD OUT → the night's sold-out pass when the read is trusted for it; otherwise UNKNOWN (seen, so never "missing").
    if (!r.inStock) {
      if (trusted) soldOutSkus.add(sku)
      else { seenIds.add(sku); soldOutDistrusted++ }
      continue
    }
    if (!Number.isInteger(r.price) || r.price <= 0) { unpriced.set(sku, { name: r.name, url: r.url }); seenIds.add(sku); dropped++; continue }
    let link: string
    try { link = trackingLink(campaignId, r.url) } catch { unpriced.set(sku, { name: r.name, url: r.url }); seenIds.add(sku); dropped++; continue }
    prices.set(sku, { price: r.price, affiliateUrl: link, name: r.name, url: r.url })
    seenIds.add(sku)
  }
  return {
    prices, unpriced, seenIds, seen: read.rows.size + read.unknown.size, complete: read.complete, dropped, newSkus: new Set(read.newSkus),
    soldOutSkus, soldOutDistrusted,
    read: { rows: read.rows.size, unknown: read.unknown.size, skippedNew: read.skippedNew, ...read.log },
  }
}

/** Read one crawl campaign inside the night's deadline and map it (no photos: the nightly job never fetches an image). */
export async function fetchCrawlPrices(campaign: string, campaignId: string, budget: { deadline?: number }): Promise<CrawlFeed> {
  const reader = READERS.get(campaign)
  if (!reader) throw new Error(`no crawl reader for campaign ${campaign}`)
  const read = await reader({ deadline: budget.deadline ?? Date.now() + 20 * 60_000, withPhotos: false })
  return crawlToFeed(read, campaignId)
}
