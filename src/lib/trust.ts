import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from './db'
import { recomputeRankScoreForSeller } from './ranking'
import { RESPONSE_METRIC_IS_REAL } from './seller-metrics'
import { ENFORCEMENT_REASON, VELOCITY, velocitySpike } from './enforcement-machine'
import { expireEnforcement, flagForReview, syncEnforcement } from './enforcement'
import {
  CHARGE_REVERSAL_PREFIX,
  DAY_MS,
  TRUST,
  applyDailyCap,
  composeScore,
  conductPenalty,
  credibilityWeight,
  dedupeReviewPairs,
  freshnessScore,
  GUEST_SELLER_TRUST,
  manualAdjustSum,
  reportClearsCharge,
  responseScore,
  reviewScore,
  saleTimeMs,
  scamChargeKey,
  scamReleaseMarkers,
  scamStage,
  severityFromDelta,
  SCAM_RELEASE_PREFIX,
  standingConductEvents,
  tierFor,
  trackRecordScore,
  verificationScore,
  wilsonLowerBound,
  type ConductItem,
  type ReportSeverity,
  type ReportWindow,
  type ScamCharge,
  type TierInputs,
  type TrustTier,
} from './trust-math'

/**
 * Trust & Reputation engine v2 — the single public trust signal (a color-coded score).
 *
 * v2 (design: .claude/plans/eno-trust-v2.md) replaces the v1 lifetime additive sum
 * with a WINDOWED, DECAYED composite recomputed from source tables:
 *
 *   score = clamp(0, 150, 60 + V + Q + T − C)
 *
 *  • V Verification (0–25): permanent one-time gates — phone +10 · KYC +10 · age≥90d +5.
 *  • Q Quality (0–40): Bayesian-smoothed verified reviews (IMDb, m=5 prior 4.6) +
 *    Wilson-lower-bound responsiveness (z=1.28, 90d) + availability freshness (<14d).
 *  • T Track record (0–25): 12·log10(1+tx) over the trailing 365d — log-diminishing
 *    so reputation can't be bulk-bought.
 *  • C Conduct (0–90): admin-CONFIRMED reports, severity × reporter-credibility ×
 *    per-class decay — and a confirmed scam's decay stays FROZEN (Friedman–Resnick: time
 *    alone never launders fraud). The scam HOLD it causes ends only by a human: a reversal
 *    (won appeal / overturn) or an admin release marker (scamStage, trust-math.ts).
 *
 * The TrustEvent LEDGER stays the audit trail (report resolutions, manual adjusts,
 * one-time verification lifts all still write events) — but the score is no longer
 * Σdeltas: the recompute READS the source tables + the decayed ledger. There is NO
 * calendar drift: no +1/day recovery, no inactivity dock — decay + shifting windows
 * keep scores current, and staleness costs the freshness component endogenously.
 *
 * Tiers are VOLUME-GATED (a badge certifies a track record, not a number) with
 * eBay-style dual-threshold demotion — one hostile buyer can never sink a seller.
 * All math is pure in src/lib/trust-math.ts (unit-tested; mirrored in the
 * scripts/trust-v2-*.mjs migration scripts).
 */

export type { TrustTier } from './trust-math'
export { tierFor, TRUST } from './trust-math'

// v2 nominal severity weights — also the ledger delta magnitude written on confirm
// (audit only; the recompute re-derives the decayed, credibility-weighted penalty
// from the Report row). scam 45 · misrepresentation 18 · minor 5.
export const SEVERITY_PENALTY: Record<ReportSeverity, number> = TRUST.SEVERITY_WEIGHT

// Penalty applied to a REPORTER whose report an admin marks abusive/false
// (a manual_adjust ledger event → decays with H=365 in the composite; the strike
// itself also halves the reporter's source credibility — the harsher, lasting cost).
export const FALSE_REPORT_PENALTY = 10
export const REPORT_COOLDOWN_DAYS = 14

// v2 baseline: every account starts at 60 (Building — neutral probation, not shame)
// and verification lifts it: phone +10, business KYC +10 (age≥90d adds +5 later).
export const BASE_SCORE = TRUST.BASE
export const PHONE_VERIFIED_BONUS = TRUST.V_PHONE
export const KYC_BONUS = TRUST.V_KYC

// Reasons that must apply AT MOST ONCE per account. The DB partial unique index on
// (subjectProfileId, reason) for these reasons is the belt; this set is the suspenders
// AND the daily-cap exemption list (verification one-times lift the score immediately).
// zalo_linked / profile_complete are kept for audit but no longer score (v2's V counts
// phone / KYC / age only — spec'd 0–25).
const ONE_TIME_REASONS = new Set(['new_account', 'phone_verified', 'zalo_linked', 'kyc', 'profile_complete'])

