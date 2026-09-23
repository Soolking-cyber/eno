import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import {
  applyPriceChanges, applyStockReconcile, campaignIdFor, diffPrices, fetchFeedPrices, merchantNameFor,
  type ExistingListing,
} from '@/lib/affiliate-price-refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600

// Daily price refresh for imported affiliate listings (owner, 2026-08-25: "fetch prices daily").
// Guarded by CRON_SECRET like every other job here; driven by the systemd timer installed by
// infra/vn-node/cron/install-cron-timers.sh.
//
// ⚠️ CALLED ON 127.0.0.1 WITH A Host HEADER, NOT THROUGH CLOUDFLARE — which is what makes a
// multi-minute walk of a ~9,700-row datafeed legal. Cloudflare cuts a request at 100s; the timer's
// eno-cron.sh curl allows 900. Do not "helpfully" expose this on the public hostname.
const CAMPAIGNS = (process.env.ACCESSTRADE_CAMPAIGNS || 'cellphones_cps').split(',').map((s) => s.trim()).filter(Boolean)
// Wider than the 24h cadence on purpose: a missed night, a manual CLI run, or the sibling edition
// calling later in the day must all still find the rows that moved.
const REVALIDATE_LOOKBACK_MS = 48 * 60 * 60 * 1000
const REVALIDATE_CAP = 3000

/**
 * ⛔ A FAILED WALK MUST NOT RETIRE A CATALOGUE, AND "FAILED" IS NOT ONLY "THREW". These two floors
 * are lifted verbatim in spirit from /api/cron/partner-stock, which learned them the expensive way:
 * "not in the feed" and "the feed did not load" are the same shape in a short result, and treating
 * them alike marks a working merchant's entire inventory sold the first night their API has a bad
 * minute. `fetchFeedPrices` throws on a non-200, but it also BREAKS on the first empty page — a
 * paginated endpoint that stops early clears no error bar at all, and that is the case these catch.
 *
 * ⚠️ 17,435 Tiki rows retired by mistake is not a tidy mistake to undo: each one flips to `sold`,
 * leaves the Google and Meta catalogues, and takes its accumulated matching with it.
 */
const MIN_ROWS_TO_RECONCILE = 20
const MIN_FEED_FRACTION = 0.5

/**
 * ⛔ AND A CEILING ON WHAT ONE NIGHT MAY RETIRE, BECAUSE THE FLOORS ABOVE CANNOT BE MADE EXACT.
 * Two reviewers converged on the same residual after three rounds: `complete` compares a RAW row
 * count against a total read on page 1, so duplicated rows — or a catalogue that shrinks during a
 * 49-page walk that takes minutes — can reach the total before the tail is read. The floors then
 * pass on the 51% that WAS read and the unread tail looks delisted. Their number: ~8,700 Tiki rows
 * in one night.
 *
 * Making the completeness test exact is what produced the deadlock this file already fixed once
 * (`seenIds.size >= total` is false forever on one duplicate SKU). So the answer is not a better
 * oracle, it is a blast radius: a merchant really dropping a tenth of their catalogue overnight is
 * an event a human should look at, and a bug that wants to retire half of it is stopped at the same
 * line. Prices still refresh; restores still run; only the absence-inference is held back.
 */
const MAX_RETIRE_FRACTION = 0.1
const MAX_RETIRE_FLOOR = 25

/**
 * ⛔ THE WRITE IS NOT THE SHIP. `/listings/[id]` is `export const revalidate = 2592000` — THIRTY
 * DAYS — because it is a high-cardinality route whose real edits all revalidate on demand. A raw
 * SQL UPDATE fires no Prisma hook and no route handler, so without this a refreshed price sits
 * correct in the database and wrong on the page for up to a month. That is worse than not
 * refreshing at all: it is the "prices are current" promise, unkept, invisibly.
 *
 * ⛔ AND IT IS NOT ENOUGH TO FLUSH *THIS RUN'S* CHANGES. Three ways a row ends up written but
 * un-flushed, all real:
 *   · scripts/refresh-affiliate-prices.ts --apply writes the same rows with no Next runtime, so it
 *     cannot revalidate. The next cron run then sees DB == feed, finds zero changes, and flushes
 *     nothing — the stale pages are invisible to the only thing that could fix them. That is
 *     exactly what happened on 2026-08-25 with 192 rows applied from the CLI.
 *   · revalidatePath only flushes THE CONTAINER THAT SERVED THE REQUEST, and the box runs two —
 *     eno-vn:3001 and eno-forum:3002 — off one shared database.
 *   · eno-forum's env has no ACCESSTRADE_KEY, so its call cannot fetch. It must still flush, which
 *     is why this runs BEFORE the key check and not after it.
 * So the flush set is "changed by me" ∪ "changed recently by anyone", and a second call from
 * either edition costs nothing and repairs the other two cases.
 */
