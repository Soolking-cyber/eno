import type { VerificationStatus } from './account-state'

// ── Which identity_verifications row speaks for a profile — PURE ─────────────────────────────────
//
// Extracted verbatim from recompute-verification.ts, which is `server-only` and reaches the database.
// The derivation itself needs neither, and keeping it importable from a plain Node script is what
// lets scripts/publish-held.ts apply the SAME identity decision the app applies, instead of a second
// copy of these rules that would drift the first time one of them changes.

export type VerificationRow = {
  id: string
  tier: string
  method: string
  status: string
  decidedAt: Date | null
  documentExpiresAt: Date | null
  assuranceLevel: string | null
}

const KNOWN: readonly VerificationStatus[] = ['unverified', 'pending', 'verified', 'rejected', 'expired', 'revoked']
export const asStatus = (v: string): VerificationStatus | null =>
  (KNOWN as readonly string[]).includes(v) ? (v as VerificationStatus) : null

/**
 * Which row speaks for this profile, and what it means TODAY.
 *
 * ⚠️ REVOKED WINS OVER EVERYTHING, INCLUDING A NEWER ROW. Revocation is an admin or authority act;
 * if it did not outrank a subsequent submission, a revoked seller could bury it under a fresh
 * pending row and the cache would report `pending` — which `canPublish` treats far more kindly.
 * The transition table already refuses to leave `revoked`; this keeps the DERIVATION honest too.
 */
/**
 * ⚠️ GENERIC OVER THE ROW, so a caller that selected more columns (the status route reads the
 * reviewer's note off the source row) gets them back on `source` without a cast.
 */
export function deriveVerification<R extends VerificationRow>(rows: R[], now: Date): { status: VerificationStatus; source: R | null } {
  if (rows.length === 0) return { status: 'unverified', source: null }

  const revoked = rows.find((r) => r.status === 'revoked')
  if (revoked) return { status: 'revoked', source: revoked }

  // The newest DECIDED row is the verdict. An undecided (pending) row alongside it means a
  // resubmission is in flight, which does not undo the previous verdict — but see below.
  const decided = rows.filter((r) => r.decidedAt !== null)
    .sort((a, b) => (b.decidedAt!.getTime() - a.decidedAt!.getTime()))
  const latest = decided[0]

  // ⛔ A STILL-VALID VERIFICATION SURVIVES A LATER REJECTION, AND THE FIRST VERSION DID NOT DO THIS.
  // Taking `decided[0]` unconditionally meant a seller verified in March who resubmits in August —
  // to update a detail, or with a second document — and is REJECTED loses the March verification
  // too: the account drops from `verified` to `rejected` and can no longer publish, on the strength
  // of an attempt that was only ever additive. Caught by external review.
  //
  // ⚠️ THE ESCAPE HATCH IS `revoked`, NOT REJECTION. If a reviewer concludes the earlier record was
  // fraudulent, revoking it outranks everything above — that is what the first branch is for. A
  // rejection says "this submission does not qualify", never "the previous one was a lie", and the
  // two must not be conflated on an account someone is trying to sell from.
  if (latest && latest.status !== 'verified') {
    const standing = decided.find((r) => r.status === 'verified'
      && !(r.documentExpiresAt && r.documentExpiresAt.getTime() < startOfDay(now)))
    if (standing) return { status: 'verified', source: standing }
  }

  if (latest?.status === 'verified') {
    // ⛔ THE DOCUMENT CLOCK, CHECKED HERE AND NOWHERE ELSE. Decree 248/2026 Art 18.1(b) requires a
    // foreign seller's passport to be valid; a row that said `verified` in March says nothing about
    // today. Strictly BEFORE, so a document expiring today is still good today — the same calendar
    // -day leniency verify-decision.ts applies at submission.
    const exp = latest.documentExpiresAt
    if (exp && exp.getTime() < startOfDay(now)) return { status: 'expired', source: latest }
    return { status: 'verified', source: latest }
  }

  // No verdict yet, or the last verdict was a rejection: a pending row is the live state, because
  // the seller has acted since.
  const pending = rows.find((r) => r.status === 'pending')
  if (pending) return { status: 'pending', source: pending }

  if (latest) {
    const s = asStatus(latest.status)
    if (s) return { status: s, source: latest }
  }
  return { status: 'unverified', source: null }
}

/** Midnight ICT as a UTC instant. Every compliance date in this codebase is +07:00. */
function startOfDay(now: Date): number {
  const ict = new Date(now.getTime() + 7 * 3600_000)
  return Date.UTC(ict.getUTCFullYear(), ict.getUTCMonth(), ict.getUTCDate()) - 7 * 3600_000
}