const isUniqueViolation = (e: unknown): boolean =>
  !!(e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002')

// Apply a one-time event; if the partial unique index rejects it as a duplicate
// (the race the count-check can't fully close), treat it as already-applied.
async function applyOnce(profileId: string, type: Parameters<typeof applyTrustEvent>[1], delta: number, reason: string): Promise<boolean> {
  try {
    await applyTrustEvent(profileId, type, delta, { reason })
    return true
  } catch (e) {
    if (isUniqueViolation(e)) return false
    throw e
  }
}

// Daily engagement ledger event (availability confirms). Informational in v2 —
// freshness is scored endogenously from Listing.availabilityConfirmedAt — but the
// event still triggers a recompute so the freshness gain lands immediately.
export const ENGAGEMENT_DAILY_CAP = 1 // at most one engagement event per account per day

/** Map a report reason to a default severity (admin can override on confirm). */
export function severityForReason(reason: string): ReportSeverity {
  if (reason === 'scam' || reason === 'counterfeit') return 'severe'
  if (reason === 'wrong-info' || reason === 'offensive' || reason === 'misrepresentation') return 'moderate'
  return 'minor'
}

// ── The v2 composite recompute ─────────────────────────────────────────────────────

export type TrustBreakdown = {
  score: number // the UNCAPPED composite (recomputeTrust applies the daily cap on persist)
  V: number
  Q: number
  T: number
  C: number
  M: number // decayed admin manual adjustments (signed)
  inputs: TierInputs & {
    phoneVerified: boolean
    kycVerified: boolean
    verifiedReviewCount: number
    /**
     * Every STANDING severe charge and whether a human has released it — the same derivation that
     * sets hasScamHold, exposed so the admin release/overturn (src/lib/scam-hold.ts) act on exactly
     * the charges holding the account rather than re-deriving them a second way.
     */
    scamCharges: ScamCharge[]
    conversations90: number
    activeListings: number
    freshActiveListings: number
    // Phase 3 velocity-detector counts — derived from data this recompute already
    // loaded (zero extra queries); runTrustMaintenance feeds them to velocitySpike.
    velocity: { reviews24h: number; reviews30d: number; tx24h: number; tx30d: number }
  }
  cached: { score: number; tier: string } // current Profile values (pre-recompute)
}

/** Author standing for credibility weighting — batched fetch, 0.6 when unreachable. */
async function credibilityByProfileId(ids: string[], now: number): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!ids.length) return map
  const [profiles, kycEvents] = await Promise.all([
    db.profile.findMany({
      where: { id: { in: ids } },
      select: { id: true, trustScore: true, createdAt: true, falseReportStrikes: true },
    }),
    db.trustEvent.findMany({
      where: { subjectProfileId: { in: ids }, reason: 'kyc' },
      select: { subjectProfileId: true },
    }),
  ])
  const kyc = new Set(kycEvents.map((e) => e.subjectProfileId))
  for (const p of profiles) {
    map.set(
      p.id,
      credibilityWeight({
        trustScore: p.trustScore,
        accountAgeDays: (now - p.createdAt.getTime()) / DAY_MS,
        falseReportStrikes: p.falseReportStrikes,
        kycVerified: kyc.has(p.id),
      }),
    )
  }
  return map
}

/**
 * Compute the full v2 breakdown for a profile from source tables + the decayed
 * ledger. A BOUNDED number of indexed queries (~10): profile + its events (PK /
 * subjectProfileId index), the linked Reports (PK), the owned Seller (ownerId
 * unique), its verified Reviews / Conversations / Listings (sellerId indexes),
 * transactions (sellerId+status / conversation join), and two batched
 * author-credibility lookups. Also feeds the dashboard's tier-progress panel.
 */
