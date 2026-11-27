import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { IS_SERVICES } from '@/lib/edition'
import { isEnoRunPartner } from '@/lib/eno-run-partners'
import { applyPriceChanges, applyStockReconcile, type PriceChange } from '@/lib/affiliate-price-refresh'
import { restockReport, screenRestock } from '@/lib/restock-screen'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { NEW_APPLE_PREFIX, NEW_APPLE_SHOPS, NEW_APPLE_STALE_MS, lineOfModel } from '@/lib/new-apple'
import { pageUrlOfTrackingLink, readProduct, type PageRead } from '@/lib/new-apple-read'
import { plausibleMove, plausibleNewPrice } from '@/lib/new-apple-text'

/**
 * ── THE NEW-APPLE NIGHT: PRICE AND STOCK OF THE `new:` ROWS, FROM EACH ROW'S OWN PRODUCT PAGE ──────────────────────────
 *
 * Owner 2026-11-26 (src/lib/new-apple.ts). /api/cron/new-apple, 22:31 UTC = 05:31 ICT — after the 03:01 datafeed and the
 * 04:31 crawl nights, and never inside their budgets (plan review): it walks no datafeed and reads no catalogue, only the
 * ~110 product pages its own rows point at (the page URL is the one inside the row's staff tracking link).
 *
 * Per row, from the page (src/lib/new-apple-read.ts):
 *   · in stock, same line, plausible price → the price is written if it moved (an unchanged one is STAMPED: updatedAt, which
 *     keeps it quoted — new-apple.ts NEW_APPLE_FRESH_MS); a `sold` row comes back (restock screen first).
 *   · OUT OF STOCK in the page's own markup, or 404/410 → an `active` row goes to `sold` (positive evidence only).
 *   · anything else → UNKNOWN: the row is left exactly as it is, and counted.
 * ⛔ NEVER CREATES (scripts/import-new-apple.ts does, by hand), never touches a row outside `new:` on the three pinned
 * storefronts, never a hidden/removed one (only `active` ↔ `sold`, through the same statements the used nights use).
 * ⛔ RED (502, the unit fails) when a storefront is not a pinned eno-run pair, when more than a quarter of a shop's ACTIVE rows
 * (and at least three) read UNKNOWN (a page layout changed under the reader) — then that shop is not written AT ALL — or when more rows would go to
 * sold than the night's cap — then none of its rows is sold: "half the catalogue sold out overnight" is a reader bug far more
 * often than a fact.
 * On eno.forum (IS_SERVICES) it only flushes: the two containers share one database but each serves its own cache.
 */

const PACE_MS = 1_500
/** Per SHOP, not per night (commit gate round 4): one shop whose pages hang never starves the shops read after it. */
const SHOP_BUDGET_MS = 5 * 60_000
const UNKNOWN_RED_FRACTION = 0.25
/** …and at least this many: one flaky page of a three-row shop is not a broken reader (commit gate round 3). */
const UNKNOWN_RED_MIN = 3
const RETIRE_CAP_FRACTION = 0.34
const RETIRE_CAP_FLOOR = 3
const FLUSH_LOOKBACK_MS = 26 * 3_600_000

/** The public pages that quote these rows (their tables and post blocks read newAppleOfferWhere). */
export const NEW_APPLE_PAGES = [
  '/iphone-18-vietnam', '/iphone-18-pro-vietnam', '/iphone-18-pro-max-vietnam', '/iphone-duo-vietnam',
  '/best-place-to-buy-iphone-vietnam', '/chinh-hang-vs-xach-tay-vietnam', '/iphone-chinh-hang-va-xach-tay', '/mua-iphone-o-dau-uy-tin',
] as const

type Row = { id: string; externalId: string | null; price: number; status: string; model: string | null; purchaseLink: { url: string; updatedAt: Date } | null }

export type RowVerdict =
  | { act: 'price'; to: number; restore: boolean }
  | { act: 'restore' }
  | { act: 'retire' }
  | { act: 'none' }
  | { act: 'unknown'; why: string }

/** What one row's page read means for it. Pure, so every branch is tested. */
export function verdictFor(row: Pick<Row, 'price' | 'status' | 'model'>, page: PageRead): RowVerdict {
  if (page.kind === 'gone' || page.kind === 'out') return row.status === 'active' ? { act: 'retire' } : { act: 'none' }
  if (page.kind === 'unknown') return { act: 'unknown', why: page.why }
  const line = lineOfModel(row.model)
  if (!line || !plausibleNewPrice(line, page.price)) return { act: 'unknown', why: `price ${page.price} not plausible for ${row.model}` }
  if (!plausibleMove(row.price, page.price)) return { act: 'unknown', why: `price ${row.price} → ${page.price} moved too far` }
  const restore = row.status === 'sold'
  if (page.price !== row.price) return { act: 'price', to: page.price, restore }
  return restore ? { act: 'restore' } : { act: 'none' }
}

