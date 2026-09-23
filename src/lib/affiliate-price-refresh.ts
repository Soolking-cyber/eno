/**
 * Daily price refresh for imported affiliate listings (owner, 2026-08-25: "fetch prices daily").
 *
 * ⛔ WHY THIS IS NOT `import-accesstrade.ts --apply` ON A TIMER. The importer's refresh set
 * includes category, subcategory, brand and model — fields that were REDONE BY HAND across all
 * 9,726 CellphoneS products (classify-cellphones.ts, extract-specs.ts) because the feed's own
 * taxonomy put wallets and kickstands in "phones". Running the importer nightly would silently
 * undo that classification every night. This job writes TWO columns and nothing else.
 *
 * ⛔ IT ALSO MUST NOT WRITE `previousPrice` / `priceDropAt`. Those drive the "price dropped" badge
 * AND the saved-search alert sweep (saved-search-alerts.ts:118) — a merchant feed that moves a few
 * thousand prices overnight would fire a price-drop alert mail per matching saved search, every
 * day, about a discount we did not set and cannot honour. The drop badge is for a SELLER lowering
 * their own ask; a merchant's shelf price is not that. Prices move silently here, by design.
 *
 * ⚠️ `affiliateUrl` IS refreshed alongside price. It is derived from the same feed row, and a
 * stale one is a dead link the owner has already had to report once — the aff_link repair below
 * is the same one the importer applies.
 */

import type { Prisma } from '@/generated/prisma/client'
type Sql = Prisma.Sql

/** One row of AccessTrade's `datafeeds` response — only the fields this job reads. */
export type FeedRow = {
  sku?: string | number
  product_id?: string | number
  name?: string
  price?: string | number
  discount?: string | number
  status_discount?: string | number
  aff_link?: string
}

/**
 * The storefront name a campaign's products hang off. Mirrors `--name` in import-accesstrade.ts.
 *
 * ⛔ AN IMPORT THAT PASSES `--name` AND IS NOT LISTED HERE NEVER GETS ITS PRICES REFRESHED.
 * The nightly cron finds the storefront by `merchantNameFor(campaign)`
 * (api/cron/affiliate-prices/route.ts:77); a campaign whose products were imported under a
 * prettier display name resolves to the raw slug, matches no seller, and the run records
 * `no_storefront` and moves on. The listings keep whatever price they had on import, forever.
 *
 * MEASURED 2026-09-09, and it is not hypothetical: `ACCESSTRADE_CAMPAIGNS` is UNSET on both
 * containers, so the cron only ever walks `cellphones_cps`. BỀN COMPUTER (258 rows, campaign
 * `ben`) and Điện Thoại Vui (152 rows, `dienthoaivui`) have not had a price refreshed since the
 * day they were imported. Adding a campaign here is half the fix; the other half is putting its
 * slug in ACCESSTRADE_CAMPAIGNS on the box, and neither half works alone.
 *
 * ✅ THE OTHER HALF IS DONE. ACCESSTRADE_CAMPAIGNS was written to both container env files and
 * verified live on 2026-09-09 (`docker exec eno-vn-app printenv` and the forum sibling both
 * return `cellphones_cps,ben,dienthoaivui,tiki_creator`), and all four storefronts exist in prod
 * under exactly these names, NFC-normalized: CellphoneS 9,726 listings · Tiki 17,435 ·
 * BỀN COMPUTER 258 · Điện Thoại Vui 152. This mapping is therefore live, not inert.
 *
 * ⛔ A `Map`, NOT AN OBJECT LITERAL — and that is a correctness fix, not a style preference.
 * With a plain object, `MERCHANT_NAMES[campaign] ?? campaign` reads through Object.prototype, so
 * a campaign slug of `constructor` or `toString` returns a FUNCTION: `??` only catches
 * null/undefined, and an inherited method is neither. Measured — `merchantNameFor('constructor')`
 * returned `typeof 'function'` while the signature promises `string`, and the value then flows
 * straight into a `Seller.name` lookup. The slugs come from the operator-set ACCESSTRADE_CAMPAIGNS
 * env, so this is not attacker-reachable, but a typed function that can return a function is
 * wrong regardless of who can trigger it. A Map has no prototype chain to fall through.
 * (Found by all three review seats, 2026-09-09.)
 */
const MERCHANT_NAMES = new Map<string, string>([
  ['cellphones_cps', 'CellphoneS'],
  ['ben', 'BỀN COMPUTER'],
  ['dienthoaivui', 'Điện Thoại Vui'],
  ['tiki_creator', 'Tiki'],
])