export async function computeTrustV2(profileId: string): Promise<TrustBreakdown | null> {
  const now = Date.now()
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: { createdAt: true, phone: true, trustScore: true, trustTier: true },
  })
  if (!profile) return null
  const accountAgeDays = (now - profile.createdAt.getTime()) / DAY_MS

  // Ledger reads: conduct events + manual adjustments + one-time verification gates.
  // report_dismissed rides along for the charge-REVERSAL markers only (standingConductEvents).
  const events = await db.trustEvent.findMany({
    where: { subjectProfileId: profileId, type: { in: ['report_confirmed', 'manual_adjust', 'report_dismissed'] } },
    select: { id: true, type: true, delta: true, reason: true, reportId: true, createdAt: true },
  })

  // V — permanent verification gates. Phone: the mirrored verified number OR the
  // one-time event (covers a number later released); KYC: the one-time event.
  const phoneVerified = !!profile.phone || events.some((e) => e.reason === 'phone_verified')
  const kycVerified = events.some((e) => e.reason === 'kyc')
  const V = verificationScore({ phoneVerified, kycVerified, accountAgeDays })

  // Conduct events → join Report for severity + reporter identity. Legacy events
  // without a reachable Report fall back to severityFromDelta + default credibility.
  const conductEvents = events.filter((e) => e.type === 'report_confirmed')
  const reportIds = conductEvents.map((e) => e.reportId).filter((x): x is string => !!x)
  const reports = reportIds.length
    ? await db.report.findMany({
        where: { id: { in: reportIds } },
        select: { id: true, severity: true, reporterProfileId: true, status: true, resolvedBy: true, remediatedAt: true },
      })
    : []
  const reportById = new Map(reports.map((r) => [r.id, r]))

  // Symmetric protection (eBay purge): a report OVERTURNED after its reporter was
  // struck no longer counts anywhere — conduct, the demote windows, and the scam
  // freeze all read only still-standing confirmations. Legacy events without a
  // reachable Report keep counting (fail-safe toward caution).
  //
  // ⚠️ NOT ONLY 'overturned' (audit 2026-09-23, #15). An appeal re-opens the SAME
  // confirmed report; a WON appeal resolves it 'dismissed'/'abusive', and only filtering
  // 'overturned' kept the full penalty (and the enforcement it drove) on a report the
  // platform had just ruled was no violation. A LOST appeal re-confirms it and writes a
  // second report_confirmed event, which double-charged — so events are also deduped by
  // reportId (earliest kept). While the appeal is merely OPEN the penalty still stands.
  // A reversal is ALSO recorded in the ledger (a report_dismissed marker, written by
  // recordChargeReversals), because the Report row can be cascade-deleted with its listing and
  // its status would then be unreadable. The rules live in standingConductEvents (trust-math.ts,
  // unit-tested).
  const reversedAt = new Map<string, number>()
  for (const e of events) {
    if (e.type !== 'report_dismissed' || !e.reportId || !e.reason?.startsWith(CHARGE_REVERSAL_PREFIX)) continue
    reversedAt.set(e.reportId, Math.max(reversedAt.get(e.reportId) ?? 0, e.createdAt.getTime()))
  }
  const standingConduct = standingConductEvents(conductEvents, {
    report: (id) => reportById.get(id),
    reversedAtMs: (id) => reversedAt.get(id),
  })
  // Admin RELEASE markers (scam_release:<chargeKey>) — the only non-reversal way a scam hold ends.
  const releasedAt = scamReleaseMarkers(events)

  // Remediation (Amazon): a remediated report's conduct weight is halved — read off
  // the typed Report rows fetched above (the column went live with add-enforcement.mjs).
  const remediated = new Set(reports.filter((r) => r.remediatedAt !== null).map((r) => r.id))

  const seller = await db.seller.findUnique({
    where: { ownerId: profileId },
    select: { id: true, responseRate: true, responseMetricAt: true },
  })

  // Seller-side source data (Q + T + tier volumes). Buyer-only profiles skip all of it.
  let reviewsRaw: { rating: number; authorProfileId: string | null; createdAt: Date }[] = []
  let conversations90 = 0
  let activeListings = 0
  let freshActiveListings = 0
  // Transaction = a sold listing OR a conversation with an accepted offer, unioned by
  // listing so a sold listing whose thread also had an accepted offer counts once.
  // Timing: sold → Listing.soldAt, falling back to updatedAt only for sold rows with no
  // soldAt (saleTimeMs — see why in trust-math.ts); accepted offer → the offer Message's
  // createdAt.
  const txByListing = new Map<string, number>() // listingId → earliest transaction ms

  if (seller) {
    // Transactions feed T (the trailing year) and velocity only. They used to reach back past the
    // window to the oldest severe event, because "5 clean transactions after the scam" ended the
    // hold; a self-marked sale no longer ends anything (scamStage), so the window is just T's.
    const txSince = new Date(now - TRUST.TRACK_WINDOW_DAYS * DAY_MS)
    const freshCutoff = new Date(now - TRUST.FRESH_DAYS * DAY_MS)

    const [reviews, convo90, active, fresh, sold, acceptedOffers] = await Promise.all([
      // Verified reviews only (conversation-backed) — Q reads the Review table
      // directly; legacy positive_review ledger deltas are excluded (no double count).
      db.review.findMany({
        where: { sellerId: seller.id, conversationId: { not: null }, authorProfileId: { not: null } },
        select: { rating: true, authorProfileId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 2000, // bounded; newest reviews are the ones that matter
      }),
      db.conversation.count({
        where: { sellerId: seller.id, createdAt: { gte: new Date(now - TRUST.RESPONSE_WINDOW_DAYS * DAY_MS) } },
      }),
      db.listing.count({ where: { sellerId: seller.id, status: 'active', verified: true } }),
      db.listing.count({
        where: {
          sellerId: seller.id,
          status: 'active',
          verified: true,
          OR: [{ availabilityConfirmedAt: { gte: freshCutoff } }, { availabilityConfirmedAt: null, postedAt: { gte: freshCutoff } }],
        },
      }),
      db.listing.findMany({
        // ⛔ NOT AFFILIATE/PARTNER LISTINGS: an imported shop's `sold` means "out of stock at the merchant"
        // (import-partners / the price refresh flip it both ways), never a sale made through eno — counting
        // them handed partner storefronts thousands of phantom transactions (audit, 2026-09-13).
        // Windowed on the SAME timestamp saleTimeMs reads: soldAt when set, updatedAt only
        // for the rows that have none.
        where: {
          sellerId: seller.id,
          status: 'sold',
          affiliateUrl: null,
          OR: [{ soldAt: { gte: txSince } }, { soldAt: null, updatedAt: { gte: txSince } }],
        },
        select: { id: true, soldAt: true, updatedAt: true },
        take: 5000,
      }),
      db.message.findMany({
        where: { kind: 'offer', offerStatus: 'accepted', createdAt: { gte: txSince }, conversation: { sellerId: seller.id } },
        select: { createdAt: true, conversation: { select: { listingId: true } } },
        take: 5000,
      }),
    ])
    reviewsRaw = reviews
    conversations90 = convo90
    activeListings = active
    freshActiveListings = fresh
    for (const l of sold) {
      const t = saleTimeMs(l)
      const prev = txByListing.get(l.id)
      if (prev === undefined || t < prev) txByListing.set(l.id, t)
    }
    for (const m of acceptedOffers) {
      // A support thread has no listing to key a transaction by, and cannot carry an accepted
      // offer in any case — skip rather than bucket it under a null key.
      if (!m.conversation.listingId) continue
      const t = m.createdAt.getTime()
      const prev = txByListing.get(m.conversation.listingId)
      if (prev === undefined || t < prev) txByListing.set(m.conversation.listingId, t)
    }
  }

  const txTimes = [...txByListing.values()].sort((a, b) => a - b)
  const tx365 = txTimes.filter((t) => t >= now - TRUST.TRACK_WINDOW_DAYS * DAY_MS).length

  // Phase 3 velocity-detector counts — RAW verified-review timestamps (pre-dedup: a
  // same-buyer burst IS the fraud signal the pair-dedup would mask) + the unioned
  // transaction times. Everything is already in memory — zero extra queries.
  const velocity = {
    reviews24h: reviewsRaw.filter((r) => r.createdAt.getTime() > now - DAY_MS).length,
    reviews30d: reviewsRaw.filter((r) => r.createdAt.getTime() > now - VELOCITY.WINDOW_DAYS * DAY_MS).length,
    tx24h: txTimes.filter((t) => t > now - DAY_MS).length,
    tx30d: txTimes.filter((t) => t > now - VELOCITY.WINDOW_DAYS * DAY_MS).length,
  }

  // Source credibility for BOTH reviewers and reporters — one batched lookup.
  const raterIds = [
    ...new Set([
      ...reviewsRaw.map((r) => r.authorProfileId).filter((x): x is string => !!x),
      ...reports.map((r) => r.reporterProfileId).filter((x): x is string => !!x),
    ]),
  ]
  const credibility = await credibilityByProfileId(raterIds, now)

  // Q · reviews — pair-dedup (one counted per buyer per 90d), credibility-weighted.
  const deduped = dedupeReviewPairs(
    reviewsRaw
      .filter((r) => r.authorProfileId)
      .map((r) => ({ authorId: r.authorProfileId as string, createdAtMs: r.createdAt.getTime(), rating: r.rating })),
  )
  const reviewsQ = reviewScore(
    deduped.map((r) => ({ rating: r.rating, weight: credibility.get(r.authorId) ?? TRUST.CRED_DEFAULT })),
  )

  // Q · responsiveness — Wilson lower bound over last-90d conversations. p̂ comes from
  // the denormalized Seller.responseRate (the app's replied-within-24h measure,
  // recomputed nightly by recomputeResponseRates()); n from the indexed Conversation
  // count. successes = round(p̂·n) — the closest fair approximation without a
  // per-message reply scan.
  // HONESTY GATE, row-level: a seller the nightly job has never written (n<5 at every
  // run) still holds the fabricated =100 DEFAULT in responseRate — and the Wilson
  // bound does NOT neutralize small n (wilsonLowerBound(3,3) ≈ 0.65, not ~0). Only a
  // non-null responseMetricAt (the job's write receipt) proves the number was
  // measured; without it the whole term stays zero. Same receipt gates the display
  // bucket (seller-metrics.ts) so trust and display can never disagree about whether
  // the metric is real.
  const responseIsMeasured = RESPONSE_METRIC_IS_REAL && !!seller?.responseMetricAt
  const responseWilson = seller && responseIsMeasured ? wilsonLowerBound(Math.round(((seller.responseRate ?? 0) / 100) * conversations90), conversations90) : 0
  const responseQ = responseIsMeasured ? responseScore(responseWilson) : 0

  // Q · availability freshness.
  const freshQ = freshnessScore(freshActiveListings, activeListings)
  const Q = reviewsQ + responseQ + freshQ

  const T = trackRecordScore(tx365)

  // C · conduct — severity × reporter credibility × per-class decay (+ frozen-scam rule).
  let hasScamHold = false
  const scamCharges: ScamCharge[] = []
  const win90: ReportWindow = { count: 0, distinctReporters: 0, scams: 0 }
  const win180: ReportWindow = { count: 0, distinctReporters: 0, scams: 0 }
  const reporters90 = new Set<string>()
  const reporters180 = new Set<string>()
  const conductItems: ConductItem[] = standingConduct.map((e) => {
    const report = e.reportId ? reportById.get(e.reportId) : undefined
    const severity = ((report?.severity as ReportSeverity | undefined) ?? severityFromDelta(e.delta))
    // Reporter unreachable (guest/legacy/deleted) → default credibility 0.6 (fair middle).
    let cred = report?.reporterProfileId ? (credibility.get(report.reporterProfileId) ?? TRUST.CRED_DEFAULT) : TRUST.CRED_DEFAULT
    // Remediated (seller demonstrably fixed it) → the event stays on record at half weight.
    if (e.reportId && remediated.has(e.reportId)) cred *= TRUST.REMEDIATION_FACTOR
    const eventMs = e.createdAt.getTime()
    const ageDays = (now - eventMs) / DAY_MS
    // Frozen-scam rule: the hold ends only when a HUMAN ends it (scamStage — a release marker; a
    // reversal never reaches here), and the charge stays at full weight either way — the dues-paid
    // anchor (buyer-confirmed graduation) is not built, so daysSinceDuesPaid is always null.
    // ⛔ txTimes is NOT consulted: sales the seller marks themselves were the old exit.
    if (severity === 'severe') {
      const key = scamChargeKey(e)
      const stage = scamStage(eventMs, releasedAt.get(key))
      scamCharges.push({ key, reportId: e.reportId, confirmedAtMs: eventMs, stage })
      if (stage === 'held') hasScamHold = true // unreleased → hard Restricted hold
    }
    // Dual-threshold demotion windows (distinct reporters; unknown reporter = its
    // own identity via the report/event id so pile-ons without accounts still count).
    const reporterKey = report?.reporterProfileId ?? `anon:${e.reportId ?? eventMs}`
    if (ageDays <= 90) {
      win90.count++
      reporters90.add(reporterKey)
      if (severity === 'severe') win90.scams++
    }
    if (ageDays <= 180) {
      win180.count++
      reporters180.add(reporterKey)
      if (severity === 'severe') win180.scams++
    }
    return { severity, credibility: cred, ageDays, daysSinceDuesPaid: null }
  })
  win90.distinctReporters = reporters90.size
  win180.distinctReporters = reporters180.size
  const C = conductPenalty(conductItems)

  // M · admin manual adjustments (e.g. the −10 false-report penalty), H=365 decay.
  // One-time verification reasons are EXCLUDED (they're V's domain — and the legacy
  // v1 baseline events like new_account −40 must not leak into the composite).
  const M = manualAdjustSum(
    events
      .filter((e) => e.type === 'manual_adjust' && !(e.reason && ONE_TIME_REASONS.has(e.reason)))
      .map((e) => ({ delta: e.delta, ageDays: (now - e.createdAt.getTime()) / DAY_MS })),
  )

  const score = composeScore({ V, Q, T, C, M })
  const inputs: TrustBreakdown['inputs'] = {
    score,
    transactions365: tx365,
    accountAgeDays,
    distinctBuyerReviews: new Set(deduped.map((r) => r.authorId)).size,
    responseWilson,
    reports90: win90,
    reports180: win180,
    hasScamHold,
    phoneVerified,
    kycVerified,
    verifiedReviewCount: deduped.length,
    scamCharges,
    conversations90,
    activeListings,
    freshActiveListings,
    velocity,
  }
  // No `tier` here on purpose: recomputeTrust derives the tier from the PERSISTED
  // (possibly daily-capped) score — keeping it the single tier authority.
  return { score, V, Q, T, C, M, inputs, cached: { score: profile.trustScore, tier: profile.trustTier } }
}

