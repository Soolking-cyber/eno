// Trust v2 — the PURE math (no DB, no server-only) so every formula is unit-testable
// (src/lib/trust-math.test.ts) and mirrorable in the plain-JS migration scripts
// (scripts/trust-v2-dryrun.mjs / trust-v2-backfill.mjs — keep in sync BY HAND).
//
// v2 replaces the lifetime additive sum with a WINDOWED, DECAYED composite
// recomputed from source tables:  score = clamp(0, 150, 60 + V + Q + T − C).
// Design synthesis (see .claude/plans/eno-trust-v2.md): IMDb Bayesian review
// smoothing, Wilson lower bound for response rate, eBay dual-threshold demotion,
// Friedman–Resnick "dues-paying" (fraud never heals by time alone), and a
// mini-EigenTrust source-credibility weighting so burner accounts can neither
// mint nor destroy reputation.

export type TrustTier = 'restricted' | 'standard' | 'trusted' | 'exceptional'
export type ReportSeverity = 'minor' | 'moderate' | 'severe'

export const DAY_MS = 86_400_000

export const TRUST = {
  BASE: 60, // every account starts here — Building is neutral probation, not shame
  MAX: 150, // 60 + V(25) + Q(40) + T(25) at perfection; floor 0

  // ── V · Verification (0–25) — permanent one-time gates ──
  V_PHONE: 10, // verified phone (auth-confirmed, never self-typed)
  V_KYC: 10, // business identity verification
  V_AGE: 5, // account age ≥ V_AGE_DAYS — time-in-community is weak but real signal
  V_AGE_DAYS: 90,

  // ── Q · Quality (0–40) = reviews (0–25) + responsiveness (0–10) + freshness (0–5) ──
  // Reviews: IMDb-style Bayesian shrinkage toward the platform prior so 2×5.0 can
  // never beat 200×4.8 — small samples are pulled hard toward the mean.
  REVIEW_PRIOR_MEAN: 4.6, // platform mean prior C (re-tune periodically against the live mean)
  REVIEW_PRIOR_WEIGHT: 5, // m — phantom votes at the prior
  REVIEW_MAX: 25,
  REVIEW_FLOOR: 3.5, // R_adj at/below this earns 0 — mediocre isn't rewarded
  REVIEW_SPAN: 1.5, // full marks at R_adj = 5.0 (3.5 + 1.5)
  REVIEW_SATURATION: 5, // volume ramp: full weight once effective n ≥ 5
  REVIEW_PAIR_DEDUP_DAYS: 90, // one COUNTED review per buyer→seller pair per 90d (anti-collusion)

  // Responsiveness: Wilson score lower bound (z = 1.28 ≈ 80% one-sided confidence)
  // on replied-within-24h — a pessimistic estimate, so 3/3 can't beat 285/300.
  RESPONSE_MAX: 10,
  WILSON_Z: 1.28,
  RESPONSE_WINDOW_DAYS: 90, // only recent conversations count — recent behavior matters more

  // Availability freshness: share of active listings confirmed within FRESH_DAYS.
  FRESH_MAX: 5,
  FRESH_DAYS: 14,

  // ── T · Track record (0–25): 12·log10(1 + tx365), capped ──
  // Diminishing (log) so reputation can't be bulk-bought: 10 sales → 12.5, 100 → 24.
  TRACK_MAX: 25,
  TRACK_LOG_COEF: 12,
  TRACK_WINDOW_DAYS: 365, // trailing year — a dormant shop's record fades from T naturally

  // ── C · Conduct (0–90): Σ severity × reporterCredibility × decay ──
  CONDUCT_MAX: 90,
  SEVERITY_WEIGHT: { minor: 5, moderate: 18, severe: 45 } as Record<ReportSeverity, number>,
  // Per-class exponential decay half-lives: minor fades in ~3 months, moderate ~1yr.
  DECAY_HALF_LIFE_DAYS: { minor: 45, moderate: 180, severe: 365 } as Record<ReportSeverity, number>,
  // Scam (severe) decay is FROZEN at 100% until ≥ SCAM_CLEAN_TX verified clean
  // transactions AFTER the event — reform requires behavior, not patience
  // (Friedman–Resnick dues-paying) — then decays with H=365 to a permanent floor.
  SCAM_CLEAN_TX: 5,
  SCAM_FLOOR: 0.4, // a confirmed scam NEVER fully disappears

  // Remediation (Amazon pattern): a confirmed report the seller demonstrably FIXED
  // (admin sets Report.remediatedAt) keeps its record but counts at half weight.
  REMEDIATION_FACTOR: 0.5,

  // Admin manual_adjust ledger events (incl. false-report strikes) decay with H=365.
  MANUAL_HALF_LIFE_DAYS: 365,

  // ── Source credibility (mini-EigenTrust, centralized) — weights reviews AND reports ──
  CRED_FULL: 1.0, // trust ≥ 85 ∧ (KYC ∨ age ≥ 180d)
  CRED_DEFAULT: 0.6, // age ≥ 30d ∧ no strikes (also the fallback when the author is unreachable)
  CRED_LOW: 0.25, // everyone else — day-old burners can't mint/destroy reputation
  CRED_FULL_TRUST: 85,
  CRED_FULL_AGE_DAYS: 180,
  CRED_DEFAULT_AGE_DAYS: 30,
  CRED_STRIKE_FACTOR: 0.5, // ×0.5 per confirmed-false-report strike…
  CRED_FLOOR: 0.1, // …down to this floor

  // ── Anti-gaming rails ──
  DAILY_POSITIVE_CAP: 6, // max upward score movement per rolling 24h (verification one-times exempt)

  // ── Tier gates (volume-gated, cadenced) ──
  TIER: {
    TRUSTED_SCORE: 85,
    TRUSTED_TX: 3, // ≥3 completed transactions (trailing 365d)
    TRUSTED_AGE_DAYS: 60, // … ∧ (≥60d age ∨ ≥3 distinct-buyer verified reviews)
    TRUSTED_ALT_REVIEWS: 3,
    TRUSTED_CLEAN_DAYS: 90, // no DEMOTING confirmed report in this window
    EXCEPTIONAL_SCORE: 110,
    EXCEPTIONAL_TX: 10,
    EXCEPTIONAL_REVIEWS: 5, // distinct-buyer verified reviews
    EXCEPTIONAL_CLEAN_DAYS: 180,
    EXCEPTIONAL_WILSON: 0.85, // needs ~10 perfect-reply conversations at z=1.28
    // eBay dual-threshold demotion: reports only demote when the RATE is bad AND
    // the signal is corroborated — one hostile buyer can never sink a seller alone.
    DEMOTE_RATE: 0.02, // confirmed reports > 2% of transactions…
    DEMOTE_MIN_REPORTERS: 2, // …from ≥2 DISTINCT reporters (any confirmed scam bypasses)
  },
} as const

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * IMDb-style Bayesian-adjusted mean: m phantom votes at the platform prior pull
 * small samples toward the mean, so a tiny perfect record can't outrank a long
 * near-perfect one. `weightedSum` = Σ wᵢ·ratingᵢ and `weightN` = Σ wᵢ (credibility
 * weights), the weighted generalization of (m·C + Σr)/(m + n).
 */
