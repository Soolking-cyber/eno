import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fold } from '@/lib/fold'

export const runtime = 'nodejs'

// Instant-match suggestions for the search bars (debounced typeahead, mobile +
// desktop). Queries the folded, accent-insensitive `searchText` (pg_trgm GIN
// index) for live listings + a few matching categories. Public → verified+active
// only, same gate as the browse feed. Intentionally lightweight (minimal select,
// small take) so it's fast enough to hit on every keystroke.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 80)
  if (q.length < 2) return NextResponse.json({ q, listings: [], categories: [] })

  const folded = fold(q)

  const [listings, allCategories] = await Promise.all([
    db.listing.findMany({
      where: { verified: true, status: 'active', searchText: { contains: folded } },
      orderBy: [{ featured: 'desc' }, { postedAt: 'desc' }],
      take: 6,
      select: {
        id: true, title: true, titleVi: true, price: true, currency: true,
        priceUnit: true, location: true, images: true,
        category: { select: { slug: true } },
      },
    }),
    // Categories are a tiny fixed set — fetch once and match on FOLDED text in JS
    // so accent-free input ("can ho") matches "Căn hộ", consistent with the
    // accent-insensitive listing search (and one fewer DB round-trip per keystroke).
    db.category.findMany({ select: { slug: true, name: true, nameVi: true } }),
  ])

  const categories = allCategories
    .filter((c) => fold(c.name).includes(folded) || fold(c.nameVi).includes(folded))
    .slice(0, 4)

  return NextResponse.json(
    {
      q,
      listings: listings.map((l) => {
        let image: string | null = null
        try { image = JSON.parse(l.images || '[]')[0] ?? null } catch { /* ignore */ }
        return {
          id: l.id, title: l.title, titleVi: l.titleVi, price: l.price,
          currency: l.currency, priceUnit: l.priceUnit, location: l.location,
          image, categorySlug: l.category.slug,
        }
      }),
      categories: categories.map((c) => ({ slug: c.slug, name: c.name, nameVi: c.nameVi })),
    },
    // Public verified+active data only → safe to let the CDN absorb repeat
    // prefixes (hot terms like "ho"/"xe"), matching the /api/listings policy.
    { headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=30' } },
  )
}