/**
 * Recompute the cached score+tier on the Profile and mirror onto its Seller +
 * listings. Applies the anti-gaming daily cap: upward movement is limited to +6
 * per rolling 24h (ledgered as recompute_lift events for airtight accounting) —
 * EXCEPT one-time verification lifts (`uncapped`), which land immediately.
 * Downward movement always lands in full (penalties bite immediately).
 */
export async function recomputeTrust(
  profileId: string,
  opts?: { uncapped?: boolean },
): Promise<{ score: number; tier: TrustTier; breakdown: TrustBreakdown } | null> {
  const breakdown = await computeTrustV2(profileId)
  if (!breakdown) return null

  let score = breakdown.score
  if (!opts?.uncapped && score > breakdown.cached.score) {
    // Rolling-24h lift already granted — the ledger is the accounting, so a burst
    // of recomputes (many events in one day) can't stack past the cap.
    const lifted = await db.trustEvent.aggregate({
      where: { subjectProfileId: profileId, type: 'recompute_lift', createdAt: { gt: new Date(Date.now() - DAY_MS) } },
      _sum: { delta: true },
    })
    const capped = applyDailyCap(breakdown.cached.score, score, lifted._sum.delta ?? 0)
    score = capped.score
    if (capped.lift > 0) {
      await db.trustEvent.create({
        data: { subjectProfileId: profileId, type: 'recompute_lift', delta: capped.lift, reason: 'daily_cap' },
      })
    }
  }
  // Tier keys off the PERSISTED (possibly capped) score so display stays consistent.
  const tier = tierFor({ ...breakdown.inputs, score })

  // Good-standing insurance clock (enforcement Phase 2): an unbroken ≥85 streak.
  // ≥85 starts it (only if not already running — the WHERE keeps it a no-write no-op),
  // <85 resets it. Runs BEFORE the no-change early return so already-≥85 profiles
  // still get their clock maintained by the daily pass.
  if (score >= TRUST.TIER.TRUSTED_SCORE) {
    await db.profile.updateMany({ where: { id: profileId, goodStandingSince: null }, data: { goodStandingSince: new Date() } })
  } else {
    await db.profile.updateMany({ where: { id: profileId, goodStandingSince: { not: null } }, data: { goodStandingSince: null } })
  }

  // Profile unchanged → no Profile write (keeps the daily recompute-all pass cheap).
  if (score !== breakdown.cached.score || tier !== breakdown.cached.tier) {
    await db.profile.update({ where: { id: profileId }, data: { trustScore: score, trustTier: tier } })
  }

  // ⚠️ THE STOREFRONT MIRROR RUNS EVEN WHEN THE PROFILE DID NOT CHANGE (audit 2026-09-23, #13).
  // It used to sit behind the no-change early return, so it only ever fired on a PROFILE
  // score change — and Seller.trustScore carries a v1 @default(100). A storefront created
  // after its owner's score had settled (or any guest storefront later claimed) kept the
  // default forever: a brand-new shop wore a "100 Trusted" shield. Every write below is
  // GUARDED (only rows that differ), so an in-sync seller costs reads and no writes.
  const owned = await db.seller.findMany({ where: { ownerId: profileId }, select: { id: true, trustScore: true, trustTier: true } })
  if (owned.length) {
    const drifted = owned.filter((s) => s.trustScore !== score || s.trustTier !== tier).map((s) => s.id)
    if (drifted.length) {
      await db.seller.updateMany({
        where: { id: { in: drifted }, OR: [{ trustScore: { not: score } }, { trustTier: { not: tier } }] },
        data: { trustScore: score, trustTier: tier },
      })
    }
    // Cascade the score onto the listings' denormalized ranking key (the feed ORDER BY
    // reads it locally — no Seller join). Guarded and updatedAt-preserving; see
    // cascadeSellerTrustScore. Always run: listings created while the storefront sat at a
    // stale score carry that stale copy, and the guard makes the in-sync case a no-op.
    const ids = owned.map((s) => s.id)
    const touched = await cascadeSellerTrustScore(ids, score)
    // Re-blend the feed rankScore only when a ranking key actually moved (one SQL
    // UPDATE/seller; recency kept). rankScore reads sellerTrustScore alone, so a tier-only
    // change needs no re-rank.
    if (touched > 0) for (const id of ids) await recomputeRankScoreForSeller(id)
  }
  return { score, tier, breakdown }
}

