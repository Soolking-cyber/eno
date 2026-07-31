import { marketplaceListingScope } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'

/** "Outstanding businesses" rail data — ONE flagship (most-viewed active) listing per
 *  highest-trust business storefront. Single source for GET /api/businesses/top AND the
 *  home page's SSR seed (perf Phase 1: server-known availability lets the rail render
 *  with its final geometry on first paint — the skeleton→empty collapse of the client
 *  fetch was the homepage's dominant CLS, 0.142 measured). Public-safe, no viewer data. */
export async function topBusinessListings() {
  /**
   * ⚠️ THE EXCLUSION GOES ON THE **SELLER** QUERY, NOT THE LISTING ONE BELOW, AND THE DIFFERENCE IS
   * VISIBLE. This picks 12 sellers and then fetches one flagship listing each. Filtering at the
   * listing level would leave the desk holding a slot and returning null, and the `.filter(Boolean)`
   * afterwards would silently shrink the rail to 11 cards. Excluding the seller lets a real business
   * take the slot instead — the rail stays full, which is the whole point of a fixed-geometry rail
   * that exists to prevent CLS.
   */
  const editionScope = await marketplaceListingScope()
  const sellers = await db.seller.findMany({
    where: {
      OR: [{ owner: { accountType: 'business' } }, { trustScore: { gte: 110 } }],
      listings: { some: { verified: true, status: 'active' } },
      ...(editionScope.sellerId ? { id: editionScope.sellerId } : {}),
    },
    orderBy: [{ trustScore: 'desc' }, { reviewCount: 'desc' }, { id: 'desc' }],
    take: 12,
    select: { id: true },
  })

  // One listing per business — the most-viewed active one (their flagship product/service).
  const rows = await Promise.all(
    sellers.map((s) =>
      db.listing.findFirst({
        where: { sellerId: s.id, verified: true, status: 'active' },
        orderBy: [{ views: 'desc' }, { postedAt: 'desc' }, { id: 'desc' }],
        include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
      }),
    ),
  )

  return rows.filter((l): l is NonNullable<typeof l> => !!l).map(serializeListing)
}
