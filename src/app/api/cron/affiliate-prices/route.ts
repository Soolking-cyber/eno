import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import {
  applyPriceChanges, applyStockReconcile, campaignIdFor, campaignsFromEnv, diffPrices, fetchFeedPrices, merchantNameFor,
  type ExistingListing,
} from '@/lib/affiliate-price-refresh'
import { restockReport, screenRestock } from '@/lib/restock-screen'
import { keepUsedRows } from '@/lib/accesstrade-restore'
import { importableCampaign } from '@/lib/retired-imports'

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
// ⛔ THE CAMPAIGN LIST IS READ PER REQUEST, AND UNSET/EMPTY MEANS NONE (campaignsFromEnv). It was a
// module constant defaulting to 'cellphones_cps', so emptying the env re-armed CellphoneS.
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
  // ⛔ One time budget for every AccessTrade call of the night (codex, diff review round 4): eno-cron.sh's curl gives up at
  // 900 s, and 429 retries are bounded per call, not per walk. 12 min leaves the DB work its room; out of time, the walk
  // throws, counts as incomplete and retires nothing (accessTradeGet).
  const budget = { deadline: Date.now() + 12 * 60_000 }
  const campaigns = campaignsFromEnv(process.env.ACCESSTRADE_CAMPAIGNS)
  // A 200, not an error: an empty list is a configuration ("walk nothing"), and a red unit every night
  // would train everyone to ignore failed units.
  if (!campaigns.length) {
    // ⚠️ SAID OUT LOUD (commit-gate review): a 200 that walks nothing must still show in the journal, or an
    // env that lost its value looks like a healthy night while the kept stock's prices go stale.
    console.warn('affiliate-prices: ACCESSTRADE_CAMPAIGNS is unset or empty — no campaign walked (expected: cellphones_cps,dienthoaivui)')
    return { ok: true, results, skipped: 'no_campaigns' }
  }

  let failed = 0
  let blocked = 0
  for (const [i, campaign] of campaigns.entries()) {
    // Where this campaign writes, and what it has already moved to sold: on a later throw everything it committed is
    // purged anyway (codex, gate rounds 11 + 13) — flushRecent sweeps every row whose updatedAt moved in 48 h, which is
    // every price, stock and sold write, plus the not-used rows by id.
    let sellerNow: string | null = null
    let retiredNow: string[] = []
    // ⛔ A FAIR SHARE of what is left, per campaign (codex, gate round 7): one slow shop cannot spend the next one's time.
    const share = { deadline: Date.now() + Math.floor(Math.max(0, budget.deadline - Date.now()) / (campaigns.length - i)) }
    /**
     * ⛔ ONE SHOP'S FAILURE IS THAT SHOP'S (commit gate, opus 2026-11-14): a 429 past its retries or the night's budget
     * running out throws out of the walk, and without this the next campaign was never walked. A throw from the walk
     * comes before any write, so that shop changes nothing tonight; a throw from the writes after it can leave prices
     * written and pages unflushed until the next night's 48-hour sweep. Either way the unit goes red below.
     */
    try {
      // ⛔ `ownerId: null`. Seller.name is NOT unique — anyone can open a storefront called
      // "CellphoneS" — and this job rewrites prices and buy links in bulk. An owned storefront
      // belongs to a real person and is never a datafeed target.
      const seller = await db.seller.findFirst({ where: { name: merchantNameFor(campaign), ownerId: null }, select: { id: true } })
      // A configured campaign that cannot refresh is a failure, red like a throw (codex, gate round 9).
      if (!seller) { failed++; results.push({ campaign, error: 'no_storefront' }); continue }
      sellerNow = seller.id

      // ⛔ NO KEY = FLUSH ONLY, AND STILL A 200. This is the forum edition's whole job (its env has no
      // ACCESSTRADE_KEY and does not need one), and it is also how the route behaves anywhere the
      // secret is not provisioned — a nightly red unit trains everyone to ignore failed units, so it
      // reports what it did instead of failing.
      // ✅ eno-vn's env HAS the key as of 2026-08-25 (/opt/eno/secrets/eno-vn.env), so the marketplace
      //    container takes the full path below. It is not in the repo and never should be.
      if (!key) { results.push({ campaign, skipped: 'no_key', ...(await flushRecent(seller.id)) }); continue }

      const campaignId = await campaignIdFor(campaign, key, share)
      // ⛔ Not approved = the links earn nothing and may not resolve. Report, never guess an id.
      if (!campaignId) { failed++; results.push({ campaign, error: 'not_an_approved_campaign' }); continue }

      const { prices, unpriced, seenIds, seen, complete, dropped } = await fetchFeedPrices(campaign, key, campaignId, undefined, share)
      // ⛔ A used-only campaign keeps only what the importer's own rule still calls used (src/lib/accesstrade-restore.ts);
      // the SKUs it refuses are handled below, before the reconcile.
      const notUsedSkus = importableCampaign(campaign)?.usedOnly ? keepUsedRows(prices, unpriced) : new Set<string>()
      /**
       * ⚠️ NO `status` PREDICATE, DELIBERATELY. The rows this job must look at include the ones it
       * retired on an earlier night: a SKU the merchant re-lists has to be found here before it can
       * be restored, and filtering to `active` would make every retire permanent.
       */
      const held = (await db.listing.findMany({
        where: { sellerId: seller.id, externalId: { not: null } },
        select: { id: true, externalId: true, price: true, affiliateUrl: true, status: true, condition: true },
      })) as (ExistingListing & { status: string; condition: string | null })[]
      /**
       * ⛔ A SKU THE SHOP NOW SELLS AS NEW IS POSITIVE EVIDENCE, NOT ABSENCE (commit gate, codex 2026-11-14). Left to the
       * reconcile it would read as "missing", and the retire floors (≥20 matched, ≥50%, the cap) exist to stop absence
       * being over-read — they could keep a now-new row up as used. So those rows leave the reconcile, and the ACTIVE ones
       * go to `sold` through the retire's own statement: the noindexed sold page, no buy link. A sold row stays sold.
       * ⛔ `sold`, NOT `hidden` (commit gate round 3, codex + opus): sold is the state the restock reads, so the night the
       * shop calls that SKU used again it comes back, screened — a rule or feed that briefly stops recognising the shelf
       * cannot strand it.
       * ⛔ AND NEVER CAPPED (commit gate round 6, codex): because it is reversible, a cap only kept known-new goods up as
       * used. More than a night's retire budget of them is still done — and turns the unit red, since that many at once
       * more likely means isUsedTitle (src/lib/used-signal.ts) stopped recognising the shop's names: fix the rule and the
       * restock brings them back.
       */
      // ⛔ …and a row not STORED as used is not this shelf's either (owner 2026-11-14: "2nd hand only"; codex, gate rounds
      // 11–12): out of the reconcile, and to sold if active, the same way.
      const usedOnly = !!importableCampaign(campaign)?.usedOnly
      const offShelf = (l: (typeof held)[number]) => (!!l.externalId && notUsedSkus.has(l.externalId)) || (usedOnly && l.condition !== 'used')
      const nowNew = held.filter((l) => l.status === 'active' && offShelf(l)).map((l) => l.id)
      const activeAll = held.filter((l) => l.status === 'active').length
      // ⛔ ONE RETIRE BUDGET A NIGHT (codex, gate round 5): at most max(MAX_RETIRE_FLOOR, a tenth of the shop's live rows).
      // The not-used pass spends from it first; the ordinary retire below gets what is left — none when it is spent.
      const nightRetireCap = Math.max(MAX_RETIRE_FLOOR, Math.floor(activeAll * MAX_RETIRE_FRACTION))
      const nowNewAlarm = nowNew.length > nightRetireCap
      const soldNotUsed = nowNew.length ? (await applyStockReconcile(db, Prisma, { retire: nowNew, restore: [] })).retired : 0
      retiredNow = nowNew
      if (nowNewAlarm) {
        blocked++
        console.warn('affiliate-prices: %s %d active rows the shop no longer calls used went to sold (budget %d) — check isUsedTitle against the feed; e.g. SKUs %s', campaign, nowNew.length, nightRetireCap, [...notUsedSkus].slice(0, 5).join(', '))
      }
      const existing = held.filter((l) => !offShelf(l))

      const diff = diffPrices(existing, prices, seenIds)
      const { unchanged, missingFromFeed, missingIds, presentIds } = diff
      // Only active/sold rows take a price (applyPriceChanges) — so only they count as changes, or a hidden
      // row whose feed price moved would be re-flushed every night and push the batch past REVALIDATE_CAP.
      const live = new Set(existing.filter((e) => e.status === 'active' || e.status === 'sold').map((e) => e.id))
      const changes = diff.changes.filter((c) => live.has(c.id))
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
      // What this night's not-used pass left of the shared budget (no other cause: the whole budget, as before).
      const retireCap = Math.max(0, nightRetireCap - soldNotUsed)
      // ⚠️ REFUSED WHOLESALE, NOT TRUNCATED TO THE CAP. Retiring "the first 870 of 8,700" would be
      // the same wrong inference, applied to an arbitrary tenth of it, and it would look like a
      // healthy night in the logs.
      const cappedOut = retireCandidates.length > retireCap
      const mayRetire = complete && !cappedOut
        && matchedActive >= MIN_ROWS_TO_RECONCILE && matchedActive >= activeHeld * MIN_FEED_FRACTION
      /**
       * ⛔ A RESTORE RE-ADVERTISES THE ROW, SO IT IS SCREENED FIRST (src/lib/restock-screen.ts, 2026-10-01):
       * a banned word or an ad-classifier 'ban' is NOT restored and is hidden (a sold row is public on
       * the sold page); 'review' restores and is reported. Only `sold` rows are candidates — a tombstone
       * ('removed') never is, and applyStockReconcile's SQL re-states `status = 'sold'` in its WHERE.
       * A screen that throws restores NOTHING tonight (the safe direction) and says so.
       */
      // (On a used-only shelf a row not stored as used never gets here — offShelf above — so it is never restocked: opus, round 10.)
      const restoreCandidates = presentIds.filter((id) => byId.get(id)?.status === 'sold')
      let screen: Awaited<ReturnType<typeof screenRestock>> | null = null
      let screenError = false
      if (restoreCandidates.length) {
        try { screen = await screenRestock(db, restoreCandidates, merchantNameFor(campaign)) } catch (e) {
          screenError = true
          console.error('affiliate-prices: %s restock screen FAILED — restoring nothing tonight', campaign, e)
        }
      }
      const stock = await applyStockReconcile(db, Prisma, {
        retire: mayRetire ? retireCandidates : [],
        /**
         * ⚠️ NO COMPLETENESS GATE, WHICH IS THE POINT OF SPLITTING THEM. An earlier draft wrote
         * `complete ? … : []` here and all three reviewers caught it contradicting the paragraph
         * above: a partial walk cannot falsify a SKU it positively returned. Gating this was also
         * the half that made a rotation deadlock unrecoverable.
         */
        restore: screen?.restock ?? [],
      })
      // ⚠️ A BLOCKED RETIRE IS REPORTED, NOT SWALLOWED. A campaign that stops retiring because its
      // merchant rotated most of its catalogue is a thing a human should see, not a silent no-op.
      if (!mayRetire) console.warn('affiliate-prices: %s retire BLOCKED — complete=%s matchedActive=%d activeHeld=%d candidates=%d cap=%d', campaign, complete, matchedActive, activeHeld, retireCandidates.length, retireCap)

      /**
       * ⚠️ RETIRED AND RESTORED ROWS MUST FLUSH TOO. `flushRecent` already sweeps anything whose
       * `updatedAt` moved in the last 48h and the reconcile stamps it, so they are covered — but
       * only because the reconcile runs BEFORE this line. Keep that order. Awaited BEFORE the push (opus, gate round 15):
       * a throw here is then reported once, by the catch, not as a result and a failure both.
       */
      const flushed = await flushRecent(seller.id, [...changes.map((c) => c.id), ...(screen?.hide.map((f) => f.id) ?? []), ...nowNew])
      results.push({
        campaign, feedRows: seen, feedDropped: dropped, feedNotUsed: notUsedSkus.size, soldNotUsed, nowNewAlarm, ...(nowNewAlarm ? { notUsedSample: [...notUsedSkus].slice(0, 5) } : {}), listings: existing.length,
        changed: written, unchanged, missingFromFeed, stock, mayRetire, cappedOut,
        matchedActive, activeHeld, retireCandidates: retireCandidates.length, retireCap,
        ...(screen ? restockReport(screen) : screenError ? { restockScreen: { failed: true, candidates: restoreCandidates.length } } : {}),
        ...flushed,
      })
    } catch (e) {
      failed++
      console.error('affiliate-prices: %s FAILED — the rest of it is not written tonight', campaign, e)
      results.push({ campaign, error: String((e as Error)?.message ?? e).slice(0, 200) })
      // Nothing this campaign already committed may keep rendering stale from the page cache.
      if (sellerNow) await flushRecent(sellerNow, retiredNow).catch((f) => console.error('affiliate-prices: %s flush after failure FAILED', campaign, f))
    }
  }
  // A 502 with the report, not a thrown 500: the other shops' results stay readable, and eno-cron.sh fails the unit.
  if (failed || blocked) return Response.json({ ok: false, failed, blocked, results }, { status: 502 })
  return { ok: true, results }
})