export function bayesianRating(
  weightedSum: number,
  weightN: number,
  prior: number = TRUST.REVIEW_PRIOR_MEAN,
  m: number = TRUST.REVIEW_PRIOR_WEIGHT,
): number {
  return (m * prior + weightedSum) / (m + weightN)
}

/**
 * Review contribution (0–25): Bayesian-adjusted mean mapped through the quality
 * band [3.5..5.0], then ramped by effective volume (min(1, n_eff/5)) so the first
 * few reviews can't max the component. Reviews arrive pre-weighted by author
 * credibility (see credibilityWeight) and pre-deduped (see dedupeReviewPairs).
 */
export function reviewScore(reviews: ReadonlyArray<{ rating: number; weight: number }>): number {
  let weightedSum = 0
  let weightN = 0
  for (const r of reviews) {
    weightedSum += r.weight * r.rating
    weightN += r.weight
  }
  if (weightN <= 0) return 0
  const adj = bayesianRating(weightedSum, weightN)
  const quality = clamp01((adj - TRUST.REVIEW_FLOOR) / TRUST.REVIEW_SPAN)
  const volume = Math.min(1, weightN / TRUST.REVIEW_SATURATION)
  return TRUST.REVIEW_MAX * quality * volume
}

/**
 * Wilson score interval lower bound — the pessimistic "true rate is at least this"
 * estimate. n=0 → 0 (no evidence, no credit). z=1.28 ≈ 80% one-sided confidence:
 * 3/3 lower-bounds to ~0.65 while 285/300 lower-bounds to ~0.93.
 */
