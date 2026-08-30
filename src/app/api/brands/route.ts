import { scopedListingWhere } from '@/lib/edition-scope'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeBrand } from '@/lib/brand-normalize'
import { brandIconPath } from '@/lib/brand-icons'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'

// Brand catalogue read — powers the post-wizard datalist, the brand directory, AND
// the search-page brand rail.
//  - `?q=`        accent-insensitive match on the normalized key (datalist).
//  - `?category=` brands that actually have LIVE listings in that category, ranked
//                 by how many — this is what the rail shows (category-contextual).
//  - neither      the most-listed brands overall (directory).
// Each brand includes `iconPath` (resolved server-side so simple-icons never ships
// to the client). Public, lightly cached.
//
// ⚠️ WS6 MIGRATION. `auth: 'public'` — the post wizard's datalist, the brand directory and the
// search rail all call this signed-out. No rate limit and no body existed, so none were added.
//
// ⚠️ `NextRequest` → `Request`. The wrapper hands the handler a plain `Request`; this route only
// ever did `new URL(req.url).searchParams`, which is identical on both. Nothing reads `nextUrl`.
//
// ⚠️ BOTH EARLY RETURNS ARE PRESERVED AS `NextResponse`s, INCLUDING THE EMPTY ONE. The `stat.size
// === 0` branch answers `{"brands":[]}` WITH the same Cache-Control as the populated branch — an
// empty category rail is exactly the case worth having the CDN absorb, so returning a plain object
// there (which would drop the header) would quietly make the miss path the expensive one.
//
// ⚠️ ACCEPTED WIRE CHANGE, FAILURE PATH ONLY: the groupBy / findMany calls and
// `scopedListingWhere()` were unguarded, so a throw was Next's default 500; it is now
// `{"error":"internal_error"}` 500.
export const GET = route({ auth: 'public' }, async ({ req }) => {
  const { searchParams } = new URL(req.url)
  const q = normalizeBrand(searchParams.get('q') || '')
  const category = searchParams.get('category')?.trim()
  const subcategory = searchParams.get('subcategory')?.trim()
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 60, 1), 200)
  const sellerParam = searchParams.get('seller')?.trim() || null

  let rows: { slug: string; name: string; iconSlug: string | null; logoPath: string | null; count: number }[]

  if (category && category !== 'all') {
    // Brands present in this category's (and, when set, subcategory's) live
    // listings (rail context), ranked by live DEMAND (views + weighted contacts)
    // so the most-wanted brands lead; falls back to listing count when there's
    // no traffic yet. Subcategory scoping keeps the hierarchy honest: Bicycle
    // must not offer Toyota just because both live under Vehicles.
    const grouped = await db.listing.groupBy({
      by: ['brandSlug'],
      // ⚠️ A LATENT LEAK, not a live one — held shut today only by the seeded desk rows having a
      // null brandSlug. createListingCore sets brandSlug from the resolver, so one desk product
      // with a brand opens it. Closed rather than left to luck.
      where: await scopedListingWhere({
        verified: true,
        status: 'active',
        brandSlug: { not: null },
        category: { slug: category },
        ...(subcategory && subcategory !== 'all' ? { subcategorySlug: subcategory } : {}),
        /**
         * STOREFRONT SCOPE — `?seller=<id>`, sent by a shop's own subdomain. Owner, 2026-08-30:
         * *"storefronts dont show brands"*.
         *
         * ⛔ THE RAIL IS DERIVED FROM LISTINGS, SO SCOPING IT HERE IS WHAT MAKES IT THE SHOP'S. The
         * brands come from a groupBy over the catalogue, not from the Brand table — so without the
         * seller the rail on `apple.eno.vn` advertised every brand the MARKETPLACE carries in that
         * category, and tapping one returned nothing, because the feed beside it is scoped and the
         * rail was not. A shop's storefront now offers exactly the brands that shop stocks.
         * ⚠️ IT GOES INSIDE `scopedListingWhere`, never spread onto its result — the same rule the
         * feed query documents, because that helper may return `{ AND: [...] }` and a spread would
         * drop the edition exclusion.
         */
        ...(sellerParam ? { sellerId: sellerParam } : {}),
      }),
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
      return NextResponse.json({ brands: [] }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=900' } })
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
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=900' } },
  )
})
