import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { belowFloorThroughWindow, staleWindowStart } from '@/lib/index-floor'

/**
 * THE STALE-NOINDEX CHECK (SEO wave B, I1b; owner decision I-g: 14 days). Has a page that is under
 * its floor NOW been under it for the whole window? Read by `/c/<slug>` (floor: one live listing) and
 * `/c/<slug>/<district>` (floor: MIN_INDEXABLE_LISTINGS); the rule itself is `belowFloorThroughWindow`
 * in src/lib/index-floor.ts.
 *
 * ⚠️ DERIVED FROM THE LISTING ROWS, NO NEW TABLE. What could have held the page at its floor inside
 * the window is a row that was live then and is not now. Such a row is still in the page's scope
 * (same category, same place), and leaving the live set was a write to it, so its timestamp is inside
 * the window: it is counted here. Apart from the gaps named below, the count is an upper bound, which
 * is the safe side — it can only keep a page indexable longer.
 *
 * ⚠️ WHICH TIMESTAMPS. `updatedAt` moves on every Prisma write (`updateMany` included), and every way
 * a listing leaves the live set in the app and the importers is one — sold, hidden, unverified, taken
 * down, retired — or a raw UPDATE that sets `"updatedAt" = now()` itself (affiliate-price-refresh.ts,
 * the seed scripts; grep of `UPDATE "Listing"`, 2026-09-29). `soldAt` and `takenDownAt` also catch a
 * write that set them and not `updatedAt`. The counters that bump `updatedAt` with no real change
 * (views, saves; I3a stops them) touch only LIVE rows (view/route.ts and save/route.ts count nothing
 * else), which are not counted here; a contact reveal on a sold listing can bump one, which again
 * only keeps a page indexable longer.
 *
 * ⚠️ WHAT IT CANNOT SEE, all undercounts: a row DELETED inside the window (a seller's delete, an admin
 * reject and account erasure remove the row; nothing records its category), a row whose category or
 * district was edited away (it is in another scope now), and a hand-run UPDATE that sets `status`
 * alone (the importers print such rollback lines). If one of those is what kept the page at its
 * floor, the page turns `noindex` sooner than 14 days — at worst as soon as it did before this check.
 * Recording them would take a new table or column; the owner asked for none.
 *
 * ⚠️ AND WHAT IT OVERCOUNTS, all on the indexable side: a row that was never live (pending
 * moderation, an identity hold) but was written inside the window, and a non-live row something keeps
 * rewriting — an importer's upsert of a row it did not retire but that stays hidden (`status` is
 * create-only there), a price refresh of a retired affiliate row. Such a page stays indexable longer,
 * still unlinked and unsubmitted — and for as long as the rewrites go on, not 14 days: for a district
 * page that is where it was before I1; for an EMPTY category it is a 200 of zero listings with no
 * noindex, where `live === 0` said noindex at once (opus, review of this change). None today: the
 * three empty categories hold no row at all (community-events, moving-sale, property).
 * Measured 2026-09-29 (read-only): of the 7 district pages under the floor, the window changes one
 * decision — www.eno.forum/c/services/an-khanh, 2 live rows at most and 14 of eno's own hidden on
 * 2026-09-19, which turns `noindex` on 2026-10-03 (on eno.vn those rows are out of the edition scope,
 * so it stays `noindex` there). The other six have no non-live row written in the window.
 *
 * ⚠️ NO try/catch, LIKE THE PAGE'S OTHER READS: a failed regeneration keeps serving the last good copy
 * (Next's ISR contract), robots tag included; catching here would cache a guessed tag instead.
 *
 * ⚠️ THE TAG FLIPS AT THE PAGE'S NEXT REGENERATION AFTER DAY 14, not on the minute: up to 6 hours
 * later on a category page (`revalidate` 21600), up to a day on a district page (86400).
 *
 * `where` is the page's scope WITHOUT its liveness clause (category, place, places-only on rentals);
 * the edition scope is applied here, as on every listing read. `take` stops the count as soon as it
 * settles the answer (one row for an empty category).
 */
const NOT_LIVE: Prisma.ListingWhereInput = { OR: [{ verified: false }, { status: { not: 'active' } }] }

export async function staleBelowFloor({ where, live, floor, now = Date.now() }: {
  where: Prisma.ListingWhereInput
  live: number
  floor: number
  now?: number
}): Promise<boolean> {
  // At or over the floor now (or not a number): nothing to decide, and no query.
  if (!belowFloorThroughWindow(live, 0, floor)) return false
  const since = staleWindowStart(now)
  const leftInWindow = await db.listing.count({
    where: await scopedListingWhere({
      AND: [where, NOT_LIVE, { OR: [{ updatedAt: { gt: since } }, { soldAt: { gt: since } }, { takenDownAt: { gt: since } }] }],
    }),
    take: floor - live,
  })
  return belowFloorThroughWindow(live, leftInWindow, floor)
}
