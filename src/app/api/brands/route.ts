import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeBrand } from '@/lib/brand-normalize'
import { brandIconPath } from '@/lib/brand-icons'

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
  const subcategory = searchParams.get('subcategory')?.trim()
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 60, 1), 200)

  let rows: { slug: string; name: string; iconSlug: string | null; logoPath: string | null; count: number }[]

  if (category && category !== 'all') {
    // Brands present in this category's (and, when set, subcategory's) live
    // listings (rail context), ranked by live DEMAND (views + weighted contacts)
    // so the most-wanted brands lead; falls back to listing count when there's
    // no traffic yet. Subcategory scoping keeps the hierarchy honest: Bicycle
    // must not offer Toyota just because both live under Vehicles.
    const grouped = await db.listing.groupBy({
      by: ['brandSlug'],
      where: {
        verified: true,
        status: 'active',
        brandSlug: { not: null },
        category: { slug: category },
        ...(subcategory && subcategory !== 'all' ? { subcategorySlug: subcategory } : {}),
      },
      _count: { _all: true },
      _sum: { views: true, contactCount: true },
    })
    const stat = new Map(
      grouped.filter((g) => g.brandSlug).map((g) => [
        g.brandSlug as string,
        { count: g._count._all, demand: (g._sum.views ?? 0) + 5 * (g._sum.contactCount ?? 0) },
      ]),
    )
    if (stat.size === 0) {
      return NextResponse.json({ brands: [] }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } })
    }
    const brandRows = await db.brand.findMany({
      where: { status: 'active', slug: { in: Array.from(stat.keys()) } },
      select: { slug: true, name: true, iconSlug: true, logoPath: true },
    })
    rows = brandRows
      .map((b) => ({ ...b, count: stat.get(b.slug)?.count ?? 0, demand: stat.get(b.slug)?.demand ?? 0 }))
      .sort((a, b) => b.demand - a.demand || b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map(({ demand: _d, ...b }) => b)
  } else {
    const where = q ? { status: 'active', normalized: { contains: q } } : { status: 'active' }
    const brandRows = await db.brand.findMany({
      where,
      select: { slug: true, name: true, iconSlug: true, logoPath: true, listingCount: true },
      orderBy: [{ listingCount: 'desc' }, { name: 'asc' }],
      take: limit,
    })
    rows = brandRows.map((b) => ({ slug: b.slug, name: b.name, iconSlug: b.iconSlug, logoPath: b.logoPath, count: b.listingCount }))
  }

  const brands = rows.map((b) => ({ slug: b.slug, name: b.name, count: b.count, iconPath: brandIconPath(b) }))

  return NextResponse.json(
    { brands },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  )
}
