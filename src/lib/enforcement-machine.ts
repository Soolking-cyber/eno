// Enforcement ladder Phase 2 — the PURE state machine (no DB, no server-only) so
// every transition rule is unit-testable (src/lib/enforcement-machine.test.ts).
// src/lib/enforcement.ts wires this to Prisma + notifications.
//
// States (severity-ordered): good_standing → warned → throttled → held → suspended.
// System-derived from the trust v2 breakdown + admin-overridable; the system never
// downgrades an active higher-severity ADMIN action, and auto-lifts its own actions
// when the derived state improves. Anti-double-punishment: no rank multiplier — the
// composite score already demotes; enforcement only gates CAPABILITIES.

import { DAY_MS, reportsDemote, type ReportWindow } from './trust-math'

export const ENFORCEMENT_STATES = ['good_standing', 'warned', 'throttled', 'held', 'suspended'] as const
export type EnforcementState = (typeof ENFORCEMENT_STATES)[number]

/** Severity order — transitions compare on this, never on string identity. */
export const ENFORCEMENT_SEVERITY: Record<EnforcementState, number> = {
  good_standing: 0,
  warned: 1,
  throttled: 2,
  held: 3,
  suspended: 4,
}

// Reason slugs stored on EnforcementAction.reason — the CLIENT maps these to i18n
// copy (server stores slugs, not prose, so copy can improve without data migrations).
export const ENFORCEMENT_REASON = {
  SCAM_HOLD: 'scam_hold', // a confirmed scam with dues unpaid (frozen decay)
  CONDUCT_RESTRICTED: 'conduct_restricted', // score <60 driven by confirmed reports
  CONDUCT_WARNING: 'conduct_warning', // dual-threshold demote signal inside 90d
  INSURANCE_GRACE: 'insurance_grace', // good-standing insurance 72h contact-before-action
  ADMIN_MANUAL: 'admin_manual', // an admin set the state by hand
  // ── Phase 3 (identity layer) ──
  BAN_EVASION_REVIEW: 'ban_evasion_review', // verified phone matches a suspended account → held for HUMAN review (never auto-ban: VN families share numbers)
  BAN_EVASION_EMAIL: 'ban_evasion_email', // email matches a suspended account — weaker signal → silent flag only, state unchanged
  VELOCITY_REVIEW: 'velocity_review', // positive-event spike far above baseline → silent flag only, state unchanged
} as const

/**
 * FLAG-ONLY reasons (Phase 3): EnforcementAction rows that are review ANNOTATIONS,
 * not ladder states — they never touch Profile.enforcementState, never notify the
 * seller, and must be EXCLUDED from every ladder query (supersede-on-transition,
 * system-precedence reads, the seller-facing dashboard/appeal action lookups) so a
 * silent flag can neither leak to the seller nor shadow a real action.
 */
export const FLAG_REASONS = [ENFORCEMENT_REASON.VELOCITY_REVIEW, ENFORCEMENT_REASON.BAN_EVASION_EMAIL] as const
export type FlagReason = (typeof FLAG_REASONS)[number]

export function isFlagReason(reason: string): reason is FlagReason {
  return (FLAG_REASONS as readonly string[]).includes(reason)
}

export const ENFORCEMENT = {
  WARN_EXPIRES_DAYS: 30, // a conduct warning lapses after a clean month
  INSURANCE_GRACE_HOURS: 72, // Amazon AHA: notice-before-action for long-good sellers
  INSURANCE_MIN_GOOD_DAYS: 180, // insured = goodStandingSince ≥ this
  GRACE_REUSE_DAYS: 30, // one grace per episode — a lapsed grace can't immediately re-arm
  RESTRICTED_SCORE: 60, // mirrors the tier floor (trust-math)
  // Probation: capability caps for NEW accounts — caps, not score shame.
  PROBATION: {
    MIN_ACCOUNT_AGE_DAYS: 30, // probation ends at ≥30d age…
    MIN_TRANSACTIONS: 3, // …OR ≥3 completed transactions, whichever first
    // 8 → 30 (owner, 2026-08-11). Official partners and verified businesses are exempt
    // from this cap entirely — see isListingCapExempt in enforcement.ts.
    MAX_ACTIVE_LISTINGS: 30,
    MAX_NEW_CONVERSATIONS_PER_DAY: 15,
  },
} as const

