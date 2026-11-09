#!/usr/bin/env node
// ── SavedListing: a signed-in person's saved listings, on every device (owner, 2026-11-09: "3 ok") ─────────────────────
//
//   set -a; . ./.env; set +a; node scripts/saved-listings-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// Until now a heart lived only in the browser (favorites-context.tsx), for guests and signed-in people alike. A signed-in
// person's saves now live here and follow them to every device; a guest's move here at sign-in (src/lib/saved-sync.ts).
// RUN ON PRODUCTION BEFORE THE DEPLOY THAT DECLARES THE MODEL. prisma/ changed, so eno-deploy.sh's step 2 refuses that
// deploy unless SCHEMA_OK = the full sha of the HEAD being deployed. A NEW TABLE: the current revision never reads it,
// and the new one tolerates its absence (GET /api/saved-listings answers `available: false`, and the browser keeps
// saving on the device as before) — but database first is the order.
//
// EXACTLY Prisma's own DDL for the SavedListing model (`prisma migrate diff` prints this CREATE TABLE, the two CREATE
// INDEXes and the two foreign keys and nothing else, so it shows no drift once this has run), made idempotent;
// src/lib/saved-listings-ddl.test.ts pins it to schema.prisma and runs it in PGlite.
// ⛔ CLOSED TO THE API ROLES: RLS on with NO policy, AND anon/authenticated/PUBLIC revoked — RLS is not what keeps PostgREST
// out, grants are (rum-ddl.mjs). The app writes as postgres (BYPASSRLS); nothing else touches the table.
// ⚠️ The two foreign keys take a SHARE ROW EXCLUSIVE lock on Profile and Listing for the instant they are added (the new
// table is empty, so there is nothing to validate) — it waits behind writes already running on Listing and holds new
// ones back while it waits, hence the 5 s lock_timeout: re-run in a quieter moment if it gives up. Nothing slow runs
// before COMMIT (the asserts read catalogs only).
//
// Idempotent; one transaction; safe to re-run any time.
import pg from 'pg'

const STATEMENTS = [
  [
    'SavedListing table',
    `CREATE TABLE IF NOT EXISTS public."SavedListing" (
       "profileId" UUID NOT NULL,
       "listingId" TEXT NOT NULL,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "SavedListing_pkey" PRIMARY KEY ("profileId","listingId")
     )`,
  ],
  ['SavedListing (profileId, createdAt) index', `CREATE INDEX IF NOT EXISTS "SavedListing_profileId_createdAt_idx" ON public."SavedListing"("profileId", "createdAt")`],
  ['SavedListing (listingId) index', `CREATE INDEX IF NOT EXISTS "SavedListing_listingId_idx" ON public."SavedListing"("listingId")`],
  [
    'SavedListing → Profile foreign key',
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SavedListing_profileId_fkey' AND conrelid = 'public."SavedListing"'::regclass) THEN
         ALTER TABLE public."SavedListing" ADD CONSTRAINT "SavedListing_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES public."Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
       END IF;
     END $$`,
  ],
  [
    'SavedListing → Listing foreign key',
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SavedListing_listingId_fkey' AND conrelid = 'public."SavedListing"'::regclass) THEN
         ALTER TABLE public."SavedListing" ADD CONSTRAINT "SavedListing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES public."Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
       END IF;
     END $$`,
  ],
  ['SavedListing RLS on', `ALTER TABLE public."SavedListing" ENABLE ROW LEVEL SECURITY`],
  [
    // ⚠️⚠️ REVOKE — Supabase's default privileges hand every new public table to `anon` and `authenticated`. Each role only
    // where it exists (rls-guard.sql's to_regrole): a scratch Postgres has neither, and a bare REVOKE would abort the run.
    'SavedListing revoke API roles',
    `DO $$ BEGIN
       IF to_regrole('anon') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON public."SavedListing" FROM anon'; END IF;
       IF to_regrole('authenticated') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON public."SavedListing" FROM authenticated'; END IF;
       EXECUTE 'REVOKE ALL ON public."SavedListing" FROM PUBLIC';
     END $$`,
  ],
]

/** The table as the statement above makes it — asserted, because CREATE TABLE IF NOT EXISTS keeps one of another shape. */
const SHAPE = ['profileId:uuid:NO', 'listingId:text:NO', 'createdAt:timestamp without time zone:NO'].join(',')
/** The two foreign keys — name:referenced table:on delete — asserted the same way (an existing name proves nothing). */
const FKEYS = ['SavedListing_listingId_fkey:Listing:c', 'SavedListing_profileId_fkey:Profile:c'].join(',')

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
  const base = await client.query(`SELECT to_regclass('public."Profile"') AS p, to_regclass('public."Listing"') AS s`)
  if (!base.rows[0]?.p || !base.rows[0]?.s) throw new Error('Profile or Listing does not exist — this is not the eno database; rolled back.')
  for (const [label, sql] of STATEMENTS) {
    await client.query(sql)
    console.log(`✓ ${label}`)
  }
  // Assert rather than assume: the shape, the key, the foreign keys, RLS on, and no grant left for the API roles.
  const cols = await client.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'SavedListing' ORDER BY ordinal_position`)
  const shape = cols.rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`).join(',')
  if (shape !== SHAPE) throw new Error(`unexpected columns (${shape}) — rolled back.`)
  const pk = await client.query(
    `SELECT a.attname FROM pg_index i JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, n) ON true
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indrelid = 'public."SavedListing"'::regclass AND i.indisprimary ORDER BY k.n`)
  const key = pk.rows.map((r) => r.attname).join(',')
  if (key !== 'profileId,listingId') throw new Error(`the primary key is (${key || 'none'}), not ("profileId","listingId") — the app's createMany skipDuplicates relies on it; rolled back.`)
  const fks = await client.query(
    `SELECT c.conname || ':' || t.relname || ':' || c.confdeltype::text AS f FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid
      WHERE c.conrelid = 'public."SavedListing"'::regclass AND c.contype = 'f' ORDER BY c.conname`)
  const fk = fks.rows.map((r) => r.f).join(',')
  if (fk !== FKEYS) throw new Error(`unexpected foreign keys (${fk || 'none'}), not (${FKEYS}) — rolled back.`)
  const rel = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public."SavedListing"'::regclass`)
  if (!rel.rows[0]?.relrowsecurity) throw new Error('RLS did not switch on for SavedListing — rolled back.')
  // has_table_privilege asks Postgres directly, whoever runs this (rum-ddl.mjs: information_schema lists only grants
  // involving the current role); COLUMN grants through has_any_column_privilege; PUBLIC through aclexplode (grantee 0);
  // and MAINTAIN on Postgres 17+ (it allows LOCK TABLE; the keyword errors on 16 and older).
  const v17 = Number((await client.query(`SELECT current_setting('server_version_num') AS v`)).rows[0].v) >= 170000
  const priv = await client.query(
    `SELECT r.rolname FROM pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated')
        AND (has_table_privilege(r.rolname, 'public."SavedListing"', $1)
             OR has_any_column_privilege(r.rolname, 'public."SavedListing"', 'SELECT,INSERT,UPDATE,REFERENCES'))
     UNION ALL
     SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = 'public."SavedListing"'::regclass AND a.grantee = 0`,
    [`SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER${v17 ? ',MAINTAIN' : ''}`])
  if (priv.rows.length) throw new Error(`SavedListing still grants ${JSON.stringify(priv.rows)} — rolled back.`)
  await client.query('COMMIT')
  console.log('✓ committed')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
