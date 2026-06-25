import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const SELECT = {
  id: true, name: true, avatarUrl: true, avatarColor: true,
  trustScore: true, trustTier: true, location: true, reviewCount: true,
  _count: { select: { listings: true } },
} as const
const HAS_ACTIVE = { listings: { some: { verified: true, status: 'active' } } } as const

// "Outstanding businesses" — top-trust business storefronts. Business accounts lead;
// if there aren't enough yet, fill with the highest-trust storefronts (Exceptional+,
// score ≥ 110) so the rail is useful before many businesses sign up. Public-safe.
export async function GET() {
  const biz = await db.seller.findMany({
    where: { owner: { accountType: 'business' }, ...HAS_ACTIVE },
    orderBy: [{ trustScore: 'desc' }, { reviewCount: 'desc' }, { id: 'desc' }],
    take: 12,
    select: SELECT,
  })

  let rows = biz
  if (rows.length < 12) {
    const ids = rows.map((r) => r.id)
    const fill = await db.seller.findMany({
      where: { ...HAS_ACTIVE, trustScore: { gte: 110 }, id: { notIn: ids } },
      orderBy: [{ trustScore: 'desc' }, { reviewCount: 'desc' }, { id: 'desc' }],
      take: 12 - rows.length,
      select: SELECT,
    })
    rows = [...rows, ...fill]
  }

  const businesses = rows.map((s) => ({
    id: s.id,
    name: s.name,
    avatarUrl: s.avatarUrl,
    avatarColor: s.avatarColor,
    trustScore: s.trustScore,
    trustTier: s.trustTier,
    location: s.location,
    reviewCount: s.reviewCount,
    listingCount: s._count.listings,
  }))

  return NextResponse.json(
    { businesses },
    { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=300' } },
  )
}