async function flushRecent(sellerId: string, alsoIds: string[] = []) {
  const recent = await db.listing.findMany({
    where: { sellerId, externalId: { not: null }, updatedAt: { gte: new Date(Date.now() - REVALIDATE_LOOKBACK_MS) } },
    select: { id: true },
  })
  const ids = [...new Set([...alsoIds, ...recent.map((r) => r.id)])]
  /**
   * ⚠️ PAST THE CAP, FLUSH THE ROUTE INSTEAD OF TRUNCATING. A silent top-N reads as "everything
   * was flushed" while thousands of pages stay stale — the exact failure this job exists to avoid.
   * Next can invalidate every page of a dynamic route by its PATTERN, which is one call regardless
   * of catalogue size. It is the blunter instrument (every listing page regenerates on next hit,
   * not just the affiliate ones), so it is the fallback, not the default: a normal night moves a
   * couple of hundred rows and those get a precise flush.
   */
  if (ids.length > REVALIDATE_CAP) {
    revalidatePublicPath('/listings/[id]', 'layout')
    return { revalidated: 'whole-route', wanted: ids.length }
  }
  for (const id of ids) revalidatePublicPath(`/listings/${id}`)
  return { revalidated: ids.length }
}

export const GET = route({ auth: 'cron' }, async () => {
  const key = process.env.ACCESSTRADE_KEY
  const results: Record<string, unknown>[] = []

  for (const campaign of CAMPAIGNS) {
    // ⛔ `ownerId: null`. Seller.name is NOT unique — anyone can open a storefront called
    // "CellphoneS" — and this job rewrites prices and buy links in bulk. An owned storefront
    // belongs to a real person and is never a datafeed target.
    const seller = await db.seller.findFirst({ where: { name: merchantNameFor(campaign), ownerId: null }, select: { id: true } })
    if (!seller) { results.push({ campaign, error: 'no_storefront' }); continue }

    // ⛔ NO KEY = FLUSH ONLY, AND STILL A 200. This is the forum edition's whole job (its env has no
    // ACCESSTRADE_KEY and does not need one), and it is also how the route behaves anywhere the
    // secret is not provisioned — a nightly red unit trains everyone to ignore failed units, so it
    // reports what it did instead of failing.
    // ✅ eno-vn's env HAS the key as of 2026-08-25 (/opt/eno/secrets/eno-vn.env), so the marketplace
    //    container takes the full path below. It is not in the repo and never should be.
    if (!key) { results.push({ campaign, skipped: 'no_key', ...(await flushRecent(seller.id)) }); continue }

    const campaignId = await campaignIdFor(campaign, key)
    // ⛔ Not approved = the links earn nothing and may not resolve. Report, never guess an id.
    if (!campaignId) { results.push({ campaign, error: 'not_an_approved_campaign' }); continue }

    const { prices, seenIds, seen, complete, dropped } = await fetchFeedPrices(campaign, key, campaignId)
    /**
     * ⚠️ NO `status` PREDICATE, DELIBERATELY. The rows this job must look at include the ones it
     * retired on an earlier night: a SKU the merchant re-lists has to be found here before it can
     * be restored, and filtering to `active` would make every retire permanent.
     */
    const existing = (await db.listing.findMany({
      where: { sellerId: seller.id, externalId: { not: null } },
      select: { id: true, externalId: true, price: true, affiliateUrl: true, status: true },
    })) as (ExistingListing & { status: string })[]

    const { changes, unchanged, missingFromFeed, missingIds, presentIds } = diffPrices(existing, prices, seenIds)
    const written = await applyPriceChanges(db, Prisma, changes)

    /**
     * ⛔ THREE CONDITIONS, AND THE FIRST DRAFT HAD ONLY THE WEAKEST TWO. A reviewer refuted it with
     * a case that still stands as the test: 1,000 listings, 600 rows returned, then an unexpected
     * empty page — both row floors pass and the other 400 live listings retire. Worse, `seen`
     * counts RAW ROWS, so 500 products belonging to some other part of the merchant's catalogue
     * clear the floor while matching none of ours, and the pass would retire all 1,000.
     *
     * So: (1) the walk must have REACHED THE TOTAL the API reported (`complete` — the fix for the
     * early break), (2) it must have matched at least half of what we hold (`presentIds`, not
     * `seen` — the fix for unrelated rows clearing a raw-row floor), and (3) the absolute floor
     * stays, because a fraction of a handful is meaningless.
     */
    const byId = new Map(existing.map((l) => [l.id, l]))
    /**
     * ⛔ BOTH SIDES OF THE FRACTION MUST COUNT THE SAME POPULATION. `presentIds` carries every
     * matched row INCLUDING previously-retired ones — that is how a restore is detected — so
     * comparing it against the ACTIVE held count compares two different sets. A reviewer supplied
     * the arithmetic: 100 active rows, 900 old retired ones, a walk that re-lists the 900 and
     * matches 5 of the active → `matched` 905 clears `activeHeld*0.5` = 50, and the pass retires
     * the other 95 live listings. Restricting the numerator to active rows is what makes the
     * sentence "we still see at least half of our live stock" true of the code.
     *
     * ⛔ AND THE DENOMINATOR IS ACTIVE ROWS, NOT EVERYTHING WE HOLD, OR THE JOB BRICKS ITSELF.
     * `existing` has no `status` filter by design, so it only grows as stock churns. Measured
     * against all held rows the fraction ratchets downward forever, and the first night cumulative
     * retirements pass 50% the pass stops running and never runs again — reporting a tidy
     * `incomplete_walk` while the catalogue goes stale. Against active rows it is stable: retire
     * one and both sides shrink together.
     */
    const activeHeld = existing.filter((l) => l.status === 'active').length
    const matchedActive = presentIds.filter((id) => byId.get(id)?.status === 'active').length

    /**
     * ⛔ RETIRING AND RESTORING DO NOT DESERVE THE SAME GATE, AND ONE BOOLEAN FOR BOTH IS A BUG IN
     * ITS OWN RIGHT. Retiring acts on ABSENCE, which is an inference that a partial walk makes
     * wrong — it needs every floor. Restoring acts on PRESENCE: the merchant's feed positively
     * listed this SKU, and no amount of missing pages makes that observation false. Fusing them
     * meant a merchant with 19 held rows could re-list all 19 in a perfect feed and stay sold
     * forever (the 20-row floor), and a >50% catalogue rotation deadlocked BOTH directions with no
     * way back — `activeHeld` could never recover, because recovery is exactly what was blocked.
     */
    const retireCandidates = missingIds.filter((id) => byId.get(id)?.status === 'active')
    const retireCap = Math.max(MAX_RETIRE_FLOOR, Math.floor(activeHeld * MAX_RETIRE_FRACTION))
    // ⚠️ REFUSED WHOLESALE, NOT TRUNCATED TO THE CAP. Retiring "the first 870 of 8,700" would be
    // the same wrong inference, applied to an arbitrary tenth of it, and it would look like a
    // healthy night in the logs.
    const cappedOut = retireCandidates.length > retireCap
    const mayRetire = complete && !cappedOut
      && matchedActive >= MIN_ROWS_TO_RECONCILE && matchedActive >= activeHeld * MIN_FEED_FRACTION
    const stock = await applyStockReconcile(db, Prisma, {
      retire: mayRetire ? retireCandidates : [],
      /**
       * ⚠️ NO COMPLETENESS GATE, WHICH IS THE POINT OF SPLITTING THEM. An earlier draft wrote
       * `complete ? … : []` here and all three reviewers caught it contradicting the paragraph
       * above: a partial walk cannot falsify a SKU it positively returned. Gating this was also
       * the half that made a rotation deadlock unrecoverable.
       */
      restore: presentIds.filter((id) => byId.get(id)?.status === 'sold'),
    })
    // ⚠️ A BLOCKED RETIRE IS REPORTED, NOT SWALLOWED. A campaign that stops retiring because its
    // merchant rotated most of its catalogue is a thing a human should see, not a silent no-op.
    if (!mayRetire) console.warn('affiliate-prices: %s retire BLOCKED — complete=%s matchedActive=%d activeHeld=%d candidates=%d cap=%d', campaign, complete, matchedActive, activeHeld, retireCandidates.length, retireCap)

    results.push({
      campaign, feedRows: seen, feedDropped: dropped, listings: existing.length,
      changed: written, unchanged, missingFromFeed, stock, mayRetire, cappedOut,
      matchedActive, activeHeld, retireCandidates: retireCandidates.length, retireCap,
      /**
       * ⚠️ RETIRED AND RESTORED ROWS MUST FLUSH TOO. `flushRecent` already sweeps anything whose
       * `updatedAt` moved in the last 48h and the reconcile stamps it, so they are covered — but
       * only because the reconcile runs BEFORE this line. Keep that order.
       */
      ...(await flushRecent(seller.id, changes.map((c) => c.id))),
    })
  }
  return { ok: true, results }
})
