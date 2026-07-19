import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'

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
        // Balanced rankScore blend, then most-viewed — matches the main feed's order.
        orderBy: [
          { rankScore: 'desc' },
          { views: 'desc' },
          { id: 'desc' },
        ],
        take: PER_RAIL,
        select: LISTING_CARD_SELECT,
      })
      return { slug, listings: listings.map(serializeListingCard) }
    }),
  )

  // ONE translation lookup for every rail's titles (was one query per rail).
  const present = rails.filter((r): r is NonNullable<typeof rails[number]> => !!r)
  const localizedFlat = await localizeListingTitles(present.flatMap((r) => r.listings))
  let cursor = 0
  for (const r of present) { r.listings = localizedFlat.slice(cursor, cursor + r.listings.length); cursor += r.listings.length }

  return NextResponse.json(
    { rails: present },
    { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=900' } },
  )
}
