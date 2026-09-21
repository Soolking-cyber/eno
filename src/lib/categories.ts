import { DeskResolutionError, marketplaceListingScope } from '@/lib/edition-scope'
import 'server-only'
import { db } from './db'
import type { SerializedCategory } from './types'

// Demand weighting: a contact (revealed number / message intent) is worth far more
// than a passive view; a save sits in between. At launch everything is 0, so the
// order gracefully falls back to supply (active listing count) then name — and as
// real traffic accrues, the most-wanted categories float to the front on their own.
const W_VIEW = 1
const W_SAVE = 2
const W_CONTACT = 5

/**
 * ⛔ THE FIRST FOUR TILES ARE AN EDITORIAL DECISION, NOT A MEASUREMENT. Owner, 2026-09-21:
 * "reorganize categories according to importance the top 4 rest old order. 1 rentals 2 jobs
 * 3 services 4 electronics", then "swap electronics to moving sales" — so the four are
 * rentals, jobs, services, moving-sale.
 *
 * The pin sits IN FRONT OF the demand ranking, it does not replace it: everything from the fifth
 * tile down is still ordered by live demand exactly as before.
 *
 * ⚠️ DEMAND COULD NEVER HAVE PROMOTED THESE ON ITS OWN, WHICH IS THE POINT. The score is
 * views+saves+contacts summed over ACTIVE LISTINGS, so it follows SUPPLY: measured on production
 * 2026-09-21 the rail ran electronics, sports, furniture-appliances, … and put `rentals` LAST of
 * seventeen. `rentals`, `jobs` and `services` are low-supply, high-intent — few listings, but the
 * visitor who wants one wants it badly — and a category with 20 listings cannot out-score one with
 * 80,000 however wanted it is. That bias is what this corrects.
 */
const PINNED_SLUGS = ['rentals', 'jobs', 'services', 'moving-sale'] as const

/**
 * All categories ordered by live DEMAND (most-wanted first) for the search rails +
 * home grid. One aggregate query over active listings; safe to call from ISR pages
 * (cached by their revalidate window). Falls back to empty on a DB error.
 */
export async function getCategoriesByDemand(): Promise<SerializedCategory[]> {
  try {
    const editionScope = await marketplaceListingScope()
    const [categories, demand] = await Promise.all([
      /**
       * ⚠️ THIS NESTED `_count` IS INVISIBLE TO scripts/edition-lint.mjs — its regex matches
       * `db.listing.*`, and this is `db.category.findMany`. A Prisma client extension would not
       * cover it either. It only ever gets fixed by hand, which is why it is called out here: it is
       * the number on every category chip, and without the scope the services category advertises
       * 15 listings that a marketplace visitor cannot see.
       *
       * The RAW fragment, not scopedListingWhere: the value must stay a plain ListingWhereInput
       * inside `_count.select`, and there is no sibling `sellerId` here to collide with.
       */
      db.category.findMany({
        include: { _count: { select: { listings: { where: { verified: true, status: 'active', ...editionScope } } } } },
      }),
      // Decides the ORDER of the home category rail: desk views and contacts would otherwise float
      // the services category to the front of the licensed marketplace's grid.
      db.listing.groupBy({
        by: ['categoryId'],
        where: { verified: true, status: 'active', ...editionScope },
        _sum: { views: true, contactCount: true, savedCount: true },
      }),
    ])

    const score = new Map(
      demand.map((d) => [
        d.categoryId,
        (d._sum.views ?? 0) * W_VIEW + (d._sum.contactCount ?? 0) * W_CONTACT + (d._sum.savedCount ?? 0) * W_SAVE,
      ]),
    )

    return categories
      .map((c) => ({
        id: c.id,
        name: c.name,
        nameVi: c.nameVi,
        slug: c.slug,
        icon: c.icon,
        color: c.color as SerializedCategory['color'],
        description: c.description,
        verifiedCount: c._count.listings,
        demand: score.get(c.id) ?? 0,
      }))
      /**
       * The four pinned slugs first, in the order they are listed; everything else most-wanted
       * first, ties broken by supply (active count) then name — unchanged from before the pin.
       * ⚠️ A slug in PINNED_SLUGS that no longer exists in the database simply never matches, so a
       * renamed or retired category degrades to "not pinned" rather than leaving a hole in the rail.
       */
      .sort((a, b) => {
        const pa = (PINNED_SLUGS as readonly string[]).indexOf(a.slug)
        const pb = (PINNED_SLUGS as readonly string[]).indexOf(b.slug)
        if (pa !== -1 && pb !== -1) return pa - pb
        if (pa !== -1) return -1
        if (pb !== -1) return 1
        return b.demand - a.demand || b.verifiedCount - a.verifiedCount || a.name.localeCompare(b.name)
      })
      .map(({ demand: _demand, ...c }) => c)
  } catch (e) {
    // A desk-resolution failure must not become a silently empty category rail — see the same
    // re-throw on the home page.
    if (e instanceof DeskResolutionError) throw e
    return []
  }
}