/**
 * Write Listing.sellerTrustScore for these storefronts WITHOUT touching Listing.updatedAt.
 * Returns how many listings actually changed.
 *
 * ⛔ NEVER db.listing.updateMany HERE (audit 2026-09-23, #26). updatedAt is @updatedAt, so a
 * Prisma updateMany restamps it on EVERY matched row — sold ones included — and trust timed
 * sold listings by updatedAt. Every score change (e.g. the drop a confirmed scam report
 * causes) therefore made all of the seller's past sales look like they happened AFTER the
 * scam, which satisfied the "5 clean transactions after the event" rule within a day and
 * released the hard scam hold. Raw SQL is not seen by the @updatedAt middleware, and a
 * ranking-key mirror is not an edit to the listing anyway. IS DISTINCT FROM keeps an
 * in-sync seller write-free.
 */
export async function cascadeSellerTrustScore(sellerIds: string[], score: number): Promise<number> {
  if (!sellerIds.length) return 0
  return db.$executeRaw(
    Prisma.sql`UPDATE "Listing" SET "sellerTrustScore" = ${score} WHERE "sellerId" IN (${Prisma.join(sellerIds)}) AND "sellerTrustScore" IS DISTINCT FROM ${score}`,
  )
}

/**
 * The trust a NEW storefront starts with — its owner's CURRENT score/tier, or the guest
 * base (GUEST_SELLER_TRUST) when it has no owner or the owner row is gone. Every
 * db.seller.create spreads this in, because Seller.trustScore still defaults to the v1
 * 100 and changing a column default is production DDL. recomputeTrust's guarded mirror is
 * the backstop that re-syncs an owned storefront on the owner's next recompute.
 */
export async function initialSellerTrust(ownerId: string | null): Promise<{ trustScore: number; trustTier: string }> {
  if (!ownerId) return { ...GUEST_SELLER_TRUST }
  const p = await db.profile.findUnique({ where: { id: ownerId }, select: { trustScore: true, trustTier: true } })
  return p ? { trustScore: p.trustScore, trustTier: p.trustTier } : { ...GUEST_SELLER_TRUST }
}

/**
 * Write the ledger's own record that these reports' report_confirmed charges were REVERSED, and
 * return the profiles they had charged. `reports` must already be resolved not-a-violation.
 *
 * Why the ledger and not just Report.status: the Report row cascades away with its listing (a
 * seller deleting the listing, an admin reject), and TrustEvent.reportId has no FK — so once the
 * row was gone computeTrustV2 could no longer see the ruling and the charge (a scam hold
 * included) came back. The marker is type 'report_dismissed', delta 0 — the PDPL export already
 * describes that type truthfully ("A report against you was dismissed").
 */
