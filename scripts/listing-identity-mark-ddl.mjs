// ONE ADDITIVE COLUMN for the teacher card's "Identity verified" tick — its DISPLAY CACHE (2026-10-16).
// IDEMPOTENT — safe to re-run, and MUST be re-applied after any `prisma db push`.
//
// Run:  node scripts/listing-identity-mark-ddl.mjs
//       (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// ⛔ APPLY THIS TO PROD **BEFORE** DEPLOYING THE CODE THAT DECLARES `Listing.identityMarkNotice` — and before any local
// `preview:vn` or `dev:vn` of that branch, both of which read the production database. Prisma selects every scalar
// column it knows about, so the new build against an un-migrated database throws 42703 (undefined_column) on ANY
// unscoped Listing query — the feed, the PDP, the dashboard: a site-wide outage, not a degraded feature. The column is
// additive, so the CURRENT build is unaffected by it; database first is always the safe order. Run
// scripts/teachers-ddl.mjs too (the four TeacherProfile.identityMark* columns), then scripts/rls-guard.sql.
//
// ⛔ WHY IT IS NOT IN scripts/teachers-ddl.mjs, where the TeacherProfile half lives. `ALTER TABLE "Listing"` takes an
// ACCESS EXCLUSIVE lock BEFORE `IF NOT EXISTS` is checked, so even a run that finds the column already there queues
// for that lock. teachers-ddl.mjs is "re-run any time", in ONE transaction that also takes a lock on the busy
// Conversation table: putting this ALTER there would make every future run of it a chance to stall every Listing read
// site-wide behind it. Alone, here, it holds the lock for one catalogue change and nothing else.
//
// ⛔ WHY THIS IS A SCRIPT AND NOT `prisma db push`. `db push` reconciles the DATABASE to the SCHEMA,
// and this database holds more tables than Prisma models — it emits DROP TABLE for every one it does
// not manage, including live applicant PII. scripts/db-guard.mjs refuses it for that reason. The
// additive SQL is short enough to read in full:
//
//     BEGIN; SET LOCAL lock_timeout = '5s';
//     ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "identityMarkNotice" text;
//     COMMIT;
//
// No DROP, no rewrite: a NULLABLE column with NO DEFAULT is a catalogue-only change — existing rows read NULL without
// being touched. NULL is exactly "the tick is not shown" (src/lib/teachers/identity-mark-card.ts writes the rule's
// version while it is), so no row needs a backfill BY SQL: a teacher's tick appears when its first sync runs — their
// own show-again, any profile save, the identity effects of a KYC decision, or the card pass (00:05 ICT, and after the
// 09:05 reconcile). ⚠️ BUT THE MARK IS AUTOMATIC SINCE 2026-10-16, so every teacher already verified is owed a tick
// the moment that rule deploys, and no event of theirs will come: run /api/cron/identity-marks once by hand right after
// the deploy (`?dryRun=1` first — its selection covers every identity holder, so it IS the backfill; or
// /api/cron/identity-reconcile, whose loop does the same). Until then their cards carry no tick, and their 30-day ISR
// profile pages keep the HTML from before the deploy (the ISR cache survives a deploy).
//
// ⚠️ BUT IT STILL TAKES AN ACCESS EXCLUSIVE LOCK, however briefly. Queued behind one long
// transaction, it would block every Listing read that arrives after it — a site-wide stall. The
// 5-second lock_timeout makes it give up instead; re-run it in a quieter moment if it does.
//
// ⚠️ NO INDEX, DELIBERATELY. The card reads it off rows it already has (one more column of the card select); the only
// query that FILTERS on it is the card pass's selection (00:05 ICT, and after the 09:05 reconcile), which starts from
// TeacherProfile (a few hundred rows) and reaches each Listing by its primary key. A partial index would be invisible to
// Prisma (it cannot express WHERE on an index), so every future `prisma migrate diff` would emit a DROP INDEX for it.
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
  process.stdout.write('  Listing.identityMarkNotice … ')
  await client.query('BEGIN')
  await client.query(`SET LOCAL lock_timeout = '5s'`)
  await client.query('ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "identityMarkNotice" text')
  await client.query('COMMIT')
  console.log('ok')

  const { rows } = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'Listing' AND column_name = 'identityMarkNotice'`,
  )
  console.log('\n  verify column:', rows[0] ?? 'MISSING')
  // The shape the code relies on: text, NULLABLE, no default (NULL = not shown). Anything else is not this script's
  // column — say so rather than report success.
  if (!rows[0] || rows[0].data_type !== 'text' || rows[0].is_nullable !== 'YES' || rows[0].column_default !== null) {
    console.error('  ⚠️ the column is missing or not `text NULL` with no default — stop and look before deploying')
    process.exitCode = 1
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  // 55P03 = lock_not_available: the lock_timeout fired. Nothing changed; try again later.
  console.error(e.code === '55P03' ? '\n  ⚠️ could not get the lock within 5s — nothing changed; re-run when the site is quieter' : e)
  process.exitCode = 1
} finally {
  await client.end()
}