/** The night's sold cap for a shop with `active` live rows: a third of them, at least three. */
export const retireCap = (active: number) => Math.max(RETIRE_CAP_FLOOR, Math.floor(active * RETIRE_CAP_FRACTION))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function flush(ids: string[]) {
  for (const id of new Set(ids)) revalidatePublicPath(`/listings/${id}`)
  if (ids.length) for (const p of NEW_APPLE_PAGES) revalidatePublicPath(p)
}

/**
 * ⛔ THE BACKSTOP OUTSIDE THIS JOB (commit gate round 6, opus): the 7-day stale rule above runs only when this nightly runs. The
 * used nights (affiliate-night.ts, 03:01 / 04:31, enabled) call this too, so an active `new:` row whose staff link has not been
 * confirmed for NEW_APPLE_STALE_MS goes to `sold` even if eno-cron-new-apple.timer is off or this route keeps failing. It reads
 * no shop page and touches only active `new:` rows of the three pinned storefronts. Reversible: a later in-stock read restores.
 */
export async function sellStaleNewApple(now: Date = new Date()): Promise<{ staleNewApple: number }> {
  // edition-lint-allow: a write job's read of its own `new:` rows on three pinned storefronts by id; never rendered.
  const stale = await db.listing.findMany({
    where: {
      sellerId: { in: NEW_APPLE_SHOPS.map((s) => s.sellerId) }, externalId: { startsWith: NEW_APPLE_PREFIX }, status: 'active',
      OR: [{ purchaseLink: null }, { purchaseLink: { updatedAt: { lt: new Date(now.getTime() - NEW_APPLE_STALE_MS) } } }],
    },
    select: { id: true },
  })
  if (!stale.length) return { staleNewApple: 0 }
  const ids = stale.map((r) => r.id)
  const { retired } = await applyStockReconcile(db, Prisma, { retire: ids, restore: [] })
  console.warn('new-apple: %d active rows unconfirmed for 7 days went to sold (backstop) — is eno-cron-new-apple.timer on?', retired)
  flush(ids)
  return { staleNewApple: retired }
}

