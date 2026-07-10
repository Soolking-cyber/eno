import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { Prisma } from '@/generated/prisma/client'
import { fold } from '@/lib/fold'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'

export const dynamic = 'force-dynamic'

const LIMIT = 16
const RANK: Prisma.ListingOrderByWithRelationInput = { rankScore: 'desc' }
const split = (v: string | null, n: number) =>
  (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []).slice(0, n)

// "For You" recommendations. Personalizes from the caller's OWN on-site signals
// (recent search terms + viewed categories/brands, passed as query params from
// localStorage); falls back to Trending (most-viewed) when there's no signal. Always
// trust-ranked. Public-safe (verified + active only), so it can't leak anything the
// feed wouldn't.
export async function GET(req: NextRequest) {
  // Public + runs user-controlled substring scans against the DB — cap per IP so it can't
  // be turned into a cheap scraping/DB-load tool. Generous for real page loads.
  const rl = await rateLimit('recommendations', clientIp(req), 60, '1 m')
  if (!rl.success) return NextResponse.json({ listings: [], personalized: false }, { status: 429 })

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

  // Thin-catalog guard: the non-personalized ("Trending now") rail is just the top of the
  // same pool the feed below already shows. When the whole active catalog is smaller than
  // ~2 feed pages, the rail mirrors the grid card-for-card — repetition makes a thin
  // catalog look thinner. Return [] (rails self-hide on empty); self-reverses as supply grows.
  if (!personalized) {
    const pool = await db.listing.count({ where: base })
    if (pool < 24) {
      return NextResponse.json(
        { listings: [], personalized },
        { headers: { 'Cache-Control': 'private, max-age=30' } },
      )
    }
  }
  // Balanced rankScore blend for both modes — same hierarchy as the rest of the app:
  // trusted-and-fresh sellers lead, then popularity (views). (Personalization/trending only
  // changes the WHERE, not the ranking — a low-trust listing never tops the rail.)
  const orderBy: Prisma.ListingOrderByWithRelationInput[] = [RANK, { views: 'desc' }, { id: 'desc' }]

  const rows = await db.listing.findMany({
    where,
    orderBy,
    take: LIMIT,
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
  })

  return NextResponse.json(
    { listings: await localizeListingTitles(rows.map(serializeListing), req.cookies.get('lang')?.value), personalized },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  )
}
