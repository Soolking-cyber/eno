import { route } from '@/lib/api/handler'
import { runDailySocial, tableReady } from '@/lib/social/daily'
import { IS_MARKETPLACE } from '@/lib/edition'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * DAILY SOCIAL POST — one listing per configured channel (Cloud Scheduler → this route).
 *
 * Guarded by `auth: 'cron'`, the same timing-safe CRON_SECRET comparison every other job here uses.
 *
 * ⛔ MARKETPLACE ONLY. Both editions build this route, and both would run it if scheduled — but the
 * accounts it posts to (eno's Facebook Page, eno's LinkedIn Page) belong to the marketplace, and the
 * listings it selects are marketplace stock. A services-edition run would post eno.vn's inventory
 * from a deployment whose whole purpose is to be a separate operator. One scheduler job exists, and
 * this gate is the belt to that braces: a scheduler misconfiguration cannot turn into a post.
 *
 * ⚠️ IT REPORTS PER CHANNEL AND NEVER 500s ON A CHANNEL FAILURE. A platform rejection is normal
 * operational noise — four of the five channels are pending app approval — so the run returns 200
 * with a per-channel breakdown. A non-200 here would page nobody and just make the scheduler retry,
 * which is the one thing a non-idempotent poster must not do.
 */
export const GET = route({ auth: 'cron' }, async () => {
  if (!IS_MARKETPLACE) return { ok: true, skipped: 'not_marketplace' }
  /**
   * ⛔ REPORT A MISSING TABLE AS A FAILURE, NOT AS A QUIET SUCCESS — reviewer-caught. `social_posts`
   * is created by scripts/social-ddl.mjs, which is run by hand and is NOT part of a deploy. Without
   * it every channel throws on its first query, each throw is caught per channel, and this route
   * would have answered `{ ok: true, posted: 0 }` — a scheduler reporting success every morning
   * while nothing was ever posted, which is the failure shape that survives longest.
   */
  if (!(await tableReady())) return { ok: false, error: 'social_posts_missing' }
  const report = await runDailySocial()
  const posted = report.filter((r) => r.result?.id || (r.result && !r.result.skipped)).length
  return { ok: true, posted, channels: report }
})