export function wilsonLowerBound(successes: number, n: number, z: number = TRUST.WILSON_Z): number {
  if (n <= 0) return 0
  const p = Math.min(1, Math.max(0, successes / n))
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = p + z2 / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return Math.max(0, (center - margin) / denom)
}

/** Responsiveness (0–10): the Wilson lower bound scaled onto the component. */
export function responseScore(wilson: number): number {
  return TRUST.RESPONSE_MAX * clamp01(wilson)
}

/**
 * Availability freshness (0–5): share of ACTIVE listings confirmed within 14d.
 * No active listings → full marks (nothing is stale; a sold-out shop isn't punished).
 */
export function freshnessScore(freshActive: number, totalActive: number): number {
  if (totalActive <= 0) return TRUST.FRESH_MAX
  return TRUST.FRESH_MAX * clamp01(freshActive / totalActive)
}

/** V · Verification (0–25): phone +10 · business KYC +10 · account age ≥90d +5. */
export function verificationScore(v: { phoneVerified: boolean; kycVerified: boolean; accountAgeDays: number }): number {
  return (
    (v.phoneVerified ? TRUST.V_PHONE : 0) +
    (v.kycVerified ? TRUST.V_KYC : 0) +
    (v.accountAgeDays >= TRUST.V_AGE_DAYS ? TRUST.V_AGE : 0)
  )
}

/**
 * T · Track record (0–25): 12·log10(1 + tx365), capped — log-diminishing so
 * reputation can't be bulk-bought (10 sales → 12.5, 100 → 24, 200 → capped).
 */
export function trackRecordScore(tx365: number): number {
  return Math.min(TRUST.TRACK_MAX, TRUST.TRACK_LOG_COEF * Math.log10(1 + Math.max(0, tx365)))
}

/**
 * Source credibility (mini-EigenTrust): how much this author's reviews/reports count.
 * High-standing verified accounts speak at full weight; young/unproven at 0.25 —
 * a day-old burner can neither mint nor destroy reputation. Confirmed-false-report
 * strikes halve it (floor 0.1). When the author is unreachable use CRED_DEFAULT (0.6).
 */
export function credibilityWeight(a: {
  trustScore: number
  accountAgeDays: number
  falseReportStrikes: number
  kycVerified: boolean
}): number {
  let base: number
  if (a.trustScore >= TRUST.CRED_FULL_TRUST && (a.kycVerified || a.accountAgeDays >= TRUST.CRED_FULL_AGE_DAYS)) {
    base = TRUST.CRED_FULL
  } else if (a.accountAgeDays >= TRUST.CRED_DEFAULT_AGE_DAYS && a.falseReportStrikes === 0) {
    base = TRUST.CRED_DEFAULT
  } else {
    base = TRUST.CRED_LOW
  }
  const struck = base * Math.pow(TRUST.CRED_STRIKE_FACTOR, Math.max(0, a.falseReportStrikes))
  return Math.max(TRUST.CRED_FLOOR, struck)
}

/**
 * Per-class penalty decay. minor: 2^(−age/45d) (gone in ~3 months) · moderate:
 * 2^(−age/180d) (~1 yr) · severe (scam): FROZEN at 100% until ≥5 verified clean
 * transactions AFTER the event, then 2^(−ageSinceFifthCleanTx/365d) down to a
 * permanent 40% floor — time alone never launders fraud (Friedman–Resnick).
 */
