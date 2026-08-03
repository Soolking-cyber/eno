import 'server-only'

// ── Tier A: Vietnamese citizen verification via an eKYC provider (VNPT eKYC free tier) ──────────
//
// Owner, 2026-08-03: Tier A runs on VNPT eKYC's free tier rather than a direct C06/VNeID
// integration — which is the pragmatic call, since a direct integration needs a contract we do not
// have and VNPT is an authorised intermediary that already holds one.
//
// ⚠️ THE ENDPOINT AND FIELD NAMES BELOW ARE A PLACEHOLDER SHAPE, NOT VERIFIED API DOCUMENTATION.
// I have not confirmed VNPT's current request/response schema against their integration package.
// The ADAPTER BOUNDARY is the deliverable here: everything above `EkycProvider` is ours and
// correct, and swapping in the real wire format is one file. Do not ship Tier A until the mapping
// in `vnptAdapter` has been checked against their docs.
//
// ⚠️ A FREE TIER IS A QUOTA, AND THE QUOTA IS THE DESIGN PROBLEM — not the happy path.
// Every free tier ends. What happens at call N+1 decides whether this system is safe:
//   · fail OPEN (auto-verify) → unverified sellers publish; the exact outcome the law forbids
//   · fail HARD (500)         → verification is simply broken, with no signal to anyone
//   · fail SOFT (queue for manual review) ← what this does
// Degrading to a human queue keeps the legal gate intact while keeping honest users moving, and
// surfaces the exhaustion as an operational alert rather than a silent behaviour change.

export type EkycInput = {
  /** Front/back of the CCCD, or the VNeID assertion payload. Never persisted by us. */
  documentFront: Uint8Array
  documentBack?: Uint8Array
  /** Selfie for face-match, when the provider tier supports it. */
  portrait?: Uint8Array
}

export type EkycOutcome =
  /** Provider affirmatively verified the person. `subject` is the identifier we HMAC (never store). */
  | { status: 'verified'; subject: string; fullName?: string; birthYear?: number; assurance?: string }
  /** Provider ran and said no. A real negative — distinct from "we could not ask". */
  | { status: 'rejected'; reason: string }
  /** ⚠️ WE COULD NOT ASK. Quota, outage, timeout. NOT a rejection — route to human review. */
  | { status: 'unavailable'; reason: 'quota_exhausted' | 'provider_error' | 'timeout'; detail?: string }

export type EkycProvider = {
  name: string
  verify(input: EkycInput): Promise<EkycOutcome>
}

/**
 * ⚠️ `unavailable` MUST NEVER COLLAPSE INTO `rejected`, AND THIS IS THE SUBTLE ONE.
 * They are both "not verified", so a tired refactor will merge them — and then a quota exhaustion
 * silently starts REJECTING every Vietnamese seller, telling honest citizens their national ID
 * failed verification. It looks identical in the database and completely different to a human.
 * This repo has already recorded the same distinction on the visa side, where a transient
 * `shop_unavailable` had to be kept separate from a real refusal.
 */
export function isTransient(o: EkycOutcome): o is Extract<EkycOutcome, { status: 'unavailable' }> {
  return o.status === 'unavailable'
}

/** Where an outcome sends the verification record. Pure, so the mapping is testable in isolation. */
export function outcomeToStatus(o: EkycOutcome): 'verified' | 'rejected' | 'pending' {
  switch (o.status) {
    case 'verified': return 'verified'
    case 'rejected': return 'rejected'
    // Transient → stays in review for a human, never an automatic negative.
    case 'unavailable': return 'pending'
  }
}

// ── Quota accounting ────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ COUNT OUR OWN CALLS; DO NOT WAIT TO BE TOLD. Discovering the free tier is exhausted by reading
 * a 429 means we have already failed a user, and providers differ on whether they even return a
 * distinguishable code. A local counter lets us degrade BEFORE the wall and alert at a threshold.
 *
 * Backed by the same Postgres primitives as the rate limiter (there is no Redis here — Upstash was
 * fully replaced), so the count survives a restart and is shared across Cloud Run instances. An
 * in-memory counter would reset on every deploy and every scale-out, which is the same as no
 * counter at all.
 */
export type QuotaState = { used: number; limit: number; periodStart: Date }

export const QUOTA_ALERT_FRACTION = 0.8

export function quotaStatus(q: QuotaState): 'ok' | 'warn' | 'exhausted' {
  if (q.used >= q.limit) return 'exhausted'
  if (q.used >= q.limit * QUOTA_ALERT_FRACTION) return 'warn'
  return 'ok'
}

/**
 * ⚠️ RESERVE BEFORE CALLING, NOT AFTER. Incrementing on success undercounts every failed-but-billed
 * request, and under concurrency two requests both read `used = limit - 1` and both proceed. The
 * caller must reserve a slot atomically (a single UPDATE … WHERE used < limit RETURNING) and treat
 * "no row returned" as exhausted — the same lesson as the visa capture race, where locking a row
 * without modifying it was not enough.
 */
export function shouldAttempt(q: QuotaState): boolean {
  return quotaStatus(q) !== 'exhausted'
}
