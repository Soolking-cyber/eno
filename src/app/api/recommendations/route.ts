import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { Prisma } from '@/generated/prisma/client'
import { fold } from '@/lib/fold'

export const dynamic = 'force-dynamic'

const LIMIT = 16
const TRUST: Prisma.ListingOrderByWithRelationInput = { seller: { trustScore: 'desc' } }
const split = (v: string | null, n: number) =>
  (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []).slice(0, n)

// "For You" recommendations. Personalizes from the caller's OWN on-site signals
// (recent search terms + viewed categories/brands, passed as query params from
// localStorage); falls back to Trending (most-viewed) when there's no signal. Always
// trust-ranked. Public-safe (verified + active only), so it can't leak anything the
// feed wouldn't.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const cats = split(sp.get('cats'), 6)
  const brands = split(sp.get('brands'), 6)
  const terms = split(sp.get('terms'), 6)
  const base: Prisma.ListingWhereInput = { verified: true, status: 'active' }

  // Relevance = listings in a category/brand the user has engaged with, OR matching a
  // recent search term (against the folded searchText blob). Broad OR — this is
  // discovery, not a strict filter.
  const or: Prisma.ListingWhereInput[] = []
  if (cats.length) or.push({ category: { slug: { in: cats } } })
  if (brands.length) or.push({ brandSlug: { in: brands } })
  for (const t of terms) {
    const f = fold(t)
    if (f.length >= 2) or.push({ searchText: { contains: f } })
  }

  const personalized = or.length > 0
  const where: Prisma.ListingWhereInput = personalized ? { AND: [base, { OR: or }] } : base
  // Personalized: trust then popularity then recency. Trending: popularity-led.
  const orderBy: Prisma.ListingOrderByWithRelationInput[] = personalized
    ? [TRUST, { views: 'desc' }, { postedAt: 'desc' }, { id: 'desc' }]
    : [{ views: 'desc' }, TRUST, { postedAt: 'desc' }, { id: 'desc' }]

  const rows = await db.listing.findMany({
    where,
    orderBy,
    take: LIMIT,
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
  })

  return NextResponse.json(
    { listings: rows.map(serializeListing), personalized },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  )
}
