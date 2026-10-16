#!/usr/bin/env node
// ── rum_daily: the page-speed totals (speed plan item 5, 2026-10-16) ──────────────────────────────────────
//
//   set -a; . ./.env; set +a; node scripts/rum-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// RUN ON PRODUCTION BEFORE THE DEPLOY THAT SHIPS /api/page-speed. The code tolerates the table being absent (the
// flush logs once and drops its batch — src/lib/rum/store.ts), so a late run only loses the totals in between.
//
// One row per (VN day, edition, family, dims, bucket) holding a COUNT — src/lib/rum/ops.ts lists the families.
// ⛔ NOTHING ABOUT A VISITOR: no IP, account, cookie, user agent or page address; labels are closed sets
// (src/lib/rum/shared.ts). /privacy: "Page speed measurements". Rows older than 400 days are deleted by the flush.
// ⚠️ LOGGED, deliberately (both plan reviewers, 2026-10-16): kv_store is UNLOGGED, so a Postgres crash would empty
// 13 months of history, and it is the rate limiter's hot table besides. Writes are batched (one statement per
// process per 30 s), so a logged table costs nothing that matters.
// ⚠️ OUTSIDE PRISMA — prisma/schema.prisma does not know it (CLAUDE.md lists it among the tables `db push` would
// DROP). Written only through db.$executeRaw as postgres (BYPASSRLS).
//
// Idempotent; one transaction with a 5 s lock timeout; safe to re-run any time.
import pg from 'pg'

const STATEMENTS = [
  [
    'rum_daily table',
    `CREATE TABLE IF NOT EXISTS public.rum_daily (
       day     date    NOT NULL,
       edition text    NOT NULL,
       family  text    NOT NULL,
       dims    text    NOT NULL,
       bucket  integer NOT NULL,
       n       bigint  NOT NULL DEFAULT 0,
       PRIMARY KEY (day, edition, family, dims, bucket)
     )`,
  ],
  ['rum_daily RLS on', `ALTER TABLE public.rum_daily ENABLE ROW LEVEL SECURITY`],
  [
    // ⚠️⚠️ REVOKE FIRST — RLS IS NOT WHAT KEEPS PostgREST OUT, GRANTS ARE (apple-siwa-ddl.mjs). Supabase's default
    // privileges hand new public tables to `anon` and `authenticated`.
    'rum_daily revoke API roles',
    `REVOKE ALL ON public.rum_daily FROM anon, authenticated, PUBLIC`,
  ],
  [
    // `TO service_role` — a policy with no TO clause is TO PUBLIC (the auth_handoff lesson).
    'rum_daily service-role policy',
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rum_daily' AND policyname = 'service_only') THEN
         CREATE POLICY service_only ON public.rum_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
       END IF;
     END $$`,
  ],
]

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DIRECT_URL or DATABASE_URL required')
  process.exit(1)
}
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('BEGIN')
  await client.query("SET LOCAL lock_timeout = '5s'")
  for (const [label, sql] of STATEMENTS) {
    await client.query(sql)
    console.log(`✓ ${label}`)
  }
  // Assert rather than assume: logged, RLS on, and no grant left for the API roles.
  const rel = await client.query(`SELECT relrowsecurity, relpersistence FROM pg_class WHERE oid = 'public.rum_daily'::regclass`)
  if (!rel.rows[0]?.relrowsecurity) throw new Error('RLS did not switch on for rum_daily — rolled back.')
  if (rel.rows[0]?.relpersistence !== 'p') throw new Error(`rum_daily is not a logged table (relpersistence=${rel.rows[0]?.relpersistence}) — rolled back.`)
  const grants = await client.query(
    `SELECT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'rum_daily' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`,
  )
  if (grants.rows.length) throw new Error(`rum_daily still grants ${JSON.stringify(grants.rows)} — rolled back.`)
  await client.query('COMMIT')
  console.log('✓ committed')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
