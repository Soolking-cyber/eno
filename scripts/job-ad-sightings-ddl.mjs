#!/usr/bin/env node
// ── JobAdSighting: the D3 job-ad history log (~/eno-seo-teachers-2026-10/PLAN.md §3(d), 2026-10-19) ─────────────────
//
//   set -a; . ./.env; set +a; node scripts/job-ad-sightings-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// RUN ON PRODUCTION BEFORE THE DEPLOY THAT DECLARES THE MODEL. prisma/ changed, so eno-deploy.sh's step 2 refuses that
// deploy unless SCHEMA_OK = the full sha of the HEAD being deployed (it compares `git rev-parse HEAD` after the pull — not
// this commit's sha), and keeps asking for it until one deploy that carries this commit succeeds. A NEW TABLE, never a
// column on an existing one: no app query reads it, so neither the old nor the new revision breaks without it. The writer
// is scripts/import-jobs.ts, run by the daily jobs refresh from the Mac's ~/eno.vn checkout — it reaches that job with the
// COMMIT, not the deploy — and until this has run it logs "history log NOT written" and imports exactly as before.
//
// EXACTLY Prisma's own DDL for the JobAdSighting model (`prisma migrate diff` from the previous schema prints this CREATE
// TABLE and CREATE INDEX and nothing else, so it shows no drift once this has run), made idempotent;
// src/lib/job-ad-sightings.test.ts pins it to schema.prisma and runs these statements in PGlite.
// ⛔ FACTS ONLY — no ad text, contact, person's name or visa/TRC field (the model's comment; src/lib/job-ad-sightings.ts).
// ⛔ CLOSED TO THE API ROLES: RLS on with NO policy, AND anon/authenticated/PUBLIC revoked — RLS is not what keeps PostgREST
// out, grants are (rum-ddl.mjs). The importer writes as postgres (BYPASSRLS); nothing else touches the table.
// ⚠️ NO FOREIGN KEY to Listing (the model's comment): nothing here locks the Listing table.
//
// Idempotent; one transaction with a 5 s lock timeout; safe to re-run any time.
import pg from 'pg'

const STATEMENTS = [
  [
    'JobAdSighting table',
    `CREATE TABLE IF NOT EXISTS public."JobAdSighting" (
       "externalId" TEXT NOT NULL,
       "board" TEXT NOT NULL,
       "firstSeenAt" TIMESTAMP(3) NOT NULL,
       "lastSeenAt" TIMESTAMP(3) NOT NULL,
       "seenCount" INTEGER NOT NULL DEFAULT 1,
       "listingId" TEXT,
       "title" TEXT NOT NULL,
       "city" TEXT NOT NULL,
       "employer" TEXT,
       "employmentType" TEXT,
       "salaryMin" INTEGER,
       "salaryMax" INTEGER,
       "salaryCurrency" TEXT,
       "salaryPeriod" TEXT,
       "workPermitSupport" BOOLEAN,
       "category" TEXT NOT NULL,
       "subcategory" TEXT NOT NULL,
       "postedOn" DATE NOT NULL,
       "lastPostedOn" DATE NOT NULL,
       "applyBy" DATE,
       CONSTRAINT "JobAdSighting_pkey" PRIMARY KEY ("externalId")
     )`,
  ],
  [
    // The aggregates' index: new ads per board per week (firstSeenAt).
    'JobAdSighting (board, firstSeenAt) index',
    `CREATE INDEX IF NOT EXISTS "JobAdSighting_board_firstSeenAt_idx" ON public."JobAdSighting"("board", "firstSeenAt")`,
  ],
  ['JobAdSighting RLS on', `ALTER TABLE public."JobAdSighting" ENABLE ROW LEVEL SECURITY`],
  [
    // ⚠️⚠️ REVOKE — Supabase's default privileges hand every new public table to `anon` and `authenticated`. Each role only
    // where it exists (rls-guard.sql's to_regrole): a scratch Postgres has neither, and a bare REVOKE would abort the run.
    'JobAdSighting revoke API roles',
    `DO $$ BEGIN
       IF to_regrole('anon') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON public."JobAdSighting" FROM anon'; END IF;
       IF to_regrole('authenticated') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON public."JobAdSighting" FROM authenticated'; END IF;
       EXECUTE 'REVOKE ALL ON public."JobAdSighting" FROM PUBLIC';
     END $$`,
  ],
]

/** The table as the statement above makes it — asserted, because CREATE TABLE IF NOT EXISTS keeps one of another shape. */
const SHAPE = [
  'externalId:text:NO', 'board:text:NO', 'firstSeenAt:timestamp without time zone:NO', 'lastSeenAt:timestamp without time zone:NO',
  'seenCount:integer:NO', 'listingId:text:YES', 'title:text:NO', 'city:text:NO', 'employer:text:YES', 'employmentType:text:YES',
  'salaryMin:integer:YES', 'salaryMax:integer:YES', 'salaryCurrency:text:YES', 'salaryPeriod:text:YES',
  'workPermitSupport:boolean:YES', 'category:text:NO', 'subcategory:text:NO', 'postedOn:date:NO', 'lastPostedOn:date:NO',
  'applyBy:date:YES',
].join(',')

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
  // Assert rather than assume: the shape, the key, RLS on, and no grant left for the API roles.
  const cols = await client.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'JobAdSighting' ORDER BY ordinal_position`)
  const shape = cols.rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`).join(',')
  if (shape !== SHAPE) throw new Error(`unexpected columns (${shape}) — rolled back.`)
  const pk = await client.query(
    `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'public."JobAdSighting"'::regclass AND i.indisprimary`)
  const key = pk.rows.map((r) => r.attname).join(',')
  if (key !== 'externalId') throw new Error(`the primary key is (${key || 'none'}), not ("externalId") — the importer upserts ON CONFLICT ("externalId"); rolled back.`)
  const rel = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public."JobAdSighting"'::regclass`)
  if (!rel.rows[0]?.relrowsecurity) throw new Error('RLS did not switch on for JobAdSighting — rolled back.')
  // has_table_privilege asks Postgres directly, whoever runs this (rum-ddl.mjs: information_schema lists only grants
  // involving the current role); COLUMN grants through has_any_column_privilege; PUBLIC through aclexplode (grantee 0);
  // and MAINTAIN on Postgres 17+ (it allows LOCK TABLE; the keyword errors on 16 and older).
  const v17 = Number((await client.query(`SELECT current_setting('server_version_num') AS v`)).rows[0].v) >= 170000
  const priv = await client.query(
    `SELECT r.rolname FROM pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated')
        AND (has_table_privilege(r.rolname, 'public."JobAdSighting"', $1)
             OR has_any_column_privilege(r.rolname, 'public."JobAdSighting"', 'SELECT,INSERT,UPDATE,REFERENCES'))
     UNION ALL
     SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = 'public."JobAdSighting"'::regclass AND a.grantee = 0`,
    [`SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER${v17 ? ',MAINTAIN' : ''}`])
  if (priv.rows.length) throw new Error(`JobAdSighting still grants ${JSON.stringify(priv.rows)} — rolled back.`)
  await client.query('COMMIT')
  console.log('✓ committed')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
