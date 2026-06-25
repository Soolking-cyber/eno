import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'

export const dynamic = 'force-dynamic'

// "Outstanding businesses" — rewards the highest-trust business storefronts by featuring
// ONE of each one's best listing (their most-viewed active product/service). Business
// accounts are included regardless of score; high-trust storefronts (Exceptional+, ≥110)
// fill in so the rail is populated before many businesses sign up. One card per seller,
// ordered by the seller's trust. Public-safe.
export async function GET() {
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

  const listings = rows.filter((l): l is NonNullable<typeof l> => !!l).map(serializeListing)

  return NextResponse.json(
    { listings },
    { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=300' } },
  )
}