export async function newAppleNight(now: Date = new Date()) {
  const results: Record<string, unknown>[] = []
  let red = false

  for (const shop of NEW_APPLE_SHOPS) {
    // edition-lint-allow: one pinned partner storefront by id (NEW_APPLE_SHOPS), read for its owner pair only.
    const seller = await db.seller.findUnique({ where: { id: shop.sellerId }, select: { id: true, ownerId: true, officialPartner: true } })
    if (!isEnoRunPartner(seller)) { red = true; results.push({ shop: shop.campaign, error: 'not_eno_run' }); continue }
    // edition-lint-allow: a write job's read of its own rows on three pinned storefronts; never rendered.
    const rows = (await db.listing.findMany({
      where: { sellerId: shop.sellerId, externalId: { startsWith: NEW_APPLE_PREFIX }, status: { in: ['active', 'sold'] } },
      // The least recently confirmed first (commit gate round 5): a night that runs out of budget skips a different tail
      // each time, never the same rows forever.
      orderBy: [{ purchaseLink: { updatedAt: 'asc' } }, { id: 'asc' }],
      select: { id: true, externalId: true, price: true, status: true, model: true, updatedAt: true, purchaseLink: { select: { url: true, updatedAt: true } } },
    })) as (Row & { updatedAt: Date })[]

    if (IS_SERVICES) {
      const recent = rows.filter((r) => r.updatedAt.getTime() >= now.getTime() - FLUSH_LOOKBACK_MS).map((r) => r.id)
      flush(recent)
      results.push({ shop: shop.campaign, flushedOnly: recent.length })
      continue
    }

    const deadline = Date.now() + SHOP_BUDGET_MS
    const changes: PriceChange[] = []
    const retire: string[] = []
    const restoreIds: string[] = []
    const confirmed: string[] = []
    const skipped: string[] = []
    const unknown: { id: string; why: string }[] = []
    for (const row of rows) {
      // Out of budget is NOT a reader failure (commit gate round 6): skipped rows are counted apart, never toward the alarm.
      if (Date.now() > deadline) { skipped.push(row.id); continue }
      const url = pageUrlOfTrackingLink(row.purchaseLink?.url)
      const sku = (row.externalId ?? '').slice(NEW_APPLE_PREFIX.length)
      if (!url || !sku || !row.model) { unknown.push({ id: row.id, why: 'no page url / sku / model' }); continue }
      await sleep(PACE_MS)
      const v = verdictFor(row, await readProduct(shop, url, sku, row.model))
      if (v.act === 'unknown') unknown.push({ id: row.id, why: v.why })
      else if (v.act === 'retire') retire.push(row.id)
      else if (v.act === 'restore') { restoreIds.push(row.id); confirmed.push(row.id) }
      else if (v.act === 'none') { if (row.status === 'active') confirmed.push(row.id) }
      else if (v.act === 'price') {
        changes.push({ id: row.id, externalId: row.externalId!, from: row.price, to: v.to, affiliateUrl: null })
        confirmed.push(row.id)
        if (v.restore) restoreIds.push(row.id)
      }
    }

    const active = rows.filter((r) => r.status === 'active').length
    // ⛔ OVER ACTIVE ROWS ONLY (commit gate round 5, opus): a SOLD row whose page now redirects to its successor reads UNKNOWN
    // every night by design; counted here, a shop's sold-out past would switch its reader off, stop every restore and
    // stamp, and let the stale rule sell the rest — a one-way door.
    const activeIds = new Set(rows.filter((r) => r.status === 'active').map((r) => r.id))
    const unknownActive = unknown.filter((u) => activeIds.has(u.id)).length
    const unknownRed = unknownActive >= UNKNOWN_RED_MIN && unknownActive > active * UNKNOWN_RED_FRACTION
    // ⛔ NO EVIDENCE FOR A WEEK IS NOT "IN STOCK" (commit gate round 3, opus): an active row whose page has not been confirmed in
    // NEW_APPLE_STALE_MS goes to `sold` whatever tonight's reader managed — a page that went quiet, a reader that broke, a
    // timer left off — so a sold-out "new, in stock" listing cannot stay up for good. Reversible: the night its page reads in
    // stock again it is restored (screened) like any other. Not capped and not held: it is the safe failure, and it is red.
    const confirmedNow = new Set(confirmed)
    const skippedNow = new Set(skipped)
    const stale = rows.filter((r) => r.status === 'active' && !confirmedNow.has(r.id) && !skippedNow.has(r.id) && (!r.purchaseLink || r.purchaseLink.updatedAt.getTime() < now.getTime() - NEW_APPLE_STALE_MS)).map((r) => r.id)
    const retireRed = retire.length > retireCap(active)
    // ⛔ AN UNTRUSTED READER WRITES NOTHING (commit gate rounds 1–2, opus): with a quarter of the shop's pages unreadable, its
    // prices, its restores and its "out of stock" are all suspect — the shop's rows stay exactly as they are, and age out of
    // the tables after three unconfirmed days (new-apple.ts NEW_APPLE_FRESH_MS). Too many sold at once holds the sales alone.
    const trusted = !unknownRed
    const holdSales = retireRed || unknownRed
    // Prices first: a restored row comes back at today's price (applyPriceChanges writes active and sold rows only, and
    // keeps the NULL public link — COALESCE(null, l."affiliateUrl")).
    const priced = trusted && changes.length ? await applyPriceChanges(db, Prisma, changes) : 0
    const retired = !holdSales && retire.length ? (await applyStockReconcile(db, Prisma, { retire, restore: [] })).retired : 0
    const screened = trusted && restoreIds.length ? await screenRestock(db, restoreIds, shop.name) : null
    const restored = screened?.restock.length ? (await applyStockReconcile(db, Prisma, { retire: [], restore: screened.restock })).restored : 0
    // A confirmed in-stock read stamps the row's staff link — the pages keep quoting it (new-apple.ts NEW_APPLE_FRESH_MS). The
    // LISTING is not touched: its updatedAt moves only on a real change (price, stock), so sitemap lastmod stays honest.
    const stamped = trusted && confirmed.length
      ? (await db.partnerPurchaseLink.updateMany({ where: { listingId: { in: confirmed }, listing: { externalId: { startsWith: NEW_APPLE_PREFIX }, sellerId: shop.sellerId } }, data: { updatedAt: new Date() } })).count
      : 0
    const staleSold = stale.length ? (await applyStockReconcile(db, Prisma, { retire: stale, restore: [] })).retired : 0
    if (stale.length) { red = true; console.warn('new-apple: %s %d active rows unconfirmed for 7 days went to sold', shop.campaign, stale.length) }
    if (unknownRed || retireRed) red = true
    if (holdSales && retire.length) console.warn('new-apple: %s would sell %d of %d active rows (cap %d, %d unknown) — none sold; check the page reader', shop.campaign, retire.length, active, retireCap(active), unknown.length)
    if (unknownRed) console.warn('new-apple: %s %d of %d active rows UNKNOWN — e.g. %s', shop.campaign, unknownActive, active, unknown.slice(0, 3).map((u) => u.why).join(' · '))
    flush([...changes.map((c) => c.id), ...(retired ? retire : []), ...(screened?.restock ?? []), ...(staleSold ? stale : [])])
    results.push({
      shop: shop.campaign, rows: rows.length, active, priced, retired, retireHeld: holdSales ? retire.length : 0, restored, stamped, staleSold, trusted, budgetSkipped: skipped.length,
      unknown: unknown.length, unknownSample: unknown.slice(0, 5), ...(screened ? restockReport(screened) : {}),
    })
  }

  if (red) return Response.json({ ok: false, results }, { status: 502 })
  return { ok: true, results }
}
