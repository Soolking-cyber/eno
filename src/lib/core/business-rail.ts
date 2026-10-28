import { marketplaceListingScope, teacherExclusion } from '@/lib/edition-scope'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { IN_APP_ONLY } from '@/lib/in-app-listing'
import type { Prisma } from '@/generated/prisma/client'

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
  const live: Prisma.ListingWhereInput = { AND: [{ verified: true, status: 'active' }, IN_APP_ONLY] }
  const sellers = await db.seller.findMany({
    where: {
      OR: [{ owner: { accountType: 'business' } }, { trustScore: { gte: 110 } }],
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
        include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
      }),
    ),
  )

  return rows.filter((l): l is NonNullable<typeof l> => !!l).map(serializeListing)
}
