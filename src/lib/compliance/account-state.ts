// ── Verify-on-action account state machine ──────────────────────────────────────────────────────
//
// Strategy (owner, 2026-08-03): identity verification is NOT required to sign up. Anyone may
// browse, search, save and message immediately. Verification is required to PUBLISH — which is
// where NĐ 248/2026 actually binds, since the obligation attaches to sellers.
//
// docs/compliance-2026.md §1. Legal citations: src/lib/compliance/legal-basis.ts.
//
// ⚠️ ONE VOCABULARY, TWO SPELLINGS — AND THE DB VALUE IS THE TRUTH.
// `Profile.verificationStatus` stores the lowercase values below. The UPPERCASE names are the
// PUBLIC contract (API responses, analytics, support scripts). They are two renderings of one
// value, never two columns: a second status column on the same row is how this codebase has
// already watched three copies of a ranking formula drift apart.
//
// ⚠️ `rejected` AND `suspended` ARE DIFFERENT STATES, DELIBERATELY.
// It is tempting to merge them into one "REJECTED_SUSPENDED". Do not. The overwhelmingly common
// rejection on this platform will be a bad photograph — an expat shooting a laminated TRC indoors
// under a ceiling light, producing glare the MRZ reader cannot resolve. That person must be told
// "we could not read it, try again" and be able to retry in the next thirty seconds. Someone
// flagged for identity fraud or subject to an authority order must NOT be able to retry, and must
// receive completely different words. One state cannot serve both, and merging them means
// accusing honest users of non-compliance because their camera flashed.

// ⚠️ MARKETPLACE-ONLY — AND THIS IS A DEPARTURE FROM THE "BOTH EDITIONS" DEFAULT (owner,
// 2026-08-03: "eno.forum doesnt need it").
//
// The seller-identity mandate binds the LICENSED VIETNAMESE PLATFORM. eno.vn is the entity
// registering as a sàn TMĐT; eno.forum exists precisely because it sits outside that regime.
//
// ⚠️ WITHOUT THIS GATE THE FORUM LOCKS ITSELF OUT, AND SILENTLY. `assertPublishable` lives in
// publish-guard.ts, which BOTH editions share. The moment verificationStatus starts being
// populated, an ungated check would refuse every forum publish — and since there is no VNPT
// integration channel on that side, there would be no route to becoming verified. A total publish
// lockout with no self-service exit, on a surface nobody was even looking at. The shared-guard seam
// is exactly where this repo's worst bugs have lived.
import { IS_MARKETPLACE } from '@/lib/edition'

/** Does THIS deployment require verified sellers? Compile-time, so it is inlined per artifact. */
export const IDENTITY_VERIFICATION_REQUIRED = IS_MARKETPLACE

export const ACCOUNT_STATE = {
  /** Signed up, no verification submitted. CAN browse, search, save, message. CANNOT publish. */
  unverified: 'PENDING_VERIFICATION',
  /** Documents in; automated or manual review running. Still cannot publish. */
  pending: 'VERIFICATION_SUBMITTED',
  /** Full seller access. */
  verified: 'VERIFIED_SELLER',
  /** Check failed for a FIXABLE reason (unreadable scan, name mismatch). Retry allowed. */
  rejected: 'VERIFICATION_REJECTED',
  /** Was verified; the document has since lapsed. NOT the same as never having verified. */
  expired: 'VERIFICATION_EXPIRED',
  /** Authority order or confirmed fraud. No self-service retry. */
  revoked: 'ACCOUNT_SUSPENDED',
} as const

export type VerificationStatus = keyof typeof ACCOUNT_STATE
export type PublicAccountState = (typeof ACCOUNT_STATE)[VerificationStatus]

/**
 * ⚠️ THE ONLY FUNCTION THAT DECIDES PUBLISHING. Everything else asks this — routes, the wizard,
 * the nudge scheduler, the partner API. A second copy of this predicate is a second answer.
 */
export function canPublish(status: VerificationStatus): boolean {
  return status === 'verified'
}

/** May the user fix this themselves, or does it need a human? Drives the CTA and the email. */
export function canSelfRetry(status: VerificationStatus): boolean {
  return status === 'unverified' || status === 'rejected' || status === 'expired'
}

/**
 * Browsing is open in every state. Messaging is open in every state EXCEPT `revoked`.
 *
 * ⚠️ THIS COMMENT USED TO CONTRADICT THE CODE, AND codex CAUGHT IT. The prose claimed a revoked
 * user keeps messaging ("severing chat strands a buyer who did nothing wrong") while the function
 * returned false for exactly that case — so the file argued against its own behaviour, and the
 * test pinned the code rather than the intent. Someone reading the comment would have "fixed" the
 * function and quietly re-enabled messaging for confirmed-fraud accounts.
 *
 * The behaviour is the correct one, and this is the reasoning: `revoked` means an authority order
 * or CONFIRMED fraud, so continued messaging lets a known-bad account keep working new victims —
 * which is worse than the real cost, that an honest counterparty mid-deal loses the thread. That
 * cost is mitigated by support relaying, and it is bounded; the other is not.
 */
