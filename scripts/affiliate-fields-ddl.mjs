// The three ADDITIVE columns that partner-affiliate listings need (VinWonders, 2026-08-24).
// IDEMPOTENT — safe to re-run, and MUST be re-applied after any `prisma db push`.
//
// Run:  node scripts/affiliate-fields-ddl.mjs
//       (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// ⛔ WHY THIS IS A SCRIPT AND NOT `prisma db push`. `db push` reconciles the DATABASE to the
// SCHEMA, and this database holds 67 tables against 52 Prisma models — it emits 18 DROP TABLE
// statements including visa_applications (live applicant PII). scripts/db-guard.mjs refuses it for
// exactly that reason. The documented safe flow is "generate the SQL, read it, apply only what is
// additive", and for three nullable columns the additive SQL is short enough to read in full:
//
//     ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "affiliateUrl" TEXT;
//     ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "affiliateDiscountCode" TEXT;
//     ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "affiliateDiscountPercent" INTEGER;
//     ALTER TABLE "Seller"  ADD COLUMN IF NOT EXISTS "affiliateDiscountCode" TEXT;
//     ALTER TABLE "Seller"  ADD COLUMN IF NOT EXISTS "affiliateDiscountPercent" INTEGER;
//
// There is no DROP, no NOT NULL, no DEFAULT and no rewrite: `ADD COLUMN ... TEXT` with no default
// is a catalogue-only change in Postgres 11+, so it does not rewrite the table and cannot block on
// a large `Listing`. Every existing row reads NULL, which is exactly "not an affiliate listing".
//
// ⚠️ APPLY THIS BEFORE DEPLOYING THE CODE THAT SELECTS THE COLUMNS. Prisma selects every scalar
// column it knows about, so a new revision against an un-migrated database throws 42703
// (undefined_column) on ANY unscoped Listing/Seller query — not just affiliate ones. That is a
// site-wide outage, not a degraded feature.
import 'dotenv/config'
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DIRECT_URL / DATABASE_URL not set — refusing to guess a target.')
  process.exit(1)
}

const STATEMENTS = [
  ['Listing', 'affiliateUrl', 'ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "affiliateUrl" TEXT'],
  ['Listing', 'affiliateDiscountCode', 'ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "affiliateDiscountCode" TEXT'],
  ['Listing', 'affiliateDiscountPercent', 'ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "affiliateDiscountPercent" INTEGER'],
  ['Seller', 'affiliateDiscountCode', 'ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "affiliateDiscountCode" TEXT'],
  ['Seller', 'affiliateDiscountPercent', 'ALTER TABLE "Seller" ADD COLUMN IF NOT EXISTS "affiliateDiscountPercent" INTEGER'],
]

const client = new pg.Client({ connectionString: url })
await client.connect()

// Say which database this is before touching it — `url` falls back to DATABASE_URL, and a stale
// value would point somewhere else entirely.
{
  const { hostname, port } = new URL(url)
  const { rows } = await client.query('select current_database() db')
  console.log(`Target: ${hostname}:${port} -> ${rows[0].db}`)
}

await client.query('begin')
try {
  for (const [, , sql] of STATEMENTS) {
    if (/\bDROP\b/i.test(sql)) throw new Error(`refusing a statement containing DROP: ${sql}`)
    await client.query(sql)
  }
  await client.query('commit')
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('Rolled back:', e.message)
  await client.end()
  process.exit(1)
}

// Verify against the catalogue rather than trusting the statements ran — IF NOT EXISTS makes a
// no-op indistinguishable from a success in the command tag.
let missing = 0
for (const [table, column] of STATEMENTS) {
  const { rows } = await client.query(
    `select data_type from information_schema.columns
      where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column],
  )
  if (rows.length) console.log(`  ok  ${table}.${column} (${rows[0].data_type})`)
  else { console.error(`  MISSING  ${table}.${column}`); missing++ }
}
await client.end()
if (missing) { console.error(`${missing} column(s) missing after apply.`); process.exit(1) }
console.log('All affiliate columns present. Next: npx prisma generate, then deploy.')
