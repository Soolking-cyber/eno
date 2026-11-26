/**
 * THE NIGHTLY AFFILIATE RUN — one body for both sources, so the hardened per-campaign logic exists once.
 *   · 'feed'  — /api/cron/affiliate-prices (03:01 ICT): the datafeed campaigns in ACCESSTRADE_CAMPAIGNS;
 *   · 'crawl' — /api/cron/affiliate-crawl  (04:31 ICT): the crawl campaigns in ACCESSTRADE_CRAWL_CAMPAIGNS
 *     (retired-imports.ts `source: 'crawl'` — Hoàng Hà, ShopDunk), read from the shops' own used sections by
 *     src/lib/accesstrade-crawl.ts and mapped onto the feed shape by src/lib/accesstrade-crawl-feed.ts.
 * Moved here verbatim from the affiliate-prices route on 2026-11-15; the comments below are that route's.
 */
import { CAMPAIGN_SELLER_IDS } from '@/lib/accesstrade-removal'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import {
  applyPriceChanges, applyStockReconcile, campaignIdFor, campaignsFromEnv, diffPrices, fetchFeedPrices, merchantNameFor,
  type ExistingListing,
} from '@/lib/affiliate-price-refresh'
import { restockReport, screenRestock } from '@/lib/restock-screen'
import { keepUsedRows } from '@/lib/accesstrade-restore'
import { enoRunPartnerWhere, isEnoRunPartner } from '@/lib/eno-run-partners'
import { movePublicLinksToStaff, upsertPurchaseLinks } from '@/lib/partner-purchase-link'
import { importableCampaign } from '@/lib/retired-imports'
import { NOT_NEW_APPLE } from '@/lib/new-apple'
import { sellStaleNewApple } from '@/lib/new-apple-night'

import { fetchCrawlPrices } from '@/lib/accesstrade-crawl-feed'

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


/** Minutes a crawl night may take: Hoàng Hà is ~1,093 pages at 1.2 s (~22 min), ShopDunk ~230 (~5 min), read in env
 * order with the fair-share deadline — so ACCESSTRADE_CRAWL_CAMPAIGNS lists the short one FIRST (shopdunk_web,hoanghamobile)
 * and the long one inherits what it left. eno-cron.sh gives the unit's curl 2,700 s (install-cron-timers.sh). */
const CRAWL_BUDGET_MIN = 40

export type NightSource = 'feed' | 'crawl'

