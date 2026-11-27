import { isUsedTitle } from '@/lib/used-signal'
import { decodeEntities } from '@/lib/feed-text'

/**
 * ── NEW iPHONE 18 AND CURRENT MACS FROM THE AccessTrade PARTNER SHOPS ─────────────────────────────────────
 *
 * Owner, 2026-11-26: "search accesstrade shops for new iphone model affiliate products import them and link to our
 * organic posts that get clicks for iphone same for any other mac products". For THESE LINES ONLY this sets aside the
 * second-hand focus (2026-10-03) and the partner shops' "no new goods only second hand ones" (2026-11-15). Every other
 * new good of these shops stays off the site, and the chat-only model stays: no public link, the tracking link in the
 * staff table, "Buy now" in the chat.
 *
 * Only shops that pay on these lines (AccessTrade, measured 2026-11-26, excl. VAT): ShopDunk 0.7 % (30-day cookie),
 * CellphoneS 0.65 % new customer / 0.52 % returning (14 days, pre-orders 0), Hoàng Hà 0.63 % of the paid value
 * (30 days). FPT Shop pays 0 % on iPhone and 0.31 % on Mac (0 in a launch's first 60 days); Apple's own campaign
 * excludes the 18 Pro, Pro Max, Duo, Neo, mini and Studio. Neither is read.
 *
 * ⛔ A ROW OF THIS LINE LIVES UNDER `externalId` "new:<shop id>" AND NOWHERE ELSE. The shops' storefronts are used-only
 * to every other job (src/lib/retired-imports.ts `usedOnly`): the nightly at src/lib/affiliate-night.ts sends any
 * non-used row of theirs to `sold`. The prefix is how those jobs leave these rows alone (NEW_APPLE_PREFIX), and how the
 * new-goods nightly (src/lib/new-apple-night.ts) finds the only rows it may touch.
 */
export const NEW_APPLE_PREFIX = 'new:'

/**
 * The Prisma filter for "not a new-Apple row": a used-only job adds it to its own `where`.
 * ⚠️ SQL NOT OF A NULL IS NULL: Prisma writes this as `NOT ("externalId" LIKE 'new:%')`, which also drops every row whose
 * externalId is NULL — a listing a person wrote by hand. Both callers already require `externalId: { not: null }`; a caller
 * that does not must add `OR: [{ externalId: null }, …]` itself (commit gate round 4).
 */
export const NOT_NEW_APPLE = { NOT: { externalId: { startsWith: NEW_APPLE_PREFIX } } } as const

export const isNewAppleExternalId = (externalId: string | null | undefined) => (externalId ?? '').startsWith(NEW_APPLE_PREFIX)

/**
 * The lines, newest generation only (as the three shops list them on 2026-11-26). `model` is the exact `Listing.model`
 * value the pages read (src/app/[lang]/iphone-18-vietnam/lowest-prices.ts reads `model in [...]` exactly).
 *
 * ⚠️ THE TITLE MUST START WITH THE DEVICE. Accessories name the device after their own noun ("Ốp lưng iPhone 18 Pro …",
 * "Bộ dán … For MacBook Neo", "AppleCare+ cho Mac Studio", "S-Buyback iPhone 17 Pro Max …"), and the shared taxonomy
 * files some of them on the laptops shelf (measured: "Bộ dán MacBook Air 13' …" → laptops-pcs). An optional "Apple "
 * lead is allowed: CellphoneS writes "Apple Mac mini M6 …".
 * ⚠️ A GENERATION TOKEN IS REQUIRED for a Mac: "MacBook Pro 14 inch M5 2025" (the base M5, last year's) is not a current
 * line; its M5 Pro / M5 Max and the M6 are.
 */
