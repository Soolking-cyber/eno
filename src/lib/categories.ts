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
      // Most-wanted first; ties broken by supply (active count) then name.
      .sort((a, b) => b.demand - a.demand || b.verifiedCount - a.verifiedCount || a.name.localeCompare(b.name))
      .map(({ demand: _demand, ...c }) => c)
  } catch (e) {
    // A desk-resolution failure must not become a silently empty category rail — see the same
    // re-throw on the home page.
    if (e instanceof DeskResolutionError) throw e
    return []
  }
}