export async function affiliateNight(source: NightSource) {
  const key = process.env.ACCESSTRADE_KEY
  const results: Record<string, unknown>[] = []
  // ⛔ One time budget for every AccessTrade call of the night (codex, diff review round 4): eno-cron.sh's curl gives up at
  // 900 s, and 429 retries are bounded per call, not per walk. 12 min leaves the DB work its room; out of time, the walk
  // throws, counts as incomplete and retires nothing (accessTradeGet).
  const budget = { deadline: Date.now() + (source === 'crawl' ? CRAWL_BUDGET_MIN : 12) * 60_000 }
  // The new-Apple rows' backstop (src/lib/new-apple-night.ts sellStaleNewApple): a week without a confirmed read is `sold`,
  // whether or not their own nightly ran. Only where this night writes (the key's edition); a failure here never stops the night.
  // Reported only when it did something (or failed): a quiet night's results stay as they were.
  const staleNew = key ? await sellStaleNewApple().catch((e: Error) => ({ staleNewApple: 'failed' as const, error: e.message.slice(0, 120) })) : null
  if (staleNew && staleNew.staleNewApple !== 0) results.push(staleNew)
  const campaigns = campaignsFromEnv(source === 'crawl' ? process.env.ACCESSTRADE_CRAWL_CAMPAIGNS : process.env.ACCESSTRADE_CAMPAIGNS)
  // A 200, not an error: an empty list is a configuration ("walk nothing"), and a red unit every night
  // would train everyone to ignore failed units.
  if (!campaigns.length) {
    // ⚠️ SAID OUT LOUD (commit-gate review): a 200 that walks nothing must still show in the journal, or an
    // env that lost its value looks like a healthy night while the kept stock's prices go stale.
    console.warn(source === 'crawl'
      ? 'affiliate-crawl: ACCESSTRADE_CRAWL_CAMPAIGNS is unset or empty — no campaign read (expected: shopdunk_web,hoanghamobile)'
      : 'affiliate-prices: ACCESSTRADE_CAMPAIGNS is unset or empty — no campaign walked (expected: cellphones_cps,dienthoaivui)')
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
    // Rows whose public link this run moved to the staff table: purged on a later throw too (commit gate, codex).
    let movedOuter: string[] = []
    // ⛔ A FAIR SHARE of what is left, per campaign (codex, gate round 7): one slow shop cannot spend the next one's time.
    // A crawl campaign gets ALL the time left, not a fair share (commit gate, opus): its reads are sequential and of very
    // different sizes (ShopDunk ~7 min, Hoàng Hà ~23–30), so either env order fits the night's budget.
    const share = source === 'crawl' ? { deadline: budget.deadline }
      : { deadline: Date.now() + Math.floor(Math.max(0, budget.deadline - Date.now()) / (campaigns.length - i)) }
    /**
     * ⛔ ONE SHOP'S FAILURE IS THAT SHOP'S (commit gate, opus 2026-11-14): a 429 past its retries or the night's budget
     * running out throws out of the walk, and without this the next campaign was never walked. A throw from the walk
     * comes before any write, so that shop changes nothing tonight; a throw from the writes after it can leave prices
     * written and pages unflushed until the next night's 48-hour sweep. Either way the unit goes red below.
     */
    const spec = importableCampaign(campaign)
    // ⛔ A crawl campaign is never walked as a datafeed, nor a datafeed campaign crawled (retired-imports.ts `source`): a
    // datafeed walk of Hoàng Hà would read 2,275 NEW-goods rows and judge its whole used shelf missing.
    if ((spec?.source === 'crawl') !== (source === 'crawl')) { failed++; results.push({ campaign, error: 'wrong_source' }); continue }
    try {
      // ⛔ `ownerId: null`. Seller.name is NOT unique — anyone can open a storefront called
      // "CellphoneS" — and this job rewrites prices and buy links in bulk. An owned storefront
      // belongs to a real person and is never a datafeed target.
      // …or a storefront eno itself runs: a PINNED (seller, owner) pair (src/lib/eno-run-partners.ts) — never any other owner.
      const pinnedId = CAMPAIGN_SELLER_IDS.get(campaign)
      const seller = await db.seller.findFirst({
        // By its fixed id where the campaign has one (a same-named storefront is never this shop), else by name as before.
        where: { ...(pinnedId ? { id: pinnedId } : { name: merchantNameFor(campaign) }), OR: [{ ownerId: null }, ...enoRunPartnerWhere()] },
        select: { id: true, ownerId: true, officialPartner: true },
      })
      // A configured campaign that cannot refresh is a failure, red like a throw (codex, gate round 9).
      if (!seller) { failed++; results.push({ campaign, error: 'no_storefront' }); continue }
      sellerNow = seller.id
      // ⛔ CHAT ONLY (retired-imports.ts `chatOnly`): no write of any kind unless the storefront is a pinned eno-run pair —
      // checked BEFORE the read, so an un-pinned or un-claimed shop costs no crawl and gets no write.
      if (spec?.chatOnly && !isEnoRunPartner(seller)) { failed++; results.push({ campaign, error: 'chat_only_not_eno_run' }); continue }

      // ⛔ NO KEY = FLUSH ONLY, AND STILL A 200. This is the forum edition's whole job (its env has no
      // ACCESSTRADE_KEY and does not need one), and it is also how the route behaves anywhere the
      // secret is not provisioned — a nightly red unit trains everyone to ignore failed units, so it
      // reports what it did instead of failing.
      // ✅ eno-vn's env HAS the key as of 2026-08-25 (/opt/eno/secrets/eno-vn.env), so the marketplace
      //    container takes the full path below. It is not in the repo and never should be.
      if (!key) { results.push({ campaign, skipped: 'no_key', ...(await flushRecent(seller.id)) }); continue }

      // A crawl campaign has no datafeed to ask: its id is in the allow-list entry (the tracking link's path segment).
      const campaignId = source === 'crawl' ? (spec?.campaignId ?? null) : await campaignIdFor(campaign, key, share)
      // ⛔ Not approved = the links earn nothing and may not resolve. Report, never guess an id.
      if (!campaignId) { failed++; results.push({ campaign, error: 'not_an_approved_campaign' }); continue }

      const feed = source === 'crawl'
        ? await fetchCrawlPrices(campaign, campaignId, share)
        : await fetchFeedPrices(campaign, key, campaignId, undefined, share)
      const { prices, unpriced, seenIds, seen, complete, dropped } = feed
      const crawlRead = 'read' in feed ? feed.read : undefined
      // ⛔ A used-only campaign keeps only what the importer's own rule still calls used (src/lib/accesstrade-restore.ts);
      // the SKUs it refuses are handled below, before the reconcile.
      // A crawl's section IS the used evidence (its titles do not say "cũ"), so usedForShelf is not applied to it; its
      // not-used set is the reader's POSITIVE evidence instead — the ids whose title now declares new goods (codex, gate).
      const notUsedSkus = 'newSkus' in feed ? feed.newSkus
        : spec?.usedOnly ? keepUsedRows(prices, unpriced) : new Set<string>()
      /**
       * ⚠️ NO `status` PREDICATE, DELIBERATELY. The rows this job must look at include the ones it
       * retired on an earlier night: a SKU the merchant re-lists has to be found here before it can
       * be restored, and filtering to `active` would make every retire permanent.
       */
      /**
       * ⛔ AN ENO-RUN PARTNER'S PURCHASE LINKS ARE STAFF-ONLY (src/lib/partner-purchase-link.ts, owner 2026-11-14): its rows
       * are compared against PartnerPurchaseLink, and a moved link is written THERE, never to the public column.
       */
      const enoRun = isEnoRunPartner(seller)
      // ⛔ …and its PUBLIC column stays NULL by itself (commit gate, codex): any link still public (a move never run, cut
      // short, or a row written back by hand) goes to the staff table first, in one statement, before the diff reads them.
      const movedNow = enoRun ? await movePublicLinksToStaff(db, Prisma, seller.id) : []
      // Purged AT ONCE (commit gate, codex) — and the move stamps a live row's updatedAt, so the 48-hour sweep (flushRecent)
      // re-purges it on later nights too if every purge here failed.
      movedOuter = movedNow
      if (movedNow.length) await flushRecent(seller.id, movedNow)
      // ⛔ NEVER A `new:` ROW (src/lib/new-apple.ts, owner 2026-11-26): the shop's new iPhone 18 / current Macs live on this same
      // storefront and are the new-goods nightly's (src/lib/new-apple-night.ts). Seen here, `offShelf` below would send every
      // one of them to sold, uncapped, every night — and the retire budget (activeAll) would count them as this shelf's.
      const held = ((await db.listing.findMany({
        where: { sellerId: seller.id, externalId: { not: null }, ...NOT_NEW_APPLE },
        select: { id: true, externalId: true, price: true, affiliateUrl: true, status: true, condition: true, ...(enoRun ? { purchaseLink: { select: { url: true } } } : {}) },
      })) as (ExistingListing & { status: string; condition: string | null; purchaseLink?: { url: string } | null })[])
        .map((l) => (enoRun ? { ...l, affiliateUrl: l.purchaseLink?.url ?? null } : l))
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
      /**
       * ⛔ A UNIT THE SHOP ITSELF SHOWS AS SOLD OUT IS POSITIVE EVIDENCE TOO (owner 2026-11-23, a ShopDunk MacBook reading
       * "temporarily out of stock" while eno still offered it; MEASURED that night: 165 of ShopDunk's 214 listed used
       * products had no unit). Left to the reconcile it is "missing", and the floors (≥50 % of live rows matched) would block
       * every retire on a shelf that is 77 % sold out. So, the not-used pass's shape: out of the reconcile, ACTIVE rows to
       * `sold` (the restock brings one back the night it has a unit again), uncapped, the night red when it is more than the
       * budget. Only from a read the feed trusted for it (accesstrade-crawl-feed.ts soldOutTrusted) — an untrusted one is
       * UNKNOWN and red (`soldOutDistrusted`).
       */
      const soldOutSkus = 'soldOutSkus' in feed ? feed.soldOutSkus : new Set<string>()
      const soldOutDistrusted = 'soldOutDistrusted' in feed ? feed.soldOutDistrusted : 0
      const shownSoldOut = (l: (typeof held)[number]) => !offShelf(l) && !!l.externalId && soldOutSkus.has(l.externalId)
      const goneOut = held.filter((l) => l.status === 'active' && shownSoldOut(l)).map((l) => l.id)
      const soldOut = goneOut.length ? (await applyStockReconcile(db, Prisma, { retire: goneOut, restore: [] })).retired : 0
      retiredNow = [...nowNew, ...goneOut]
      const soldOutAlarm = goneOut.length > Math.max(0, nightRetireCap - soldNotUsed)
      if (soldOutAlarm || soldOutDistrusted) {
        blocked++
        console.warn('affiliate-prices: %s sold out: %d active rows to sold (budget %d), %d sold-out ids not trusted', campaign, goneOut.length, nightRetireCap, soldOutDistrusted)
      }
      const existing = held.filter((l) => !offShelf(l) && !shownSoldOut(l))

      const diff = diffPrices(existing, prices, seenIds)
      const { unchanged, missingFromFeed, missingIds, presentIds } = diff
      // Only active/sold rows take a price (applyPriceChanges) — so only they count as changes, or a hidden
      // row whose feed price moved would be re-flushed every night and push the batch past REVALIDATE_CAP.
      const live = new Set(existing.filter((e) => e.status === 'active' || e.status === 'sold').map((e) => e.id))
      const changes = diff.changes.filter((c) => live.has(c.id))
      // An eno-run partner: the price on the row (its public link stays NULL — COALESCE keeps it), the link in the staff table.
      const written = enoRun
        ? await applyPriceChanges(db, Prisma, changes.filter((c) => c.from !== c.to).map((c) => ({ ...c, affiliateUrl: null })))
        : await applyPriceChanges(db, Prisma, changes)
      const staffLinks = enoRun
        ? await upsertPurchaseLinks(db, Prisma, changes.filter((c) => c.affiliateUrl).map((c) => ({ listingId: c.id, url: c.affiliateUrl! })))
        : 0

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
      // What this night's not-used and sold-out passes left of the shared budget (no other cause: the whole budget, as before).
      const retireCap = Math.max(0, nightRetireCap - soldNotUsed - soldOut)
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
      /**
       * ⛔ A CRAWL SHELF DRAINS UP TO THE CAP INSTEAD (commit gate, opus 2026-11-15): one device per row, never relisted, so
       * a backlog left by a missed night only GROWS — refused wholesale it would stay over the cap for ever and every sold
       * phone would keep saying "message us to buy". Only on a COMPLETE read whose floors hold (so the absence is real
       * evidence), at most the cap a night, and the night still goes red (blocked) so a person looks. A unit retired by
       * mistake is restocked the next night it is seen.
       */
      // ⚖️ ONLY WHILE THE FLOORS HOLD (gate rounds 6–9 pulled both ways): below them a flaky page that parses as an empty grid
      // could sell live units (opus), while holding there can leave sold units up after >50 % turnover between two good reads
      // (codex). Selling available stock is the worse failure; the held night is red (502) every night until a person
      // retires by hand, and that needs a week of missed nights on a ~2,800-unit shelf.
      const floorsHold = complete && matchedActive >= MIN_ROWS_TO_RECONCILE && matchedActive >= activeHeld * MIN_FEED_FRACTION
      const drain = source === 'crawl' && !mayRetire && cappedOut && floorsHold ? retireCandidates.slice(0, retireCap) : []
      const stock = await applyStockReconcile(db, Prisma, {
        retire: mayRetire ? retireCandidates : drain,
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
      // ⛔ A crawl that did not finish is a FAILED night, not a quiet one (commit gate, codex 2026-11-15): its prices and
      // restocks of what was seen still landed, but stock it never reached is stale — the unit must go red (502).
      // …and a crawl night whose retire was HELD (a cap or a floor) with units to retire is a red one too (commit gate, opus):
      // a crawl shelf is one device per row, so sold units that are never retired would keep saying "message us to buy".
      if (source === 'crawl' && (!complete || (!mayRetire && retireCandidates.length > 0))) blocked++

      /**
       * ⚠️ RETIRED AND RESTORED ROWS MUST FLUSH TOO. `flushRecent` already sweeps anything whose
       * `updatedAt` moved in the last 48h and the reconcile stamps it, so they are covered — but
       * only because the reconcile runs BEFORE this line. Keep that order. Awaited BEFORE the push (opus, gate round 15):
       * a throw here is then reported once, by the catch, not as a result and a failure both.
       */
      // An eno-run shop's link-only change alters no public page (the link is staff-only): only its price changes purge (opus).
      const pageChanges = enoRun ? changes.filter((c) => c.from !== c.to) : changes
      const flushed = await flushRecent(seller.id, [...pageChanges.map((c) => c.id), ...(screen?.hide.map((f) => f.id) ?? []), ...nowNew, ...goneOut, ...movedNow, ...drain])
      results.push({
        campaign, ...(crawlRead ? { crawl: crawlRead } : {}), feedRows: seen, feedDropped: dropped, feedNotUsed: notUsedSkus.size, soldNotUsed, nowNewAlarm, soldOut, ...(soldOutAlarm ? { soldOutAlarm } : {}), ...(soldOutDistrusted ? { soldOutDistrusted } : {}), ...(nowNewAlarm ? { notUsedSample: [...notUsedSkus].slice(0, 5) } : {}), listings: existing.length,
        changed: written, ...(enoRun ? { enoRun: true, staffLinks } : {}), unchanged, missingFromFeed, stock, mayRetire, cappedOut, ...(drain.length ? { drained: drain.length } : {}),
        matchedActive, activeHeld, retireCandidates: retireCandidates.length, retireCap,
        ...(screen ? restockReport(screen) : screenError ? { restockScreen: { failed: true, candidates: restoreCandidates.length } } : {}),
        ...flushed,
      })
    } catch (e) {
      failed++
      console.error('affiliate-prices: %s FAILED — the rest of it is not written tonight', campaign, e)
      results.push({ campaign, error: String((e as Error)?.message ?? e).slice(0, 200) })
      // Nothing this campaign already committed may keep rendering stale from the page cache.
      if (sellerNow) await flushRecent(sellerNow, [...retiredNow, ...movedOuter]).catch((f) => console.error('affiliate-prices: %s flush after failure FAILED', campaign, f))
    }
  }
  // A 502 with the report, not a thrown 500: the other shops' results stay readable, and eno-cron.sh fails the unit.
  if (failed || blocked) return Response.json({ ok: false, failed, blocked, results }, { status: 502 })
  return { ok: true, results }
}