// ── Phase 3: velocity review flags (silent — a flag is a question for an admin,
// never a punishment: the seller's state, rank and notifications are untouched).
export const VELOCITY = {
  REVIEWS_24H_MIN: 5, // absolute floor — small shops with a lucky day never flag
  TX_24H_MIN: 8,
  SPIKE_FACTOR: 3, // and the day must run >3× the trailing-30d daily average
  WINDOW_DAYS: 30,
} as const

export type VelocityInputs = {
  reviews24h: number // VERIFIED reviews received in the last 24h (raw, pre-dedup — a same-buyer burst IS the signal)
  reviews30d: number // …and in the trailing 30d (includes the last 24h)
  tx24h: number // transactions (sold listings + accepted offers) in the last 24h
  tx30d: number
}

/**
 * Should this profile get a silent velocity review flag? Dual condition per axis:
 * an ABSOLUTE floor (≥5 reviews / ≥8 transactions in 24h) AND a RELATIVE spike
 * (>3× the trailing-30d daily average). The average includes the spike day itself —
 * strictly conservative (a spike inflates its own baseline), and it keeps the
 * detector a pure function of four counts the trust recompute already has loaded.
 */
export function velocitySpike(v: VelocityInputs): boolean {
  const reviewAvg = v.reviews30d / VELOCITY.WINDOW_DAYS
  const txAvg = v.tx30d / VELOCITY.WINDOW_DAYS
  return (
    (v.reviews24h >= VELOCITY.REVIEWS_24H_MIN && v.reviews24h > VELOCITY.SPIKE_FACTOR * reviewAvg) ||
    (v.tx24h >= VELOCITY.TX_24H_MIN && v.tx24h > VELOCITY.SPIKE_FACTOR * txAvg)
  )
}

// ── Phase 3: repeat-false-reporter ladder (protect good sellers). Strikes come
// from Profile.falseReportStrikes (incremented on each 'abusive' ruling).
export const REPORTER_LADDER = {
  PRESCREEN_STRIKES: 2, // ≥2 strikes → reports land preScreen'd (triaged LAST, excluded from buyer-waiting)
  BLOCKED_STRIKES: 3, // ≥3 strikes → reporting is turned off (calm copy; appeal via help)
} as const

export type ReporterStanding = 'ok' | 'prescreen' | 'blocked'

/** 0–1 strikes: normal (the existing cooldown already applies) · 2: pre-screened · ≥3: blocked. */
export function reporterStanding(falseReportStrikes: number): ReporterStanding {
  if (falseReportStrikes >= REPORTER_LADDER.BLOCKED_STRIKES) return 'blocked'
  if (falseReportStrikes >= REPORTER_LADDER.PRESCREEN_STRIKES) return 'prescreen'
  return 'ok'
}

/** A concrete enforcement decision — what applyEnforcement executes. */
export type EnforcementDecision = {
  state: EnforcementState
  reason: string
  expiresAt: number | null // epoch ms (pure module — no Date construction for testability)
}

/** Defensive read of a stored state string (pre-migration/garbage → good_standing). */
export function normalizeEnforcementState(v: unknown): EnforcementState {
  return (ENFORCEMENT_STATES as readonly string[]).includes(String(v)) ? (v as EnforcementState) : 'good_standing'
}

export type EnforcementInputs = {
  score: number // the PERSISTED trust score (post daily-cap)
  hasScamHold: boolean // a confirmed scam still frozen (dues unpaid) — TrustBreakdown.inputs
  conductPenalty: number // the C component — >0 means confirmed reports still bite
  reports90: ReportWindow // confirmed reports in the last 90d (TrustBreakdown.inputs)
  transactions365: number
}

/**
 * Derive the system's target state from the v2 trust breakdown (spec order):
 *  1. active scam-hold → held (listings pulled, posting blocked)
 *  2. Restricted VIA CONDUCT (score <60 while confirmed reports still bite) → throttled
 *     — a low score from manual adjustments alone never throttles (no double punishment;
 *     the Restricted publish gate already applies)
 *  3. dual-threshold demote signal inside 90d → warned, expires in 30d
 *  4. else → good_standing (the system auto-lifts its own actions when this improves)
 */
