import type { Prisma } from '@/generated/prisma/client'

/**
 * ⛔ THE HOME PAGE SHOWS ONLY LISTINGS DEALT ON eno (owner, 2026-10-28: "rearrange the home page of eno.vn so no product
 * with link shows there mostly the partner teachers etc the ones that dont take us out of the app").
 *
 * A listing with an `affiliateUrl` is completed on a partner's own site — VinWonders tickets, the eSIM carriers, linked
 * job boards, vehicle hire, imported retail — and its page swaps chat for an outbound button (schema.prisma
 * `Listing.affiliateUrl`; serialize.ts `isPartnerBooking`). Measured 2026-10-28 on the public feed: 337 of 3,785 listings,
 * and 20 of the home page's first 24 cards. Those rows keep their category, search and storefront; only the home page's
 * own surfaces drop them:
 *   · the default feed — (home)/page.tsx's server seed AND /api/listings' answer to the same request (feed-payload.ts,
 *     `goodsSeatsFor`), which must agree exactly or page 2 repeats a card and skips another;
 *   · the rails only the home route draws — Trending / For You (trending-rail.ts, /api/recommendations), Outstanding
 *     businesses (business-rail.ts) and Browse by category (/api/category-rails).
 * ⚠️ NOT "Recently viewed": that rail is the reader's own trail (Quy chế Article 14 promises it shows what they opened).
 * ⚠️ `''` COUNTS AS NO LINK, as `Boolean(affiliateUrl)` reads it — the predicate is the serializer's flag, not the column's
 * nullness, so a card the home page shows can never carry the "partner booking" CTA.
 * ⚖️ /legal/ranking (#home) and the Quy chế's Article 14 state this rule; change one, change the others.
 */
export const IN_APP_ONLY: Prisma.ListingWhereInput = { OR: [{ affiliateUrl: null }, { affiliateUrl: '' }] }

/**
 * `where` narrowed to listings dealt on eno. ⛔ ITS OWN AND ELEMENT, never spread beside the caller's keys: `IN_APP_ONLY`
 * is an `OR`, and a spread would overwrite a caller's own `OR` (edition-scope.ts teacherExclusion makes the same rule).
 */
export function inAppOnly(where: Prisma.ListingWhereInput): Prisma.ListingWhereInput {
  return { AND: [where, IN_APP_ONLY] }
}