export function merchantNameFor(campaign: string): string {
  return MERCHANT_NAMES.get(campaign) ?? campaign
}

/**
 * ⛔ `/deep_link/<pub>?url=` 500s at AccessTrade; `/deep_link/<pub>/<campaignId>?url=` works.
 * The feed hands out the broken shape, so every link is repaired on the way in. Anything that is
 * neither already well-formed nor repairable is REFUSED rather than shipped unexamined.
 */
export function repairAffLink(affLink: string | undefined, campaignId: string): string | null {
  if (!affLink) return null
  if (/\/deep_link\/\d+\/\d+/.test(affLink)) return affLink
  const fixed = affLink.replace(/\/deep_link\/(\d+)\?/, `/deep_link/$1/${campaignId}?`)
  return fixed === affLink ? null : fixed
}

/**
 * The price a feed row is actually selling at.
 * ⛔ A ZERO OR NEGATIVE PRICE RENDERS AS "Free / Miễn phí" (price.tsx) — return null so the caller
 * keeps the last good price instead of publishing a free iPhone.
 */
export function feedPrice(p: FeedRow): number | null {
  const discounted = Number(p.status_discount) === 1 && Number(p.discount) > 0 ? Number(p.discount) : Number(p.price)
  return Number.isFinite(discounted) && discounted > 0 ? discounted : null
}

export type ExistingListing = { id: string; externalId: string | null; price: number; affiliateUrl: string | null }
export type PriceChange = { id: string; externalId: string; from: number; to: number; affiliateUrl: string | null }

/**
 * Pure diff: which listings the feed actually moves. Separated from IO so the decisions worth
 * getting right — "never write a zero", "skip no-ops" — are unit-testable without a network.
 *
 * ⚠️ SKIPPING NO-OPS IS LOAD-BEARING, not an optimisation. `Listing.updatedAt` is `@updatedAt`, so
 * writing all 9,726 rows nightly would restamp the entire affiliate catalogue every day. No feed
 * sort reads updatedAt today (feed-query.ts orders on rankScore/postedAt/price), but trust.ts
 * approximates a sale date from it, and a table where every row changed last night is a table
 * nobody can debug from.
 */
export function diffPrices(
  existing: ExistingListing[],
  feed: Map<string, { price: number; affiliateUrl: string | null }>,
  /**
   * Every `externalId` the walk SAW, including rows whose price was unusable and dropped.
   *
   * ⛔ WITHOUT IT, "THE MERCHANT DELISTED THIS" AND "THIS ROW'S PRICE DID NOT PARSE" ARE THE SAME
   * SHAPE — both are simply absent from `feed` — and the retire pass below would mark a product
   * sold because the merchant published it at `price: 0` for one night. Callers that cannot supply
   * the set get the old behaviour: nothing is ever considered delisted.
   */
  seenIds?: ReadonlySet<string>,
) {
  const changes: PriceChange[] = []
  const missingIds: string[] = []
  const presentIds: string[] = []
  let unchanged = 0
  let missingFromFeed = 0
  for (const l of existing) {
    if (!l.externalId) continue
    const row = feed.get(l.externalId)
    /**
     * ⚠️ ABSENT ≠ DELISTED, AND THAT IS STILL TRUE — it is the caller, not this function, that
     * decides whether a walk was complete enough to act on. The list is handed back rather than
     * acted on here so the completeness floors stay next to the numbers that justify them.
     */
    if (!row) {
      missingFromFeed++
      if (seenIds && !seenIds.has(l.externalId)) missingIds.push(l.id)
      continue
    }
    presentIds.push(l.id)
    const priceMoved = row.price !== l.price
    const linkMoved = row.affiliateUrl != null && row.affiliateUrl !== l.affiliateUrl
    if (!priceMoved && !linkMoved) { unchanged++; continue }
    changes.push({ id: l.id, externalId: l.externalId, from: l.price, to: row.price, affiliateUrl: linkMoved ? row.affiliateUrl : null })
  }
  return { changes, unchanged, missingFromFeed, missingIds, presentIds }
}

