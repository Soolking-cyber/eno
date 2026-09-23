import 'server-only'
import { db } from '@/lib/db'
import { assertTransition, canTransition, type VerificationStatus } from './account-state'
import { asStatus, deriveVerification, type VerificationRow as Row } from './derive-verification'
import { releaseIdentityHolds } from './identity-holds'

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

// ⚠️ THE DERIVATION MOVED TO derive-verification.ts (pure, no db, no server-only) so that a SCRIPT can
// run the same answer — scripts/publish-held.ts gates on it through a raw pg client, and it cannot
// import this file. Re-exported here so every existing caller and test keeps its import.
export { deriveVerification } from './derive-verification'

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
  const { result, derived } = await recomputeCache(profileId, now)
  // ⚖️ AUTO-PUBLISH ON VERIFY — the other half of the seller identity gate's HOLD. Keyed on the
  // DERIVED status, i.e. the same identity_verifications answer the gate itself decides on, and not
  // on `changed`: a cache that already read `verified` (an expiry the sweep never recorded, then a
  // renewal) must still release what was parked while the decision said otherwise, and an illegal
  // cache transition must not strand holds the gate would now allow.
  // ⚠️ FAIL-QUIET: this runs inside KYC decisions and the admin users console. A listing-write
  // hiccup must never fail a verification; the next recompute for this profile retries the release.
  // ⚠️ NOT GATED ON identityGateEnforced(), DELIBERATELY. That predicate is marketplace-edition AND
  // the flag, but both editions share one database: a verification recomputed by the eno.forum build
  // (or after the switch was turned off again) would otherwise release nothing, and a now-verified
  // seller's parked listings would stay invisible until some later recompute on the other build.
  // Releasing is always right once the owner is verified. Its cost with nothing held is two small
  // INDEXED reads (Seller by ownerId, Listing by sellerId) and no write.
  // ⛔ AND ONLY WHEN THE RECOMPUTE'S OWN ANSWER IS `verified` — not merely the derivation. On an
  // illegal transition the cache write is refused and the profile keeps its old state (say `revoked`,
  // set by another path); releasing then would republish every parked listing of an account the rest
  // of the app still treats as suspended.
  if (derived === 'verified' && result.status === 'verified') {
    try {
      const released = await releaseIdentityHolds(profileId)
      if (released) console.info('[recompute-verification] released identity holds', { profileId, released })
    } catch (e) {
      console.error('[recompute-verification] identity-hold release failed', { profileId }, e)
    }
  }
  return result
}

/** The cache write itself; returns the derived status alongside, for the release above. */
async function recomputeCache(profileId: string, now: Date): Promise<{ result: RecomputeResult; derived: VerificationStatus }> {
  const rows = (await db.identityVerification.findMany({
    where: { profileId },
    select: ROW_SELECT,
    orderBy: { submittedAt: 'desc' },
  })) as Row[]

  const { status, source } = deriveVerification(rows, now)

  const profile = await db.profile.findUnique({ where: { id: profileId }, select: { verificationStatus: true } })
  const from = asStatus(profile?.verificationStatus ?? 'unverified') ?? 'unverified'
  if (from === status) return { derived: status, result: { status, sourceId: source?.id ?? null, changed: false } }

  if (!canTransition(from, status)) {
    console.error('[recompute-verification] illegal transition', { profileId, from, to: status, sourceId: source?.id })
    return { derived: status, result: { status: from, sourceId: source?.id ?? null, changed: false, illegalTransition: { from, to: status } } }
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
  return { derived: status, result: { status, sourceId: source?.id ?? null, changed: true } }
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
