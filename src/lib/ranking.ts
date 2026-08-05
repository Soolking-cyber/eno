import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { rankScoreExprSql } from '@/lib/ranking-formula'
import { logError } from '@/lib/log'

// The pure formula (constants, components, browse/search scores) lives in
// src/lib/ranking-formula.ts so the seed and tsx scripts can consume the SAME source
// (audit Phase 1 — three hand-mirrored SQL copies had drifted). This module re-exports
// it for app code and owns the db-touching recompute helpers.
export {
  RANK,
  relevanceFromPosition,
  trustComponent,
  recencyComponent,
  demandComponent,
  browseRankScore,
  searchScore,
} from '@/lib/ranking-formula'

// SQL mirror of browseRankScore — built from the single-source expression, so the JS
// and SQL formulas cannot drift (at age 0 they produce the identical value).
const SET_RANK_SCORE = Prisma.sql`"rankScore" = ${Prisma.raw(rankScoreExprSql())}`

/** Recompute one listing's rankScore at the current time (e.g. after a status change). */
export async function recomputeRankScoreForListing(id: string): Promise<void> {
  await db.$executeRaw(Prisma.sql`UPDATE "Listing" SET ${SET_RANK_SCORE} WHERE "id" = ${id}`).catch((e) => logError(e, { op: 'ranking.recompute' }))
}

/** Recompute rankScore for a specific set of active listings (e.g. a batch availability
 *  bump). Optionally scoped to one seller so a caller can only re-rank its own. */
export async function recomputeRankScoreForListings(ids: string[], sellerId?: string): Promise<void> {
  if (!ids.length) return
  const guard = sellerId ? Prisma.sql`AND "sellerId" = ${sellerId}` : Prisma.empty
  await db
    .$executeRaw(Prisma.sql`UPDATE "Listing" SET ${SET_RANK_SCORE} WHERE "id" IN (${Prisma.join(ids)}) AND "status" = 'active' ${guard}`)
    .catch((e) => logError(e, { op: 'ranking.recomputeForListings' }))
}

/** Recompute rankScore for all of a seller's active listings (after their trust changes). */
export async function recomputeRankScoreForSeller(sellerId: string): Promise<void> {
  await db
    .$executeRaw(Prisma.sql`UPDATE "Listing" SET ${SET_RANK_SCORE} WHERE "sellerId" = ${sellerId} AND "status" = 'active'`)
    .catch((e) => logError(e, { op: 'ranking.recomputeForSeller' }))
}

/** Daily re-decay sweep: refresh rankScore for every live listing. Returns rows touched. */
export async function recomputeRankScoreAllActive(): Promise<number> {
  return db
    .$executeRaw(Prisma.sql`UPDATE "Listing" SET ${SET_RANK_SCORE} WHERE "verified" = true AND "status" = 'active'`)
    .catch(() => 0)
}
