import 'server-only'
import { cache } from 'react'
import { db } from './db'
import { isBusinessVerified } from './business-verification'
import { IS_SERVICES } from './edition'
import { deskSellerIds } from './edition-scope'

/**
 * Is this seller a KNOWN, registry-backed business rather than an anonymous account?
 *
 * One predicate, deliberately shared by every gate that exists to police anonymous spam and
 * therefore should not be policing a real company's catalogue. Today that is two gates:
 *   · the probation listing cap (`enforcement.ts`, owner 2026-08-11: "remove this guard from
 *     official partners and registered businesses"), and
 *   · the duplicate-listing guard (`duplicate-guard.ts`), which relaxes rather than waives.
 *
 * It lives in its own module, not in `enforcement.ts`, so importing it costs a `db` handle and
 * nothing else — `enforcement.ts` pulls in push notifications, `next/server`'s `after()` and
 * `revalidatePath`, none of which a duplicate check has any business loading.
 *
 * ⚠️ TWO CLAUSES, AND ONLY ONE OF THEM IS SELF-DECLARED-PROOF. `officialPartner` is a flag eno
 * sets by hand on a commercial partner. `isBusinessVerified` requires a tax-registry match the
 * seller does not control. Neither can be claimed by a spammer filling in a form, which is the
 * whole reason the exemption is safe to grant. Do NOT widen this to `owner.accountType ===
 * 'business'` — that IS self-declared, and it would retire both gates in practice.
 */
/**
 * ⚠️ REQUEST-MEMOIZED WITH `cache()`, AND IT IS NOT AN OPTIMISATION FOR ITS OWN SAKE. The two
 * gates both ask this on the SAME seller within one request, and the bulk importer asks it once
 * per row: `bulkImportCore` loops up to BULK_MAX_ROWS = 200 rows sequentially and calls
 * `findDuplicateListing` inside the loop, so an uncached version issues 200 identical
 * ten-column seller lookups for an answer `bulkPostingBudget` already computed before the loop
 * started. `cache()` collapses all of them to one for the life of the request, which is the same
 * mechanism `edition-scope.ts` uses on `deskSellerIds` for the same reason.
 * It is per-request, NOT a shared TTL cache: revoking `officialPartner` or a tax registration
 * takes effect on the very next request, which is the only correctness property that matters for
 * a predicate that waives a spam gate.
 */
export const isVerifiedCatalogueSeller = cache(async (sellerId: string): Promise<boolean> => {
  // ⛔ THE DESK EXCLUSION IS REAL, NOT A LINT APPEASEMENT — AND IT REPLACED AN `edition-lint` ALLOW
  // ENTRY THAT THREE REVIEWERS REJECTED. The first attempt at this file was exempted from Rule A
  // with a prose reason ("the caller already holds the sellerId"). The objection was correct and
  // worth recording: an ALLOW key is a FILE PATH and is permanent, so the day someone adds a
  // `getCatalogueSeller()` here that returns a name or a slug, every premise of that reason is
  // false, the gate stays green, and a services-desk seller can render on the licensed
  // marketplace. A promise about today's code cannot guard tomorrow's.
  //
  // Excluding the desk outright is the version that needs no promise. On the marketplace build
  // this function simply cannot answer a question about a desk seller — including the boolean
  // itself, which reviewers rightly called an existence oracle. On the services build the desk IS
  // the storefront doing the posting, so the scope is not applied there, exactly as
  // `marketplaceListingScope` behaves for listings.
  //
  // ⚠️ A THROW FAILS CLOSED; AN EMPTY LIST DOES NOT — AND THE DIFFERENCE IS NOT COSMETIC.
  // The first version treated both the same and a reviewer caught that it was a marketplace-wide
  // kill switch. `deskSellerIds()` (edition-scope.ts) does NOT throw on "no desk found" — it
  // returns `[]`, because the query succeeded and matched nothing. Failing closed on that would
  // strip the exemption from EVERY partner the moment a desk row is renamed or an owner email is
  // misconfigured, and they would meet the probation cap and the duplicate guard with a
  // spam-shaped error nobody could trace. An empty list means there is no desk to exclude, so the
  // correct action is to carry on: nothing about this function can surface desk CONTENT, which is
  // what Rule A protects — the worst case is that a desk seller keeps a spam-gate exemption it
  // would have had anyway before this exclusion existed.
  // A genuine THROW is different (connection reset, pool exhausted): the answer is unknown, so
  // it fails closed. Both callers are publish-path gates and one has no try/catch, so returning
  // false rather than rethrowing is also what keeps a database blip from 500-ing a real post.
  // ⚠️ AND BOTH PATHS LOG. A spam exemption failing shut is exactly the thing that must not be
  // silent: without this, a persistent desk-resolution failure looks to the seller like a
  // duplicate-listing rejection and looks to the server like nothing at all.
  if (!IS_SERVICES) {
    let deskIds: string[] = []
    try {
      deskIds = await deskSellerIds()
    } catch (e) {
      console.error('[catalogue-seller] desk resolution failed — withholding the exemption', e)
      return false
    }
    if (!deskIds.length) {
      console.warn('[catalogue-seller] no desk seller resolved — nothing to exclude; check VISA_SHOP_OWNER_EMAIL / TRIP_DESK_OWNER_EMAILS')
    } else if (deskIds.includes(sellerId)) {
      return false
    }
  }
  const seller = await db.seller.findUnique({
    where: { id: sellerId },
    select: {
      officialPartner: true,
      // Everything isBusinessVerified reads — see VerificationFacts.
      name: true, legalName: true, legalAddress: true, idNumber: true, taxCode: true,
      taxCheckedAt: true, taxRegisteredName: true, taxActive: true,
      verifiedIdentityHash: true, verifiedUntil: true,
    },
  })
  if (!seller) return false
  return seller.officialPartner || isBusinessVerified(seller)
})
