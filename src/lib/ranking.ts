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

/** Live rows the nightly sweep re-scores per statement. */
export const SWEEP_BATCH = 500

/**
 * Daily re-decay sweep: refresh rankScore for every live listing. Returns rows touched.
 *
 * ⚠️ IN BATCHES, EACH ITS OWN STATEMENT (speed plan item 9, 2026-10-17). One UPDATE over every live row held every row's
 * lock until the whole statement committed. Measured on production (pg_stat_statements since 2026-09-20): 34 s mean,
 * 58 s max while ~65k rows were live — and the view counter, description and attribute writes on those rows waited
 * behind it, up to 40 s. Now the ids are read first (the live partial indexes answer that) and re-scored 500 at a time,
 * so a write waits for one batch at most. A row that leaves the live set meanwhile is skipped by the WHERE; one that
 * joins it was scored when it was published.
 * ⚠️ A FAILED BATCH (a deadlock, the server's 30 s statement limit) does not stop the others — every later batch would
 * otherwise keep yesterday's score — and the sweep then throws, naming how many failed, so the cron logs it.
 * ⛔ NO `.catch(() => 0)`: swallowed here, a sweep that re-scored nothing looked exactly like a quiet night.
 * (Every live row's score changes nightly — the recency term decays continuously — so there is nothing to skip.)
 */
export async function recomputeRankScoreAllActive(): Promise<number> {
  const rows = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM "Listing" WHERE "verified" = true AND "status" = 'active' ORDER BY "id"`,
  )
  const ids = rows.map((r) => r.id)
  let touched = 0
  const failed: unknown[] = []
  for (let i = 0; i < ids.length; i += SWEEP_BATCH) {
    try {
      touched += await db.$executeRaw(
        Prisma.sql`UPDATE "Listing" SET ${SET_RANK_SCORE}
          WHERE "id" IN (${Prisma.join(ids.slice(i, i + SWEEP_BATCH))}) AND "verified" = true AND "status" = 'active'`,
      )
    } catch (e) {
      failed.push(e)
    }
  }
  if (failed.length) {
    const batches = Math.ceil(ids.length / SWEEP_BATCH)
    throw new Error(`rank sweep: ${failed.length} of ${batches} batches failed (${touched} rows re-scored)`, { cause: failed[0] })
  }
  return touched
}