export function decayFactor(
  severity: ReportSeverity,
  ageDays: number,
  scam?: { cleanTxAfter: number; daysSinceFifthCleanTx: number | null },
): number {
  const age = Math.max(0, ageDays)
  if (severity !== 'severe') {
    return Math.pow(2, -age / TRUST.DECAY_HALF_LIFE_DAYS[severity])
  }
  const cleanTx = scam?.cleanTxAfter ?? 0
  if (cleanTx < TRUST.SCAM_CLEAN_TX || scam?.daysSinceFifthCleanTx == null) return 1 // frozen — dues not paid
  const sinceFifth = Math.max(0, scam.daysSinceFifthCleanTx)
  return Math.max(TRUST.SCAM_FLOOR, Math.pow(2, -sinceFifth / TRUST.DECAY_HALF_LIFE_DAYS.severe))
}

export type ConductItem = {
  severity: ReportSeverity
  credibility: number // reporter credibilityWeight (0.1–1.0)
  ageDays: number // days since the report was CONFIRMED
  // severe only — the frozen-scam rule inputs:
  cleanTxAfter?: number
  daysSinceFifthCleanTx?: number | null
}

/** C · Conduct (0–90): Σ over admin-confirmed reports of sev × cred × decay. */
export function conductPenalty(items: ReadonlyArray<ConductItem>): number {
  let sum = 0
  for (const it of items) {
    sum +=
      TRUST.SEVERITY_WEIGHT[it.severity] *
      it.credibility *
      decayFactor(it.severity, it.ageDays, { cleanTxAfter: it.cleanTxAfter ?? 0, daysSinceFifthCleanTx: it.daysSinceFifthCleanTx ?? null })
  }
  return Math.min(TRUST.CONDUCT_MAX, sum)
}

/** Signed decayed sum of admin manual adjustments (H=365) — audit-ledger residue. */
export function manualAdjustSum(items: ReadonlyArray<{ delta: number; ageDays: number }>): number {
  let sum = 0
  for (const it of items) sum += it.delta * Math.pow(2, -Math.max(0, it.ageDays) / TRUST.MANUAL_HALF_LIFE_DAYS)
  return sum
}

/** The composite: clamp(0, 150, 60 + V + Q + T − C + M). Integer (Profile.trustScore is Int). */
export function composeScore(parts: { V: number; Q: number; T: number; C: number; M?: number }): number {
  const raw = TRUST.BASE + parts.V + parts.Q + parts.T - parts.C + (parts.M ?? 0)
  return Math.round(Math.min(TRUST.MAX, Math.max(0, raw)))
}

/**
 * Anti-gaming daily cap: upward movement is limited to +6 per rolling 24h
 * (verification one-times exempt — handled by the caller passing uncapped).
 * Downward movement is NEVER capped — penalties bite immediately (asymmetry by
 * design: trust is slow to earn, fast to lose). Returns the persisted score and
 * the lift actually granted (ledgered for the rolling-window accounting).
 */
export function applyDailyCap(current: number, target: number, liftedInLast24h: number): { score: number; lift: number } {
  if (target <= current) return { score: target, lift: 0 }
  const allowance = Math.max(0, TRUST.DAILY_POSITIVE_CAP - Math.max(0, liftedInLast24h))
  const score = Math.min(target, current + allowance)
  return { score, lift: score - current }
}

/** One report window's demotion inputs (confirmed reports inside the window). */
export type ReportWindow = {
  count: number // confirmed reports in the window
  distinctReporters: number
  scams: number // confirmed SEVERE reports in the window
}

/**
 * eBay dual-threshold demotion: reports pull a tier down only when the rate is
 * bad (>2% of transactions) AND corroborated (≥2 distinct reporters) — OR any
 * confirmed scam. A single hostile buyer can never sink a seller alone.
 */
