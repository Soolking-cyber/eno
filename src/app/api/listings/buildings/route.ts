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
import { mapGlyphFor, type MapGlyph } from '@/lib/listing-map-glyph'
import { resolveFeedFilters } from '../feed-query'

export async function GET(req: NextRequest) {
  const searchParams = migrateLegacyCategoryParams(req.nextUrl.searchParams)
  try {
    // Resolved like the feed (resolveFeedFilters): a district reading the feed dropped for finding
    // nothing is dropped here too, or the pins would count a scope the list is not showing.
    const { andFilters } = await resolveFeedFilters(searchParams)

    /**
     * ⚠️ GROUPED BY (buildingKey, subcategorySlug) RATHER THAN buildingKey ALONE, so a pin can draw
     * the KIND of place it stands for and not just a count. The second column costs nothing here —
     * it is the same index-backed scan — and it is the only way to get a glyph without a second
     * round trip or a guess. A project is overwhelmingly one kind, so the DOMINANT slug is the
     * honest answer; the per-key totals below are re-aggregated because the split is an
     * implementation detail the map must never see.
     */
    const rows = await db.listing.groupBy({
      by: ['buildingKey', 'subcategorySlug'],
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

    /**
     * ⛔ RE-AGGREGATE, DO NOT RENDER THE SPLIT ROWS. Grouping on two columns means one project with
     * both `apartment-rental` and `office-rental` units comes back as TWO rows. Mapping those
     * straight through would draw two pins on one coordinate, each with a partial count — exactly
     * the "a pin that says 40 opening a list of 12" drift this endpoint exists to prevent.
     */
    type Agg = { count: number; min: number | null; max: number | null; byGlyph: Map<MapGlyph, number> }
    const merged = new Map<string, Agg>()
    for (const r of rows) {
      if (!r.buildingKey) continue
      const a = merged.get(r.buildingKey) ?? { count: 0, min: null, max: null, byGlyph: new Map() }
      a.count += r._count._all
      if (r._min.price !== null) a.min = a.min === null ? r._min.price : Math.min(a.min, r._min.price)
      if (r._max.price !== null) a.max = a.max === null ? r._max.price : Math.max(a.max, r._max.price)
      const g = mapGlyphFor(r.subcategorySlug)
      a.byGlyph.set(g, (a.byGlyph.get(g) ?? 0) + r._count._all)
      merged.set(r.buildingKey, a)
    }

    /**
     * The most common kind among a project's units. Ties break toward the more specific mark by
     * simply keeping the first maximum seen in count order — and `other` is only ever the answer
     * when nothing else was classified, which is the ~446 rows the importer left without a slug.
     */
    const dominant = (byGlyph: Map<MapGlyph, number>): MapGlyph => {
      /**
       * ⛔ SORTED, BECAUSE MAP ORDER HERE IS POSTGRES SCAN ORDER (reviewer). A `Map` iterates in
       * INSERTION order, and these were inserted while walking a `groupBy` that carries no
       * `orderBy` — so a mixed-use project split evenly between apartments and offices drew a tower
       * on one request and a briefcase on the next, and the two answers cached separately at the
       * edge. Ties now break on the glyph name, which is arbitrary but STABLE: the same building
       * gets the same mark on every request.
       */
      /**
       * ⚠️ `'other'` COMPETES ON COUNT AND ONLY LOSES A TIE (reviewer). Filtering it out first made
       * classification beat quantity by any margin: a project with 400 unclassified units and ONE
       * office-rental drew a briefcase next to the count 401, which is not "the dominant kind", it
       * is the dominant kind among the rows that happened to have a slug. The importer left ~446
       * rows without one, so that is a live shape, not a hypothetical. Ranking is count first, then
       * classified-beats-unclassified on a tie, then the glyph name so the answer is stable across
       * requests and their separate edge-cache entries.
       */
      const ranked = [...byGlyph.entries()].sort((a, b) =>
        b[1] - a[1] ||
        Number(a[0] === 'other') - Number(b[0] === 'other') ||
        a[0].localeCompare(b[0]),
      )
      return ranked[0]?.[0] ?? 'other'
    }

    const buildings = [...merged.entries()]
      .map(([key, a]) => {
        const meta = REVER_BUILDINGS[key]
        if (!meta) return null
        return {
          key: meta.slug,
          name: meta.name,
          hero: meta.hero,
          lat: meta.lat,
          lng: meta.lng,
          district: meta.district,
          count: a.count,
          minPrice: a.min,
          maxPrice: a.max,
          glyph: dominant(a.byGlyph),
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