/**
 * Move imported rows between `active` and `sold` to match what the merchant's datafeed still
 * carries. The mirror of what `/api/cron/partner-stock` does for the scraped shops.
 *
 * ⛔ IT WRITES `status` AND NOTHING ELSE. Not `soldChannel`, not `salePrice`, not `saleConfirmedAt`
 * — and NOT `soldAt`, which an earlier draft did write. A reviewer put it plainly: `soldAt`
 * describes a sale exactly as much as the columns beside it, and this repo's sold badges, sold
 * counts and PUBLIC seller trust read it. Writing it would have booked up to 17,435 Tiki
 * delistings as sales on a storefront's record. Its only justification was a feed window that was
 * reviewed and reversed in this same change, so it buys nothing and costs trust data.
 *
 * ⚠️ A ROW RETIRED HERE THEREFORE HAS `status='sold'` WITH A NULL `soldAt` AND A NULL
 * `soldChannel` — which is precisely the signature the restore below matches on.
 *
 * ⚠️ `updatedAt` MOVES HERE, unlike in `applyPriceChanges`' no-op skip, and it should: a row
 * changing availability is a real edit that the ISR flush must see.
 */
export async function applyStockReconcile(
  dbc: { $executeRaw: (q: Sql) => Promise<number> },
  sql: { sql: typeof Prisma.sql; join: typeof Prisma.join },
  ids: { retire: string[]; restore: string[] },
) {
  let retired = 0
  let restored = 0
  for (let i = 0; i < ids.retire.length; i += 500) {
    const chunk = ids.retire.slice(i, i + 500)
    retired += await dbc.$executeRaw(sql.sql`
      UPDATE "Listing" SET status = 'sold', "updatedAt" = now()
       WHERE id IN (${sql.join(chunk.map((id) => sql.sql`${id}`))}) AND status = 'active'
    `)
  }
  for (let i = 0; i < ids.restore.length; i += 500) {
    const chunk = ids.restore.slice(i, i + 500)
    /**
     * ⛔ `"soldChannel" IS NULL` IS THE GUARD THAT KEEPS THIS OFF REAL SALES. A storefront row is
     * retired by the clause above, which never sets `soldChannel`; a row sold THROUGH eno carries
     * `'eno'` or `'external'`. Without this predicate a datafeed that re-listed a SKU would
     * resurrect a listing a buyer had already bought.
     */
    // ⚖️ OUTSIDE THE SELLER IDENTITY GATE BY DESIGN — only the ownerless affiliate storefronts reach
    // this (no person to verify; see seller-publish-decision.ts). An owned seller here would need it.
    restored += await dbc.$executeRaw(sql.sql`
      UPDATE "Listing" SET status = 'active', "updatedAt" = now()
       WHERE id IN (${sql.join(chunk.map((id) => sql.sql`${id}`))})
         AND status = 'sold' AND "soldChannel" IS NULL AND "soldAt" IS NULL
    `)
  }
  return { retired, restored }
}

const API = 'https://api.accesstrade.vn/v1'

/** The campaign's numeric id, needed to repair every aff_link. Read from the API, never hardcoded. */
export async function campaignIdFor(campaign: string, key: string): Promise<string | null> {
  // ⚠️ `limit=50`. At limit>=100 this endpoint returns HTTP 200 with an EMPTY data array and no
  // `total` field — which reads exactly like "this publisher has no approved campaigns".
  const res = await fetch(`${API}/campaigns?approval=successful&limit=50`, { headers: { Authorization: `Token ${key}` }, signal: AbortSignal.timeout(45_000) })
  if (!res.ok) throw new Error(`campaigns: HTTP ${res.status}`)
  const json = (await res.json()) as { data?: { id: string; merchant: string }[] }
  return (json.data || []).find((c) => c.merchant === campaign)?.id ?? null
}

/**
 * Walk the whole datafeed into a map keyed by the same `externalId` the importer wrote.
 * ⛔ THE PAGE SIZE MUST NEVER SHRINK — AccessTrade's offsets are limit-relative, so asking for a
 * smaller final page re-reads the middle of the feed and the tail is never fetched at all, while
 * the progress counter still reaches 100%. Ask for a full page every time.
 */
