import { Prisma } from '@/generated/prisma/client'
import { rankScoreExprSql } from './ranking-formula'
import { IMPORT_SELLERS, isImportSeller } from './import-sellers'

/**
 * THE POST-IMPORT RANK STEP — the pure half of scripts/recompute-seller-rank.ts.
 *
 * It writes exactly what the nightly `recomputeRankScoreAllActive()` and the app's
 * `recomputeRankScoreForSeller()` (src/lib/ranking.ts) write: `rankScoreExprSql()`, the ONE formula
 * every SQL writer shares, over a seller's active rows. It cannot call that helper directly —
 * ranking.ts is `server-only` and owns the app's pooled `db` singleton, both of which throw or
 * mis-connect under tsx — so it composes the same expression, and the unit test pins that it does.
 *
 * ⚠️ WHAT IT FIXES, AND WHAT IT DOES NOT — measured from the formula, not assumed.
 *   · FIXES: rows whose stored score is not the formula's — a row an importer created without a
 *     `rankScore` sits at the schema default 0 (dead last) until the nightly sweep, and a row an
 *     importer re-activated keeps whatever score it had when it was hidden.
 *   · DOES NOT demote a fresh import. The formula is 0.60·trust + 0.25·demand + 0.15·recency over
 *     `postedAt`, and every shipped importer sets `postedAt` from the SOURCE's own post date (nhatot
 *     `list_time`, muaban `publish_at`, Honeycomb's sitemap `lastmod`; never "now" — lead,
 *     2026-09-24) and scores the row with this same formula at create, so recomputing re-derives
 *     the same number. A source ad posted an hour ago still has recency ≈ 1: at the import sellers'
 *     default trustScore 100 that is ≈ 0.4286 + 0 + 0.15 = 0.5786 (the 2026-09-24 dry runs measured
 *     0.5757–0.5785), above the existing ~0.56 rows. The remaining lever is the seller's trust,
 *     which is not this step's to change.
 */

/**
 * The SET clause. Nothing but `rankScore`: this step must never touch `status` or `verified` (the
 * publication gate) — src/lib/compliance/public-state-writes.test.ts would fail if it did — and a
 * raw UPDATE does not bump `updatedAt`, so the sitemap's lastmod is not rewritten by a re-rank.
 */
export const RANK_SET_CLAUSE = `"rankScore" = ${rankScoreExprSql()}`

/** The same rows `recomputeRankScoreForSeller()` touches: the seller's ACTIVE listings. */
function sellerScope(sellers: readonly string[]): Prisma.Sql {
  if (!sellers.length) throw new Error('no sellers — refusing an unscoped rank update')
  return Prisma.sql`"sellerId" IN (${Prisma.join([...sellers])}) AND "status" = 'active'`
}

export function recomputeUpdateSql(sellers: readonly string[]): Prisma.Sql {
  return Prisma.sql`UPDATE "Listing" SET ${Prisma.raw(RANK_SET_CLAUSE)} WHERE ${sellerScope(sellers)}`
}

/** Read-only preview: per seller, the score today and the score the update would write. */
export function recomputePreviewSql(sellers: readonly string[]): Prisma.Sql {
  const next = Prisma.raw(`(${rankScoreExprSql()})`)
  return Prisma.sql`SELECT "sellerId",
      COUNT(*)::int AS rows,
      AVG("rankScore")::float AS "curAvg", MIN("rankScore")::float AS "curMin", MAX("rankScore")::float AS "curMax",
      AVG(${next})::float AS "nextAvg", MIN(${next})::float AS "nextMin", MAX(${next})::float AS "nextMax",
      SUM(CASE WHEN ABS("rankScore" - ${next}) > 1e-6 THEN 1 ELSE 0 END)::int AS changing
    FROM "Listing" WHERE ${sellerScope(sellers)}
    GROUP BY "sellerId" ORDER BY "sellerId"`
}

/** The yardstick the preview prints beside each seller: every OTHER live listing's stored score. */
export function platformBaselineSql(sellers: readonly string[]): Prisma.Sql {
  return Prisma.sql`SELECT COUNT(*)::int AS rows, AVG("rankScore")::float AS avg,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "rankScore")::float AS median
    FROM "Listing" WHERE "verified" = true AND "status" = 'active' AND "sellerId" NOT IN (${Prisma.join([...sellers])})`
}

export type RecomputeArgs = { sellers: string[]; apply: boolean }

/**
 * `--seller <id>` (repeatable, or comma-separated) or `--all-imports`, plus `--apply`.
 *
 * ⛔ ONLY IMPORT SELLERS. The update is the nightly formula and harmless in itself, but a typo'd or
 * pasted id is how an operator script reaches a real shop's rows; the list in
 * src/lib/import-sellers.ts is the whole blast radius this tool is meant to have.
 */
export function parseRecomputeArgs(argv: readonly string[]): RecomputeArgs {
  const sellers: string[] = []
  let apply = false
  const addList = (v: string | undefined, flag: string) => {
    if (!v || v.startsWith('--')) throw new Error(`${flag} needs a seller id`)
    sellers.push(...v.split(',').map((s) => s.trim()).filter(Boolean))
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') apply = true
    else if (a === '--all-imports') sellers.push(...IMPORT_SELLERS)
    else if (a === '--seller') addList(argv[++i], '--seller')
    else if (a.startsWith('--seller=')) addList(a.slice('--seller='.length), '--seller')
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!sellers.length) throw new Error('name the sellers: --seller <id> (repeatable) or --all-imports')
  const unknown = sellers.filter((s) => !isImportSeller(s))
  if (unknown.length) throw new Error(`not an import seller (see src/lib/import-sellers.ts): ${unknown.join(', ')}`)
  return { sellers: [...new Set(sellers)], apply }
}
