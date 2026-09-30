import { xmlResponse } from '@/lib/sitemap'
import { buildPagesSitemap } from './build'

/**
 * /sitemaps/pages.xml — EVERY SUBMITTED URL THAT IS NOT A LISTING. It was the body of /sitemap.xml
 * until 2026-09-24, when that became a sitemap INDEX (src/lib/sitemap.ts says why). The listing URLs
 * moved to /sitemaps/listings-<k>.xml; everything else is here, with one real change: the category
 * lastmods, the category × district combos and the storefront URLs are derived from whole-table
 * GROUP BYs instead of the newest 45,000 rows, so a bulk import can no longer push older stock's
 * districts and sellers out of the sitemap.
 */

// Cache the generated sitemap instead of rebuilding it (DB query over all listings
// + a serverless cold start) on every request — that ~6s response was timing out
// Google's fetcher ("Couldn't fetch"). ISR revalidates every 24h in the background
// (plus a 1h CDN s-maxage below), so Google always gets a fast, already-built XML.
export const revalidate = 86400

// ⚠️ THE BODY LIVES IN ./build.ts SINCE SEO WAVE B (I4), so the IndexNow cron can build the same
// document in-process; that file carries every rule and its reasoning. This route only serves it.
/**
 * ⛔ A FAILURE IS RETHROWN, NEVER RETURNED AS A 500 (SEO wave B, D3). This used to `return` a JSON 500,
 * and under ISR a returned response is cached like any other, status and all, for the route's
 * `revalidate` (next/dist/build/templates/app-route.js stores `status: response.status`) — so one
 * database blip at the daily regeneration replaced a good sitemap with a 500 for a day. A THROWN
 * regeneration produces no cache entry: Next has already served the stale copy to the request, re-stores
 * that copy with a revalidate of at most 30 s, and logs the error (server/response-cache/index.js).
 * With no copy at all (the first request after a start), the request gets a 500 and nothing is cached.
 * The builder relies on this: with the rent snapshot unknown it throws rather than build a document
 * without the rentals URLs (build.ts, `'require'`). MEASURED on a local production build — see the
 * D3 commit for the numbers.
 * ⚠️ AT BUILD TIME `next build` prerenders this route, so a failure there now fails the build loudly
 * instead of prerendering a 500; nothing is swapped when a build fails (eno-deploy.sh).
 */
export async function GET() {
  try {
    return xmlResponse((await buildPagesSitemap({ rentIndex: 'require' })).xml)
  } catch (error) {
    console.error('Failed to generate sitemaps/pages.xml (the last good copy stays served):', error)
    throw error
  }
}