export function canBrowse(): boolean { return true }
export function canMessage(status: VerificationStatus): boolean { return status !== 'revoked' }

// ── Legal transitions ───────────────────────────────────────────────────────────────────────────
// ⚠️ AN EXPLICIT TABLE, NOT AN `if` LADDER. Every transition writes a hash-chained audit row
// (§2.5), so an impossible transition reaching the database is a hole in the evidence, not just a
// bug. Rejecting it here means the log can only contain journeys that were actually possible.
const TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  unverified: ['pending'],
  pending: ['verified', 'rejected'],
  // A rejection is retryable — straight back into review.
  rejected: ['pending', 'revoked'],
  // ⚠️ `verified → expired` is driven by the DOCUMENT CLOCK, not by any user action, so it must be
  // reachable without a submission. That is why expiry is a state and not a boolean.
  verified: ['expired', 'revoked'],
  expired: ['pending', 'revoked'],
  // ⚠️ NO SELF-SERVICE PATH OUT OF `revoked`. Restoration is an admin/authority act that writes its
  // own audit row; allowing revoked → pending here would let a suspended seller resubmit documents
  // and quietly re-enter review.
  revoked: [],
}

export function canTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function assertTransition(from: VerificationStatus, to: VerificationStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal verification transition: ${from} → ${to}`)
  }
}

// ── The 30-day proactive nudge ──────────────────────────────────────────────────────────────────
//
// ⚠️ NUDGE ON INTENT, NOT ONLY ON THE CALENDAR. A pure day-7/14/30 drip mails every signup,
// including the large majority who came to BUY a motorbike and will never post anything. Those
// people receive an escalating series of warnings about an obligation that does not apply to them,
// and the predictable result is unsubscribes and spam complaints that damage deliverability for
// the mail that matters. This codebase has already learned the general form of this mistake once:
// a fix was ranked highly for a funnel step almost nobody reached, because reach was assumed
// rather than counted.
//
// So the schedule below is a CEILING on frequency, and `shouldNudge` additionally requires a
// signal of selling intent — opening the post wizard, a blocked publish attempt, an existing
// draft. No intent, no nudge beyond the single day-1 welcome mention.

export const NUDGE_DAYS = [1, 7, 21, 30] as const
export const NUDGE_WINDOW_DAYS = 30

export type NudgeInput = {
  createdAt: Date
  status: VerificationStatus
  /** Any selling-intent signal: opened /post, blocked publish attempt, saved draft. */
  hasSellingIntent: boolean
  lastPromptAt: Date | null
  promptCount: number
  optedOut: boolean
  now?: Date
}

export type NudgeDecision =
  | { send: false; reason: string }
  | { send: true; step: number; dayIndex: number; tone: 'welcome' | 'reminder' | 'deadline' }

/**
 * Decide whether to send a verification nudge right now.
 *
 * ⚠️ PURE AND FULLY-DETERMINED BY ITS INPUT — no clock reads, no db. The cron passes `now`. That is
 * what makes the schedule testable at all: the alternative is a cron whose behaviour can only be
 * observed by waiting three weeks.
 */
export function shouldNudge(input: NudgeInput): NudgeDecision {
  const now = input.now ?? new Date()

  // Never nag someone who cannot act on it, or who already did.
  if (input.optedOut) return { send: false, reason: 'opted_out' }
  if (input.status === 'verified') return { send: false, reason: 'already_verified' }
  if (input.status === 'pending') return { send: false, reason: 'review_in_progress' }
  if (input.status === 'revoked') return { send: false, reason: 'suspended_needs_human' }

  const ageDays = Math.floor((now.getTime() - input.createdAt.getTime()) / 86_400_000)
  if (ageDays < NUDGE_DAYS[0]) return { send: false, reason: 'too_new' }

  if (input.promptCount >= NUDGE_DAYS.length) return { send: false, reason: 'schedule_exhausted' }

  // ⚠️ A HARD FLOOR BETWEEN SENDS, INDEPENDENT OF THE SCHEDULE. A cron that runs hourly and reads a
  // stale promptCount (a failed write, a retry, two workers) would otherwise send the same step
  // repeatedly within one day. The price-drop notifier learned this: the ratchet, not the
  // schedule, is what actually prevents duplicate mail.
  if (input.lastPromptAt && now.getTime() - input.lastPromptAt.getTime() < 3 * 86_400_000) {
    return { send: false, reason: 'cooldown' }
  }

  const step = input.promptCount
  const dueDay = NUDGE_DAYS[step]
  if (ageDays < dueDay) return { send: false, reason: 'not_due' }

  // Day 1 is informational and goes to everyone; everything after it requires intent.
  if (step > 0 && !input.hasSellingIntent) return { send: false, reason: 'no_selling_intent' }

  return {
    send: true,
    step,
    dayIndex: dueDay,
    tone: step === 0 ? 'welcome' : dueDay >= NUDGE_WINDOW_DAYS ? 'deadline' : 'reminder',
  }
}
