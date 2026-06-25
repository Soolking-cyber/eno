import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'

export const runtime = 'nodejs'

// Home page "browse by category" rails — one horizontal feed per category, ordered by
// live DEMAND (views + weighted contacts) so the most-used category leads, mirroring
// the category-icon hierarchy. Listings within each rail are trust-first (same default
// ordering as the main feed). Public, lightly cached.
const PER_RAIL = 8 // listings per category rail (kept lean; rail scrolls for more)
const MAX_RAILS = 10 // cap the page length
const MIN_LISTINGS = 4 // skip near-empty rails (can't fill a desktop row)

export async function GET() {
  // Rank categories by demand over their live listings (like the brand rail), falling
  // back to listing count where there's no traffic yet.
  const grouped = await db.listing.groupBy({
    by: ['categoryId'],
    where: { verified: true, status: 'active' },
    _count: { _all: true },
    _sum: { views: true, contactCount: true },
  })
  const ranked = grouped
    .filter((g) => g._count._all >= MIN_LISTINGS)
    .map((g) => ({
      categoryId: g.categoryId,
      count: g._count._all,
      demand: (g._sum.views ?? 0) + 5 * (g._sum.contactCount ?? 0),
    }))
    .sort((a, b) => b.demand - a.demand || b.count - a.count)
    .slice(0, MAX_RAILS)

  const cats = await db.category.findMany({
    where: { id: { in: ranked.map((r) => r.categoryId) } },
    select: { id: true, slug: true },
  })
  const slugById = new Map(cats.map((c) => [c.id, c.slug]))

  const rails = await Promise.all(
    ranked.map(async (r) => {
      const slug = slugById.get(r.categoryId)
      if (!slug) return null
      const listings = await db.listing.findMany({
        where: { verified: true, status: 'active', categoryId: r.categoryId },
        // Trust-first, then featured, then most-viewed/recent — matches the main feed.
        orderBy: [
          { seller: { trustScore: 'desc' } },
          { featured: 'desc' },
          { views: 'desc' },
          { postedAt: 'desc' },
          { id: 'desc' },
        ],
        take: PER_RAIL,
        include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
      })
      return { slug, listings: listings.map(serializeListing) }
    }),
  )

  return NextResponse.json(
    { rails: rails.filter((r): r is { slug: string; listings: ReturnType<typeof serializeListing>[] } => !!r) },
    { headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=300' } },
  )
}
