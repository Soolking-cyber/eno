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

/** The storefront name a campaign's products hang off. Mirrors import-accesstrade.ts. */
export function merchantNameFor(campaign: string): string {
  return campaign === 'cellphones_cps' ? 'CellphoneS' : campaign
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
export function diffPrices(existing: ExistingListing[], feed: Map<string, { price: number; affiliateUrl: string | null }>) {
  const changes: PriceChange[] = []
  let unchanged = 0
  let missingFromFeed = 0
  for (const l of existing) {
    if (!l.externalId) continue
    const row = feed.get(l.externalId)
    // ⚠️ ABSENT ≠ DELISTED. One failed page of a 49-page walk would look like thousands of
    // vanished products, so absence never hides a listing here — it is counted and reported.
    if (!row) { missingFromFeed++; continue }
    const priceMoved = row.price !== l.price
    const linkMoved = row.affiliateUrl != null && row.affiliateUrl !== l.affiliateUrl
    if (!priceMoved && !linkMoved) { unchanged++; continue }
    changes.push({ id: l.id, externalId: l.externalId, from: l.price, to: row.price, affiliateUrl: linkMoved ? row.affiliateUrl : null })
  }
  return { changes, unchanged, missingFromFeed }
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
  for (let page = 1; seen < total && page <= MAX_PAGES; page++) {
    const url = `${API}/datafeeds?campaign=${encodeURIComponent(campaign)}&limit=${PAGE}&page=${page}`
    const res = await fetch(url, { headers: { Authorization: `Token ${key}` }, signal: AbortSignal.timeout(45_000) })
    if (!res.ok) throw new Error(`datafeeds page ${page}: HTTP ${res.status}`)
    const json = (await res.json()) as { data?: FeedRow[]; total?: number }
    if (page === 1 && typeof json.total === 'number') total = json.total
    const rows = json.data || []
    if (!rows.length) break
    for (const p of rows) {
      seen++
      const externalId = String(p.sku || p.product_id || '').slice(0, 190)
      const price = feedPrice(p)
      if (!externalId || price == null) { dropped++; continue }
      out.set(externalId, { price, affiliateUrl: repairAffLink(p.aff_link, campaignId) })
    }
    onProgress?.(seen, total)
  }
  return { prices: out, seen, total: Number.isFinite(total) ? total : seen, dropped }
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
