import { marketplaceListingScope, scopedListingWhere, teacherExclusion } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { IN_APP_ONLY } from '@/lib/in-app-listing'
import type { Prisma } from '@/generated/prisma/client'
import { railListing } from './rail-listing'

/** What a rail card reads beside the row (serializeListing's input). */
const CARD_INCLUDE = { category: true, seller: { include: { owner: { select: { accountType: true } } } } } as const
/** A listing the rail may show: verified, active, dealt on eno — the `live` of both reads (its note is in topBusinessListings). */
const LIVE: Prisma.ListingWhereInput = { AND: [{ verified: true, status: 'active' }, IN_APP_ONLY] }
/** A storefront the rail may feature: a business account, or a storefront at Exceptional trust (110) and above. */
const FEATURED: Prisma.SellerWhereInput[] = [{ owner: { accountType: 'business' } }, { trustScore: { gte: 110 } }]

/** "Outstanding businesses" rail data — ONE flagship (most-viewed active) listing per
 *  highest-trust business storefront. Single source for GET /api/businesses/top AND the
 *  home page's SSR seed (perf Phase 1: server-known availability lets the rail render
 *  with its final geometry on first paint — the skeleton→empty collapse of the client
 *  fetch was the homepage's dominant CLS, 0.142 measured). Public-safe, no viewer data. */
export async function topBusinessListings() {
  /**
   * ⚠️ THE EXCLUSION GOES ON THE **SELLER** QUERY, NOT THE LISTING ONE BELOW, AND THE DIFFERENCE IS
   * VISIBLE. This picks 12 sellers and then fetches one flagship listing each. Filtering at the
   * listing level would leave the desk holding a slot and returning null, and the `.filter(Boolean)`
   * afterwards would silently shrink the rail to 11 cards. Excluding the seller lets a real business
   * take the slot instead — the rail stays full, which is the whole point of a fixed-geometry rail
   * that exists to prevent CLS.
   */
  /**
   * ⛔ AND NO TEACHER PROFILE IS EVER A FLAGSHIP (2026-10-13). This file reads the edition scope directly rather than
   * through scopedListingWhere, so the default teacher exclusion never applied here: a business account's teacher
   * profile — the owner's demo, on ENO COMPANY LIMITED, is one — could be its "Outstanding businesses" card, and once
   * the home page gained its "Find a teacher" shelf the same person could appear on the page twice. The exclusion goes
   * on BOTH reads, each as its own AND element (never spread beside another key — edition-scope.ts teacherExclusion):
   * on the seller pick, so a storefront whose only live listing is a teacher profile takes no slot (the reason the desk
   * exclusion sits there too, above), and on each flagship read, so a business with goods AND a teacher profile shows
   * its goods.
   */
  const [editionScope, noTeachers] = await Promise.all([marketplaceListingScope(), teacherExclusion()])
  /**
   * ⛔ ONLY LISTINGS DEALT ON eno — the rail is drawn on the home page alone (owner, 2026-10-28 — in-app-listing.ts). On
   * BOTH reads, like the teacher exclusion and for the same reason: on the seller pick, a business whose every live
   * listing is booked on its own site takes no slot; on each flagship read, a business with both shows an in-app one.
   * Its own AND element: IN_APP_ONLY is an OR.
   */
  const live = LIVE
  const sellers = await db.seller.findMany({
    where: {
      OR: FEATURED,
      listings: { some: noTeachers ? { AND: [live, noTeachers] } : live },
      ...(editionScope.sellerId ? { id: editionScope.sellerId } : {}),
    },
    orderBy: [{ trustScore: 'desc' }, { reviewCount: 'desc' }, { id: 'desc' }],
    take: 12,
    select: { id: true },
  })

  // One listing per business — the most-viewed active one (their flagship product/service).
  const rows = await Promise.all(
    sellers.map((s) =>
      db.listing.findFirst({
        where: { AND: [{ sellerId: s.id }, live, ...(noTeachers ? [noTeachers] : [])] },
        orderBy: [{ views: 'desc' }, { postedAt: 'desc' }, { id: 'desc' }],
        include: CARD_INCLUDE,
      }),
    ),
  )

  // Without the description: no rail card reads it (rail-listing.ts).
  return rows.filter((l): l is NonNullable<typeof l> => !!l).map((l) => railListing(serializeListing(l)))
}

/**
 * The rail's cards BY ID, for the home page's late draw (GET /api/home/cards): the page sends this rail as ids — none of its
 * cards is drawn at first paint (src/lib/home-lanes.ts slimHomeRails) — and the rail asks for them when it opens.
 * ⛔ THE RAIL'S OWN PREDICATE, PIECE FOR PIECE — NOT A BARE id LOOKUP: the route is public and takes any id, so an id answers
 * only while its listing is one topBusinessListings could pick: each flagship read's own LIVE, and the seller pick's FEATURED
 * on the card's seller (its `listings.some` is this card itself) — the same objects.
 * ⛔ AND THE WHOLE EDITION SCOPE, THROUGH scopedListingWhere (commit gate, 2026-11-17): its full output — every part of
 * marketplaceListingScope (today the desk / allow-list seller filter) and the teacher exclusion, each its own AND element at
 * the LISTING level — not a hand-picked part of it. A scope that grows a part later applies here without an edit. In the
 * marketplace edition the read is:
 *   { AND: [ { AND: [ { id: { in: ids } }, LIVE, { seller: { is: { OR: FEATURED } } } ] },
 *            { sellerId: { notIn: desk, in?: allowed } },   // marketplaceListingScope, whole
 *            { categoryId: { not: teachers } } ] }          // the teacher exclusion
 * What is NOT re-asked is RANK — still among the top 12 storefronts, still the most viewed of its own: that is the choice the
 * page made, which stands for its ISR window as every other rail's does. Anything else is simply missing from the answer.
 * The SAME card (railListing(serializeListing)), in the asked order.
 */
export async function businessRailCards(ids: readonly string[]) {
  if (!ids.length) return []
  const rows = await db.listing.findMany({
    where: await scopedListingWhere({ AND: [{ id: { in: [...ids] } }, LIVE, { seller: { is: { OR: FEATURED } } }] }),
    include: CARD_INCLUDE,
  })
  const byId = new Map(rows.map((r) => [r.id, r] as const))
  return ids.flatMap((id) => { const r = byId.get(id); return r ? [railListing(serializeListing(r))] : [] })
}
