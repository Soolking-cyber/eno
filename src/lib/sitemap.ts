import type { Prisma } from '@/generated/prisma/client'
import { scopedListingWhere } from '@/lib/edition-scope'

/**
 * THE SITEMAP IS AN INDEX NOW — /sitemap.xml names child sitemaps, and every child is capped.
 *
 *   /sitemap.xml                 <sitemapindex>: the pages child + one child per LISTINGS_PER_SITEMAP
 *   /sitemaps/pages.xml          <urlset>: home, static/editorial pages, help, categories, category ×
 *                                district combos, storefronts — everything that is not a listing
 *   /sitemaps/listings-<k>.xml   <urlset>: the k-th slice of the SUBMITTED listings, ordered by id
 *
 * ⛔ WHY: THE SINGLE FILE WAS TWO `take: 45000` WINDOWS ORDERED BY `updatedAt desc`. One fed the
 * category lastmods, the category × district combos and the storefront URLs; the other fed the
 * listing URLs. Any bulk write that touches `updatedAt` — a 44,000-row nhatot import, an affiliate
 * sync — fills a window with its own rows, and everything older silently drops out: districts that
 * only older stock covers lose their combo URL, and their sellers' storefronts leave the sitemap,
 * with nothing reporting it. The fix is not a bigger number: the derivations are now whole-table
 * GROUP BYs (src/app/sitemaps/pages.xml/route.ts), and the listing URLs are paged into as many
 * children as the count needs.
 *
 * ⚠️ WHAT "EVERY PUBLIC LISTING" MEANS HERE IS UNCHANGED: `submittedListingWhere()` below. Imported
 * reference/affiliate rows stay crawlable but NOT submitted — the owner's 2026-09-17 decision, whose
 * reasoning sits in pages.xml/route.ts beside the old listing loop. Paging does not widen the set;
 * it stops the set being truncated.
 */

/** Sitemap protocol: ≤ 50,000 URLs per file. Listing children keep the old headroom. */
export const LISTINGS_PER_SITEMAP = 45_000
export const MAX_URLS_PER_SITEMAP = 50_000
/**
 * A sanity bound on `listings-<k>.xml`, not a policy: 200 × 45,000 = 9M submitted listings. Each
 * child is an ISR cache entry, so an unbounded `k` would let any crawler mint cache entries (and
 * database OFFSET scans) by asking for `listings-999999.xml`.
 */
export const MAX_LISTING_SITEMAPS = 200

export function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
}

/**
 * THE ONE DEFINITION OF A LISTING THIS SITE ASKS GOOGLE TO INDEX — used by the index (to count)
 * and by every listing child (to page), so the two cannot disagree about how many children exist.
 *
 *   · `verified: true, status: 'active'` — exactly what the PDP serves without `noindex`
 *     (src/app/[lang]/listings/[id]/(pdp)/page.tsx: robots is undefined only for verified+active).
 *   · `scopedListingWhere` — the edition boundary: the licensed marketplace never submits the desk.
 *   · `affiliateUrl: null` — imported stock is crawlable, not submitted (see pages.xml/route.ts).
 *
 * ⚠️ NESTED IN AN `AND`, NOT SPREAD: whatever shape scopedListingWhere returns, the extra key cannot
 * collide with it (the note that used to sit on this query in sitemap.xml/route.ts).
 *
 * `extra` narrows further (the category × district block passes `district: { not: null }`); it can
 * only ADD conditions — the three rules above always apply.
 */
export async function submittedListingWhere(extra: Prisma.ListingWhereInput = {}) {
  return { AND: [await scopedListingWhere({ ...extra, verified: true, status: 'active' }), { affiliateUrl: null }] }
}

/** How many `listings-<k>.xml` children `total` submitted listings need (0 → none). */
export function listingSitemapCount(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.min(MAX_LISTING_SITEMAPS, Math.ceil(total / LISTINGS_PER_SITEMAP))
}

export function listingSitemapPath(k: number): string {
  return `/sitemaps/listings-${k}.xml`
}

export const PAGES_SITEMAP_PATH = '/sitemaps/pages.xml'

/** `listings-<k>.xml` → k, or null for anything else (including a `k` past the bound, or `01`). */
export function parseListingSitemapFile(file: string): number | null {
  const m = /^listings-(0|[1-9]\d{0,5})\.xml$/.exec(file)
  if (!m) return null
  const k = Number(m[1])
  return k < MAX_LISTING_SITEMAPS ? k : null
}

export function sitemapIndexXml(locs: string[]): string {
  const body = locs.map((loc) => `  <sitemap><loc>${loc}</loc></sitemap>\n`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}</sitemapindex>`
}

/**
 * Wrap pre-rendered `<url>` entries in a urlset, trimming past the protocol cap.
 *
 * ⚠️ A FILE OVER 50,000 URLs IS REJECTED WHOLE, so trimming the tail is the lesser failure — and it
 * is logged, because a trimmed sitemap is a real defect to fix (split the file), not a steady state.
 */
export function urlsetXml(entries: string[], label: string): string {
  let kept = entries
  if (entries.length > MAX_URLS_PER_SITEMAP) {
    console.error(`[sitemap] ${label} has ${entries.length} URLs — trimmed to ${MAX_URLS_PER_SITEMAP}; split it into another child`)
    kept = entries.slice(0, MAX_URLS_PER_SITEMAP)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${kept.join('')}</urlset>`
}

export function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600',
    },
  })
}
