import { db } from '@/lib/db'
import {
  PAGES_SITEMAP_PATH,
  listingSitemapCount,
  listingSitemapPath,
  siteOrigin,
  sitemapIndexXml,
  submittedListingWhere,
  xmlResponse,
} from '@/lib/sitemap'
import { NextResponse } from 'next/server'

/**
 * /sitemap.xml — A SITEMAP INDEX since 2026-09-24, no longer a urlset.
 *
 * It names /sitemaps/pages.xml (every non-listing URL — the whole body of this file until then) and
 * one /sitemaps/listings-<k>.xml per 45,000 submitted listings. src/lib/sitemap.ts records why: the
 * single file read two `take: 45000` windows, and a bulk import silently pushed older stock's
 * districts, storefronts and listing URLs out of both.
 *
 * ⚠️ THE URL DID NOT MOVE, ON PURPOSE. Search Console, robots.txt (src/app/robots.txt/route.ts),
 * llms.txt, /agents.md and the not-found pages all point here; Google reads an index at the same
 * address as a urlset and follows its children.
 *
 * ⚠️ THE COUNT USES THE SAME PREDICATE THE CHILDREN PAGE BY (`submittedListingWhere`) — edition
 * scope included — so a FRESH index names exactly as many children as there are listings to fill
 * them. The index and each child are cached for 24h INDEPENDENTLY, so between rebuilds they can
 * disagree: a stale index can name a child that has since emptied (a valid empty urlset, not an
 * error), and when the count crosses a 45,000 boundary the rows past it sit in a child the index
 * does not name yet — for up to one index revalidation (24h). At the ~77 submitted listings of
 * 2026-09-24 there is one child and no boundary in sight.
 */

// Same ISR window as the children: rebuilt daily in the background, never per request.
export const revalidate = 86400

export async function GET() {
  try {
    // edition-lint-allow: `submittedListingWhere()` IS `scopedListingWhere(...)` AND-ed with the
    // affiliate exclusion (src/lib/sitemap.ts) — the edition scope is inside the helper.
    const submitted = await db.listing.count({ where: await submittedListingWhere() })
    const host = siteOrigin()
    const children = [`${host}${PAGES_SITEMAP_PATH}`]
    for (let k = 0; k < listingSitemapCount(submitted); k++) children.push(`${host}${listingSitemapPath(k)}`)
    return xmlResponse(sitemapIndexXml(children))
  } catch (error) {
    console.error('Failed to generate sitemap.xml:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