type Line = { model: string; kind: 'iphone' | 'mac'; test: RegExp }
const LEAD = String.raw`^(?:apple\s+)?`
const LINES: readonly Line[] = [
  { model: 'iPhone 18 Pro Max', kind: 'iphone', test: new RegExp(`${LEAD}iphone\\s*18\\s*pro\\s*max(?![\\p{L}])`, 'iu') },
  { model: 'iPhone 18 Pro', kind: 'iphone', test: new RegExp(`${LEAD}iphone\\s*18\\s*pro(?!\\s*max)(?![\\p{L}])`, 'iu') },
  { model: 'iPhone Duo', kind: 'iphone', test: new RegExp(`${LEAD}iphone\\s*duo(?![\\p{L}])`, 'iu') },
  { model: 'MacBook Neo', kind: 'mac', test: new RegExp(`${LEAD}macbook\\s*neo(?![\\p{L}])`, 'iu') },
  { model: 'MacBook Air M5', kind: 'mac', test: new RegExp(`${LEAD}macbook\\s*air(?![\\p{L}]).*?(?<![\\p{L}\\p{N}])m5(?![\\p{L}\\p{N}])`, 'iu') },
  { model: 'MacBook Pro M5 Max', kind: 'mac', test: new RegExp(`${LEAD}macbook\\s*pro(?![\\p{L}]).*?(?<![\\p{L}\\p{N}])m5\\s*max(?![\\p{L}\\p{N}])`, 'iu') },
  { model: 'MacBook Pro M5 Pro', kind: 'mac', test: new RegExp(`${LEAD}macbook\\s*pro(?![\\p{L}]).*?(?<![\\p{L}\\p{N}])m5\\s*pro(?![\\p{L}\\p{N}])`, 'iu') },
  { model: 'MacBook Pro M6', kind: 'mac', test: new RegExp(`${LEAD}macbook\\s*pro(?![\\p{L}]).*?(?<![\\p{L}\\p{N}])m6(?![\\p{L}\\p{N}])(?!\\s*(?:pro|max))`, 'iu') },
  { model: 'iMac M6', kind: 'mac', test: new RegExp(`${LEAD}imac(?![\\p{L}]).*?(?<![\\p{L}\\p{N}])m6(?![\\p{L}\\p{N}])`, 'iu') },
  { model: 'Mac mini M5 Pro', kind: 'mac', test: new RegExp(`${LEAD}mac\\s*mini(?![\\p{L}]).*?(?<![\\p{L}\\p{N}])m5\\s*pro(?![\\p{L}\\p{N}])`, 'iu') },
  { model: 'Mac mini M6', kind: 'mac', test: new RegExp(`${LEAD}mac\\s*mini(?![\\p{L}]).*?(?<![\\p{L}\\p{N}])m6(?![\\p{L}\\p{N}])`, 'iu') },
  { model: 'Mac Studio M5 Ultra', kind: 'mac', test: new RegExp(`${LEAD}mac\\s*studio(?![\\p{L}]).*?(?<![\\p{L}\\p{N}])m5\\s*ultra(?![\\p{L}\\p{N}])`, 'iu') },
  { model: 'Mac Studio M5 Max', kind: 'mac', test: new RegExp(`${LEAD}mac\\s*studio(?![\\p{L}]).*?(?<![\\p{L}\\p{N}])m5\\s*max(?![\\p{L}\\p{N}])`, 'iu') },
]

/** The line a stored `Listing.model` names (exact), or null. */
export function lineOfModel(model: string | null | undefined): NewAppleLine | null {
  const l = LINES.find((x) => x.model === model)
  return l ? { model: l.model, kind: l.kind } : null
}

/** The models of the three iPhone lines, for the pages that read them. */
export const NEW_APPLE_IPHONE_MODELS = LINES.filter((l) => l.kind === 'iphone').map((l) => l.model)

/**
 * Words that make a device-led title something else: a service, an accessory named after the device ("Apple iPhone 18
 * Pro/18 Pro Max dán bảo vệ camera …"), a deposit, a trade-in or buyback offer, or a unit the shop has opened ("Đã kích
 * hoạt" activated, "Đổi bảo hành" a warranty swap, "Trầy xước" scratched). Measured on the 2026-11-26 feeds.
 * ⚠️ NOT "sạc" (charger): a device row names its bundled charger ("MacBook Air M5 … Sạc 70W", "… - Sạc nhanh 70W").
 */
const NOT_THE_DEVICE = /(?<![\p{L}\p{N}])(?:applecare|care\s*\+|bảo hành mở rộng|đặt cọc|đặt trước|pre-?order|thu\s*cũ|đổi\s*cũ|thu\s*đổi|buyback|đã\s*kích\s*hoạt|đổi\s*bảo\s*hành|trầy|xước|trả góp 0đ|vỏ|ốp|bao da|dán|kính|cường lực|cáp|adapter|hub|đế|giá đỡ|phụ kiện|combo)(?![\p{L}\p{N}])/iu

/** A storage or memory figure — every device row names its tier ("256GB", "1TB", "16GB/512GB"). */
const HAS_TIER = /(?<![\p{L}\p{N}])\d+\s*(?:GB|TB)(?![\p{L}])/iu

export type NewAppleLine = { model: string; kind: 'iphone' | 'mac' }

/**
 * The line a shop's product title belongs to, or null when it is not one of them, not the device itself, or second-hand.
 * `url` is the shop's product page: a used slug ("…-cu-dep.html") disqualifies the row as it does everywhere else.
 */
