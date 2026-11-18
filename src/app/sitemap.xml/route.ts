import { xmlResponse } from '@/lib/sitemap'
import { buildRootSitemap } from './build'

/**
 * /sitemap.xml — ONE FLAT <urlset> WHILE THE SITE IS SMALL, A SITEMAP INDEX ONCE IT IS NOT (2026-11-18).
 * ./build.ts has the rule and why; src/lib/sitemap.ts has the children it pages into.
 *
 * ⚠️ THE URL NEVER MOVES. Search Console, robots.txt (src/app/robots.txt/route.ts), llms.txt, /agents.md
 * and the not-found pages all point here, and Google reads a urlset or an index at the same address.
 *
 * ⚠️ CACHED FOR 24h INDEPENDENTLY OF THE CHILDREN, so between rebuilds the two can disagree by a day's
 * writes: a listing in one and not yet the other, or (as an index) a child named before it fills.
 */

// Same ISR window as the children: rebuilt daily in the background, never per request.
export const revalidate = 86400

export async function GET() {
  try {
    return xmlResponse((await buildRootSitemap()).xml)
  } catch (error) {
    // ⛔ RETHROWN, NEVER RETURNED AS A 500 (SEO wave B, D3): a returned 500 is cached by ISR for the
    // route's whole day in place of the good copy; a throw keeps serving the last good copy
    // (sitemaps/pages.xml/route.ts says how, and the D3 commit what was measured).
    console.error('Failed to generate sitemap.xml (the last good copy stays served):', error)
    throw error
  }
}