export function deriveState(i: EnforcementInputs, now: number = Date.now()): EnforcementDecision {
  if (i.hasScamHold) return { state: 'held', reason: ENFORCEMENT_REASON.SCAM_HOLD, expiresAt: null }
  if (i.score < ENFORCEMENT.RESTRICTED_SCORE && i.conductPenalty > 0) {
    return { state: 'throttled', reason: ENFORCEMENT_REASON.CONDUCT_RESTRICTED, expiresAt: null }
  }
  if (reportsDemote(i.reports90, i.transactions365)) {
    return { state: 'warned', reason: ENFORCEMENT_REASON.CONDUCT_WARNING, expiresAt: now + ENFORCEMENT.WARN_EXPIRES_DAYS * DAY_MS }
  }
  return { state: 'good_standing', reason: 'good_standing', expiresAt: null }
}

/**
 * May the SYSTEM move from the current state to the derived one?
 *  - same state → false (idempotent no-op; applyEnforcement never re-creates)
 *  - escalation (higher severity) → always allowed, even over an admin action
 *  - downgrade → only when the current action is the system's own (decidedBy
 *    'system'); ADMIN actions only lift manually (an admin's suspend can't be
 *    silently un-done because a score decayed back up).
 */
export function canSystemTransition(
  current: { state: EnforcementState; decidedBy: string },
  derived: EnforcementState,
): boolean {
  if (derived === current.state) return false
  if (ENFORCEMENT_SEVERITY[derived] > ENFORCEMENT_SEVERITY[current.state]) return true
  return current.decidedBy === 'system'
}

/** Insured = an unbroken ≥85 streak of at least 180 days (Profile.goodStandingSince). */
export function isInsured(goodStandingSinceMs: number | null, now: number = Date.now()): boolean {
  return goodStandingSinceMs != null && now - goodStandingSinceMs >= ENFORCEMENT.INSURANCE_MIN_GOOD_DAYS * DAY_MS
}

/**
 * Good-standing insurance (Amazon AHA): a NON-CRITICAL system escalation
 * (warned/throttled) against an insured seller who is currently in good standing
 * becomes a 72h grace notice first — escalate only if still derived after the
 * window (the cron expires the grace, then the next sync applies the real state;
 * graceUsedRecently stops an expire→re-grace loop). NEVER applies to held/suspended
 * (scam holds act immediately) and never re-arms mid-episode.
 */
export function applyInsurance(
  derived: EnforcementDecision,
  ctx: { insured: boolean; currentState: EnforcementState; graceUsedRecently: boolean },
  now: number = Date.now(),
): EnforcementDecision {
  if (!ctx.insured || ctx.graceUsedRecently) return derived
  if (ctx.currentState !== 'good_standing') return derived
  if (derived.state !== 'warned' && derived.state !== 'throttled') return derived
  return { state: 'warned', reason: ENFORCEMENT_REASON.INSURANCE_GRACE, expiresAt: now + ENFORCEMENT.INSURANCE_GRACE_HOURS * 3_600_000 }
}

/**
 * While an insurance-grace action is still un-expired, a warned/throttled derivation
 * is HELD BACK (the whole point of the 72h window). A critical derivation
 * (held/suspended) always breaks through.
 */
export function holdForGrace(
  active: { reason: string | null; expiresAtMs: number | null } | null,
  derivedState: EnforcementState,
  now: number = Date.now(),
): boolean {
  if (!active || active.reason !== ENFORCEMENT_REASON.INSURANCE_GRACE) return false
  if (active.expiresAtMs == null || active.expiresAtMs <= now) return false
  return derivedState === 'warned' || derivedState === 'throttled'
}

/** Probation (new accounts): until ≥30d old OR ≥3 completed transactions. */
export function isProbation(accountAgeDays: number, transactions: number): boolean {
  return accountAgeDays < ENFORCEMENT.PROBATION.MIN_ACCOUNT_AGE_DAYS && transactions < ENFORCEMENT.PROBATION.MIN_TRANSACTIONS
}

/** held + suspended block publishing new listings (held also pulls existing ones). */
export function blocksPosting(s: EnforcementState): boolean {
  return s === 'held' || s === 'suspended'
}

/** Only suspended blocks messages / offers / reviews / conversations. */
export function blocksMessaging(s: EnforcementState): boolean {
  return s === 'suspended'
}