export async function recordChargeReversals(
  reports: ReadonlyArray<{ id: string; targetProfileId: string | null; targetSellerId: string | null }>,
  why: 'appeal_won' | 'overturned',
  // A caller whose status change must land WITH its markers passes its transaction (the scam-hold
  // overturn): a reversed Report without a marker is exactly the state that resurrects the charge.
  client: Pick<typeof db, 'seller' | 'trustEvent'> = db,
): Promise<string[]> {
  if (!reports.length) return []
  // A storefront-only target's charge lands on the storefront's OWNER (penalizeSeller).
  const sellerIds = [...new Set(reports.map((r) => r.targetSellerId).filter((x): x is string => !!x))]
  const owners = sellerIds.length
    ? (await client.seller.findMany({ where: { id: { in: sellerIds } }, select: { ownerId: true } })).map((s) => s.ownerId)
    : []
  const candidates = [...new Set([...reports.map((r) => r.targetProfileId), ...owners].filter((x): x is string => !!x))]
  if (!candidates.length) return []
  // The ledger check rides the (subjectProfileId, createdAt) index — TrustEvent has no reportId index.
  const ledger = await client.trustEvent.findMany({
    where: { subjectProfileId: { in: candidates }, type: { in: ['report_confirmed', 'report_dismissed'] }, reportId: { in: reports.map((r) => r.id) } },
    select: { subjectProfileId: true, reportId: true, type: true, reason: true, createdAt: true },
  })
  const charged = ledger.filter((e) => e.type === 'report_confirmed')
  // ⚠️ ONE MARKER PER CHARGE, NOT PER CALL. The same won appeal can be settled twice (approve, then
  // dismiss-report on the same case), and every marker is a line in the user's PDPL export. A pair
  // is reversed again only when a charge LANDED AFTER its latest marker — a re-confirmation after
  // a reversal is a new charge, and it must still be reversible.
  const latest = new Map<string, { charge: number; marker: number }>()
  for (const e of ledger) {
    if (!e.reportId) continue
    const isMarker = e.type === 'report_dismissed'
    if (isMarker && !e.reason?.startsWith(CHARGE_REVERSAL_PREFIX)) continue
    const k = `${e.subjectProfileId}:${e.reportId}`
    const t = latest.get(k) ?? { charge: -Infinity, marker: -Infinity }
    if (isMarker) t.marker = Math.max(t.marker, e.createdAt.getTime())
    else t.charge = Math.max(t.charge, e.createdAt.getTime())
    latest.set(k, t)
  }
  const pairs = new Map<string, { subjectProfileId: string; reportId: string }>()
  for (const e of charged) {
    const k = `${e.subjectProfileId}:${e.reportId}`
    const t = latest.get(k)
    if (e.reportId && t && t.charge > t.marker) pairs.set(k, { subjectProfileId: e.subjectProfileId, reportId: e.reportId })
  }
  if (pairs.size) {
    await client.trustEvent.createMany({
      data: [...pairs.values()].map((p) => ({ ...p, type: 'report_dismissed', delta: 0, reason: `${CHARGE_REVERSAL_PREFIX}${why}` })),
    })
  }
  return [...new Set(charged.map((e) => e.subjectProfileId))]
}

/**
 * A report left 'open' (an appeal) was just resolved as NOT a violation (dismissed /
 * abusive) — record the reversal in the ledger and re-derive trust AND enforcement for whoever
 * that report had charged.
 *
 * computeTrustV2 already stops counting a report_confirmed event once its report is in a
 * not-confirmed status (standingConductEvents), but nothing re-reads the ledger until the
 * next event or the daily pass — and the enforcement the charge caused (a scam hold pulls
 * every listing) would sit for up to a day on a seller the platform had just cleared.
 * Uncapped, like the abusive-reporter purge: getting back what a wrong ruling took is not
 * "earning" (no +6/day wait). Returns how many profiles were re-derived.
 *
 * Cheap on ordinary dismissals: only APPEALED reports can carry a charge (a report is
 * confirmed → open only through the appeal route). A reporter's withdrawal is never a won
 * appeal (reportClearsCharge) — the withdraw route refuses appealed cases, and this refuses to
 * treat one as a ruling even if it ever lands.
 *
 * ⚠️ The listing confirm-report took down is NOT republished here, deliberately: verified=false is
 * one boolean written by six different takedowns (core/listings.ts, "NO AUTO-REPUBLISH"), so
 * nothing can tell this report's takedown from a later AI/duplicate hold on the same row. The
 * admin's 'approve' on the listing is the human republish, and it settles the appeal too.
 */
export async function settleReportCharges(
  reportIds: string[],
  opts?: { onHeld?: (held: number) => void },
): Promise<number> {
  if (!reportIds.length) return 0
  const appealed = await db.report.findMany({
    where: { id: { in: reportIds }, appealedAt: { not: null } },
    select: { id: true, targetProfileId: true, targetSellerId: true, status: true, resolvedBy: true },
  })
  const won = appealed.filter((r) => reportClearsCharge(r))
  if (!won.length) return 0
  const subjects = await recordChargeReversals(won, 'appeal_won')
  for (const pid of subjects) {
    const res = await recomputeTrust(pid, { uncapped: true })
    if (res) await syncEnforcement(pid, res.breakdown, { persistedScore: res.score, onHeld: opts?.onHeld })
  }
  return subjects.length
}

/**
 * A TRUTHFUL, USER-FACING description of one ledger row — for the PDPL data export.
 *
 * ⚠️ THE RAW `type` MUST NOT BE HANDED TO THE USER, and that is the whole reason this exists.
 * `manual_adjust` is an INTERNAL CATCH-ALL, not a description of what happened: it carries the
 * automated offer-spam penalty (offer-guard.ts), the automatic new_account / phone_verified /
 * zalo_linked / kyc grants, AND genuine admin action. Exporting that string told a user that a
 * machine-applied penalty was a "manual adjustment" — i.e. that a person had judged them. The
 * export is a legal disclosure under the PDPL access right, and /legal/ranking tells users to
 * contact support if they think their score is wrong, so this is the one place the distinction
 * actually reaches a human and matters.
 *
 * The ledger already knows the truth — `reason` records the precise cause — so this needs no
 * schema change, no backfill and no change to scoring. It reads (type, reason) and returns what
 * genuinely happened.
 *
 * ⚠️ It must never leak internal metadata: `false_report:<reportId>` is reduced to its shape, and
 * an unrecognised reason falls back to the neutral wording rather than being echoed verbatim.
 * Anything added to ONE_TIME_REASONS or to a new applyTrustEvent caller belongs here too — a
 * missing case degrades to honest-but-vague, never to a wrong claim.
 */
