import { db } from '@/lib/db'
import {
  LISTINGS_PER_SITEMAP,
  MAX_URLS_PER_SITEMAP,
  PAGES_SITEMAP_PATH,
  listingSitemapCount,
  listingSitemapPath,
  siteOrigin,
  sitemapIndexXml,
  submittedListingWhere,
  urlsetXml,
} from '@/lib/sitemap'
import { buildPagesSitemap } from '@/app/sitemaps/pages.xml/build'
import { listingSitemapEntries } from '@/app/sitemaps/[file]/build'

/**
 * The children a sitemap index names: /sitemaps/pages.xml, then one /sitemaps/listings-<k>.xml per
 * 45,000 submitted listings. /sitemap.xml serves this index once the site is large (below); the IndexNow
 * cron always reads its children through it (src/app/api/cron/indexnow/collect.ts), whichever form
 * /sitemap.xml is in.
 *
 * ⚠️ THE COUNT USES THE SAME PREDICATE THE CHILDREN PAGE BY (`submittedListingWhere`), edition scope
 * included, so a fresh index names exactly as many children as there are listings to fill them.
 */
export async function sitemapIndexChildren(): Promise<{ submitted: number; locs: string[] }> {
  // edition-lint-allow: `submittedListingWhere()` IS `scopedListingWhere(...)` AND-ed with the
  // affiliate exclusion (src/lib/sitemap.ts) — the edition scope is inside the helper.
  const submitted = await db.listing.count({ where: await submittedListingWhere() })
  const host = siteOrigin()
  const locs = [`${host}${PAGES_SITEMAP_PATH}`]
  for (let k = 0; k < listingSitemapCount(submitted); k++) locs.push(`${host}${listingSitemapPath(k)}`)
  return { submitted, locs }
}

/**
 * /sitemap.xml: ONE FLAT <urlset> WHILE THE SITE IS SMALL, THE SITEMAP INDEX ONCE IT IS NOT (2026-11-18).
 *
 * ⛔ WHY FLAT (owner: "1 go", the AEO checker's "80%+ pages have titles"): from 2026-09-24 until this date,
 * /sitemap.xml was always an index of two children. Crawlers that read /sitemap.xml's `<loc>`s as pages and do not
 * follow an index (check.aeojs.org's aeo.js does exactly that) fetched the two child XML files as
 * "pages", found no <title>, and scored the site's real pages as never seen. A urlset holds the pages
 * themselves, which every reader understands, and Google reads either form at the same address.
 *
 * ⚠️ THE 2026-09-24 FIX STANDS: the flat form is pages.xml's entries followed by the listing entries of
 * the SAME builders the children serve (whole-table GROUP BYs, listings paged by id) — nothing goes
 * back to the old `take: 45000` windows. The children stay served, and robots.txt still names pages.xml.
 *
 * WHEN IT TURNS BACK INTO AN INDEX: more than one listing child's worth of submitted listings
 * (45,000), or pages + listings past the protocol's 50,000 URLs per file. At 2026-11-18 it was
 * 422 pages + 9,858 listings ≈ 1.2 MB, against the 50 MB cap.
 *
 * ⚠️ `pages.xml`'s rule comes with it: its builder runs in `'require'` mode, so an unknown rent snapshot
 * THROWS here too and the route keeps serving the last good copy (pages.xml/route.ts says why). Until
 * 2026-11-18 this route was a count and could not fail that way; it now has exactly pages.xml's exposure
 * (both are prerendered by `next build`, which fails loudly rather than ship either without it).
 *
 * ⚠️ THE COUNT AND THE ROWS ARE TWO READS. A count at ≤ 45,000 followed by writes that pass 45,000 gives a
 * flat file of the first 45,000 by id, the rest absent until the next daily rebuild — the same window the
 * index always had (a row past the boundary in a child it did not name yet).
 *
 * While flat, /sitemaps/listings-0.xml is still served and named by nothing; a crawler that knew it
 * from the index sees its URLs twice, which the protocol allows.
 */
export async function buildRootSitemap(): Promise<{ form: 'urlset' | 'index'; xml: string }> {
  const { submitted, locs } = await sitemapIndexChildren()
  if (submitted <= LISTINGS_PER_SITEMAP) {
    const [pages, listings] = await Promise.all([
      buildPagesSitemap({ rentIndex: 'require' }),
      submitted > 0 ? listingSitemapEntries(0) : Promise.resolve([]),
    ])
    const entries = [...pages.entries, ...listings]
    if (entries.length <= MAX_URLS_PER_SITEMAP) return { form: 'urlset', xml: urlsetXml(entries, 'sitemap.xml') }
  }
  return { form: 'index', xml: sitemapIndexXml(locs) }
}
