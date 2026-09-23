// ONE ADDITIVE COLUMN for the seller identity gate's HOLD state (2026-09-23).
// IDEMPOTENT — safe to re-run, and MUST be re-applied after any `prisma db push`.
//
// Run:  node scripts/listing-identity-hold-ddl.mjs
//       (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// ⛔ APPLY THIS TO PROD **BEFORE** DEPLOYING THE CODE THAT DECLARES `Listing.identityHold`. Prisma
// selects every scalar column it knows about, so the new build against an un-migrated database
// throws 42703 (undefined_column) on ANY unscoped Listing query — the feed, the PDP, the dashboard:
// a site-wide outage, not a degraded feature. The column is additive, so the CURRENT build is
// unaffected by it; database first is always the safe order. (A local `preview` build prerenders
// against the same database, so it needs the column too.)
//
// ⛔ WHY THIS IS A SCRIPT AND NOT `prisma db push`. `db push` reconciles the DATABASE to the SCHEMA,
// and this database holds more tables than Prisma models — it emits DROP TABLE for every one it does
// not manage, including live applicant PII. scripts/db-guard.mjs refuses it for that reason. The
// additive SQL is short enough to read in full:
//
//     BEGIN; SET LOCAL lock_timeout = '5s';
//     ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "identityHold" boolean NOT NULL DEFAULT false;
//     COMMIT;
//
// No DROP, no rewrite: since Postgres 11 an ADD COLUMN with a constant (non-volatile) DEFAULT is a
// catalogue-only change — existing rows read the default without being touched. Every existing row
// reads false, which is exactly "not held".
//
// ⚠️ BUT IT STILL TAKES AN ACCESS EXCLUSIVE LOCK, however briefly. Queued behind one long
// transaction, it would block every Listing read that arrives after it — a site-wide stall. The
// 5-second lock_timeout makes it give up instead; re-run it in a quieter moment if it does.
//
// ⚠️ NO INDEX, DELIBERATELY. The only reader is releaseIdentityHolds() — "this owner's held rows",
// run when a seller becomes verified, a rare event — and the release script. A partial index would
// be invisible to Prisma (it cannot express WHERE on an index), so every future `prisma migrate diff`
// would emit a DROP INDEX for it; a scan of ~110k rows (~125 ms, measured) on a rare path is cheaper
// than that hazard.
import 'dotenv/config'
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DIRECT_URL / DATABASE_URL not set — refusing to guess a target.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  // ⚠️ SET LOCAL INSIDE A TRANSACTION, not a bare SET: on the pooled DATABASE_URL (transaction
  // pooling) a session-level SET does not survive to the next statement, so the timeout would be
  // silently absent exactly when it matters.
  process.stdout.write('  Listing.identityHold … ')
  await client.query('BEGIN')
  await client.query(`SET LOCAL lock_timeout = '5s'`)
  await client.query('ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "identityHold" boolean NOT NULL DEFAULT false')
  await client.query('COMMIT')
  console.log('ok')

  const { rows } = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'Listing' AND column_name = 'identityHold'`,
  )
  console.log('\n  verify column:', rows[0] ?? 'MISSING')
  if (!rows[0]) process.exitCode = 1
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  // 55P03 = lock_not_available: the lock_timeout fired. Nothing changed; try again later.
  console.error(e.code === '55P03' ? '\n  ⚠️ could not get the lock within 5s — nothing changed; re-run when the site is quieter' : e)
  process.exitCode = 1
} finally {
  await client.end()
}
