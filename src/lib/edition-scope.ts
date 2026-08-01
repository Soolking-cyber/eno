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
  /**
   * `action` names what is being refused, because this error is now thrown from two places whose
   * operators are different people with different fixes: a marketplace page read (a 500 on a rail)
   * and a write into the SHARED Vertex index (an ingest that must not run). Defaulted so every
   * existing call site keeps its exact wording.
   */
  constructor(detail: string, action = 'serve a marketplace listing query') {
    super(`[edition] refusing to ${action}: ${detail}. ` +
      'The visa/trip desk must be excluded here — eno.vn is a licensed sàn TMĐT and may not ' +
      'surface e-visa or itinerary services — and the desk could not be resolved. Check ' +
      'VISA_SHOP_OWNER_EMAIL and TRIP_DESK_OWNER_EMAIL in the deployed env, and that the desk ' +
      'Profile rows exist.')
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
  return { sellerId: { notIn: await requiredDeskSellerIds() } }
}

/**
 * `deskSellerIds()` or a throw — never an empty array, which is the shape of the leak.
 *
 * Shared by the marketplace scope above and the edition-INDEPENDENT ingest helpers below so the
 * refusal and its operator message cannot drift between them.
 */
async function requiredDeskSellerIds(action?: string): Promise<string[]> {
  const ids = await deskSellerIds()
  if (!ids.length) throw new DeskResolutionError('no desk seller could be resolved', action)
  return ids
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

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE SHARED-DESTINATION HALF: an exclusion that is EDITION-INDEPENDENT on purpose.
 *
 * Everything above this line is edition-CONDITIONAL and right to be. A page read answers the
 * reader in front of it, and on eno.forum that reader is allowed to see the desk — hence
 * `if (IS_SERVICES) return {}` as the first line of `marketplaceListingScope()`.
 *
 * ⚠️ THAT NO-OP BECOMES A LEAK THE MOMENT THE DESTINATION IS SHARED, AND IT DID. Both editions
 * write into ONE Vertex AI Search datastore (`eno-listings`), and the thing that READS that
 * datastore is eno.vn's AI concierge. So an ingest must not ask "may MY edition show the desk"
 * — it must ask "may the READER show it", and the reader is the licensed sàn TMĐT whichever
 * build is doing the writing. Measured 2026-08-01: a reconcile found 34 documents where 18
 * belonged, the extra 15 being the desk's (14 e-Visa SKUs + the trip anchor). They were put
 * there by an import whose guard WAS `scopedListingWhere` — a guard that, running on the
 * services edition, excluded precisely nothing while looking correct in the diff.
 *
 * ⚠️ AND NOTHING DOWNSTREAM CAN UNDO IT. `ListingDoc` in src/lib/vertex-search.ts carries
 * neither `sellerId` nor `subcategorySlug`, so `buildFilter()` is structurally incapable of
 * expressing this exclusion at query time — there is no Vertex-side filter to fall back on, and
 * no app-side fix reaches a document already in the index (that takes scripts/vertex-reconcile.mjs).
 * Ingest is the only place it can be done.
 *
 * So: `scopedListingWhere()` for anything that reads listings FOR A PAGE; the two helpers below
 * for anything that WRITES to the shared index. They are not interchangeable in either direction.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */

/** What the ingest helpers are refusing to do, for the operator reading the log at 3am. */
const INGEST_ACTION = 'write a listing into the shared Vertex AI Search index'

/**
 * Is this listing owned by the visa/trip desk? TRUE on BOTH editions for the same row.
 *
 * ⚠️ IT THROWS RATHER THAN ANSWERING `false` WHEN THE DESK CANNOT BE RESOLVED, for the same
 * reason `marketplaceListingScope()` does: "no desk exists" and "I could not find out" are the
 * same value and opposite decisions, and the second one silently answers "not the desk" for the
 * desk's own rows. A caller that must not throw (a background `after()` path) is expected to
 * catch this and fail CLOSED — treat the row as the desk's — not to let the error mean `false`.
 * src/lib/listing-index.ts does exactly that, and says so.
 *
 * Resolved by owner EMAIL via `deskSellerIds()`, never a hardcoded seller id: ids change on a
 * reseed and a stale one stops matching without ever failing.
 */
export async function isServicesDeskListing(listing: { sellerId?: string | null }): Promise<boolean> {
  const ids = await requiredDeskSellerIds(INGEST_ACTION)
  return !!listing?.sellerId && ids.includes(listing.sellerId)
}

/**
 * `scopedListingWhere()`'s edition-independent twin, for a bulk ingest into the shared index.
 *
 * AND-composed for the same reason — object spread overwrites on key collision, so a caller's own
 * `sellerId` would silently swallow the exclusion — and unconditional because the destination is
 * shared. There is deliberately no early return for the services edition: eno.forum sells these
 * listings and still may not put them in the index eno.vn searches.
 *
 * Throws when the desk cannot be resolved. On a foreground admin action that is a visible 500,
 * which is the outcome we want: an import that cannot prove which seller is the desk must not run
 * at all, because INCREMENTAL import is an upsert and nothing later removes what it wrote.
 */
export async function deskExcludedListingWhere<T extends object>(where: T): Promise<{ AND: [T, { sellerId: { notIn: string[] } }] }> {
  return { AND: [where, { sellerId: { notIn: await requiredDeskSellerIds(INGEST_ACTION) } }] }
}
