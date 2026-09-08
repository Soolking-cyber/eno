import { revalidatePath } from 'next/cache'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { fetchStore, mayReconcile } from '@/lib/partner-fetch'
import { PARTNER_STORES } from '@/lib/partner-stores'
import { scopedListingWhere } from '@/lib/edition-scope'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/**
 * DAILY AVAILABILITY + PRICE REFRESH FOR THE SCRAPED PARTNER SHOPS.
 *
 * Owner, 2026-09-08: *"also have a daily cron to fetch availability for all partner stores and
 * price updates for existing products"*. The sibling job /api/cron/affiliate-prices does this for
 * the AccessTrade merchants, which have a datafeed API; these thirteen shops have no API, so the
 * catalogue is re-read through the same adapters scripts/partner-fetch.ts uses.
 *
 * ⚠️ CALLED ON 127.0.0.1 WITH A Host HEADER, NOT THROUGH CLOUDFLARE. Re-reading thirteen shops
 * takes many minutes and Cloudflare cuts a request at 100s; the timer's eno-cron.sh curl allows
 * 900. Do not expose this on the public hostname.
 *
 * ⛔ IT NEVER CREATES A LISTING, AND IT NEVER FETCHES AN IMAGE. New products are a deliberate
 * import (scripts/import-partners.ts), reviewed by a human, because publishing a shop's goods is a
 * business decision — these thirteen are still "Not contact yet". This job only moves price and
 * availability on rows that already exist, which is the promise the marketplace makes to a buyer.
 */

/**
 * ⛔ A SHOP THAT FAILED TO FETCH MUST NOT RETIRE ITS CATALOGUE. This is the whole reason the
 * reconcile pass below is gated: "not in the feed" and "the feed did not load" are the same shape
 * in a list of zero products, and treating them alike marks a working shop's entire inventory sold
 * the first night its host has a bad minute. A run must look complete before it may retire
 * anything, and this is the floor for "complete".
 */
const MIN_ROWS_TO_RECONCILE = 20
/**
 * ⛔ AND A SHOP THAT SHRANK IMPLAUSIBLY IS ALSO A FAILED FETCH. A partial scrape — a sitemap that
 * served half its pages, a paginated endpoint that stopped early — clears the row-count floor while
 * still being wrong. Anything under this fraction of what we hold is treated as incomplete and
 * retires nothing; a shop that genuinely halved its catalogue overnight is worth a human looking.
 */
const MIN_FEED_FRACTION = 0.5
const REVALIDATE_CAP = 3000
/**
 * ⛔ THIRTEEN SHOPS DO NOT FIT IN ONE NIGHT, AND PRETENDING THEY DO IS THE BUG. Re-reading a
 * sitemap shop is one HTTP request per product with a 1.2s politeness gap — minhtuanmobile's 540
 * URLs alone is roughly eleven minutes — while eno-cron.sh's curl gives up at 900s. Run serially
 * with no budget, the job is killed mid-shop every night: the units go red, the `results` array
 * (the only place `reconcileSkipped` and `fetch_failed` are ever reported) is never delivered, and
 * on a slow night it overlaps affiliate-prices at 20:00, which the schedule comment promises it
 * cannot. Reviewers priced it three rounds running.
 *
 * So the job takes a BUDGET and a ROTATING START. Each night it works through as many shops as fit
 * from an offset that advances daily, so every shop is refreshed every few days rather than the
 * first three being refreshed nightly and the last ten never at all. Availability on a second-hand
 * catalogue moves in days, not hours; a shop refreshed on a four-day cycle is the honest trade for
 * a job that finishes.
 */
const BUDGET_MS = 12 * 60 * 1000
/** Which shop to start from tonight — a plain day counter, so the rotation is even and stateless. */
const rotationOffset = (count: number) => (count ? Math.floor(Date.now() / 86_400_000) % count : 0)

