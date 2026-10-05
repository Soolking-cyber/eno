import { cache } from 'react'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { isGoneListing } from '@/lib/gone-listing'
import { isJournaledGone } from '@/lib/gone-listing-ids'
// `{ teachers: true }` on every read here: each one is pinned to ONE listing id, so the default
// teacher exclusion (scopedListingWhere) would only 404 a teacher's own profile page.

/**
 * The PDP's listing reads: a cheap viewability probe for `layout.tsx`, and the full row for
 * `generateMetadata` and the page body.
 *
 * ⚠️ BOTH ARE `cache()`-WRAPPED, so a request pays for each at most once. They lived inside
 * `page.tsx` until the 404 fix needed one from the layout too, and a page module is the wrong thing
 * to import from — Next treats `page.tsx` as a route entry, not a module.
 */

/**
 * Is this listing publicly viewable? Three columns, one indexed lookup.
 *
 * ⛔ IT IS A SEPARATE, DELIBERATELY TINY QUERY, AND THE FIRST VERSION OF THE 404 FIX GOT THIS
 * WRONG TWICE OVER. That version had the layout call `getListing` below and 404 only on null:
 *
 *   · It missed hidden, unverified and held listings entirely. `scopedListingWhere({ id })` does
 *     not filter on `status` or `verified`, so those rows come back non-null, the layout waved them
 *     through, and the page's own policy guard then ran BELOW the loading boundary (deleted since
 *     SEO wave B, H1a) — the exact soft-404 the fix exists to remove. Measured on production
 *     2026-09-07: a hidden listing answered 200. Three reviewers found it independently.
 *   · It made the skeleton wait on the full seller+category+owner join. A layout rendered above the
 *     loading boundary, which is what bought the correct status — but it also meant everything the
 *     layout awaited delayed the shell. The skeleton is gone since SEO wave B, H1a (see layout.tsx),
 *     and the layout's wait now delays the page itself, so a three-column primary-key lookup is
 *     still about as little of it as can be bought.
 *
 * ⚠️ THE RULE HERE MUST STAY IN STEP WITH `page.tsx`'s GUARD. `sold` is viewable on purpose — it
 * renders its own on-brand "this item has been sold" page rather than a 404 — so this must not
 * reject it. The page remains the authority on what happens next; this only decides 404 or not.
 *
 * ⛔ AND SO IS A GONE ROW — a hidden import-shop listing, which renders the gone page (200, noindex;
 * src/lib/gone-listing.ts). Only a verified HIDDEN row can be one, so only that row pays for the
 * second read, and the read is `getListing` itself: the page and generateMetadata ask for the same row
 * through the same `cache()`, so the request makes it once. Every other row costs what it always did.
 */
export const isListingViewable = cache(async (id: string) => {
  const row = await db.listing.findFirst({
    where: await scopedListingWhere({ id }, { teachers: true }),
    select: { verified: true, status: true },
  })
  if (listingIsViewable(row)) return true
  // The journal first: a Set lookup spares the full read for every hidden row that can never be gone.
  return !!row && row.verified && row.status === 'hidden' && isJournaledGone(id) && isGoneListing(await getListing(id))
})

/**
 * The rule itself, as a pure function so it can be TESTED — which is the point, because the bug
 * three reviewers caught was in this rule and not in the plumbing. This module imports Prisma, so
 * `isListingViewable` above cannot be reached from a unit test; `listingIsViewable` can.
 * ⚠️ It is the LIVE half (active or sold) — a hidden row is still `false` here; whether it is a gone
 * page is `isGoneListing`'s question, asked of the full row (above).
 */
export const listingIsViewable = (row: { verified: boolean; status: string } | null) =>
  !!row && row.verified && (row.status === 'active' || row.status === 'sold')

/**
 * ⚠️ findFirst, NOT findUnique, AND THAT IS FORCED. `scopedListingWhere` returns an
 * `{ AND: [...] }` wrapper, which `ListingWhereUniqueInput` rejects outright. Every caller already
 * notFound()s on null, so a desk listing simply becomes a 404 on eno.vn instead of an ISR-cached
 * PDP shipping Product JSON-LD (offers, priceCurrency, seller) for a government e-Visa service
 * from a licensed sàn TMĐT.
 */
export const getListing = cache(async (id: string) =>
  db.listing.findFirst({
    where: await scopedListingWhere({ id }, { teachers: true }),
    // owner.lastSeenAt: presence for the seller strip — consumed server-side into a
    // day-coarse bucket input (sellerMetrics), the raw timestamp never serializes.
    include: { category: true, seller: { include: { owner: { select: { accountType: true, lastSeenAt: true } } } } },
  }),
)