export async function fetchFeedPrices(campaign: string, key: string, campaignId: string, onProgress?: (seen: number, total: number) => void) {
  const PAGE = 200
  const out = new Map<string, { price: number; affiliateUrl: string | null }>()
  // Every id the walk saw, INCLUDING the ones dropped for an unusable price — see the `seenIds`
  // note on diffPrices for why the two must not be conflated.
  const seenIds = new Set<string>()
  let total = Infinity
  let seen = 0
  let dropped = 0
  /**
   * ⚠️ A CEILING AS WELL AS THE EMPTY-PAGE BREAK. If page 1 ever omits `total`, the loop condition
   * is `seen < Infinity` and only `rows.length === 0` stops it. MEASURED 2026-08-25: page 999 of a
   * 49-page feed returns HTTP 200 with `data: []`, so today the break fires and this ceiling is
   * dead code. It exists because the cost of being wrong is a handler that hammers a partner's API
   * forever while the cron curl walks away at 900s and stacks another one tomorrow.
   */
  const MAX_PAGES = 500
  /**
   * ⛔ WHY THE LOOP ENDED IS THE WHOLE SIGNAL, AND NEITHER `seen` NOR `seenIds.size` CARRIES IT.
   * Comparing `seen >= total` alone treats an early empty page as a finished walk (600 of 1,000
   * rows, and the other 400 look delisted). Comparing `seenIds.size >= total` — the first attempt
   * at that fix — DEADLOCKS instead: `seenIds` holds DISTINCT ids while `total` counts rows, so one
   * duplicated SKU or one row with no id makes the set smaller than the total every night, forever,
   * and the reconcile never runs again. Both reviewers landed on that within one round.
   *
   * So the loop records whether it reached the total on its own terms. Duplicates padding `seen`
   * remain a coverage gap in theory; the caller's "still matching half our ACTIVE rows" floor is
   * what bounds that, and a bounded gap beats a permanent deadlock.
   */
  let endedEarly = false
  for (let page = 1; seen < total && page <= MAX_PAGES; page++) {
    const url = `${API}/datafeeds?campaign=${encodeURIComponent(campaign)}&limit=${PAGE}&page=${page}`
    const res = await fetch(url, { headers: { Authorization: `Token ${key}` }, signal: AbortSignal.timeout(45_000) })
    if (!res.ok) throw new Error(`datafeeds page ${page}: HTTP ${res.status}`)
    const json = (await res.json()) as { data?: FeedRow[]; total?: number }
    if (page === 1 && typeof json.total === 'number') total = json.total
    const rows = json.data || []
    // An empty page BEFORE the total is reached is a feed that stopped early, not a feed that ended.
    if (!rows.length) { endedEarly = seen < total; break }
    for (const p of rows) {
      seen++
      const externalId = String(p.sku || p.product_id || '').slice(0, 190)
      const price = feedPrice(p)
      if (externalId) seenIds.add(externalId)
      if (!externalId || price == null) { dropped++; continue }
      out.set(externalId, { price, affiliateUrl: repairAffLink(p.aff_link, campaignId) })
    }
    onProgress?.(seen, total)
  }
  /**
   * ⛔ "DID NOT THROW" IS NOT "WALKED THE WHOLE FEED", AND CONFLATING THEM CAN RETIRE A CATALOGUE.
   * This loop has THREE exits and only one of them means completion: `seen >= total` (done), an
   * empty page (`break` — a paginated endpoint that stopped early looks exactly like the end), and
   * MAX_PAGES. A reviewer put the number on it: 600 rows returned then an unexpected empty page
   * leaves 400 live listings absent from the map, and a caller that trusts a non-throwing walk
   * retires all 400.
   *
   * `complete` is true only when page 1 REPORTED a total and the walk reached it. A feed that omits
   * `total` is not a feed we may reconcile against — prices still refresh, nothing is retired.
   */
  const complete = Number.isFinite(total) && seen >= total && !endedEarly
  return { prices: out, seenIds, seen, complete, total: Number.isFinite(total) ? total : seen, dropped }
}

/**
 * Write the changes in chunked multi-row UPDATEs.
 * ⚠️ ONE STATEMENT PER CHUNK, not per row: 9,726 individual `db.listing.update` round trips took
 * minutes; a `FROM (VALUES …)` join does the same work in a few seconds. Chunked at 500 so a
 * single statement never approaches the parameter ceiling.
 */
export async function applyPriceChanges(
  dbc: { $executeRaw: (q: Sql) => Promise<number> },
  sql: { sql: typeof Prisma.sql; join: typeof Prisma.join },
  changes: PriceChange[],
) {
  let written = 0
  for (let i = 0; i < changes.length; i += 500) {
    const chunk = changes.slice(i, i + 500)
    const values = sql.join(chunk.map((c) => sql.sql`(${c.id}, ${c.to}::double precision, ${c.affiliateUrl}::text)`))
    // COALESCE keeps the existing link when this row's link did not move — the diff passes null
    // for "unchanged", and overwriting a good link with null would break the buy button.
    written += await dbc.$executeRaw(sql.sql`
      UPDATE "Listing" AS l
         SET price = v.price,
             "affiliateUrl" = COALESCE(v.aff, l."affiliateUrl"),
             "updatedAt" = now()
        FROM (VALUES ${values}) AS v(id, price, aff)
       WHERE l.id = v.id
    `)
  }
  return written
}
