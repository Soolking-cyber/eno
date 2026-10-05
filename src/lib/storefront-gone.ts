import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'

/**
 * ⛔ AN OWNERLESS STOREFRONT WITH NOTHING A VISITOR CAN OPEN IS GONE (owner, 2026-10-02).
 *
 * Owner: *"remove all supersports products from website"*, then *"remove it too"* — the storefront.
 * All 5,955 SuperSports rows were set `hidden`, and `/sellers/cmu52jkld0000czq443snv0jh` still served
 * an empty shop: the name, the "Linked shop" chip, "More from other sellers" — a page for a shop that
 * eno no longer carries.
 *
 * THE RULE, AND IT IS DATA, NOT A LIST: a Seller with NO OWNER (`ownerId IS NULL` — an import
 * storefront, a desk, or a shop whose account was erased) that holds NO publicly visible listing is
 * treated as not existing. Its storefront 404s on both routes and both editions, and no other surface
 * names or links it. When it gets a public listing again it comes back by itself; nothing to undo.
 *
 * ⚠️ WHY NOT THE OWNER-EMAIL HIDE-LIST (`isSellerHiddenHere`, edition-scope.ts): it keys on the
 * Seller's OWNER email, and an import storefront has no owner — so it cannot reach one. And that list
 * is an EDITION rule (what eno.vn may legally show); this one is a fact about the shop, true on both.
 *
 * ⛔ AN OWNED SELLER IS NEVER GONE. A real person's shop with nothing in it is still that person's
 * page — their name, their reviews, their @handle — and it is the page "Post a listing" fills. Only a
 * storefront nobody stands behind disappears when its stock does.
 *
 * ⚠️ THE SELLER ROW IS KEPT. Listings, reviews and conversations reference it, and deleting it is
 * neither needed nor reversible. No column either: "gone" is derived on read, so it cannot drift from
 * the listings it describes.
 */

/**
 * The listing statuses a visitor can open — the PDP's own rule (`listingIsViewable`,
 * src/app/[lang]/listings/[id]/(pdp)/get-listing.ts), pinned to it by storefront-gone.test.ts.
 * `sold` IS public: it renders its own "this item has been sold" page (a 200), which links the shop —
 * so a shop with only sold rows is not gone, or that link would 404.
 * `stale`, `expired`, `hidden` and `removed` all 404 at the PDP, so they do not keep a shop alive. (A
 * hidden import-shop goods row renders the gone page instead — src/lib/gone-listing.ts — which names
 * no shop and links none, so it keeps nothing alive either.)
 */
export const PUBLIC_LISTING_STATUSES: readonly string[] = ['active', 'sold']

/** The same question of a row already in hand. */
export function isPublicListing(row: { verified: boolean; status: string } | null | undefined): boolean {
  return !!row && row.verified && PUBLIC_LISTING_STATUSES.includes(row.status)
}

/** A Listing `where` for "a row a visitor can open". Edition-blind on purpose — see `isStorefrontGone`. */
export function publicListingWhere(): Prisma.ListingWhereInput {
  return { verified: true, status: { in: [...PUBLIC_LISTING_STATUSES] } }
}

/**
 * The rule itself, pure, so the cases are pinned without a database: an ownerless shop that HAD listings
 * and has no public one left — an EMPTIED import catalogue (owner 2026-10-02: SuperSports). ⛔ A shop that
 * never had a listing is NOT gone: that is the support / rental desk every buyer's inbox links to, and the
 * native apps open its storefront from the thread header (opus, gate review 2026-10-02).
 */
export function storefrontIsGone(seller: { ownerId: string | null }, hasPublicListing: boolean, hasAnyListing = true): boolean {
  return !seller.ownerId && hasAnyListing && !hasPublicListing
}

/**
 * For a seller row already in hand: is its storefront gone?
 *
 * ⚠️ `knownPublic` IS A COUNT THE CALLER ALREADY RAN — the storefront's `_count.listings`, the seller
 * API's loaded rows, the thread's own listing. Any of those > 0 means a public listing exists, so the
 * answer costs NOTHING. An owned seller costs nothing either. Only an ownerless shop that showed no
 * live row pays the one query below, and that is exactly the rare case this rule is for.
 *
 * ⚠️ ONE INDEXED EXISTENCE CHECK, NOT A COUNT. Measured on the live database 2026-10-02 (EXPLAIN
 * ANALYZE, read-only): SuperSports (5,955 rows, all hidden) an Index Scan on
 * `Listing_verified_status_categoryId_sellerId_idx`, 518 buffers, 2–5ms warm (~11ms cold) — NOT
 * index-only: it selects `id`, which that index does not hold. Its row estimate (5,045) is stale since
 * the bulk hide. The support desk (0 rows) 0.08ms and Việc Làm 24h (12 hidden) 0.13ms on
 * `Listing_sellerId_saleConfirmedAt_idx`.
 *
 * ⚠️ EDITION-BLIND, DELIBERATELY. "Gone" is a fact about the shop, not about this edition: what an
 * edition may not show is `isSellerHiddenHere`'s job, and every caller runs that first. Scoping this
 * probe would make a shop's existence depend on which domain asked — and the teacher-category
 * exclusion inside `scopedListingWhere` would call a shop whose only public row is a teacher profile
 * gone, when that row's page is public.
 */
export async function isStorefrontGone(seller: { id: string; ownerId: string | null }, knownPublic = 0): Promise<boolean> {
  if (seller.ownerId || knownPublic > 0) return false
  // edition-lint-allow: an existence probe that returns a boolean about ONE seller; no row is listed,
  // serialized or published, and it is edition-blind on purpose (see above).
  const row = await db.listing.findFirst({ where: { sellerId: seller.id, ...publicListingWhere() }, select: { id: true } })
  if (row) return false
  // edition-lint-allow: same existence probe — does this ownerless shop have ANY listing (an emptied catalogue)?
  const any = await db.listing.findFirst({ where: { sellerId: seller.id }, select: { id: true } })
  return storefrontIsGone(seller, false, !!any)
}

/**
 * The same rule as a Seller `where` fragment, for a surface that LISTS storefronts (or links one per
 * row) rather than testing one: owned, or holding at least one public listing.
 * ⚠️ A FUNCTION, NOT A SHARED CONSTANT, so no caller can mutate the `in` array another caller reads.
 */
export function liveStorefrontWhere(): Prisma.SellerWhereInput {
  return { OR: [{ ownerId: { not: null } }, { listings: { some: publicListingWhere() } }, { listings: { none: {} } }] }
}
