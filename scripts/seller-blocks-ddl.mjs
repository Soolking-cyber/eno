#!/usr/bin/env node
// ── SellerBlock: a user's block of a SHOP no blockable person runs (App Store Guideline 1.2, 2026-10-29) ────────────
//
//   set -a; . ./.env; set +a; node scripts/seller-blocks-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// Apple rejected 1.0.3 (4) on 2026-10-28 from an imported "Linked shop" storefront that offered Report and no Block —
// an ownerless shop "had nobody to block". It now blocks as a SHOP: its listings leave the blocker's feeds and
// moderators are told (src/lib/user-blocks.ts setSellerBlock / hiddenSellerIdsFor).
// RUN ON PRODUCTION BEFORE THE DEPLOY THAT DECLARES THE MODEL. prisma/ changed, so eno-deploy.sh's step 2 refuses that
// deploy unless SCHEMA_OK = the full sha of the HEAD being deployed. A NEW TABLE: the current revision never reads it,
// and the new one tolerates its absence (every read answers "no shop blocks", a shop block answers 503) — but database
// first is the order.
//
// EXACTLY Prisma's own DDL for the SellerBlock model (`prisma migrate diff` from the previous schema prints this CREATE
// TABLE, CREATE INDEX and the two foreign keys and nothing else, so it shows no drift once this has run), made
// idempotent; src/lib/seller-blocks-ddl.test.ts pins it to schema.prisma and runs it in PGlite.
// ⛔ CLOSED TO THE API ROLES: RLS on with NO policy, AND anon/authenticated/PUBLIC revoked — RLS is not what keeps PostgREST
// out, grants are (rum-ddl.mjs). The app writes as postgres (BYPASSRLS); nothing else touches the table.
// ⚠️ The two foreign keys take a SHARE ROW EXCLUSIVE lock on Profile and Seller for the instant they are added (the new
// table is empty, so there is nothing to validate) — hence the 5 s lock_timeout: re-run in a quieter moment if it gives up.
//
// Idempotent; one transaction; safe to re-run any time.
import pg from 'pg'

const STATEMENTS = [
  [
    'SellerBlock table',
    `CREATE TABLE IF NOT EXISTS public."SellerBlock" (
       "blockerProfileId" UUID NOT NULL,
       "sellerId" TEXT NOT NULL,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "SellerBlock_pkey" PRIMARY KEY ("blockerProfileId","sellerId")
     )`,
  ],
  ['SellerBlock (sellerId) index', `CREATE INDEX IF NOT EXISTS "SellerBlock_sellerId_idx" ON public."SellerBlock"("sellerId")`],
  [
    'SellerBlock → Profile foreign key',
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SellerBlock_blockerProfileId_fkey' AND conrelid = 'public."SellerBlock"'::regclass) THEN
         ALTER TABLE public."SellerBlock" ADD CONSTRAINT "SellerBlock_blockerProfileId_fkey" FOREIGN KEY ("blockerProfileId") REFERENCES public."Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
       END IF;
     END $$`,
  ],
  [
    'SellerBlock → Seller foreign key',
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SellerBlock_sellerId_fkey' AND conrelid = 'public."SellerBlock"'::regclass) THEN
         ALTER TABLE public."SellerBlock" ADD CONSTRAINT "SellerBlock_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES public."Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;
       END IF;
     END $$`,
  ],
  ['SellerBlock RLS on', `ALTER TABLE public."SellerBlock" ENABLE ROW LEVEL SECURITY`],
  [
    // ⚠️⚠️ REVOKE — Supabase's default privileges hand every new public table to `anon` and `authenticated`. Each role only
    // where it exists (rls-guard.sql's to_regrole): a scratch Postgres has neither, and a bare REVOKE would abort the run.
    'SellerBlock revoke API roles',
    `DO $$ BEGIN
       IF to_regrole('anon') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON public."SellerBlock" FROM anon'; END IF;
       IF to_regrole('authenticated') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON public."SellerBlock" FROM authenticated'; END IF;
       EXECUTE 'REVOKE ALL ON public."SellerBlock" FROM PUBLIC';
     END $$`,
  ],
]

/** The table as the statement above makes it — asserted, because CREATE TABLE IF NOT EXISTS keeps one of another shape. */
const SHAPE = ['blockerProfileId:uuid:NO', 'sellerId:text:NO', 'createdAt:timestamp without time zone:NO'].join(',')
/** The two foreign keys — name:referenced table:on delete — asserted the same way (an existing name proves nothing). */
const FKEYS = ['SellerBlock_blockerProfileId_fkey:Profile:c', 'SellerBlock_sellerId_fkey:Seller:c'].join(',')

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
  const base = await client.query(`SELECT to_regclass('public."Profile"') AS p, to_regclass('public."Seller"') AS s`)
  if (!base.rows[0]?.p || !base.rows[0]?.s) throw new Error('Profile or Seller does not exist — this is not the eno database; rolled back.')
  for (const [label, sql] of STATEMENTS) {
    await client.query(sql)
    console.log(`✓ ${label}`)
  }
  // Assert rather than assume: the shape, the key, the foreign keys, RLS on, and no grant left for the API roles.
  const cols = await client.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'SellerBlock' ORDER BY ordinal_position`)
  const shape = cols.rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`).join(',')
  if (shape !== SHAPE) throw new Error(`unexpected columns (${shape}) — rolled back.`)
  const pk = await client.query(
    `SELECT a.attname FROM pg_index i JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, n) ON true
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indrelid = 'public."SellerBlock"'::regclass AND i.indisprimary ORDER BY k.n`)
  const key = pk.rows.map((r) => r.attname).join(',')
  if (key !== 'blockerProfileId,sellerId') throw new Error(`the primary key is (${key || 'none'}), not ("blockerProfileId","sellerId") — the app's createMany skipDuplicates relies on it; rolled back.`)
  const fks = await client.query(
    `SELECT c.conname || ':' || t.relname || ':' || c.confdeltype::text AS f FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid
      WHERE c.conrelid = 'public."SellerBlock"'::regclass AND c.contype = 'f' ORDER BY c.conname`)
  const fk = fks.rows.map((r) => r.f).join(',')
  if (fk !== FKEYS) throw new Error(`unexpected foreign keys (${fk || 'none'}), not (${FKEYS}) — rolled back.`)
  const rel = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public."SellerBlock"'::regclass`)
  if (!rel.rows[0]?.relrowsecurity) throw new Error('RLS did not switch on for SellerBlock — rolled back.')
  // has_table_privilege asks Postgres directly, whoever runs this (rum-ddl.mjs: information_schema lists only grants
  // involving the current role); COLUMN grants through has_any_column_privilege; PUBLIC through aclexplode (grantee 0);
  // and MAINTAIN on Postgres 17+ (it allows LOCK TABLE; the keyword errors on 16 and older).
  const v17 = Number((await client.query(`SELECT current_setting('server_version_num') AS v`)).rows[0].v) >= 170000
  const priv = await client.query(
    `SELECT r.rolname FROM pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated')
        AND (has_table_privilege(r.rolname, 'public."SellerBlock"', $1)
             OR has_any_column_privilege(r.rolname, 'public."SellerBlock"', 'SELECT,INSERT,UPDATE,REFERENCES'))
     UNION ALL
     SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = 'public."SellerBlock"'::regclass AND a.grantee = 0`,
    [`SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER${v17 ? ',MAINTAIN' : ''}`])
  if (priv.rows.length) throw new Error(`SellerBlock still grants ${JSON.stringify(priv.rows)} — rolled back.`)
  await client.query('COMMIT')
  console.log('✓ committed')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
