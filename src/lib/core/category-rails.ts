import { scopedListingWhere } from '@/lib/edition-scope'
import { inAppOnly } from '@/lib/in-app-listing'
import { db } from '@/lib/db'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { crowdingSellers, diversifyRail } from '@/lib/feed-diversity'
import type { Prisma } from '@/generated/prisma/client'
import { isRetiredNavCategory } from '@/lib/retired-categories'
import { categoryLeadRank } from '@/lib/category-lead'
import type { SerializedListingCard } from '@/lib/types'

/**
 * THE HOME PAGE'S PER-CATEGORY SHELVES — one rail per category, ordered by the owner's lead order then live DEMAND (views
 * + weighted contacts), each rail trust-first (the main feed's own order). Moved here from /api/category-rails (owner-
 * approved 2026-11-14, cook r04 home-b: "lanes as rails"): on a phone the lanes now sit ABOVE the feed, so they must be in
 * the server's HTML — a client fetch there would land under a reader already looking at the page and push the feed down.
 * (home)/page.tsx reads it into the ISR document beside Trending and Outstanding businesses; the route is a thin wrapper
 * over the same function, so the two can never answer differently.
 */
export type CategoryRailRow = { slug: string; listings: SerializedListingCard[] }

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
/** Balanced rankScore blend, then most-viewed — matches the main feed's order. ONE order for the fill and its top-up read. */
const RAIL_ORDER = [{ rankScore: 'desc' }, { views: 'desc' }, { id: 'desc' }] satisfies Prisma.ListingOrderByWithRelationInput[]

/**
 * The rails, with their card titles localized for `onlyTitleLang` (a site language code; undefined = every language, as
 * localizeListingTitles reads it).
 * ⚠️ IT THROWS, and both callers decide what a failure means: the route answers 500 (route()'s wrapper), the home page
 * logs it and renders no category rails (`.catch` in (home)/page.tsx). `scopedListingWhere` throws DeskResolutionError by
 * design; the home page's own `publicScope` read rethrows that one first.
 */
export async function homeCategoryRails(onlyTitleLang?: string): Promise<CategoryRailRow[]> {
  // Rank categories by demand over their live listings (like the brand rail), falling
  // back to listing count where there's no traffic yet.
  const grouped = await db.listing.groupBy({
    by: ['categoryId'],
    // ⚠️ RANK. Scoped together with the fill below, never alone: this groupBy applies a MIN_LISTINGS
    // floor and slices to MAX_RAILS, so scoping only the fill leaves a Services rail that ranked in
    // on the desk's demand and then renders with zero cards.
    // ⛔ ONLY LISTINGS DEALT ON eno, here and in the fill, for the same reason (owner, 2026-10-28 — in-app-listing.ts):
    // these shelves are drawn on the home page alone, and a category whose rows are booked on partner sites must not
    // rank in on them and then print them.
    where: inAppOnly(await scopedListingWhere({ verified: true, status: 'active' })),
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
     * ⚠️ THERE IS NO TEACHERS SHELF HERE, so here electronics follows services. Teacher profiles are not in this
     * groupBy (scopedListingWhere keeps them out of listing shelves), and Browse by category stays teacher-free:
     * they have their own "Find a teacher" shelf on the home page, after the feed's first page (owner, 2026-10-13 —
     * src/components/marketplace/teacher-shelf.tsx, seeded by src/lib/core/teacher-shelf.ts).
     * ⚠️ BEFORE THE CUT, so a lead category is never sliced off — which means past MAX_RAILS qualifying
     * categories a lead shelf takes the place of the tenth by demand. Nine qualified on 2026-10-10.
     */
    .sort((a, b) => a.lead - b.lead || b.demand - a.demand || b.count - a.count)
    .slice(0, MAX_RAILS)

  const rails = await Promise.all(
    ranked.map(async (r) => {
      const slug = slugById.get(r.categoryId)
      if (!slug) return null
      const where = inAppOnly(await scopedListingWhere({ verified: true, status: 'active', categoryId: r.categoryId }))
      const listings = await db.listing.findMany({
        // ⚠️ FILL — the read that actually PRINTS the cards. The take applies after the
        // exclusion, so the rail refills from real marketplace supply rather than shrinking.
        where,
        orderBy: RAIL_ORDER,
        take: RAIL_POOL,
        select: LISTING_CARD_SELECT,
      })
      const cards = listings.map(serializeListingCard)
      // ⛔ ONE SELLER MAY NOT BE THE WHOLE POOL (2026-11-18, crowdingSellers in feed-diversity.ts): a full pool that cannot fill
      // the rail two to a seat reads the next RAIL_POOL rows without the crowding sellers, in the same order.
      const crowding = listings.length === RAIL_POOL ? crowdingSellers(cards, { take: PER_RAIL }) : []
      if (crowding.length) {
        const have = new Set(listings.map((l) => l.id))
        const more = await db.listing.findMany({
          where: { AND: [where, { sellerId: { notIn: crowding } }] },
          orderBy: RAIL_ORDER,
          take: RAIL_POOL,
          select: LISTING_CARD_SELECT,
        })
        cards.push(...more.filter((l) => !have.has(l.id)).map(serializeListingCard))
      }
      return { slug, listings: diversifyRail(cards, { take: PER_RAIL, min: MIN_LISTINGS, fillCapped: crowding.length > 0 }) }
    }),
  )

  // ONE translation lookup for every rail's titles (was one query per rail).
  // ⛔ THE READER'S LANGUAGE IS THE CALLER'S, NEVER THE COOKIE: the route reads it from its URL (its answer is
  // `public, s-maxage`, so a cookie-read variant would poison the shared entry — audit P2), and the home page passes the
  // ISR entry's own (`vi` → no titleI18n at all, like the feed seed; `en` → every MT language, swapped on the client).
  const present = rails.filter((r): r is NonNullable<typeof rails[number]> => !!r)
  const localizedFlat = await localizeListingTitles(present.flatMap((r) => r.listings), onlyTitleLang)
  let cursor = 0
  for (const r of present) { r.listings = localizedFlat.slice(cursor, cursor + r.listings.length); cursor += r.listings.length }
  return present
}
