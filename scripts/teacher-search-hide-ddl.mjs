#!/usr/bin/env node
// ── TeacherProfile.hideFromSearch: the teacher's "Hide my profile from search engines" (owner decision 14, 2026-10-20) ──
//
//   set -a; . ./.env; set +a; node scripts/teacher-search-hide-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// ⛔ RUN ON PRODUCTION BEFORE THE DEPLOY THAT DECLARES THE COLUMN. Prisma selects every scalar column it knows, so the new
// revision against a table without it answers 42703 (undefined_column) on every TeacherProfile read: the teacher profile
// pages, the teacher form's GET /api/teachers/me, every save, the sitemaps. The column is ADDITIVE, so the CURRENT
// revision is unaffected by it — database first is always the safe order. prisma/ changed, so eno-deploy.sh refuses the
// deploy unless SCHEMA_OK = the full sha of the HEAD being deployed.
//
// EXACTLY Prisma's own DDL for schema.prisma's TeacherProfile.hideFromSearch (`prisma migrate diff` prints this one
// ADD COLUMN and nothing else, so it shows no drift once this has run), made idempotent; src/lib/teachers/search-hide-ddl.test.ts
// pins it to the schema and runs it in PGlite.
// ⛔ NOT BACKFILLED, AND THE DEFAULT IS THE ANSWER: every existing profile reads false — the teacher has not asked to be
// hidden — and is judged by the quality floor alone (src/lib/teachers/search-floor.ts). Never flip the default or write
// true by script: it is the teacher's own choice, saved by their own switch.
// No table rewrite: on Postgres 11+ a constant default is a catalogue change. ⚠️ It still takes an ACCESS EXCLUSIVE lock
// on TeacherProfile for that instant, so it runs alone, in one short transaction, under a 5 s lock_timeout (a queued ALTER
// would stall every profile read behind it) — re-run it in a quieter moment if it gives up.
// ⛔ It REFUSES a column of another shape (CREATE … IF NOT EXISTS keeps whatever is there), checks that TeacherProfile
// still has RLS on, and that no API role (anon, authenticated — PostgREST's) can read its ROWS, and so the new column: no
// policy admits them (or PUBLIC, or a role they inherit) and neither bypasses RLS — rolling back if any of that is not so.
// Not a new table, so no RLS or REVOKE of its own: the table's protection is asserted instead.
//
// Idempotent; safe to re-run any time.
import pg from 'pg'

const STATEMENTS = [
  [
    'TeacherProfile.hideFromSearch',
    `ALTER TABLE public."TeacherProfile" ADD COLUMN IF NOT EXISTS "hideFromSearch" BOOLEAN NOT NULL DEFAULT false`,
  ],
]

/** The column as the statement above makes it — name:type:nullable:default — asserted, never assumed. */
const SHAPE = 'hideFromSearch:boolean:NO:false'
const SHAPE_SQL = `SELECT column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, 'NULL') AS s
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TeacherProfile' AND column_name = 'hideFromSearch'`
// What could let an API role read a TeacherProfile row, and so the new column — must be nothing: a policy that admits
// anon or authenticated (by name, through PUBLIC, or through a role either inherits), or either role bypassing RLS.
// ⚠️ ROWS, NOT PRIVILEGES (verifier, 2026-10-20): Supabase's default privileges give anon/authenticated ALL on every
// public table, and TeacherProfile keeps them — scripts/teachers-ddl.mjs switches RLS on with no policy and takes
// nothing back, and rls-guard.sql takes nothing back on a table either. A column-privilege test counts that table-level
// ALL, so it named both roles on a production-shaped table and refused every run (measured in PGlite). RLS on (asserted
// below) with no policy for them is what keeps PostgREST out (rls-guard.sql), so that is what is asserted here.
const API_ACCESS_SQL = `SELECT 'policy ' || p.policyname AS rolname FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'TeacherProfile'
     AND EXISTS (SELECT 1 FROM unnest(p.roles) AS pr(name)
                  WHERE pr.name = 'public'
                     OR EXISTS (SELECT 1 FROM pg_roles api JOIN pg_roles target ON target.rolname = pr.name
                                 WHERE api.rolname IN ('anon', 'authenticated') AND pg_has_role(api.oid, target.oid, 'MEMBER')))
  UNION ALL
  SELECT r.rolname FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated') AND r.rolbypassrls`

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
  const table = await client.query(`SELECT to_regclass('public."TeacherProfile"') AS t`)
  if (!table.rows[0]?.t) throw new Error('TeacherProfile does not exist — this is not the eno database; rolled back.')
  for (const [label, sql] of STATEMENTS) {
    await client.query(sql)
    console.log(`✓ ${label}`)
  }
  const shape = (await client.query(SHAPE_SQL)).rows.map((r) => r.s).join(',')
  if (shape !== SHAPE) throw new Error(`TeacherProfile."hideFromSearch" is (${shape || 'missing'}), not (${SHAPE}) — stop and look; rolled back.`)
  const rel = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public."TeacherProfile"'::regclass`)
  if (!rel.rows[0]?.relrowsecurity) throw new Error('RLS is OFF on TeacherProfile — run scripts/rls-guard.sql and look before deploying; rolled back.')
  const open = (await client.query(API_ACCESS_SQL)).rows.map((r) => r.rolname)
  if (open.length) throw new Error(`TeacherProfile rows are readable by an API role through ${JSON.stringify(open)} — stop and look before deploying (rls-guard.sql does not evaluate policies); rolled back.`)
  await client.query('COMMIT')
  console.log('✓ committed')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
