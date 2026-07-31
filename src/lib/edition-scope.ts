import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { IS_SERVICES } from '@/lib/edition'
import { VISA_SHOP_OWNER_EMAILS } from '@/lib/visa-shop'
import { TRIP_DESK_OWNER_EMAILS } from '@/lib/trips/dm-thread'

/**
 * The server half of the edition split: the `where` fragment that keeps the visa/trip desk's
 * listings off the licensed marketplace.
 *
 * ⚠️ SEPARATE FROM `edition.ts` ON PURPOSE. That file must stay import-free so client components can
 * read the flag and have their branches minified away; this one pulls in two `server-only` modules
 * and could never be imported from the browser. Same feature, two files, because they have different
 * runtime homes. Do not merge them back.
 *
 * ⚠️ NOT IN `src/lib/core/listings.ts`, which is the obvious home and fails CI:
 * `src/lib/core/listings.currency.test.ts` asserts that file contains neither `getVisaShopSeller`
 * nor `visa-shop` as whole-file substrings.
 */

/**
 * Thrown when the marketplace edition cannot prove which sellers to exclude.
 *
 * Its own type so a caller can recognise it, and so the message is one an operator can act on at
 * three in the morning without reading this file.
 */
export class DeskResolutionError extends Error {
  constructor(detail: string) {
    super(`[edition] refusing to serve a marketplace listing query: ${detail}. ` +
      'eno.vn must exclude the visa/trip desk from every listing read, and the desk could not be ' +
      'resolved. Check VISA_SHOP_OWNER_EMAIL and TRIP_DESK_OWNER_EMAIL in the deployed env, and ' +
      'that the desk Profile rows exist.')
    this.name = 'DeskResolutionError'
  }
}

/**
 * The seller ids whose listings are services-edition-only.
 *
 * ⚠️ IT DOES ITS OWN QUERY INSTEAD OF CALLING `getVisaShopSeller()` AND `getTripDesk()`, AND THAT IS
 * THE FIX FOR A LEAK AN ADVERSARIAL REVIEW FOUND IN THE FIRST DRAFT. Those two helpers are
 * deliberately FAIL-SOFT: each wraps its lookup in try/catch and returns `null` on a database error,
 * so the visa feature degrades to "unavailable" rather than throwing at its own callers. Composing
 * them here made `null` ambiguous — it means either "this desk is not set up" or "the lookup just
 * failed", and those need opposite handling. The first draft treated any resolved desk as good
 * enough, so a transient error on ONE lookup returned `{ sellerId: { notIn: [visaDesk] } }`: a
 * perfectly valid predicate that silently failed to exclude the TRIP desk's listings. No exception,
 * no failing test — the exact silent-leak shape this whole module exists to prevent. Worse, the
 * first version of the test suite asserted that behaviour was correct.
 *
 * One query over the union of both address lists removes the ambiguity: it either succeeds, and we
 * know exactly which desks exist, or it throws and the caller fails closed. There is no third state.
 *
 * ⚠️ NO try/catch HERE, ON PURPOSE. A database error must propagate.
 *
 * ⚠️ THE VISA DESK AND THE TRIP DESK ARE USUALLY THE SAME ROW. `Seller.ownerId` is `@unique`, so one
 * support account owns exactly one storefront and both features hang off it, distinguished only by
 * an anchor listing. So a ONE-row result is normal and correct, not a partial failure — which is
 * exactly why "require two rows" would be the wrong rule and would take the marketplace down.
 */
export const deskSellerIds = cache(async (): Promise<string[]> => {
  const emails = [...new Set([...VISA_SHOP_OWNER_EMAILS, ...TRIP_DESK_OWNER_EMAILS])]
  const sellers = await db.seller.findMany({
    where: { owner: { email: { in: emails } } },
    select: { id: true },
  })
  return [...new Set(sellers.map((s) => s.id))]
})

/**
 * The raw exclusion fragment.
 *
 * ⚠️ PREFER `scopedListingWhere()` BELOW. This is exported for the rare caller that composes its own
 * `AND` array, and for the tests. Spreading it beside another top-level `sellerId` is a silent leak —
 * see the note on `scopedListingWhere`.
 *
 * ⚠️ IT THROWS ON THE MARKETPLACE EDITION WHEN THE DESK CANNOT BE RESOLVED, AND THAT IS THE MOST
 * IMPORTANT LINE IN THIS FILE. Both resolvers are deliberately FAIL-SOFT for their own callers —
 * `getVisaShopSeller` and `getTripDesk` each swallow database errors and return null so the visa
 * feature degrades to "unavailable" instead of throwing. Inherited here, that softness inverts into
 * a legal breach: null desks would produce `{ sellerId: { notIn: [] } }`, a predicate that excludes
 * NOTHING, and the fourteen e-Visa SKUs would quietly rejoin the licensed marketplace's browse feed,
 * search, rails, sitemap and Google/Meta product feeds.
 *
 * This is not hypothetical. `src/lib/visa-shop.ts` records that on 2026-07-22 `VISA_SHOP_OWNER_EMAIL`
 * was set in neither the local env nor the deployed secret, so it fell back to a default address
 * with no Profile row — and it was still unset when this module was written. The exact condition
 * that once disabled the visa surface would, after the split, publish it on the wrong domain.
 *
 * So: a visible 500 on a rail is recoverable in ten minutes. A silently unfiltered feed is a
 * licensing breach nobody notices. Fail loud.
 */
export async function marketplaceListingScope(): Promise<{ sellerId?: { notIn: string[] } }> {
  if (IS_SERVICES) return {}
  const ids = await deskSellerIds()
  if (!ids.length) throw new DeskResolutionError('no desk seller could be resolved')
  return { sellerId: { notIn: ids } }
}

/**
 * Wrap a listing `where` so the desk exclusion cannot be lost. THIS IS THE ONE CALLERS SHOULD USE:
 *
 *   where: await scopedListingWhere({ status: 'active', sellerId: someSeller })
 *
 * ⚠️ IT EXISTS BECAUSE THE SPREADABLE FRAGMENT WAS A TRAP, AND BOTH INDEPENDENT REVIEWERS WALKED
 * INTO IT. Object spread overwrites on key collision, so the obvious usage silently loses:
 *
 *   { ...(await marketplaceListingScope()), sellerId: someSeller }  // caller wins → LEAK
 *   { sellerId: someSeller, ...(await marketplaceListingScope()) }  // scope wins → wrong results
 *
 * The first is the dangerous one: a storefront or seller-filtered query drops the exclusion entirely,
 * with no error, no failing test, and no lint hit — the file mentions `marketplaceListingScope`, so
 * it looks guarded. Order-dependent correctness in the one predicate that carries a legal boundary is
 * not a trade-off worth taking.
 *
 * Composing through `AND` makes collision impossible: the caller's `sellerId` and the exclusion are
 * separate operands and BOTH apply, which is the semantics anyone reading the call site expects.
 * On the services edition this returns the caller's `where` untouched and adds no `AND` wrapper, so
 * eno.forum pays nothing — not even an extra array.
 */
export async function scopedListingWhere<T extends object>(where: T): Promise<T | { AND: [T, { sellerId: { notIn: string[] } }] }> {
  const scope = await marketplaceListingScope()
  if (!scope.sellerId) return where
  return { AND: [where, { sellerId: scope.sellerId }] }
}