export function describeTrustEvent(type: string, reason?: string | null): string {
  const r = reason ?? ''
  if (r.startsWith('false_report')) return 'Penalty: a report you filed was found to be false (reviewed by our team)'
  // A release is a person's decision (scam-hold.ts refuses without an admin and a written plan), and
  // it changes no points — the charge stays on the record at full weight. Say both.
  if (r.startsWith(SCAM_RELEASE_PREFIX)) return 'Hold released by our team after a review (the confirmed report stays on your record)'
  switch (r) {
    case 'new_account': return 'Automatic: new account opened'
    case 'phone_verified': return 'Automatic: phone number verified'
    case 'zalo_linked': return 'Automatic: Zalo account linked'
    case 'kyc': return 'Automatic: identity verified'
    case 'profile_complete': return 'Automatic: profile completed'
    case 'nonneg_offer_spam': return 'Automatic penalty: repeated offers on listings with a fixed price'
    case 'conduct_warning': return 'Warning issued about conduct'
  }
  switch (type) {
    case 'report_confirmed': return 'Penalty: a report against you was confirmed'
    case 'report_dismissed': return 'A report against you was dismissed'
    case 'positive_review': return 'Automatic: a buyer left a positive review'
    case 'fast_response': return 'Automatic: fast replies to buyers'
    case 'engagement': return 'Automatic: activity on the marketplace'
    case 'transaction': return 'Automatic: a completed transaction'
    case 'recompute_lift': return 'Automatic: score recalculated from your history'
    case 'decay_recover': return 'Automatic: recovery over time'
    // Deliberately does NOT say "manual" — an unrecognised manual_adjust may well be automated,
    // and claiming a human acted is exactly the inaccuracy this function exists to prevent.
    case 'manual_adjust': return 'Adjustment to your score'
    default: return 'Adjustment to your score'
  }
}

/**
 * Append a trust event (the AUDIT LEDGER) and recompute the composite. In v2 the
 * delta is informational for most types — the recompute reads source tables — but
 * report_confirmed / manual_adjust events DO feed C/M, and one-time verification
 * reasons feed V (and bypass the daily cap: verifying is always instant).
 */
export async function applyTrustEvent(
  subjectProfileId: string,
  type:
    | 'report_confirmed'
    | 'report_dismissed'
    | 'positive_review'
    | 'fast_response'
    | 'engagement'
    | 'transaction'
    | 'recompute_lift'
    | 'manual_adjust',
  delta: number,
  meta?: { reason?: string; actorId?: string; reportId?: string },
): Promise<{ score: number; tier: TrustTier; breakdown: TrustBreakdown } | null> {
  await db.trustEvent.create({
    data: { subjectProfileId, type, delta, reason: meta?.reason ?? null, actorId: meta?.actorId ?? null, reportId: meta?.reportId ?? null },
  })
  // Track-record counter kept for display/legacy (tier gates now use real volumes).
  if (type === 'positive_review' || type === 'engagement' || type === 'fast_response' || type === 'transaction') {
    await db.profile.update({ where: { id: subjectProfileId }, data: { positiveInteractions: { increment: 1 } } })
  }
  const uncapped = !!(meta?.reason && ONE_TIME_REASONS.has(meta.reason))
  return recomputeTrust(subjectProfileId, { uncapped })
}

/**
 * Penalize a SELLER by id. If the seller has an owning account, route through the
 * audited event log (Profile is the source of truth, then mirrored back). If it's
 * a GUEST seller (ownerId null — the common anonymous-post case), there's no
 * Profile to attach an event to, so dock the Seller mirror directly. Guest
 * sellers can only be Standard or Restricted — the badged tiers need an account.
 */
export async function penalizeSeller(sellerId: string, delta: number, meta?: { reason?: string; reportId?: string }): Promise<void> {
  const seller = await db.seller.findUnique({ where: { id: sellerId }, select: { ownerId: true, trustScore: true } })
  if (!seller) return
  if (seller.ownerId) {
    await applyTrustEvent(seller.ownerId, 'report_confirmed', delta, { reason: meta?.reason, reportId: meta?.reportId })
    return
  }
  const score = Math.min(TRUST.MAX, Math.max(0, seller.trustScore + delta))
  await db.seller.update({ where: { id: sellerId }, data: { trustScore: score, trustTier: score < 60 ? 'restricted' : 'standard' } })
  // Keep the listings' denormalized ranking key in sync (guest seller — no Profile path).
  // Via cascadeSellerTrustScore, never listing.updateMany: that restamps updatedAt (#26).
  await cascadeSellerTrustScore([sellerId], score)
  await recomputeRankScoreForSeller(sellerId) // re-blend the feed rankScore with the new trust
}

/**
 * Availability-confirm activity: an informational (delta 0) daily-capped ledger
 * event whose recompute picks up the fresh availabilityConfirmedAt — the freshness
 * component (0–5) is the real reward now, endogenous and un-farmable.
 *
 * The daily cap is BEST-EFFORT under concurrency: the count-then-create below has
 * no lock ('activity' is not in ONE_TIME_REASONS), so two simultaneous confirms can
 * both pass the check and land two events. Accepted — engagement events are delta 0
 * (informational), so an extra row has zero scoring impact.
 */
export async function recordEngagement(profileId: string, perDayCap = ENGAGEMENT_DAILY_CAP): Promise<boolean> {
  const since = new Date(Date.now() - DAY_MS)
  const today = await db.trustEvent.count({
    where: { subjectProfileId: profileId, type: 'engagement', createdAt: { gt: since } },
  })
  if (today >= perDayCap) return false
  await applyTrustEvent(profileId, 'engagement', 0, { reason: 'activity' })
  return true
}

/**
 * A COMPLETED on-platform transaction. Informational event (T reads sold listings
 * + accepted offers directly — log-diminishing, so bulk-buying reputation is dead);
 * the triggered recompute folds the new transaction into T immediately.
 */
