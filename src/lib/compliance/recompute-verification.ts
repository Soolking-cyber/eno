import 'server-only'
import { db } from '@/lib/db'
import { assertTransition, canTransition, type VerificationStatus } from './account-state'

// ── THE ONLY SANCTIONED WRITER OF Profile.verification* ─────────────────────────────────────────
//
// prisma/schema.prisma:115 names this function and forbids everything else: "⚠️ NEVER WRITTEN BY
// HAND — only by recomputeVerification()". It did not exist until now, which is why the whole
// identity spine has been inert: six statuses, a legal-transition table, a nudge scheduler and a
// publish gate, all reading a column nothing ever set.
//
// ⛔ THE PROFILE COLUMNS ARE A CACHE, NOT THE TRUTH. `identity_verifications` is the record; these
// columns exist so a listing page can render a badge without a join. So this function DERIVES them
// and never accepts them as an argument — a caller that could pass a status could set `verified`
// without a document, which is precisely the drift the schema comment warns about.
//
// ⚠️ EXPIRY IS COMPUTED, NOT STORED. A verified passport becomes `expired` because the clock moved,
// with no user action and no new row. That is why the transition table has `verified → expired`
// reachable without a submission — and why calling this on a schedule is part of the design rather
// than an optimisation. Nothing else notices a document lapsing.

/** Newest-first, because "the record that speaks for this profile" is almost always the latest. */
const ROW_SELECT = {
  id: true, tier: true, method: true, status: true,
  decidedAt: true, documentExpiresAt: true, assuranceLevel: true,
} as const

type Row = {
  id: string
  tier: string
  method: string
  status: string
  decidedAt: Date | null
  documentExpiresAt: Date | null
  assuranceLevel: string | null
}

export type RecomputeResult = {
  /** What the cache says now — whether or not this call changed it. */
  status: VerificationStatus
  /** The row the answer came from, for an audit line. Null when the profile has no history. */
  sourceId: string | null
  /** False when the cache already agreed; callers use this to skip a notification. */
  changed: boolean
  /** Set when the derived status was NOT reachable from the stored one — see the note below. */
  illegalTransition?: { from: VerificationStatus; to: VerificationStatus }
}

const KNOWN: readonly VerificationStatus[] = ['unverified', 'pending', 'verified', 'rejected', 'expired', 'revoked']
const asStatus = (v: string): VerificationStatus | null =>
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
export function deriveVerification<R extends Row>(rows: R[], now: Date): { status: VerificationStatus; source: R | null } {
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

/**
 * Recompute and persist the cache for one profile. Safe to call repeatedly — it writes only when
 * the derived status differs from the stored one.
 *
 * ⚠️ AN ILLEGAL TRANSITION IS REPORTED, NOT THROWN. `assertTransition` exists to stop an impossible
 * journey reaching the audit log, and that is right for a REQUEST. But this function also runs from
 * a cron over every seller, and one corrupt profile must not abort the sweep for everybody else —
 * so it records the anomaly, leaves the cache untouched, and lets the caller decide. A thrown error
 * here would mean one bad row silently stops every other seller's document clock.
 */
export async function recomputeVerification(profileId: string, now: Date = new Date()): Promise<RecomputeResult> {
  const rows = (await db.identityVerification.findMany({
    where: { profileId },
    select: ROW_SELECT,
    orderBy: { submittedAt: 'desc' },
  })) as Row[]

  const { status, source } = deriveVerification(rows, now)

  const profile = await db.profile.findUnique({ where: { id: profileId }, select: { verificationStatus: true } })
  const from = asStatus(profile?.verificationStatus ?? 'unverified') ?? 'unverified'
  if (from === status) return { status, sourceId: source?.id ?? null, changed: false }

  if (!canTransition(from, status)) {
    console.error('[recompute-verification] illegal transition', { profileId, from, to: status, sourceId: source?.id })
    return { status: from, sourceId: source?.id ?? null, changed: false, illegalTransition: { from, to: status } }
  }
  assertTransition(from, status) // belt and braces: the check above already passed

  await db.profile.update({
    where: { id: profileId },
    data: {
      verificationStatus: status,
      verificationTier: source?.tier ?? null,
      verificationMethod: source?.method ?? null,
      // ⚠️ verifiedAt IS THE MOMENT OF THE VERDICT, NOT OF THIS SWEEP. Stamping now() would make an
      // expiry sweep look like a fresh verification in every report that reads this column.
      verifiedAt: status === 'verified' ? (source?.decidedAt ?? null) : null,
    },
  })
  return { status, sourceId: source?.id ?? null, changed: true }
}

/**
 * The verification status for a decision THAT MATTERS — publishing, a takedown, an answer to an
 * authority.
 *
 * ⛔ THIS DELIBERATELY IGNORES Profile.verificationStatus. prisma/schema.prisma:116 requires it:
 * "any decision that MATTERS (publishing, takedown, an authority answer) re-reads
 * identity_verifications, because a cache that has drifted is exactly how a lapsed document keeps
 * a verified badge." The cache is for rendering a badge without a join; it is not evidence.
 *
 * ⚠️ AND THE DRIFT IS NOT HYPOTHETICAL, because expiry is derived rather than stored: a passport
 * that lapsed this morning still reads `verified` in the cache until a sweep runs. Reading the
 * cache here would let exactly that seller publish.
 *
 * One indexed query, and only when the gate is actually enforced — see the call site.
 */
export async function verificationStatusForDecision(
  ownerId: string,
  now: Date = new Date(),
): Promise<VerificationStatus> {
  const rows = (await db.identityVerification.findMany({
    where: { profileId: ownerId },
    select: ROW_SELECT,
    orderBy: { submittedAt: 'desc' },
  })) as Row[]
  return deriveVerification(rows, now).status
}
