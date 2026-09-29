/**
 * THE INDEXING FLOOR FOR A CATEGORY × DISTRICT PAGE (SEO wave B, I1; owner decision I-a, 2026-09-27).
 *
 * A `/c/<category>/<district>` page is a district's worth of listing cards and one sentence of copy.
 * With two or three cards it is a thin page, and every district that one listing reached got one: a
 * chip, a crawlable URL with no robots directive, and — when the listing was our own — a sitemap
 * entry. Measured on a production build, 2026-09-29: 7 of the 34 category × district pages held under
 * 10 listings (`/c/rentals/can-gio` 1, `/c/services/an-khanh` 2, four `binh-trung` pages 2–9, and one
 * matched only by `location`), five of them were in the sitemap, and Search Console had
 * `/c/services/an-khanh` as "Crawled - currently not indexed" (2026-09-28).
 *
 * ONE NUMBER, FOUR READERS, so they cannot disagree about which pages are worth indexing:
 * - the district page's own robots tag (`[district]/page.tsx`): `noindex, follow` below the floor,
 *   over the page's full count (`data.total`, imports included — it is what the page shows);
 * - every link to a district page — the category page's "By area" chips and /c/rentals' busiest
 *   districts (`category-data.ts`), the district page's sibling chips, and the rent index's table
 *   (`rent-index-sections.tsx`) — each gated on a count that is a SUBSET of the linked page's scope,
 *   so a link that passes lands on a page that passes (the two caveats — a spelling that differs only
 *   in case or diacritics, and the rent snapshot's age — are written where they apply);
 * - the sitemap (`sitemaps/pages.xml`), which submits a district page only with at least this many
 *   of OUR OWN listings (rule A: imports never count, and a rentals district never qualifies by its
 *   own count at all).
 *
 * ⚠️ NO FLOOR ON CATEGORY PAGES (decision I-a): `/c/<slug>` keeps its own rule — noindex only while
 * it holds nothing (load-category.ts). A category is a hub, not a district's worth of cards.
 */
export const MIN_INDEXABLE_LISTINGS = 10

/** True when `n` listings are enough for a district page to be indexed, linked and (own stock) submitted. */
export function isIndexableCount(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_INDEXABLE_LISTINGS
}
