import { route } from '@/lib/api/handler'
import { x402Config } from '@/lib/x402/config'
import { reconcileOpenAds } from '@/lib/ads/book'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ── Paid ads: the reconcile sweep (gate review 2026-11-23: "nothing calls reconcileAd except a retry by the buyer").
// Every 10 minutes: each ad whose payment outcome is not known (a settlement answer lost, or a request that died between
// its row and the settlement) is looked up on chain and activated, settled again while its authorization is still valid,
// or — past validBefore and never seen on chain — marked failed for good (src/lib/ads/book.ts reconcileAd). Nothing to do
// while ads are not on sale (no X402_PAY_TO) or before scripts/listing-ad-ddl.mjs has run ({ tables: false }).
export const GET = route({ auth: 'cron' }, async () => {
  const cfg = x402Config()
  if (!cfg) return { on: false }
  try {
    return { on: true, ...(await reconcileOpenAds(cfg, { limit: 100 })) }
  } catch (e) {
    if (e instanceof Error && /42P01|"ListingAd" does not exist/.test(e.message)) return { tables: false }
    throw e
  }
})
