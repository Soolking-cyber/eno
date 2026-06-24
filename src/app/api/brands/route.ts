import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeBrand } from '@/lib/brand-normalize'
import { iconPathForSlug } from '@/lib/brand-icons'

export const runtime = 'nodejs'

// Brand catalogue read — powers the post-wizard datalist, the brand directory, AND
// the search-page brand rail.
//  - `?q=`        accent-insensitive match on the normalized key (datalist).
//  - `?category=` brands that actually have LIVE listings in that category, ranked
//                 by how many — this is what the rail shows (category-contextual).
//  - neither      the most-listed brands overall (directory).
// Each brand includes `iconPath` (resolved server-side so simple-icons never ships
// to the client). Public, lightly cached.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = normalizeBrand(searchParams.get('q') || '')
  const category = searchParams.get('category')?.trim()
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 60, 1), 200)

  let rows: { slug: string; name: string; iconSlug: string | null; count: number }[]

  if (category && category !== 'all') {
    // Brands present in this category's live listings (rail context).
    const grouped = await db.listing.groupBy({
      by: ['brandSlug'],
      where: { verified: true, status: 'active', brandSlug: { not: null }, category: { slug: category } },
      _count: { _all: true },
    })
    const counts = new Map(grouped.filter((g) => g.brandSlug).map((g) => [g.brandSlug as string, g._count._all]))
    if (counts.size === 0) {
      return NextResponse.json({ brands: [] }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } })
    }
    const brandRows = await db.brand.findMany({
      where: { status: 'active', slug: { in: Array.from(counts.keys()) } },
      select: { slug: true, name: true, iconSlug: true },
    })
    rows = brandRows
      .map((b) => ({ ...b, count: counts.get(b.slug) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, limit)
  } else {
    const where = q ? { status: 'active', normalized: { contains: q } } : { status: 'active' }
    const brandRows = await db.brand.findMany({
      where,
      select: { slug: true, name: true, iconSlug: true, listingCount: true },
      orderBy: [{ listingCount: 'desc' }, { name: 'asc' }],
      take: limit,
    })
    rows = brandRows.map((b) => ({ slug: b.slug, name: b.name, iconSlug: b.iconSlug, count: b.listingCount }))
  }

  const brands = rows.map((b) => ({ slug: b.slug, name: b.name, count: b.count, iconPath: iconPathForSlug(b.iconSlug) }))

  return NextResponse.json(
    { brands },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  )
}
