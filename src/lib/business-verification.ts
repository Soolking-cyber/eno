import 'server-only'
import { createHash } from 'node:crypto'
import { fold } from '@/lib/fold'
import { taxVerdict, type TaxFacts } from '@/lib/tax-lookup'

// ── The "verified business" badge — one badge, >=2 independent channels ────────────
//
// Owner, 2026-07-23: an individual→business account earns a single "Business verified"
// badge only after two independent verification channels pass:
//   Channel 1 — REGISTRY/TAX (automated, already built): taxVerdict(seller)==='verified'
//               (VietQR/GDT knows the MST, it's active, the registered name matches the
//               legal name). See src/lib/tax-lookup.ts.
//   Channel 2 — DOCUMENT REVIEW (a human): an admin confirmed the uploaded identity doc
//               AND that an uploaded bank document's holder name matches the legal name.
//               That review is the SellerVerification record.
//
// ⚠️ THE BADGE IS IDENTITY-HASH-DERIVED, NEVER A PLAIN LATCHED FLAG (external review,
// codex + Gemini, both families). At approval we stamp onto the Seller the identity hash
// that was FROZEN at submit. The public badge renders ONLY when that stamped hash still
// equals a live hash of the seller's CURRENT identity. This deletes three bug classes at
// once:
//   · the approval-vs-edit RACE — a legalName/taxCode edit between review and approval
//     changes the live hash, so the just-approved badge simply doesn't match and won't show;
//   · the BRAND-IMPERSONATION hole — renaming the storefront (name) after verification
//     changes the hash, dropping the badge until re-reviewed (name is in the hash);
//   · the INDEFINITE LATCH — any identity edit silently un-verifies with NO reset write.
// On top of that the badge EXPIRES (verifiedUntil) and requires a LIVE Channel-1 verdict,
// so stale tax evidence can never keep it alive.
//
// ⚠️ HONEST CEILING: manual document review proves DOCUMENT-ATTESTED control — it raises
// the fraud bar to document forgery + legal liability, but does not cryptographically prove
// bank-account control. True proven-control is Phase 2 (automated bank account-name-inquiry,
// needs a NAPAS/VietQR key) and Phase 3 (VNeID, Law 122 from 2026-07-01, VN nationals only).
// The badge copy says "Business verified", never "ownership proven".

/** The badge's validity window from the approving review. */
export const VERIFICATION_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000
/** How long a decided case's documents linger before the retention job removes them. */
export const VERIFICATION_DOC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
/** The consent record's version (PDPL Decree 13/2023) — bump when the consent copy changes. */
export const VERIFICATION_CONSENT_VERSION = '1'

/** The identity fields whose change must invalidate a verification, folded + joined.
 *  `name` (the public storefront title a buyer reads next to the badge) is included so a
 *  post-verification rename to impersonate a brand drops the badge (external review). */
export type SellerIdentity = {
  name: string
  legalName: string | null
  legalAddress: string | null
  idNumber: string | null
  taxCode: string | null
}

/**
 * The stable fingerprint of a seller's identity. fold() normalizes diacritics/case so a
 * cosmetic re-accenting is not a "change", but any material edit to name / legal name /
 * address / id / tax code produces a new hash — and the badge stops matching.
 */
export function sellerIdentityHash(s: SellerIdentity): string {
  const parts = [
    fold(s.name || '').trim(),
    fold(s.legalName || '').trim(),
    fold(s.legalAddress || '').trim(),
    (s.idNumber || '').replace(/\D/g, ''),
    (s.taxCode || '').replace(/[^0-9-]/g, ''),
  ]
  return createHash('sha256').update(parts.join('␟')).digest('hex')
}

/** Everything the badge derivation reads off a Seller row (a superset of TaxFacts). */
export type VerificationFacts = TaxFacts &
  SellerIdentity & {
    verifiedIdentityHash: string | null
    verifiedUntil: Date | string | null
  }

/**
 * Is this seller's "Business verified" badge live RIGHT NOW? True only when all hold:
 *   1. an approval stamped an identity hash that still equals the CURRENT identity hash
 *      (no edit since approval), 2. the validity window has not lapsed, and 3. Channel 1
 *      (tax registry) is verified live. Any of these failing → no badge, no write needed.
 */
export function isBusinessVerified(s: VerificationFacts): boolean {
  if (!s.verifiedIdentityHash || !s.verifiedUntil) return false
  if (new Date(s.verifiedUntil).getTime() <= Date.now()) return false
  if (s.verifiedIdentityHash !== sellerIdentityHash(s)) return false
  return taxVerdict(s) === 'verified'
}

/** The verification state a seller should SEE (drives the dashboard status card). Distinct
 *  from isBusinessVerified, which is the public-badge test — e.g. an approved-but-expired
 *  case reads 'expired' here but the badge is simply absent publicly. */
export type VerificationView =
  | 'unverified' // no case, or channel 1 not yet verified
  | 'pending' // a case is submitted and awaiting review
  | 'verified' // live badge
  | 'expired' // was verified, window lapsed or identity changed — needs re-verification
  | 'rejected' // last case was rejected
  | 'changes_needed' // channel-1 tax not verified yet (fix the tax code / legal name)

export function verificationView(
  s: VerificationFacts,
  latestCaseStatus: 'draft' | 'pending' | 'approved' | 'rejected' | null,
): VerificationView {
  if (isBusinessVerified(s)) return 'verified'
  if (latestCaseStatus === 'pending') return 'pending'
  // Approved but the badge test failed ⇒ identity moved or the window lapsed.
  if (s.verifiedIdentityHash) return 'expired'
  if (latestCaseStatus === 'rejected') return 'rejected'
  if (s.taxCode && taxVerdict(s) !== 'verified') return 'changes_needed'
  return 'unverified'
}

/** The reviewer's suggested match for the bank-name channel — a hint, never the decision
 *  (the human confirms). Same fold()+containment strength as the tax matcher. */
export function nameMatchesLegal(seen: string, legalName: string | null, fallbackName: string): boolean {
  const a = fold(seen || '').trim()
  const b = fold(legalName || fallbackName || '').trim()
  if (!a || !b) return false
  return a === b || ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 8)
}
