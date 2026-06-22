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
