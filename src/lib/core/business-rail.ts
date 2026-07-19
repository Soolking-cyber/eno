import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'

/** "Outstanding businesses" rail data — ONE flagship (most-viewed active) listing per
 *  highest-trust business storefront. Single source for GET /api/businesses/top AND the
 *  home page's SSR seed (perf Phase 1: server-known availability lets the rail render
 *  with its final geometry on first paint — the skeleton→empty collapse of the client
 *  fetch was the homepage's dominant CLS, 0.142 measured). Public-safe, no viewer data. */
export async function topBusinessListings() {
  const sellers = await db.seller.findMany({
    where: {
      OR: [{ owner: { accountType: 'business' } }, { trustScore: { gte: 110 } }],
      listings: { some: { verified: true, status: 'active' } },
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
