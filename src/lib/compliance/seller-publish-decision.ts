import { canPublish, type VerificationStatus } from './account-state'
import { vneidLinkDeadlineFor } from './legal-basis'
import { identityBlockCodeFor, type IdentityBlockCode } from '@/lib/publish-guard'

// ── The seller identity decision, as PURE rules ─────────────────────────────────────────────────
//
// ONE question, asked by every path that can put a listing in front of the public: "may the human
// behind this storefront publish right now?" The database half (who is the owner, when did they
// sign up, what do their identity_verifications rows say) lives in seller-publish-gate.ts; the RULES
// live here, free of `server-only` and of the db, so a Node script (scripts/publish-held.ts) can
// apply exactly the decision the app applies instead of a hand-copied one.
//
// The order is the contract, and each step exists for a reason recorded beside it below.

export type SellerPublishDecision = { ok: true } | { ok: false; code: IdentityBlockCode }

export const PUBLISH_ALLOWED: SellerPublishDecision = Object.freeze({ ok: true }) as SellerPublishDecision

export type PreStatusInput = {
  /** identityGateEnforced() — marketplace edition AND IDENTITY_GATE_ENFORCED=1. */
  enforced: boolean
  /** The PROFILE that owns the storefront. null = an ownerless (guest or import) storefront. */
  ownerId: string | null
  /**
   * True ONLY for a GUEST — who is posting, not whether the row has an owner. The session web route
   * (api/listings) sets it for a SIGNED-OUT post; scripts/publish-held.ts, which has no session to
   * ask, sets it for an ownerless storefront carrying a phone (Seller.phone is the guest-claim key).
   * Every other caller leaves it false, API-key creates included: an ownerless shop behind a key is
   * a platform import, not a guest, and is allowed below on every path alike.
   */
  guestCreate?: boolean
  /** Profile.createdAt of the owner. null/undefined = unknown (profile row missing) → no grace. */
  accountCreatedAt?: Date | null
  now: Date
}

/**
 * Everything that can be decided WITHOUT reading identity_verifications. Returns a decision, or
 * null when the answer depends on the owner's verification status (the caller then asks
 * `decisionForStatus`). Split this way so the db wrapper reads that table only when it must.
 */
export function decideBeforeStatus(input: PreStatusInput): SellerPublishDecision | null {
  // ⛔ OFF MEANS OFF. The kill switch (account-state.ts) must make every path behave exactly as it
  // did before the gate existed — no reads, no refusals, no holds. Checked first so nothing below
  // can run while it is off.
  if (!input.enforced) return PUBLISH_ALLOWED

  if (!input.ownerId) {
    // ⚠️ A GUEST CANNOT BE IDENTITY-LINKED, so with the gate on a guest post is refused (owner,
    // 2026-09-23). The code is the guest's own, not `identity_unverified`: the wizard has to say
    // "sign in, then verify", because there is no account to send to the verify page.
    //
    // ⚠️ OWNERLESS BUT NOT A GUEST IS ALLOWED, AND THAT IS BY DESIGN, NOT A HOLE. Admin, cron,
    // script and API-key paths also touch storefronts with no owner: the affiliate/partner import
    // sellers (src/app/api/cron/partner-stock, src/lib/affiliate-price-refresh.ts) and the Rever
    // reference listings. There is no person behind them to verify — they are the platform's own catalogue
    // imports, published under its own responsibility — so refusing them would not make anyone
    // verify, it would just empty those shelves.
    return input.guestCreate ? { ok: false, code: 'identity_sign_in_required' } : PUBLISH_ALLOWED
  }

  // An owned storefront always needs its owner's STATUS — even inside the grace window (decideOwned).
  return null
}

/**
 * The decision for an OWNED storefront once its owner's status is known.
 *
 * ⛔ REVOKED AND EXPIRED ARE REFUSED EVEN INSIDE THE GRACE WINDOW. The grace is for accounts that
 * have not yet LINKED. `revoked` means an authority order or confirmed fraud, which no deadline
 * excuses; `expired` means a verification existed and its document lapsed — not an unlinked account,
 * and derive-verification.ts already holds that a lapsed passport is not a valid one (Decree 248/2026
 * Art 18.1(b)). Deciding grace before reading the status (the first version) let both publish until
 * 2027. `unverified`, `pending` and `rejected` keep the grace: nothing usable was ever linked.
 *
 * ⚠️ THE GRACE WINDOW IS DATE-AWARE, AND WHICH DATE DEPENDS ON THE ACCOUNT (Decree 320/2026 — see
 * legal-basis.ts). An account that existed before 2026-09-28 has until the end of 2026; one created on
 * or after it must be linked before selling at all. `<`, not `<=`: the deadline instant is the first
 * moment the duty binds.
 *
 * ⚠️ AN UNKNOWN CREATION DATE GETS NO GRACE. A missing Profile row behind a non-null ownerId is data
 * corruption; guessing "old account" would hand it the most lenient answer available.
 */
export function decideOwned(
  status: VerificationStatus | string,
  accountCreatedAt: Date | null | undefined,
  now: Date,
): SellerPublishDecision {
  if (status === 'revoked' || status === 'expired') return decisionForStatus(status)
  if (accountCreatedAt && now < vneidLinkDeadlineFor(accountCreatedAt)) return PUBLISH_ALLOWED
  return decisionForStatus(status)
}

/** The decision once the owner's verification status is known. canPublish() is the predicate. */
export function decisionForStatus(status: VerificationStatus | string): SellerPublishDecision {
  if (canPublish(status as VerificationStatus)) return PUBLISH_ALLOWED
  // identityBlockCodeFor fails CLOSED on an unrecognised status, and returns null only for a
  // status canPublish already accepted — so the `??` is unreachable, kept as a closed default.
  return { ok: false, code: identityBlockCodeFor(String(status)) ?? 'identity_unverified' }
}
