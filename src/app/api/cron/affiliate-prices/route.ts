import { revalidatePath } from 'next/cache'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import {
  applyPriceChanges, campaignIdFor, diffPrices, fetchFeedPrices, merchantNameFor,
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
  // ⚠️ A CAP THAT SAYS SO WHEN IT BITES. A silent top-N reads as "everything was flushed".
  for (const id of ids.slice(0, REVALIDATE_CAP)) revalidatePath(`/listings/${id}`)
  return { revalidated: Math.min(ids.length, REVALIDATE_CAP), ...(ids.length > REVALIDATE_CAP ? { revalidateCappedAt: REVALIDATE_CAP, wanted: ids.length } : {}) }
}

export const GET = route({ auth: 'cron' }, async () => {
  const key = process.env.ACCESSTRADE_KEY
  const results: Record<string, unknown>[] = []

  for (const campaign of CAMPAIGNS) {
    const seller = await db.seller.findFirst({ where: { name: merchantNameFor(campaign) }, select: { id: true } })
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

    const { prices, seen, dropped } = await fetchFeedPrices(campaign, key, campaignId)
    const existing = (await db.listing.findMany({
      where: { sellerId: seller.id, externalId: { not: null } },
      select: { id: true, externalId: true, price: true, affiliateUrl: true },
    })) as ExistingListing[]

    const { changes, unchanged, missingFromFeed } = diffPrices(existing, prices)
    const written = await applyPriceChanges(db, Prisma, changes)
    results.push({
      campaign, feedRows: seen, feedDropped: dropped, listings: existing.length,
      changed: written, unchanged, missingFromFeed,
      ...(await flushRecent(seller.id, changes.map((c) => c.id))),
    })
  }
  return { ok: true, results }
})
