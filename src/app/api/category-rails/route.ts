import { scopedListingWhere } from '@/lib/edition-scope'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { route } from '@/lib/api/handler'
import { diversifyRail } from '@/lib/feed-diversity'
import { isRetiredNavCategory } from '@/lib/retired-categories'
import { categoryLeadRank } from '@/lib/category-lead'

export const runtime = 'nodejs'

// Home page "browse by category" rails — one horizontal feed per category, ordered by
// live DEMAND (views + weighted contacts) so the most-used category leads, mirroring
// the category-icon hierarchy. Listings within each rail are trust-first (same default
// ordering as the main feed). Public, lightly cached.
const PER_RAIL = 8 // listings per category rail (kept lean; rail scrolls for more)
const MAX_RAILS = 10 // cap the page length
const MIN_LISTINGS = 4 // skip near-empty rails (can't fill a desktop row)
/**
 * Rows each rail CHOOSES its PER_RAIL from (diversifyRail, feed-diversity.ts). Measured 2026-09-29:
 * the electronics rail was eight variants of one iPhone from one seller under one cover photo, and
 * sports, kids, vehicles and travel were each 8 of 8 from one seller — a plain `take: 8` by rankScore
 * cannot do better, because the variants ARE the top eight. From 40, the rail takes each seller's
 * best in turn, one card per (seller, model), never the same photo twice, and at most two per seller
 * once three or more sellers are in reach (a one-seller category keeps a full rail).
 * ⚠️ NEVER BELOW MIN_LISTINGS. The groupBy admitted the category on its COUNT; the rules above could
 * then leave one card (a pool that is one photo throughout), and the client hides a rail under
 * MIN_RAIL_ITEMS. `min` back-fills the repeats instead, so an admitted category keeps its rail.
 */
const RAIL_POOL = 40

// ⚠️ WS6 MIGRATION. `auth: 'public'` — the home page calls this logged-out; there was never an auth
// preamble and adding one would 401 every guest. No rate limit and no body were added either: this
// route had neither, and the wrapper must not invent policy.
//
// ⚠️ THE ONE ACCEPTED WIRE CHANGE IS ON THE FAILURE PATH, AND IT MATTERS MORE HERE THAN ELSEWHERE.
// Nothing in this handler was wrapped — the groupBy, the category read, N per-rail findMany calls
// inside Promise.all, and localizeListingTitles could each throw, and `scopedListingWhere()` throws
// DeskResolutionError by design. All of those used to surface as Next's default 500; they now
// answer `{"error":"internal_error"}` 500, logged with an `op`. Never the exception text.
//
// The success body returns as a NextResponse because the Cache-Control header is the point of the
// route; route()'s plain-object path would drop it.
export const GET = route({ auth: 'public' }, async () => {
  // Rank categories by demand over their live listings (like the brand rail), falling
  // back to listing count where there's no traffic yet.
  const grouped = await db.listing.groupBy({
    by: ['categoryId'],
    // ⚠️ RANK. Scoped together with the fill below, never alone: this groupBy applies a MIN_LISTINGS
    // floor and slices to MAX_RAILS, so scoping only the fill leaves a Services rail that ranked in
    // on the desk's demand and then renders with zero cards.
    where: await scopedListingWhere({ verified: true, status: 'active' }),
    _count: { _all: true },
    _sum: { views: true, contactCount: true },
  })
  const eligible = grouped.filter((g) => g._count._all >= MIN_LISTINGS)
  // The slugs BEFORE the cut: a retired shelf is dropped by slug, and dropping it after the slice would leave
  // the page one rail short instead of letting the next category in.
  const cats = await db.category.findMany({
    where: { id: { in: eligible.map((g) => g.categoryId) } },
    select: { id: true, slug: true },
  })
  const slugById = new Map(cats.map((c) => [c.id, c.slug]))
  const ranked = eligible
    /**
     * ⛔ NOT A RETIRED SHELF (second-hand focus, owner 2026-10-03 — src/lib/retired-categories.ts). Vehicles,
     * pets, books-stationery and hobbies-sports left every browse surface, and this one ranks on live rows
     * alone: on 2026-10-04 hobbies-sports (4 live) ranked 10th and the home page drew a "Hobbies & Sports"
     * shelf whose title and See-all opened the shelf the owner retired. Filtered BEFORE MAX_RAILS so the
     * next category takes its place. Its listings still reach the feed and search; only the shelf goes.
     */
    .filter((g) => !isRetiredNavCategory(slugById.get(g.categoryId)))
    .map((g) => ({
      categoryId: g.categoryId,
      count: g._count._all,
      demand: (g._sum.views ?? 0) + 5 * (g._sum.contactCount ?? 0),
      lead: categoryLeadRank(slugById.get(g.categoryId) ?? ''),
    }))
    /**
     * ⛔ THE OWNER'S LEAD ORDER FIRST, THEN DEMAND (owner, 2026-10-10: "put find a teacher to number 4
     * everywhere so rentals jobs services and then electronics" — src/lib/category-lead.ts). These shelves
     * were pure demand, so they led with electronics while every other list led with rentals.
     * ⚠️ THERE IS NO TEACHERS SHELF, so here electronics follows services. Teacher profiles are not in this
     * groupBy (scopedListingWhere keeps them out of listing shelves) and the live profiles are below
     * MIN_LISTINGS anyway; a "Find a teacher" shelf would be a new surface for the owner to ask for.
     * ⚠️ BEFORE THE CUT, so a lead category is never sliced off — which means past MAX_RAILS qualifying
     * categories a lead shelf takes the place of the tenth by demand. Nine qualified on 2026-10-10.
     */
    .sort((a, b) => a.lead - b.lead || b.demand - a.demand || b.count - a.count)
    .slice(0, MAX_RAILS)

  const rails = await Promise.all(
    ranked.map(async (r) => {
      const slug = slugById.get(r.categoryId)
      if (!slug) return null
      const listings = await db.listing.findMany({
        // ⚠️ FILL — the read that actually PRINTS the cards. The take applies after the
        // exclusion, so the rail refills from real marketplace supply rather than shrinking.
        where: await scopedListingWhere({ verified: true, status: 'active', categoryId: r.categoryId }),
        // Balanced rankScore blend, then most-viewed — matches the main feed's order.
        orderBy: [
          { rankScore: 'desc' },
          { views: 'desc' },
          { id: 'desc' },
        ],
        take: RAIL_POOL,
        select: LISTING_CARD_SELECT,
      })
      return { slug, listings: diversifyRail(listings.map(serializeListingCard), { take: PER_RAIL, min: MIN_LISTINGS }) }
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
})
