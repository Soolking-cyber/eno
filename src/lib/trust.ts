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
const SCORE_MAX = 130 // small headroom above 100 so "Exceptional" (≥110) is reachable but bounded

const TRACK_RECORD_MIN_INTERACTIONS = 5 // OR …
const TRACK_RECORD_MIN_DAYS = 30 // …account age — either satisfies the track-record gate
const RECENT_BAD_WINDOW_DAYS = 90 // a recent confirmed report blocks the Exceptional tier

const DAY_MS = 86_400_000
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// ── Engagement / activity scoring (the "earn by being active" loop) ──
export const ENGAGEMENT_DELTA = 2       // +trust for a day's activity (e.g. confirming availability)
export const ENGAGEMENT_DAILY_CAP = 1   // at most one engagement bump per account per day (no farming)
export const INACTIVE_DAYS = 7          // active listings unconfirmed this long → the account decays
export const INACTIVE_PENALTY = 3       // −trust per inactivity sweep (at most once per INACTIVE_DAYS)
export const RECOVERY_DELTA = 1         // clean accounts below 100 drift back up by this per day
export const RECOVERY_CLEAN_DAYS = 14   // …only if no confirmed report / inactivity hit in this window

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
  const score = clamp(100 + (agg._sum.delta ?? 0), SCORE_MIN, SCORE_MAX)

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
    | 'decay_recover'
    | 'decay_inactive'
    | 'manual_adjust',
  delta: number,
  meta?: { reason?: string; actorId?: string; reportId?: string },
): Promise<{ score: number; tier: TrustTier } | null> {
  await db.trustEvent.create({
    data: { subjectProfileId, type, delta, reason: meta?.reason ?? null, actorId: meta?.actorId ?? null, reportId: meta?.reportId ?? null },
  })
  if (delta > 0 && (type === 'positive_review' || type === 'engagement' || type === 'fast_response')) {
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
  const score = clamp(seller.trustScore + delta, SCORE_MIN, SCORE_MAX)
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

  // Recovery: accounts below 100 with a clean recent window drift up by 1/day.
  const cleanCutoff = new Date(now - RECOVERY_CLEAN_DAYS * DAY_MS)
  const below = await db.profile.findMany({ where: { trustScore: { lt: 100 } }, select: { id: true }, take: 20000 })
  let recovered = 0
  for (const p of below) {
    const recentBad = await db.trustEvent.count({
      where: { subjectProfileId: p.id, type: { in: ['report_confirmed', 'decay_inactive'] }, createdAt: { gt: cleanCutoff } },
    })
    if (recentBad > 0) continue
    await applyTrustEvent(p.id, 'decay_recover', RECOVERY_DELTA, { reason: 'recovery' })
    recovered++
  }

  return { decayed, recovered }
}
