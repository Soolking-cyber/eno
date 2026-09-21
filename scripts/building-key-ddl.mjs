// ONE ADDITIVE COLUMN + its index, so rentals can be grouped by BUILDING (Rever import, 2026-09-21).
// IDEMPOTENT — safe to re-run, and MUST be re-applied after any `prisma db push`.
//
// Run:  node scripts/building-key-ddl.mjs
//       (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// ⛔ WHY THIS IS A SCRIPT AND NOT `prisma db push`. `db push` reconciles the DATABASE to the SCHEMA,
// and this database holds more tables than Prisma models — it emits DROP TABLE for every one it
// does not manage, including live applicant PII. scripts/db-guard.mjs refuses it for that reason.
// The documented safe flow is "generate the SQL, read it, apply only what is additive", and for one
// nullable column the additive SQL is short enough to read in full:
//
//     ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "buildingKey" TEXT;
//     CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_buildingKey_status_idx"
//       ON "Listing" ("buildingKey", "status");
//
// No DROP, no NOT NULL, no DEFAULT, no rewrite: `ADD COLUMN ... TEXT` with no default is a
// catalogue-only change in Postgres 11+, so it cannot block on a large `Listing`. Every existing row
// reads NULL, which is exactly "not part of a known building".
//
// ⚠️ APPLY THIS BEFORE DEPLOYING THE CODE THAT SELECTS THE COLUMN. Prisma selects every scalar
// column it knows about, so a new revision against an un-migrated database throws 42703
// (undefined_column) on ANY unscoped Listing query — a site-wide outage, not a degraded feature.
//
// ⛔ WHY A COLUMN AND NOT THE `attributes` JSON BLOB. The aggregation endpoint has to GROUP BY this
// and count 1,100 rows against the live feed filters; a JSON substring match cannot use an index and
// would need one query per building. Both plan reviewers also rejected keying on (lat,lng): the
// coordinate is Rever's geocode of the PROJECT, and a shared point is not a shared building — other
// projects sit on the same geocode, and any user listing dropped there would silently join it.
//
// ⚠️ CREATE INDEX CONCURRENTLY CANNOT RUN INSIDE A TRANSACTION, which is why the statements below
// are executed one at a time on a plain connection rather than wrapped in BEGIN/COMMIT. It also
// means a failed build leaves an INVALID index behind; the script reports that rather than hiding it.
import 'dotenv/config'
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DIRECT_URL / DATABASE_URL not set — refusing to guess a target.')
  process.exit(1)
}

const STATEMENTS = [
  ['Listing.buildingKey', 'ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "buildingKey" TEXT'],
  [
    'Listing_buildingKey_status_idx',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Listing_buildingKey_status_idx" ON "Listing" ("buildingKey", "status")',
  ],
]

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  for (const [label, sql] of STATEMENTS) {
    process.stdout.write(`  ${label} … `)
    await client.query(sql)
    console.log('ok')
  }

  const { rows } = await client.query(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'Listing' AND column_name = 'buildingKey'`,
  )
  console.log('\n  verify column:', rows[0] ?? 'MISSING')

  // ⚠️ An index that failed to build is left INVALID and is silently NOT USED by the planner.
  const { rows: idx } = await client.query(
    `SELECT i.relname AS name, ix.indisvalid AS valid
       FROM pg_class i
       JOIN pg_index ix ON ix.indexrelid = i.oid
      WHERE i.relname = 'Listing_buildingKey_status_idx'`,
  )
  console.log('  verify index: ', idx[0] ?? 'MISSING')
  if (idx[0] && idx[0].valid === false) {
    console.error('\n  ⛔ INDEX IS INVALID — drop it and re-run, or queries will seq-scan Listing.')
    process.exitCode = 1
  }
} finally {
  await client.end()
}
