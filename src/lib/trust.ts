import 'server-only'
import { db } from './db'

/**
 * Trust & Reputation engine (replaces manual per-listing verification).
 *
 * The score is an append-only function of TrustEvent rows: score = clamp(100 +
 * Σ delta). Profile.trustScore / trustTier (and the Seller mirror) are just a
 * denormalized cache recomputed after every event — never mutated blindly — so
 * every change is auditable and reversible. Everyone starts at 100 ("good
 * standing"); badges are *earned* (score + track record).
 */

export type TrustTier = 'restricted' | 'standard' | 'trusted' | 'exceptional'

// Confirmed-report penalties by severity (decision: severity-weighted).
export const SEVERITY_PENALTY: Record<'minor' | 'moderate' | 'severe', number> = {
  minor: 3, // spam / duplicate / minor
  moderate: 10, // misrepresentation / wrong info / offensive
  severe: 25, // scam / counterfeit
}

// Penalty applied to a REPORTER whose report an admin marks abusive/false.
export const FALSE_REPORT_PENALTY = 10
export const REPORT_COOLDOWN_DAYS = 14

const SCORE_MIN = 0
// No upper ceiling: completed transactions earn trust without limit, so the most
// active, reliable businesses keep climbing (and rank higher). Tiers/colors key
// off fixed thresholds (≥110 = Exceptional/gold), so any high score reads as gold.

const TRACK_RECORD_MIN_INTERACTIONS = 5 // OR …
const TRACK_RECORD_MIN_DAYS = 30 // …account age — either satisfies the track-record gate
const RECENT_BAD_WINDOW_DAYS = 90 // a recent confirmed report blocks the Exceptional tier

const DAY_MS = 86_400_000

// ── Engagement / activity scoring (the "earn by being active" loop) ──
export const ENGAGEMENT_DELTA = 2       // +trust for a day's activity (e.g. confirming availability)
export const ENGAGEMENT_DAILY_CAP = 1   // at most one engagement bump per account per day (no farming)
export const INACTIVE_DAYS = 7          // active listings unconfirmed this long → the account decays
export const INACTIVE_PENALTY = 3       // −trust per inactivity sweep (at most once per INACTIVE_DAYS)
export const RECOVERY_DELTA = 1         // clean accounts below 100 drift back up by this per day
export const RECOVERY_CLEAN_DAYS = 14   // …only if no confirmed report / inactivity hit in this window
export const TRANSACTION_DELTA = 5      // +trust per COMPLETED on-platform transaction — UNCAPPED (the more you transact, the higher you climb + rank)
export const FAST_RESPONSE_DELTA = 1    // capped reward for replying quickly to buyers

// KYC-gated onboarding: a brand-new account starts BELOW the 100 baseline and earns
// its way to 100 by completing its profile and passing KYC — so unverified strangers
// carry less trust up front. 60 (new) + 15 (profile) + 25 (KYC) = 100.
export const NEW_ACCOUNT_DEFICIT = 40   // new accounts start at 100 − 40 = 60
export const PROFILE_COMPLETE_DELTA = 15 // one-time: a complete storefront profile
export const KYC_BONUS = 25             // one-time: passing identity verification (KYC)

/** Map a report reason to a default severity (admin can override on confirm). */
export function severityForReason(reason: string): 'minor' | 'moderate' | 'severe' {
  if (reason === 'scam' || reason === 'counterfeit') return 'severe'
  if (reason === 'wrong-info' || reason === 'offensive' || reason === 'misrepresentation') return 'moderate'
  return 'minor'
}

/**
 * Pure tier decision. 100 (the starting score) maps to "standard" (no badge)
 * until a track record exists — so a brand-new account isn't instantly Trusted.
 */
export function tierFor(
  score: number,
  positiveInteractions: number,
  accountAgeDays: number,
  hasRecentConfirmedReport: boolean,
): TrustTier {
  if (score < 60) return 'restricted'
  const hasTrackRecord =
    positiveInteractions >= TRACK_RECORD_MIN_INTERACTIONS || accountAgeDays >= TRACK_RECORD_MIN_DAYS
  if (score >= 110 && hasTrackRecord && !hasRecentConfirmedReport) return 'exceptional'
  if (score >= 85 && hasTrackRecord) return 'trusted'
  return 'standard'
}

