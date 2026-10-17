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

// ⛔ THE INDEX MOVED (speed plan item 9, 2026-10-17): the full ("buildingKey", status) index was replaced by the partial
// Listing_live_buildingKey_idx (WHERE "buildingKey" IS NOT NULL AND verified AND status = 'active') in
// scripts/listing-index-diet-ddl.mjs — every building query is scoped to live rows. Re-creating the old one here would
// put back the write cost the diet removed, so this script now adds the column only.
const STATEMENTS = [
  ['Listing.buildingKey', 'ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "buildingKey" TEXT'],
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

  console.log('  (the building index is scripts/listing-index-diet-ddl.mjs → Listing_live_buildingKey_idx)')
} finally {
  await client.end()
}