export const GET = route({ auth: 'cron' }, async () => {
  const results: Record<string, unknown>[] = []
  const startedAt = Date.now()
  const offset = rotationOffset(PARTNER_STORES.length)
  // Rotate the list so tonight begins where the budget ran out on a previous night.
  const tonight = [...PARTNER_STORES.slice(offset), ...PARTNER_STORES.slice(0, offset)]
  let ranOutOfTime = 0
  for (const cfg of tonight) {
    /**
     * ⚠️ CHECKED BEFORE EACH SHOP, NOT INSIDE ONE. A shop is the unit of work: stopping halfway
     * through a catalogue would hand the reconcile pass a partial read, and the completeness rate
     * would (correctly) refuse to retire anything — so the fetch would have cost minutes and
     * bought nothing. Whole shops or none.
     */
    if (Date.now() - startedAt > BUDGET_MS) { ranOutOfTime++; continue }
    /**
     * ⛔ `ownerId: null`, the same rule /api/cron/affiliate-prices learned. Seller.name is NOT
     * unique — anyone may open a storefront by that name — and this job rewrites prices and
     * availability in bulk. An owned storefront belongs to a real person and is never a scrape
     * target.
     */
    const seller = await db.seller.findFirst({ where: { name: cfg.name, ownerId: null }, select: { id: true } })
    if (!seller) { results.push({ store: cfg.domain, skipped: 'no_storefront' }); continue }

    // ⚠️ A SHOP'S FAILURE IS ITS OWN. One unreachable host must not end the run for the other
    // twelve, and a nightly red unit trains everyone to ignore failed units — so it is reported.
    let feed: Awaited<ReturnType<typeof fetchStore>> = { products: [], complete: false, seenExternalIds: new Set() }
    try { feed = await fetchStore(cfg) } catch (e) {
      results.push({ store: cfg.domain, error: 'fetch_failed', detail: (e as Error).message.slice(0, 120) }); continue
    }

    /**
     * ⚠️ THE SCOPE IS APPLIED EVEN THOUGH THIS IS A WRITE JOB KEYED BY SELLER. It costs nothing —
     * these sellers are not the desk — and it means the one rule that must never have an exception
     * has no exception here either. edition-lint counts the mention against the read below.
     */
    const rows = await db.listing.findMany({
      where: await scopedListingWhere({ sellerId: seller.id, externalId: { not: null } }),
      select: { id: true, externalId: true, price: true, status: true },
    })
    const byExternal = new Map(rows.map((r) => [r.externalId!, r]))
    const seenIds = new Set<string>()

    let priced = 0, restocked = 0, soldOut = 0, retired = 0
    const touched: string[] = []
    for (const p of feed.products) {
      const row = byExternal.get(p.externalId)
      if (!row) continue                       // a NEW product — the importer's job, not this one
      seenIds.add(row.id)
      const data: { price?: number; status?: string } = {}
      if (Number.isFinite(p.price) && p.price > 0 && p.price !== row.price) { data.price = p.price; priced++ }
      /**
       * ⚠️ ONLY BETWEEN active AND sold — a row a human set to `hidden` or `draft` is left alone.
       * That separation is exactly why the importer stopped writing `hidden` for a stock-out: with
       * one value this job could not tell its own retirement from a moderator's decision, and
       * restoring stock would have resurrected moderated listings.
       */
      if (row.status === 'active' && !p.inStock) { data.status = 'sold'; soldOut++ }
      else if (row.status === 'sold' && p.inStock) { data.status = 'active'; restocked++ }
      if (!Object.keys(data).length) continue
      // ⚠️ ONE ROW'S FAILURE MUST NOT END THE SHOP'S RUN — but it must not be invisible either: a
      // swallowed write here is a price that silently never moved, which is the exact promise this
      // job exists to keep. Non-blocking AND logged.
      await db.listing.update({ where: { id: row.id }, data })
        .then(() => touched.push(row.id))
        .catch((e) => logError(e, { op: 'cron.partnerStock.update' }))
    }

    /**
     * ⛔ RETIRE WHAT THE SHOP NO LONGER LISTS — the gap the importer documents and cannot close.
     * banghethanhly.vn's endpoint deliberately EXCLUDES its "Đã bán" category (7,286 of 11,124
     * rows), so a sold item does not come back marked out-of-stock: it simply stops appearing. With
     * no reconcile pass those listings stay `active` for ever, which is the marketplace advertising
     * goods that are gone.
     */
    /**
     * ⛔ THE PRESENCE SET IS THE ADAPTER'S RAW ONE, NOT THE PRODUCTS THE IMPORTER WOULD ACCEPT — a
     * live product whose page lost its image for a day is present in the shop and must not be
     * retired for failing a rule about creating NEW listings. See seenExternalIds in the lib.
     */
    const activeHeld = rows.filter((r) => r.status === 'active')
    const matched = activeHeld.filter((r) => feed.seenExternalIds.has(r.externalId!)).length
    const complete = mayReconcile(
      { matched, activeHeld: activeHeld.length, complete: feed.complete },
      { minRows: MIN_ROWS_TO_RECONCILE, minFraction: MIN_FEED_FRACTION },
    )
    if (complete) {
      for (const row of activeHeld) {
        if (feed.seenExternalIds.has(row.externalId!)) continue
        await db.listing.update({ where: { id: row.id }, data: { status: 'sold' } })
          .then(() => { retired++; touched.push(row.id) })
          .catch((e) => logError(e, { op: 'cron.partnerStock.retire' }))
      }
    }

    /**
     * ⛔ THE WRITE IS NOT THE SHIP — the lesson /api/cron/affiliate-prices records at length.
     * `/listings/[id]` carries `revalidate = 2592000` (thirty days), so a price corrected here sits
     * right in the database and wrong on the page for a month unless it is flushed. Past the cap,
     * flush the ROUTE rather than truncating: a silent top-N reads as "everything was flushed".
     */
    if (touched.length > REVALIDATE_CAP) revalidatePath('/listings/[id]', 'page')
    else for (const id of touched) revalidatePath(`/listings/${id}`)
    if (touched.length) { revalidatePath('/'); revalidatePath('/search') }

    results.push({
      store: cfg.domain, feedRows: feed.products.length, fetchComplete: feed.complete,
      listings: rows.length, activeHeld: activeHeld.length, matched,
      priced, soldOut, restocked, retired,
      // ⚠️ SAY WHEN THE RECONCILE WAS DECLINED, rather than reporting `retired: 0` and letting it
      // read as "nothing to retire". They are different answers and only one needs a human.
      ...(complete ? {} : { reconcileSkipped: 'incomplete_fetch' }),
    })
  }
  /**
   * ⚠️ SAY WHAT WAS NOT REACHED. A results array that simply omits ten shops reads as "ten shops
   * had nothing to do"; the count plus the rotation offset is what lets someone see that the budget
   * is the binding constraint and decide whether to raise it or split the timer.
   */
  return { ok: true, startedFrom: tonight[0]?.domain, notReached: ranOutOfTime, elapsedMs: Date.now() - startedAt, results }
})