/** Recompute the cached score+tier on the Profile and mirror onto its Seller. */
export async function recomputeTrust(profileId: string): Promise<{ score: number; tier: TrustTier } | null> {
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: { createdAt: true, positiveInteractions: true },
  })
  if (!profile) return null

  const agg = await db.trustEvent.aggregate({
    where: { subjectProfileId: profileId },
    _sum: { delta: true },
  })
  const score = Math.max(SCORE_MIN, 100 + (agg._sum.delta ?? 0))

  const recentBad = await db.trustEvent.count({
    where: {
      subjectProfileId: profileId,
      type: 'report_confirmed',
      createdAt: { gte: new Date(Date.now() - RECENT_BAD_WINDOW_DAYS * DAY_MS) },
    },
  })
  const accountAgeDays = (Date.now() - profile.createdAt.getTime()) / DAY_MS
  const tier = tierFor(score, profile.positiveInteractions, accountAgeDays, recentBad > 0)

  await db.profile.update({ where: { id: profileId }, data: { trustScore: score, trustTier: tier } })
  // Mirror onto the owned storefront (if any) so cards/badges render join-free.
  await db.seller.updateMany({ where: { ownerId: profileId }, data: { trustScore: score, trustTier: tier } })
  return { score, tier }
}

/**
 * Append a trust event and recompute. Positive engagement types also bump the
 * track-record counter that gates the Trusted/Exceptional badges.
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
    | 'decay_recover'
    | 'decay_inactive'
    | 'manual_adjust',
  delta: number,
  meta?: { reason?: string; actorId?: string; reportId?: string },
): Promise<{ score: number; tier: TrustTier } | null> {
  await db.trustEvent.create({
    data: { subjectProfileId, type, delta, reason: meta?.reason ?? null, actorId: meta?.actorId ?? null, reportId: meta?.reportId ?? null },
  })
  if (delta > 0 && (type === 'positive_review' || type === 'engagement' || type === 'fast_response' || type === 'transaction')) {
    await db.profile.update({ where: { id: subjectProfileId }, data: { positiveInteractions: { increment: 1 } } })
  }
  return recomputeTrust(subjectProfileId)
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
  const score = Math.max(SCORE_MIN, seller.trustScore + delta)
  await db.seller.update({ where: { id: sellerId }, data: { trustScore: score, trustTier: score < 60 ? 'restricted' : 'standard' } })
}

/**
 * Reward day-to-day activity (e.g. confirming a listing is still available),
 * capped so it can't be farmed. Returns true if a bump was applied. No-op for
 * guest sellers (no Profile to attach the event to).
 */
export async function recordEngagement(profileId: string, delta = ENGAGEMENT_DELTA, perDayCap = ENGAGEMENT_DAILY_CAP): Promise<boolean> {
  const since = new Date(Date.now() - DAY_MS)
  const today = await db.trustEvent.count({
    where: { subjectProfileId: profileId, type: 'engagement', createdAt: { gt: since } },
  })
  if (today >= perDayCap) return false
  await applyTrustEvent(profileId, 'engagement', delta, { reason: 'activity' })
  return true
}

/**
 * Every COMPLETED on-platform transaction earns trust — UNCAPPED. The more deals
 * you successfully close through eno.vn, the higher you climb (and rank). Called
 * from the checkout/settlement flow (the 1% / flat-fee layer).
 */
export async function recordTransaction(profileId: string, amountVnd: number): Promise<void> {
  await applyTrustEvent(profileId, 'transaction', TRANSACTION_DELTA, { reason: `txn:${Math.round(amountVnd)}` })
}

/** One-time bonus when an account first completes a full, verified profile. */
export async function recordProfileComplete(profileId: string): Promise<boolean> {
  const existing = await db.trustEvent.count({ where: { subjectProfileId: profileId, type: 'engagement', reason: 'profile_complete' } })
  if (existing > 0) return false
  await applyTrustEvent(profileId, 'engagement', PROFILE_COMPLETE_DELTA, { reason: 'profile_complete' })
  return true
}

