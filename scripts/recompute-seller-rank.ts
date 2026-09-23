/**
 * Recompute `rankScore` for one or more IMPORT sellers' active listings — the post-import step.
 *
 * Run it right after any property importer's `--apply`, so the seller's rows carry the formula's
 * value now instead of whatever they held until the nightly sweep
 * (`recomputeRankScoreAllActive()` in src/app/api/cron/daily-reminders/route.ts):
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/recompute-seller-rank.ts --seller nhatot-import-seller-0001            # dry run
 *   npx tsx scripts/recompute-seller-rank.ts --seller nhatot-import-seller-0001 --apply    # writes
 *   npx tsx scripts/recompute-seller-rank.ts --all-imports [--apply]
 *
 * ⚠️ READ src/lib/seller-rank-recompute.ts BEFORE EXPECTING IT TO DEMOTE AN IMPORT. It writes the
 * nightly formula, which the importers already apply at create from the source's own post date, so
 * a fresh row re-derives the same score. It levels rows that are NOT on the formula (a 0 default, a
 * re-activated row's stale score); it does not change how fresh imports rank against older listings.
 *
 * Safety:
 *   · DRY RUN by default, and the dry run's session is read-only AT THE SERVER
 *     (`default_transaction_read_only=on`), whatever the caller's environment says.
 *   · Only ids in src/lib/import-sellers.ts are accepted; `--apply` also refuses a seller that has an
 *     owner (a claimed storefront is no longer a platform import seller — the list is stale).
 *   · One UPDATE, `rankScore` only: never `status`/`verified`, and a raw UPDATE leaves `updatedAt`
 *     alone. Rollback is unnecessary — the nightly sweep writes this same formula over every live row.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import {
  parseRecomputeArgs,
  platformBaselineSql,
  recomputePreviewSql,
  recomputeUpdateSql,
} from '../src/lib/seller-rank-recompute'

type PreviewRow = {
  sellerId: string; rows: number; changing: number
  curAvg: number; curMin: number; curMax: number; nextAvg: number; nextMin: number; nextMax: number
}

const f = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(4) : '   —  ')

async function main() {
  let args
  try {
    args = parseRecomputeArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`  ${(e as Error).message}`)
    process.exitCode = 2
    return
  }
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) {
    console.error('  DIRECT_URL / DATABASE_URL is not set — source .env first (see the header).')
    process.exitCode = 2
    return
  }
  const db = new PrismaClient({
    adapter: new PrismaPg(args.apply ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }),
    log: ['warn', 'error'],
  })
  try {
    const sellers = await db.seller.findMany({
      where: { id: { in: args.sellers } },
      select: { id: true, name: true, ownerId: true, trustScore: true },
    })
    const byId = new Map(sellers.map((s) => [s.id, s]))
    console.log(`  mode      ${args.apply ? 'APPLY — WRITES TO PRODUCTION' : 'DRY RUN (read-only session)'}`)
    for (const id of args.sellers) {
      const s = byId.get(id)
      console.log(`  seller    ${id}  ${s ? `"${s.name}"  trustScore ${s.trustScore}${s.ownerId ? '  ⛔ OWNED' : ''}` : '(does not exist yet — nothing to rank)'}`)
    }

    const preview = await db.$queryRaw<PreviewRow[]>(recomputePreviewSql(args.sellers))
    const [baseline] = await db.$queryRaw<{ rows: number; avg: number | null; median: number | null }[]>(platformBaselineSql(args.sellers))
    console.log('\n  seller                                   active   changing   now avg (min–max)            after avg (min–max)')
    for (const r of preview) {
      console.log(`  ${r.sellerId.padEnd(40)} ${String(r.rows).padStart(6)}   ${String(r.changing).padStart(8)}   ${f(r.curAvg)} (${f(r.curMin)}–${f(r.curMax)})   ${f(r.nextAvg)} (${f(r.nextMin)}–${f(r.nextMax)})`)
    }
    if (!preview.length) console.log('  (no active rows for these sellers)')
    console.log(`\n  every other live listing: ${baseline?.rows ?? 0} rows, rankScore avg ${f(baseline?.avg)}, median ${f(baseline?.median)}`)

    if (!args.apply) {
      console.log('\n  DRY RUN — nothing written. Re-run with --apply.')
      return
    }
    const owned = sellers.filter((s) => s.ownerId)
    if (owned.length) {
      console.error(`\n  REFUSING: ${owned.map((s) => s.id).join(', ')} has an owner — not a platform import seller any more.`)
      process.exitCode = 1
      return
    }
    const n = await db.$executeRaw(recomputeUpdateSql(args.sellers))
    console.log(`\n  re-ranked ${n} rows.`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
