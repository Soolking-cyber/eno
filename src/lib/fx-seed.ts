import 'server-only'

const FX_URL = 'https://open.er-api.com/v6/latest/VND'
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000
let failedAt = 0

/**
 * Dollars per đồng for the HTML, so "≈ $176" is in the first paint instead of fading in after /api/fx (idle, up to 10 s later), and the client has nothing to
 * re-render for (currency-context.tsx). null = no seed: the page behaves as it did, an invisible stand-in reserving the slot until the client's rates land.
 *
 * ⛔ `cache: 'force-cache'`, NEVER `next: { revalidate }`. This runs in the root layout, and a fetch's revalidate lowers the whole page's: a 6-hour value here
 * would regenerate every 30-day listing page four times a day. The rate is an approximation, labelled "≈": the client corrects it past 1%, and each deploy
 * starts a new cache, which is what freshens it.
 * ⚠️ 2 s and a ten-minute memory of a failure: a build or an ISR render must never wait on a rate. One failed call per process, not one per page.
 */
export async function fxSeedUsd(): Promise<number | null> {
  if (Date.now() - failedAt < RETRY_AFTER_FAILURE_MS) return null
  try {
    const res = await fetch(FX_URL, { cache: 'force-cache', signal: AbortSignal.timeout(2000) })
    const usd = (await res.json())?.rates?.USD
    // The same plausibility band vndPerUsd() applies on the client: 5,000 to 100,000 đồng to the dollar.
    if (typeof usd === 'number' && usd >= 1 / 100_000 && usd <= 1 / 5_000) return usd
    throw new Error('fx_unusable')
  } catch {
    failedAt = Date.now()
    return null
  }
}