/** Apply the new-account starting deficit once (so new accounts begin at ~60, not 100). */
export async function recordNewAccount(profileId: string): Promise<boolean> {
  const existing = await db.trustEvent.count({ where: { subjectProfileId: profileId, reason: 'new_account' } })
  if (existing > 0) return false
  await applyTrustEvent(profileId, 'manual_adjust', -NEW_ACCOUNT_DEFICIT, { reason: 'new_account' })
  return true
}

/** One-time bonus for passing identity verification (KYC). Lifts a profiled account to 100. */
export async function recordKyc(profileId: string): Promise<boolean> {
  const existing = await db.trustEvent.count({ where: { subjectProfileId: profileId, reason: 'kyc' } })
  if (existing > 0) return false
  await applyTrustEvent(profileId, 'manual_adjust', KYC_BONUS, { reason: 'kyc' })
  return true
}

/**
 * Daily trust maintenance (run from the cron):
 *  • DECAY — accounts whose active listings have gone unconfirmed for INACTIVE_DAYS
 *    lose trust (at most once per window) → rewards keeping listings fresh.
 *  • RECOVERY — clean accounts below 100 (no recent report or inactivity hit) drift
 *    back toward 100, so a single old mistake doesn't mark you forever.
 */
export async function runTrustMaintenance(): Promise<{ decayed: number; recovered: number }> {
  const now = Date.now()
  const staleCutoff = new Date(now - INACTIVE_DAYS * DAY_MS)

  // Owners with ≥1 live-but-stale listing.
  const stale = await db.listing.findMany({
    where: {
      verified: true,
      status: 'active',
      seller: { ownerId: { not: null } },
      OR: [{ availabilityConfirmedAt: { lt: staleCutoff } }, { availabilityConfirmedAt: null, postedAt: { lt: staleCutoff } }],
    },
    select: { seller: { select: { ownerId: true } } },
    take: 20000,
  })
  const staleOwners = [...new Set(stale.map((l) => l.seller.ownerId).filter((x): x is string => !!x))]

  let decayed = 0
  for (const ownerId of staleOwners) {
    // Already docked within this window? skip (one penalty per INACTIVE_DAYS).
    const recent = await db.trustEvent.count({
      where: { subjectProfileId: ownerId, type: 'decay_inactive', createdAt: { gt: staleCutoff } },
    })
    if (recent > 0) continue
    await applyTrustEvent(ownerId, 'decay_inactive', -INACTIVE_PENALTY, { reason: 'inactivity' })
    decayed++
  }

  // Recovery: heal BEHAVIORAL penalties (reports / inactivity) over time — but never
  // beyond what was lost, so it can't lift the new-account KYC deficit up to 100 on
  // its own (KYC + profile do that). Only accounts that actually have a penalty to
  // heal recover; capped at the total penalty so it stops exactly at the pre-penalty score.
  const cleanCutoff = new Date(now - RECOVERY_CLEAN_DAYS * DAY_MS)
  const penalized = await db.profile.findMany({
    where: { trustScore: { lt: 100 }, trustEvents: { some: { type: { in: ['report_confirmed', 'decay_inactive'] } } } },
    select: { id: true },
    take: 20000,
  })
  let recovered = 0
  for (const p of penalized) {
    const [pen, rec, recentBad] = await Promise.all([
      db.trustEvent.aggregate({ where: { subjectProfileId: p.id, type: { in: ['report_confirmed', 'decay_inactive'] } }, _sum: { delta: true } }),
      db.trustEvent.aggregate({ where: { subjectProfileId: p.id, type: 'decay_recover' }, _sum: { delta: true } }),
      db.trustEvent.count({ where: { subjectProfileId: p.id, type: { in: ['report_confirmed', 'decay_inactive'] }, createdAt: { gt: cleanCutoff } } }),
    ])
    if (recentBad > 0) continue // not clean recently
    const penalty = -(pen._sum.delta ?? 0) // positive magnitude of all penalties
    const healed = rec._sum.delta ?? 0
    const remaining = penalty - healed
    if (remaining <= 0) continue // fully healed already
    await applyTrustEvent(p.id, 'decay_recover', Math.min(RECOVERY_DELTA, remaining), { reason: 'recovery' })
    recovered++
  }

  return { decayed, recovered }
}
