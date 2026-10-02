/**
 * The "Posted" (Ngày đăng) recency filter on property rentals — owner, 2026-10-02: "we need recency
 * filter when property was posted up to 7 days".
 *
 * ⚠️ A FACET IN THE TAXONOMY, A COLUMN ON THE SERVER. It is declared as an ordinary toggle facet
 * (key `posted`, src/lib/taxonomy.ts) so the explorer's Filter panel, active chips, URL round-trip
 * (`attr_posted=7d`), saved searches and count chips all handle it with no new plumbing — but its
 * value is never stored in `Listing.attributes`. `attrWhere` (src/lib/attr-match.ts) turns it into a
 * `postedAt >= cutoff` clause, and facet-counts.ts counts it with its own queries, because the
 * attribute rails are classified in memory from grouped JSON and a timestamp cannot be grouped.
 *
 * ⚠️ `postedAt`, NOT `createdAt`. It is the date the listing is presented as posted: a seller's own
 * post sets it at publish and "confirm availability" bumps it; every importer sets it from the
 * source's own posted / re-posted date (memory: eno-apartment-source-dates). The column is NOT NULL
 * (`@default(now())`), so there is no fallback to write.
 *
 * ⚠️ THE REFERENCE INSTANT MOVES IN 5-MINUTE STEPS, ROUNDED UP. The facet-count memo is keyed on
 * the `where` clauses, so a cutoff that moved every millisecond would make every request a new
 * question and every chip a fresh fan-out of COUNTs; a 5-minute step keeps the memo (60 s TTL) useful.
 * It is rounded UP so the QUERY keeps the label's promise: at the moment it runs, "Last 24 hours"
 * returns nothing older than 24 h (a post 23 h 56 min old may wait for the next step). Rounding down —
 * the first draft — admitted posts up to 5 min older than the label, which a reviewer rightly called a
 * mislabel. ⚠️ A RESPONSE can still be served from the edge cache (api/listings: s-maxage=120 +
 * stale-while-revalidate=300), so what a buyer sees can be that many minutes behind the clock — the
 * same lag every other feed figure has.
 * ⚠️ ONE INSTANT PER REQUEST: the route passes a single `now` to the feed (FeedFilterOptions.now) and to
 * computeFacetCounts, so the grid and its chips always share a cutoff.
 */

import { facetsFor } from '@/lib/taxonomy'

export const POSTED_FACET_KEY = 'posted'

/** Option value → window length in hours. The values are the URL contract (`attr_posted=7d`). */
export const POSTED_WINDOWS: Readonly<Record<string, number>> = Object.freeze({
  '1d': 24,
  '3d': 72,
  '7d': 168,
})

/**
 * Whether the view offers the Posted filter (the taxonomy is the one answer). The feed applies
 * `attr_posted` ONLY where this is true: a hand-typed or stale URL on vehicle hire, or on another
 * category, must not narrow a feed whose Filter panel shows no Posted control to clear it with.
 */
export function postedOffered(category: string | null | undefined, subcategory: string | null | undefined): boolean {
  if (!category || category === 'all') return false
  return facetsFor(category, subcategory && subcategory !== 'all' ? subcategory : null).some((f) => f.key === POSTED_FACET_KEY)
}

const HOUR_MS = 3_600_000
const STEP_MS = 5 * 60_000

/** `now` rounded UP to its 5-minute step — the instant every window is measured back from. */
export function postedNow(now: Date = new Date()): Date {
  return new Date(Math.ceil(now.getTime() / STEP_MS) * STEP_MS)
}

/** The earliest `postedAt` a row may have to pass `attr_posted=<value>`, or null for an unknown value. */
export function postedCutoff(value: string, now: Date = new Date()): Date | null {
  const hours = Object.prototype.hasOwnProperty.call(POSTED_WINDOWS, value) ? POSTED_WINDOWS[value] : undefined
  if (hours === undefined) return null
  return new Date(postedNow(now).getTime() - hours * HOUR_MS)
}
