import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'

// ── Balanced feed/search ranking ──────────────────────────────────────────────────
// One bounded composite so seller trust is a WEIGHTED edge — never ignored, never an
// absolute override. A trusted, well-behaved business ranks above an equally-relevant
// standard seller, but a clearly fresher/more-relevant listing still wins. Replaces the
// old split where browse sorted trust-FIRST (lexicographic) while search ignored trust
// entirely — the inconsistency that made results visibly re-sort. Tunable here.

export const RANK = {
  // Trust → [0,1]. Baseline 100 maps to 0.5; Restricted (≤40) → 0, Exceptional (≥160) → 1.
  TRUST_FLOOR: 40,
  TRUST_SPAN: 120,
  // Recency decay: exp(-ageDays / DECAY_DAYS). Fresh → 1; ~2 weeks → ~0.37; a month → ~0.12.
  DECAY_DAYS: 14,
  FEATURED_BOOST: 0.15,
  // Browse (no query): trust and freshness co-lead.
  BROWSE_TRUST_W: 0.5,
  BROWSE_RECENCY_W: 0.5,
  // Search (query present): relevance-led; trust a strong-but-bounded booster.
  SEARCH_REL_W: 0.6,
  SEARCH_TRUST_W: 0.3,
  SEARCH_RECENCY_W: 0.1,
  // Map a Vertex rank position (0 = most relevant) to a relevance signal: exp(-pos/12).
  // Steep so the clearly-best matches keep the top; trust only adjusts among near-ties.
  REL_POSITION_DECAY: 12,
} as const

/** Relevance signal in (0,1] from a 0-based rank position (0 = most relevant). */
export function relevanceFromPosition(position: number): number {
  return Math.exp(-Math.max(0, position) / RANK.REL_POSITION_DECAY)
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** Seller trust → [0,1]; 100 (baseline) → 0.5. Bounded so trust can't dominate. */
export function trustComponent(sellerTrustScore: number): number {
  return clamp01((sellerTrustScore - RANK.TRUST_FLOOR) / RANK.TRUST_SPAN)
}

/** Listing freshness → (0,1]; postedAt = now → 1, decaying with age. */
export function recencyComponent(postedAt: Date, now: number = Date.now()): number {
  const ageDays = Math.max(0, (now - postedAt.getTime()) / 86_400_000)
  return Math.exp(-ageDays / RANK.DECAY_DAYS)
}

/**
 * The stored browse rankScore for a listing. Used for the JS write-time value at
 * create/bump (where age≈0 so recency=1 and this matches SET_RANK_SCORE_EXPR exactly).
 * Re-decay over time is done in SQL (recomputeRankScore*).
 */
export function browseRankScore(
  l: { sellerTrustScore: number; postedAt: Date; featured?: boolean },
  now: number = Date.now(),
): number {
  return (
    RANK.BROWSE_TRUST_W * trustComponent(l.sellerTrustScore) +
    RANK.BROWSE_RECENCY_W * recencyComponent(l.postedAt, now) +
    (l.featured ? RANK.FEATURED_BOOST : 0)
  )
}

/** Relevance-led composite for a text search, computed per candidate at query time. */
export function searchScore(
  l: { relevance: number; sellerTrustScore: number; postedAt: Date },
  now: number = Date.now(),
): number {
  return (
    RANK.SEARCH_REL_W * clamp01(l.relevance) +
    RANK.SEARCH_TRUST_W * trustComponent(l.sellerTrustScore) +
    RANK.SEARCH_RECENCY_W * recencyComponent(l.postedAt, now)
  )
}

// SQL mirror of browseRankScore — the SINGLE source of truth for re-decay. Recompute
// helpers below all reuse it, so the JS and SQL formulas can't drift (and at age 0 they
// produce the identical value, so the create/bump JS write is consistent with this).
const SET_RANK_SCORE = Prisma.sql`"rankScore" =
  ${RANK.BROWSE_TRUST_W} * LEAST(GREATEST(("sellerTrustScore"::float - ${RANK.TRUST_FLOOR}) / ${RANK.TRUST_SPAN}, 0), 1)
  + ${RANK.BROWSE_RECENCY_W} * EXP(- GREATEST(EXTRACT(EPOCH FROM (now() - "postedAt")), 0) / 86400.0 / ${RANK.DECAY_DAYS})
  + CASE WHEN "featured" THEN ${RANK.FEATURED_BOOST} ELSE 0 END`

/** Recompute one listing's rankScore at the current time (e.g. after a status change). */
export async function recomputeRankScoreForListing(id: string): Promise<void> {
  await db.$executeRaw(Prisma.sql`UPDATE "Listing" SET ${SET_RANK_SCORE} WHERE "id" = ${id}`).catch(() => {})
}

/** Recompute rankScore for a specific set of active listings (e.g. a batch availability
 *  bump). Optionally scoped to one seller so a caller can only re-rank its own. */
export async function recomputeRankScoreForListings(ids: string[], sellerId?: string): Promise<void> {
  if (!ids.length) return
  const guard = sellerId ? Prisma.sql`AND "sellerId" = ${sellerId}` : Prisma.empty
  await db
    .$executeRaw(Prisma.sql`UPDATE "Listing" SET ${SET_RANK_SCORE} WHERE "id" IN (${Prisma.join(ids)}) AND "status" = 'active' ${guard}`)
    .catch(() => {})
}

/** Recompute rankScore for all of a seller's active listings (after their trust changes). */
export async function recomputeRankScoreForSeller(sellerId: string): Promise<void> {
  await db
    .$executeRaw(Prisma.sql`UPDATE "Listing" SET ${SET_RANK_SCORE} WHERE "sellerId" = ${sellerId} AND "status" = 'active'`)
    .catch(() => {})
}

/** Daily re-decay sweep: refresh rankScore for every live listing. Returns rows touched. */
export async function recomputeRankScoreAllActive(): Promise<number> {
  return db
    .$executeRaw(Prisma.sql`UPDATE "Listing" SET ${SET_RANK_SCORE} WHERE "verified" = true AND "status" = 'active'`)
    .catch(() => 0)
}