export function newAppleLine(rawTitle: string | null | undefined, url?: string | null): NewAppleLine | null {
  const title = decodeEntities(String(rawTitle ?? '')).normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!title || !HAS_TIER.test(title)) return null
  if (NOT_THE_DEVICE.test(title) || isUsedTitle(title, null, url ?? null)) return null
  for (const l of LINES) if (l.test.test(title)) return { model: l.model, kind: l.kind }
  return null
}

/**
 * The three shops. Ids are the pinned storefronts (accesstrade-removal.ts CAMPAIGN_SELLER_IDS, eno-run-partners.ts).
 * `campaignId` is the tracking link's campaign segment (accesstrade-crawl-feed.ts trackingLink).
 */
/** `city`: the city the storefront's existing rows are filed under (measured 2026-11-26: CellphoneS 1,326 Hồ Chí Minh; Hoàng Hà
 * 2,764 and ShopDunk 214 Hà Nội) — a new row joins its shop's rows, never a city the shop's own listings do not name. */
export type NewAppleShop = { campaign: 'shopdunk_web' | 'cellphones_cps' | 'hoanghamobile'; sellerId: string; campaignId: string; name: string; host: string; city: string }
export const NEW_APPLE_SHOPS: readonly NewAppleShop[] = [
  { campaign: 'shopdunk_web', sellerId: 'cmwgyb5sl0001rjq4yuj9b2sq', campaignId: '6800497735607325103', name: 'ShopDunk', host: 'shopdunk.com', city: 'Hà Nội' },
  { campaign: 'cellphones_cps', sellerId: 'cmt78nvif0000gpq48kvzmxjw', campaignId: '6259155740535091857', name: 'CellphoneS', host: 'cellphones.com.vn', city: 'Hồ Chí Minh' },
  { campaign: 'hoanghamobile', sellerId: 'cmwgyb5m10000rjq4xxjkwwaz', campaignId: '5229340396064683522', name: 'Hoàng Hà Mobile', host: 'hoanghamobile.com', city: 'Hà Nội' },
]
export const NEW_APPLE_SELLER_IDS = NEW_APPLE_SHOPS.map((s) => s.sellerId)

/**
 * Tie-break rank of a seller id (lower first); an unknown id sorts last. Most tiers tie at Apple Vietnam's set price, so the
 * page must settle them the same way every render — ⛔ BY THE SHOP'S NAME, NEVER BY WHAT IT PAYS (commit gate round 3, opus):
 * a price table that quietly names the higher-commission shop on every tie is an advert, and the visitor is not told why.
 */
const TIE_ORDER = [...NEW_APPLE_SHOPS].sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((s) => s.sellerId)
export const newAppleShopRank = (sellerId: string) => {
  const i = TIE_ORDER.indexOf(sellerId)
  return i === -1 ? TIE_ORDER.length : i
}

/**
 * THE ONE PREDICATE FOR "A LIVE NEW iPHONE 18 / MAC OF THIS LINE" on a public page. ⛔ Exact `condition: 'new'` (conditionWhere
 * ('new') also matches `like_new`), the `new:` namespace, and the three pinned storefronts by id — never the ownerless arm
 * the used tables read (lowest-prices.ts), so a stranger's "new iPhone 18" can never be quoted as a shop price.
 */
/**
 * ⛔ A ROW NOT CONFIRMED FOR 3 DAYS IS NOT QUOTED (commit gate, opus): the nightly re-reads each row's page and stamps the
 * row's STAFF LINK (`PartnerPurchaseLink.updatedAt`) on every confirmed in-stock read (src/lib/new-apple-night.ts), so a row
 * whose page has read UNKNOWN for three nights drops out of the tables and blocks instead of being quoted as the cheapest
 * in-stock unit, dated today, for good — and after NEW_APPLE_STALE_MS it goes to `sold` everywhere.
 * ⚠️ THE LINK'S STAMP, NOT THE LISTING'S `updatedAt` (commit gate round 3): a nightly touch of the listing would move every
 * iPhone page's sitemap lastmod with no change on the page. Only this module's rows' links are written by anyone at night —
 * the used nights never select a `new:` row (affiliate-night.ts `held`).
 */
export const NEW_APPLE_FRESH_MS = 72 * 3_600_000
export const NEW_APPLE_STALE_MS = 7 * 24 * 3_600_000

export function newAppleOfferWhere(models: readonly string[], now: Date = new Date()) {
  return {
    purchaseLink: { updatedAt: { gte: new Date(now.getTime() - NEW_APPLE_FRESH_MS) } },
    status: 'active',
    verified: true,
    listingType: 'sell',
    condition: 'new',
    brandSlug: 'apple',
    currency: '₫',
    model: { in: [...models] as string[] },
    externalId: { startsWith: NEW_APPLE_PREFIX as string },
    sellerId: { in: [...NEW_APPLE_SELLER_IDS] as string[] },
  }
}