export async function recordTransaction(profileId: string, amountVnd: number): Promise<void> {
  await applyTrustEvent(profileId, 'transaction', 0, { reason: `txn:${Math.round(amountVnd)}` })
}

/** One-time marker when an account first completes a full storefront profile (audit only in v2). */
export async function recordProfileComplete(profileId: string): Promise<boolean> {
  const existing = await db.trustEvent.count({ where: { subjectProfileId: profileId, type: 'engagement', reason: 'profile_complete' } })
  if (existing > 0) return false
  return applyOnce(profileId, 'engagement', 0, 'profile_complete')
}

/**
 * A verified buyer left a review → zero-delta AUDIT event (Q reads the Review table
 * directly — Bayesian + credibility-weighted — so no double count) + recompute.
 */
export async function recordReview(profileId: string): Promise<void> {
  await applyTrustEvent(profileId, 'positive_review', 0, { reason: 'verified_review' })
}

/** One-time audit marker for account creation (v2 baseline is 60 by construction, not by delta). */
export async function recordNewAccount(profileId: string): Promise<boolean> {
  const existing = await db.trustEvent.count({ where: { subjectProfileId: profileId, reason: 'new_account' } })
  if (existing > 0) return false
  return applyOnce(profileId, 'manual_adjust', 0, 'new_account')
}

/** One-time verification gate: a verified phone number (V +10, lands immediately — cap-exempt). */
export async function recordPhoneVerified(profileId: string): Promise<boolean> {
  const existing = await db.trustEvent.count({ where: { subjectProfileId: profileId, reason: 'phone_verified' } })
  if (existing > 0) return false
  return applyOnce(profileId, 'manual_adjust', PHONE_VERIFIED_BONUS, 'phone_verified')
}

/** One-time marker for linking Zalo. Audit-only in v2 (V is phone/KYC/age per spec). */
export async function recordZaloLinked(profileId: string): Promise<boolean> {
  const existing = await db.trustEvent.count({ where: { subjectProfileId: profileId, reason: 'zalo_linked' } })
  if (existing > 0) return false
  return applyOnce(profileId, 'manual_adjust', 0, 'zalo_linked')
}

/** One-time verification gate: identity verification / KYC (V +10 — the business trust step). */
export async function recordKyc(profileId: string): Promise<boolean> {
  const existing = await db.trustEvent.count({ where: { subjectProfileId: profileId, reason: 'kyc' } })
  if (existing > 0) return false
  return applyOnce(profileId, 'manual_adjust', KYC_BONUS, 'kyc')
}

// Daily maintenance bounds: the cron shares a 60s budget with reminders/rank/stats,
// so the recompute pass is bounded by count AND a soft deadline (it resumes next run).
const MAINTENANCE_MAX_PROFILES = 5000
const MAINTENANCE_CONCURRENCY = 8
const MAINTENANCE_DEADLINE_MS = 40_000

/**
 * Daily trust maintenance (run from the cron): recompute-all-active. v2 has NO
 * calendar drift — the old +1/day recovery and −3 inactivity dock are GONE. The
 * daily pass simply re-evaluates the composite so time-dependent terms stay fresh:
 * conduct decay (and the scam freeze), the 365d transaction window, the 90d
 * response window, and availability freshness. Scope: every profile that owns a
 * storefront (the public reputation surface) + currently-restricted profiles
 * (so decay can lift them back out — indexed via Profile.trustTier). Buyer-only
 * profiles in between refresh on their next event (their score only feeds
 * credibility weighting; a slightly-stale value is the conservative direction).
 */
export async function runTrustMaintenance(): Promise<{ recomputed: number; scanned: number }> {
  const started = Date.now()

  // Enforcement Phase 2 — expire timed actions FIRST (30d warnings, 72h insurance
  // graces) so the sync below re-derives a lapsed grace on the same run. Guarded
  // no-op pre-migration.
  try { await expireEnforcement() } catch (e) { console.error('[trust] enforcement expiry', e) }

  const [owners, restricted] = await Promise.all([
    db.seller.findMany({ where: { ownerId: { not: null } }, select: { ownerId: true }, take: MAINTENANCE_MAX_PROFILES }),
    db.profile.findMany({ where: { trustTier: 'restricted' }, select: { id: true }, take: 2000 }),
  ])
  const ids = [
    ...new Set([...owners.map((s) => s.ownerId).filter((x): x is string => !!x), ...restricted.map((p) => p.id)]),
  ]
  // Fisher–Yates shuffle (audit P2): the scan is unordered, so once the population
  // outgrew one deadline window the SAME stable-heap-order head was processed every
  // night and the tail never converged. A random order gives every profile equal
  // long-run coverage without a schema change ("resume" was never implemented).
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }

  let recomputed = 0
  for (let i = 0; i < ids.length; i += MAINTENANCE_CONCURRENCY) {
    if (Date.now() - started > MAINTENANCE_DEADLINE_MS) break // resume on the next daily run
    const batch = ids.slice(i, i + MAINTENANCE_CONCURRENCY)
    const results = await Promise.all(
      batch.map((id) =>
        recomputeTrust(id).then(
          async (r) => {
            // Enforcement sync rides the same breakdown (no second computeTrustV2);
            // fail-quiet inside — a sync hiccup must not fail the trust recompute.
            if (r) await syncEnforcement(id, r.breakdown, { persistedScore: r.score })
            // Velocity review flags (Phase 3): a positive-event spike far above the
            // account's own baseline gets a SILENT admin flag — the seller is never
            // notified and their state never moves (a spike is usually a good week;
            // only a human should decide it's reputation-farming). The detector is a
            // pure function of counts the breakdown already carries — O(1) extra
            // queries, and only for the rare profile that actually spikes.
            if (r && velocitySpike(r.breakdown.inputs.velocity)) {
              await flagForReview(id, ENFORCEMENT_REASON.VELOCITY_REVIEW)
            }
            return 1
          },
          (e) => {
            console.error('[trust] daily recompute failed for', id, e)
            return 0
          },
        ),
      ),
    )
    for (const r of results) recomputed += r
  }
  return { recomputed, scanned: ids.length }
}
