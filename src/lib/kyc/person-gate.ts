import { IS_MARKETPLACE } from '@/lib/edition'
import { readVerifiedIdentity } from './identity'

/**
 * STAGE 1 BEFORE STAGE 2 — "a person verifies themselves, then they may verify their business".
 *
 * Owner, 2026-08-31: "person verifies himself then can verify business so 2 verification process to
 * open fully compliant business storefront."
 *
 * ⛔ ITS OWN FLAG, NOT `IDENTITY_GATE_ENFORCED`. That switch gates PUBLISHING — turning it on
 * refuses every seller whose `verificationStatus` says `unverified`, which is all of them. Hanging
 * the business-sequencing rule off the same var would mean the only way to require identity before
 * a business storefront is to simultaneously stop every listing on the marketplace. codex named
 * this in the plan review; two rules with different blast radii need two switches.
 *
 * ⚠️ AND IT DEFAULTS TO OFF, for the reason `identityGateEnforced` gives at length: wiring a
 * compliance gate and switching it on are different decisions. Flipping it is a config change, and
 * flipping it BACK is instant if review capacity collapses on a Monday morning.
 *
 * ⛔ MARKETPLACE ONLY, MATCHING `IDENTITY_VERIFICATION_REQUIRED`. The seller-authentication mandate
 * binds the licensed Vietnamese platform; eno.forum is deliberately outside it. Applying the
 * sequencing unconditionally inside `submitVerification` would impose a marketplace policy on forum
 * sellers — both plan reviewers raised the edition question, and this is the answer to it.
 */
export function personBeforeBusinessEnforced(): boolean {
  return IS_MARKETPLACE && process.env.PERSON_BEFORE_BUSINESS === '1'
}

/**
 * Has the human behind this storefront completed stage 1?
 *
 * ⛔ DERIVED FROM THE VERIFICATION ROWS, NOT READ OFF `Profile.verificationStatus`. That column is a
 * CACHE written by `recomputeVerification`, and nothing sweeps it on a schedule — so a lapsed
 * document still reads `verified` there until something happens to recompute it. `readVerifiedIdentity`
 * applies `deriveVerification`, where `revoked` outranks everything and expiry is evaluated against
 * today. A gate that trusts a stale cache is not a gate.
 *
 * ⚠️ A NULL OWNER IS NOT VERIFIED. A guest Seller row has no `ownerId` and therefore no person
 * behind it at all — `listings.ts` records the same fact ("A GUEST SELLER HAS NO ownerId AND
 * THEREFORE NO IDENTITY"). Returning true for the absence of a person would make the gate a no-op
 * on exactly the rows least accounted for.
 */
export async function ownerPersonVerified(ownerId: string | null | undefined): Promise<boolean> {
  if (!ownerId) return false
  const identity = await readVerifiedIdentity(ownerId)
  return identity !== null
}

/**
 * ⚠️ THERE IS DELIBERATELY NO `sellerOwnerPersonVerified(sellerId)` HELPER. One was written and
 * removed: it did its own `db.seller.findUnique`, which edition-lint Rule A refuses — an unscoped
 * seller read is how the e-visa desk's rows leak into eno.vn — and it would have been a SECOND
 * read of a row both call sites already hold. Two reads of the same row are two chances for them to
 * disagree. Both callers pass `seller.ownerId` from the select they already made.
 */

/**
 * ⚠️ WHAT THIS GATE DELIBERATELY DOES NOT DO — READ BEFORE "FIXING" IT.
 *
 * It does NOT stop someone declaring themselves a business. `POST /api/profile/account-type`
 * still creates a Seller row and mints a public handle on first onboarding with only a business
 * name and a phone, and that leniency is deliberate policy at launch, not an oversight — the
 * route's own comment records the decision, and the gate there fires only on the explicit
 * individual→business UPGRADE.
 *
 * The line drawn here is between HAVING a business storefront and having a VERIFIED one. Stage 2
 * — the tax-registry check, the licence and bank documents, the badge, the waived probation cap
 * — is what now requires stage 1. codex read the ungated onboarding as defeating the ordering;
 * that is true of "may call yourself a business" and false of "may be certified as one", and the
 * second is what the two-stage flow is for.
 *
 * ⛔ IF THAT CHANGES, IT IS A PRODUCT DECISION AND NOT THIS FILE'S TO MAKE. Requiring identity
 * before a storefront can exist would stop every new business signup dead until review capacity
 * exists to clear them, which is the failure `identityGateEnforced`'s own comment spends a
 * paragraph warning about.
 */

/**
 * ⛔ TWO KNOWN GAPS, LEFT OPEN DELIBERATELY AND RECORDED SO THE NEXT READER DOES NOT THINK THEY WERE
 * MISSED. Both were found by the diff reviewers.
 *
 * 1. THE BADGE DOES NOT COLLAPSE WHEN THE PERSON LAPSES. The gate is checked at submit and again at
 *    approval, but once `Seller.verifiedAt` is stamped nothing re-asks. If the owner's passport
 *    expires or their verification is revoked the day after approval, the business badge stays lit.
 *    The fix is a FIFTH condition on `isBusinessVerified()` — it is a live predicate, so adding one
 *    makes the badge drop the moment the person's does. That is almost certainly right, and it is
 *    NOT free: nothing sweeps `recomputeVerification` on a schedule today, so the cascade would
 *    fire only when something else happened to recompute, and it would fire silently with no
 *    notification path. Ship the cron and the notice with it, or the failure mode is a seller whose
 *    badge vanishes with no explanation.
 *
 * 2. TIME-OF-CHECK vs TIME-OF-USE INSIDE `approveVerification`. The person check and the Seller
 *    stamp are not in one transaction, so an identity revoked in the milliseconds between them is
 *    not caught. The window is small and the same shape as the tax-verdict check beside it, which
 *    has always had it; closing it properly means folding the read into the approval transaction,
 *    and it is worth doing at the same time as (1) rather than alone.
 */
