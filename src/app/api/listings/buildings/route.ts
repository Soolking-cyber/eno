/**
 * Building pins for the map: one row per PROJECT, counted across the whole filtered result set.
 *
 * ⛔ THIS ENDPOINT EXISTS BECAUSE THE FEED IS PAGINATED AND THE MAP IS NOT. `/api/listings` returns
 * 24 rows; grouping those client-side would print "24 units" on a 157-unit tower and the number
 * would climb as the user scrolled. A count that changes while you look at it is worse than no
 * count. So the grouping happens in the database, over every matching row.
 *
 * ⛔ IT MUST SHARE `buildFeedFilters` WITH THE FEED, NOT RE-IMPLEMENT IT. The pin count and the
 * left-hand list are two queries answering one question; the moment they derive their `where`
 * separately they drift, and the drift shows up as a pin that says 40 opening a list of 12. Both
 * plan reviewers raised this independently, so the same builder is called here and its `andFilters`
 * are used verbatim.
 *
 * ⚠️ NAME, HERO AND CENTROID DO NOT COME FROM THIS QUERY. Prisma's `groupBy` can only return the
 * grouped column and aggregates, and those three belong to the building rather than to any unit —
 * they live in `src/generated/rever-buildings.ts`. Only the counts and the price range are live.
 *
 * ⚠️ A building the module does not know is DROPPED, not rendered nameless. `buildingKey` is written
 * by the importer and the module is regenerated from the same crawl, so a gap means they are out of
 * step — an unnamed pin on a marketplace map is worse than one fewer pin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { migrateLegacyCategoryParams } from '@/lib/taxonomy'
import { REVER_BUILDINGS } from '@/generated/rever-buildings'
import { buildFeedFilters } from '../feed-query'

export async function GET(req: NextRequest) {
  const searchParams = migrateLegacyCategoryParams(req.nextUrl.searchParams)
  try {
    const { andFilters } = await buildFeedFilters(searchParams)

    const rows = await db.listing.groupBy({
      by: ['buildingKey'],
      where: await scopedListingWhere({
        AND: andFilters,
        // `not: null` is the whole opt-in: an ordinary listing has no buildingKey and keeps its
        // own pin, so this can never turn unrelated listings into a "building".
        buildingKey: { not: null },
      }),
      _count: { _all: true },
      _min: { price: true },
      _max: { price: true },
    })

    const buildings = rows
      .map((r) => {
        const meta = r.buildingKey ? REVER_BUILDINGS[r.buildingKey] : undefined
        if (!meta) return null
        return {
          key: meta.slug,
          name: meta.name,
          hero: meta.hero,
          lat: meta.lat,
          lng: meta.lng,
          district: meta.district,
          count: r._count._all,
          minPrice: r._min.price,
          maxPrice: r._max.price,
        }
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
      // Biggest first: the map draws later pins over earlier ones, and on a tie of position the
      // tower with more inventory is the one worth keeping legible.
      .sort((a, b) => b.count - a.count)

    return NextResponse.json(
      { buildings, total: buildings.reduce((n, b) => n + b.count, 0) },
      {
        // Same shape as the feed's own caching: short max-age, longer s-maxage, SWR so the edge
        // answers instantly while refreshing. Counts move slowly; a minute of staleness is fine.
        headers: { 'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300' },
      },
    )
  } catch {
    // ⚠️ The map must degrade to ordinary pins, never to a broken view — an empty list is a valid
    // answer meaning "no building groups here".
    return NextResponse.json({ buildings: [], total: 0 }, { status: 200 })
  }
}