export function reportsDemote(w: ReportWindow, transactions: number): boolean {
  if (w.scams > 0) return true
  if (w.count <= 0) return false
  const rate = w.count / Math.max(1, transactions)
  return w.distinctReporters >= TRUST.TIER.DEMOTE_MIN_REPORTERS && rate > TRUST.TIER.DEMOTE_RATE
}

export type TierInputs = {
  score: number
  transactions365: number // completed transactions in the trailing year (same window as T)
  accountAgeDays: number
  distinctBuyerReviews: number // distinct buyers with VERIFIED reviews (conversation-backed)
  responseWilson: number // Wilson lower bound on replied-within-24h (0..1)
  reports90: ReportWindow // confirmed reports in the last 90d
  reports180: ReportWindow // …and 180d (Exceptional's clean window)
  hasScamHold: boolean // a confirmed scam still FROZEN (dues unpaid) → hard Restricted
}

/**
 * Tier decision v2 — volume-gated so tiers certify a track record, not just a
 * number: Restricted <60 or an active scam hold · Building 60–84 OR <3 transactions
 * (neutral probation — caps, not shame) · Trusted ≥85 ∧ ≥3 tx ∧ (≥60d ∨ ≥3
 * distinct-buyer reviews) ∧ clean 90d · Exceptional ≥110 ∧ ≥10 tx ∧ ≥5 reviews ∧
 * clean 180d ∧ Wilson ≥0.85. Clean-window blocks obey the dual-threshold rule.
 * (The 160+ "Elite" flourish in trust-score.ts is a display band on the same scale.)
 */
export function tierFor(i: TierInputs): TrustTier {
  if (i.score < 60 || i.hasScamHold) return 'restricted'
  const T = TRUST.TIER
  if (
    i.score >= T.EXCEPTIONAL_SCORE &&
    i.transactions365 >= T.EXCEPTIONAL_TX &&
    i.distinctBuyerReviews >= T.EXCEPTIONAL_REVIEWS &&
    i.responseWilson >= T.EXCEPTIONAL_WILSON &&
    !reportsDemote(i.reports180, i.transactions365)
  ) {
    return 'exceptional'
  }
  if (
    i.score >= T.TRUSTED_SCORE &&
    i.transactions365 >= T.TRUSTED_TX &&
    (i.accountAgeDays >= T.TRUSTED_AGE_DAYS || i.distinctBuyerReviews >= T.TRUSTED_ALT_REVIEWS) &&
    !reportsDemote(i.reports90, i.transactions365)
  ) {
    return 'trusted'
  }
  return 'standard'
}

/**
 * One COUNTED review per buyer→seller pair per 90d (anti-collusion: a friendly
 * account re-reviewing weekly counts once a quarter). Deterministic: process each
 * author's reviews oldest-first; keep one, skip anything within 90d of the last
 * KEPT one. Authorless (legacy) reviews are excluded upstream (verified-only).
 */
export function dedupeReviewPairs<T extends { authorId: string; createdAtMs: number }>(reviews: ReadonlyArray<T>): T[] {
  const byAuthor = new Map<string, T[]>()
  for (const r of reviews) {
    const list = byAuthor.get(r.authorId)
    if (list) list.push(r)
    else byAuthor.set(r.authorId, [r])
  }
  const kept: T[] = []
  const windowMs = TRUST.REVIEW_PAIR_DEDUP_DAYS * DAY_MS
  for (const list of byAuthor.values()) {
    list.sort((a, b) => a.createdAtMs - b.createdAtMs)
    let lastKept = -Infinity
    for (const r of list) {
      if (r.createdAtMs - lastKept >= windowMs) {
        kept.push(r)
        lastKept = r.createdAtMs
      }
    }
  }
  return kept
}

/**
 * Map a legacy v1 ledger delta to a severity when the linked Report row is
 * unreachable (v1 penalties were −3/−10/−25; v2 writes −5/−18/−45).
 */
export function severityFromDelta(delta: number): ReportSeverity {
  const mag = Math.abs(delta)
  if (mag >= 25) return 'severe'
  if (mag >= 10) return 'moderate'
  return 'minor'
}
