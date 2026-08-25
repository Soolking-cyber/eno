/**
 * Refresh imported affiliate listings' prices from the merchant datafeed.
 *
 *   npx tsx scripts/refresh-affiliate-prices.ts --campaign cellphones_cps           # DRY RUN
 *   npx tsx scripts/refresh-affiliate-prices.ts --campaign cellphones_cps --apply
 *
 * Same code path as the nightly job (`GET /api/cron/affiliate-prices`) — this is the manual
 * handle on it, and the way to preview a run before the timer owns it. See
 * src/lib/affiliate-price-refresh.ts for WHY this is not the importer on a schedule.
 */
import 'dotenv/config'
import { db } from '../src/lib/db'
import { Prisma } from '../src/generated/prisma/client'
import {
  applyPriceChanges, campaignIdFor, diffPrices, fetchFeedPrices, merchantNameFor,
  type ExistingListing,
} from '../src/lib/affiliate-price-refresh'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const CAMPAIGN = arg('campaign') ?? 'cellphones_cps'
const KEY = process.env.ACCESSTRADE_KEY
if (!KEY) { console.error('ACCESSTRADE_KEY missing from .env'); process.exit(1) }

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — campaign=${CAMPAIGN}\n`)
  const campaignId = await campaignIdFor(CAMPAIGN, KEY!)
  if (!campaignId) { console.error(`"${CAMPAIGN}" is not an APPROVED campaign for this publisher.`); process.exit(1) }

  const seller = await db.seller.findFirst({ where: { name: merchantNameFor(CAMPAIGN) }, select: { id: true, name: true } })
  if (!seller) { console.error(`no storefront named "${merchantNameFor(CAMPAIGN)}"`); process.exit(1) }

  const { prices, seen, dropped } = await fetchFeedPrices(CAMPAIGN, KEY!, campaignId,
    (n, t) => { if (n % 1000 < 200) console.log(`  feed ${n}/${t}`) })
  console.log(`\nfeed: ${seen} rows, ${prices.size} usable, ${dropped} dropped (no sku or no price)\n`)

  const existing = (await db.listing.findMany({
    where: { sellerId: seller.id, externalId: { not: null } },
    select: { id: true, externalId: true, price: true, affiliateUrl: true },
  })) as ExistingListing[]

  const { changes, unchanged, missingFromFeed } = diffPrices(existing, prices)
  console.log(`${existing.length} listings — ${changes.length} to update, ${unchanged} unchanged, ${missingFromFeed} no longer in the feed`)
  for (const c of changes.slice(0, 10)) console.log(`  ${c.externalId}  ${c.from.toLocaleString('vi-VN')} → ${c.to.toLocaleString('vi-VN')} đ`)
  if (changes.length > 10) console.log(`  … and ${changes.length - 10} more`)

  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); return }
  const written = await applyPriceChanges(db, Prisma, changes)
  console.log(`\nAPPLIED: ${written} rows updated`)
  /**
   * ⛔ THIS SCRIPT CANNOT REVALIDATE — it has no Next runtime, so `revalidatePath` is unavailable.
   * `/listings/[id]` caches for 30 DAYS, so rows updated from here are correct in the database and
   * stale on the page until the cron route (which does revalidate) next moves them, or the window
   * expires. Say so rather than printing a clean success.
   */
  if (written) console.log(
    `\n⚠️  ${written} PDPs are now stale in ISR (/listings/[id] caches for 30d) — this script has no\n` +
    `    Next runtime to revalidate them. The cron route flushes anything this seller changed in the\n` +
    `    last 48h, not just its own diff, so one call clears them — run it on BOTH editions, because\n` +
    `    revalidatePath only reaches the container that served it:\n` +
    `      for p in 3001 3002; do curl -sH "Authorization: Bearer $CRON_SECRET" \\\n` +
    `        http://127.0.0.1:$p/api/cron/affiliate-prices; done`)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
