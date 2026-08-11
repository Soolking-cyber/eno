import 'server-only'
import { cache } from 'react'
import { db } from './db'
import { isBusinessVerified } from './business-verification'

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
