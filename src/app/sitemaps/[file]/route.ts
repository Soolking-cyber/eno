import { db } from '@/lib/db'
import {
  LISTINGS_PER_SITEMAP,
  parseListingSitemapFile,
  siteOrigin,
  submittedListingWhere,
  urlsetXml,
  xmlResponse,
} from '@/lib/sitemap'
import { NextResponse } from 'next/server'

/**
 * /sitemaps/listings-<k>.xml — the k-th slice of the submitted listings (src/lib/sitemap.ts).
 *
 * ⚠️ PAGED BY `id`, NOT BY `updatedAt`. The old single file ordered by `updatedAt desc` and cut at
 * 45,000, so every write reshuffled which listings were in it and a bulk write pushed the rest out.
 * `id` is immutable, so a listing stays in the same child until rows before it are removed, and a
 * re-rank, re-price or photo attach moves nothing. The slices are cached independently for 24h, so a
 * boundary can shift between two children's builds; the cost is a listing briefly in two files or
 * in none until the next rebuild — never one silently absent for good, which was the old failure.
 *
 * ⚠️ `pages.xml` IS ITS OWN STATIC ROUTE (../pages.xml/route.ts) and wins over this dynamic segment;
 * any other name, or a `k` past MAX_LISTING_SITEMAPS, is a 404 — each distinct `k` is an ISR cache
 * entry, so the bound is what stops a crawler minting them.
 */

// Rendered on first request per child, then cached (ISR), like /c/<category>/<district>.
export const revalidate = 86400

export async function generateStaticParams() {
  return []
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const k = parseListingSitemapFile(file)
  if (k === null) return new NextResponse('Not Found', { status: 404 })
  try {
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
    const urls = rows.map((l) => `  <url><loc>${host}/listings/${l.id}</loc><lastmod>${l.updatedAt.toISOString()}</lastmod></url>\n`)
    return xmlResponse(urlsetXml(urls, file))
  } catch (error) {
    console.error(`Failed to generate sitemaps/${file}:`, error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
