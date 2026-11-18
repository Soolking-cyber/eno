import { db } from '@/lib/db'
import { LISTINGS_PER_SITEMAP, siteOrigin, submittedListingWhere } from '@/lib/sitemap'

/**
 * THE `<url>` ENTRIES OF THE k-TH LISTING SLICE, OUT OF ITS ROUTE FILE (2026-11-18) so /sitemap.xml can
 * hold them too while the site is small (../../sitemap.xml/build.ts). `route.ts` may export only handlers
 * and route config. The paging rules (by `id`, never `updatedAt`) are in ./route.ts.
 */
export async function listingSitemapEntries(k: number): Promise<string[]> {
  // edition-lint-allow: `submittedListingWhere()` IS `scopedListingWhere(...)` AND-ed with the
  // affiliate exclusion (src/lib/sitemap.ts) — the edition scope is inside the helper.
  const rows = await db.listing.findMany({
    where: await submittedListingWhere(),
    select: { id: true, updatedAt: true },
    orderBy: { id: 'asc' },
    skip: k * LISTINGS_PER_SITEMAP,
    take: LISTINGS_PER_SITEMAP,
  })
  const host = siteOrigin()
  return rows.map((l) => `  <url><loc>${host}/listings/${l.id}</loc><lastmod>${l.updatedAt.toISOString()}</lastmod></url>\n`)
}
