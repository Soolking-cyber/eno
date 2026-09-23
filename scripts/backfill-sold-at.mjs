// FREEZE THE SALE TIME of every legacy sold listing (2026-09-23, audit #26 review).
// DRY RUN by default — prints the count. `--apply` writes. IDEMPOTENT: only rows still null.
//
// Run:  node scripts/backfill-sold-at.mjs            # how many rows would change
//       node scripts/backfill-sold-at.mjs --apply    # write them
//       (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// ⛔ WHY. Trust counts "clean transactions AFTER a scam" by each sale's time — soldAt, else
// updatedAt. Until 2026-09-23 only the attributed Mark-sold path stamped soldAt, so EVERY sold
// listing on prod had it null (5,768 of 5,768, measured) and was timed by updatedAt — which any
// later write to the row moves (an edit, a hide). A seller under a scam hold could touch five old
// sales and walk out of the hold. New sales now stamp soldAt; this freezes the old ones.
//
// ⚠️ IT CHANGES NO TRUST VALUE ON THE DAY IT RUNS. soldAt := updatedAt is exactly the time trust
// already reads for these rows; what changes is that the time stops moving afterwards.
//
// ⚠️ RAW SQL ON PURPOSE. `@updatedAt` is applied by the Prisma client, so a Prisma update would
// restamp updatedAt to now in the same write and freeze the WRONG time. Plain SQL leaves it alone.
// Batched so a long write never holds row locks on thousands of listings at once.
import 'dotenv/config'
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('Set DIRECT_URL (or DATABASE_URL) — read from .env')
  process.exit(1)
}
const apply = process.argv.includes('--apply')
const c = new pg.Client({ connectionString: url })
await c.connect()
try {
  const { rows: [{ n }] } = await c.query(`SELECT count(*)::int AS n FROM "Listing" WHERE status = 'sold' AND "soldAt" IS NULL`)
  console.log(`${n} sold listing(s) with no soldAt`)
  if (!apply) {
    console.log('dry run — re-run with --apply to set soldAt = updatedAt on them')
  } else {
    let total = 0
    for (;;) {
      const r = await c.query(`
        UPDATE "Listing" SET "soldAt" = "updatedAt"
        WHERE id IN (SELECT id FROM "Listing" WHERE status = 'sold' AND "soldAt" IS NULL LIMIT 1000)`)
      total += r.rowCount
      if (r.rowCount === 0) break
    }
    console.log(`froze ${total} sale time(s)`)
  }
} finally {
  await c.end()
}
