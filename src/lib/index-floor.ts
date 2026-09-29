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
 *
 * ⛔ AND NEITHER PAGE GOES `noindex` THE MOMENT IT DIPS (SEO wave B, I1b; owner decision I-g,
 * 2026-09-28: N = 14 days). The robots tag waits until the page has been under its floor for
 * STALE_NOINDEX_DAYS — see `belowFloorThroughWindow`. Six categories were crawled while empty and
 * kept the `noindex` for weeks after they filled (URL Inspection, 2026-09-28: /c/rentals, and
 * /c/vehicles since Sep 2, /c/baby-kids and /c/hobbies-sports since Aug 23, /c/pets since Aug 27,
 * /c/food-drink since Aug 31): Google recrawls a `noindex` page slowly, so an empty spell cost weeks.
 * Inside the window a page under its floor stays indexable but is still unlinked and unsubmitted —
 * the chip, rent-index and sitemap rules above read the count alone, so they never point at a page
 * that may turn `noindex`.
 */
export const MIN_INDEXABLE_LISTINGS = 10

/** True when `n` listings are enough for a district page to be indexed, linked and (own stock) submitted. */
export function isIndexableCount(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_INDEXABLE_LISTINGS
}

/** A category page's only floor (decision I-a: none but "not empty"): one live listing. */
export const MIN_CATEGORY_LISTINGS = 1

/** Owner decision I-g (2026-09-28): how long a page must sit under its floor before it says `noindex`. */
export const STALE_NOINDEX_DAYS = 14
export const STALE_NOINDEX_MS = STALE_NOINDEX_DAYS * 24 * 60 * 60 * 1000

/**
 * The window's first instant. A row that left the page's live set AFTER it may have held the page at
 * its floor inside the window; one that left at or before it cannot have. So a page that emptied
 * exactly 14 days ago has been empty for 14 days, and says `noindex`.
 */
export function staleWindowStart(now: number): Date {
  return new Date(now - STALE_NOINDEX_MS)
}

/**
 * True when a page has been under its `floor` for the WHOLE window, so its robots tag may say
 * `noindex`. It holds `live` now; `leftInWindow` bounds from above how many rows left its live set
 * inside the window (src/lib/stale-noindex.ts, which names the departures it cannot see). At any
 * moment of the window the page held at most `live + leftInWindow` — a row that ENTERED since only
 * lowers the past count — so a sum under the floor means it was under the floor throughout.
 *
 * ⚠️ NOT "THE NEWEST ACTIVITY IN SCOPE": a sub-floor district whose five listings are edited, viewed
 * or joined by a sixth has been under 10 all along. Only departures can have lifted the past count.
 * For an empty category the two are the same thing — every row in scope is a departure.
 *
 * ⚠️ FAILS TOWARD INDEXABLE: a count that is not a number cannot prove a page was under its floor.
 */
export function belowFloorThroughWindow(live: number, leftInWindow: number, floor: number): boolean {
  return live + leftInWindow < floor
}
