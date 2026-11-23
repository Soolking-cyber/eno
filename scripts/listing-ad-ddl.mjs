#!/usr/bin/env node
// ── ListingAd: paid "Ad" placements bought over x402 (owner 2026-11-23; prisma/schema.prisma model ListingAd, src/lib/ads) ─
//
//   set -a; . ./.env; set +a; node scripts/listing-ad-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// RUN ON PRODUCTION BEFORE THE DEPLOY THAT DECLARES THE MODEL. prisma/ changed, so eno-deploy.sh's step 2 refuses that
// deploy unless SCHEMA_OK = the full sha of the HEAD being deployed. A NEW TABLE, never a column on an existing one: until
// it exists the feed's ad lookup fails soft (src/lib/ads/serve.ts logs and serves the organic page) and the paid routes
// answer 503 before any payment is verified — so neither revision breaks without it.
//
// EXACTLY Prisma's own DDL for the model (`prisma migrate diff` from the previous schema prints this CREATE TABLE and these
// five CREATE INDEX and nothing else), made idempotent; src/lib/ads/ddl.test.ts pins it to schema.prisma.
// ⛔ CLOSED TO THE API ROLES: RLS on with NO policy, AND anon/authenticated/PUBLIC revoked — it holds wallet addresses and
// signed payment authorizations. The app writes as postgres (BYPASSRLS); nothing else touches the table.
// ⚠️ NO FOREIGN KEY to Listing: nothing here locks the Listing table.
//
// Idempotent; one transaction with a 5 s lock timeout; safe to re-run any time.
import pg from 'pg'

const STATEMENTS = [
  [
    'ListingAd table',
    `CREATE TABLE IF NOT EXISTS public."ListingAd" (
       "id" TEXT NOT NULL,
       "listingId" TEXT NOT NULL,
       "sellerId" TEXT NOT NULL,
       "bookedByKeyId" TEXT NOT NULL,
       "via" TEXT NOT NULL,
       "status" TEXT NOT NULL,
       "startsAt" TIMESTAMP(3),
       "endsAt" TIMESTAMP(3),
       "amount" TEXT NOT NULL,
       "asset" TEXT NOT NULL,
       "network" TEXT NOT NULL,
       "payTo" TEXT NOT NULL,
       "paymentId" TEXT NOT NULL,
       "authFrom" TEXT NOT NULL,
       "authNonce" TEXT NOT NULL,
       "authValidBefore" TEXT NOT NULL,
       "signature" TEXT NOT NULL,
       "payloadJson" JSONB NOT NULL,
       "txHash" TEXT,
       "settlementJson" JSONB,
       "failReason" TEXT,
       "impressions" INTEGER NOT NULL DEFAULT 0,
       "clicks" INTEGER NOT NULL DEFAULT 0,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "ListingAd_pkey" PRIMARY KEY ("id")
     )`,
  ],
  ['ListingAd paymentId unique', `CREATE UNIQUE INDEX IF NOT EXISTS "ListingAd_paymentId_key" ON public."ListingAd"("paymentId")`],
  ['ListingAd (status, endsAt) index', `CREATE INDEX IF NOT EXISTS "ListingAd_status_endsAt_idx" ON public."ListingAd"("status", "endsAt")`],
  ['ListingAd (listingId, status) index', `CREATE INDEX IF NOT EXISTS "ListingAd_listingId_status_idx" ON public."ListingAd"("listingId", "status")`],
  ['ListingAd (sellerId, createdAt) index', `CREATE INDEX IF NOT EXISTS "ListingAd_sellerId_createdAt_idx" ON public."ListingAd"("sellerId", "createdAt")`],
  // NOT unique: one transaction can settle several authorizations (x402 batch settlement); paymentId is the identity.
  ['ListingAd (txHash) index', `CREATE INDEX IF NOT EXISTS "ListingAd_txHash_idx" ON public."ListingAd"("txHash")`],
  // Added after the table shipped on 2026-11-23 (the 1-hour ad): a constant default, so no table rewrite.
  ['ListingAd durationSec column', `ALTER TABLE public."ListingAd" ADD COLUMN IF NOT EXISTS "durationSec" INTEGER NOT NULL DEFAULT 604800`],
  ['ListingAd RLS on', `ALTER TABLE public."ListingAd" ENABLE ROW LEVEL SECURITY`],
  [
    // ⚠️⚠️ REVOKE — Supabase's default privileges hand every new public table to `anon` and `authenticated`. Each role only
    // where it exists (rls-guard.sql's to_regrole): a scratch Postgres has neither, and a bare REVOKE would abort the run.
    'ListingAd revoke API roles',
    `DO $$ BEGIN
       IF to_regrole('anon') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON public."ListingAd" FROM anon'; END IF;
       IF to_regrole('authenticated') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON public."ListingAd" FROM authenticated'; END IF;
       EXECUTE 'REVOKE ALL ON public."ListingAd" FROM PUBLIC';
     END $$`,
  ],
]

/** The table as the statement above makes it — asserted, because CREATE TABLE IF NOT EXISTS keeps one of another shape. */
const SHAPE = [
  'id:text:NO', 'listingId:text:NO', 'sellerId:text:NO', 'bookedByKeyId:text:NO', 'via:text:NO', 'status:text:NO',
  'startsAt:timestamp without time zone:YES', 'endsAt:timestamp without time zone:YES', 'amount:text:NO', 'asset:text:NO',
  'network:text:NO', 'payTo:text:NO', 'paymentId:text:NO', 'authFrom:text:NO', 'authNonce:text:NO', 'authValidBefore:text:NO',
  'signature:text:NO', 'payloadJson:jsonb:NO', 'txHash:text:YES', 'settlementJson:jsonb:YES', 'failReason:text:YES',
  'impressions:integer:NO', 'clicks:integer:NO', 'createdAt:timestamp without time zone:NO', 'updatedAt:timestamp without time zone:NO',
  'durationSec:integer:NO',
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
      WHERE table_schema = 'public' AND table_name = 'ListingAd' ORDER BY ordinal_position`)
  const shape = cols.rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`).join(',')
  if (shape !== SHAPE) throw new Error(`unexpected columns (${shape}) — rolled back.`)
  const uq = await client.query(
    `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'public."ListingAd"'::regclass AND i.indisunique ORDER BY a.attname`)
  const uniques = uq.rows.map((r) => r.attname).join(',')
  if (uniques !== 'id,paymentId') throw new Error(`unique keys are (${uniques}), not (id, paymentId) — one payment must be one ad; rolled back.`)
  const rel = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public."ListingAd"'::regclass`)
  if (!rel.rows[0]?.relrowsecurity) throw new Error('RLS did not switch on for ListingAd — rolled back.')
  // has_table_privilege asks Postgres directly, whoever runs this (rum-ddl.mjs: information_schema lists only grants
  // involving the current role); COLUMN grants through has_any_column_privilege; PUBLIC through aclexplode (grantee 0);
  // and MAINTAIN on Postgres 17+ (it allows LOCK TABLE; the keyword errors on 16 and older).
  const v17 = Number((await client.query(`SELECT current_setting('server_version_num') AS v`)).rows[0].v) >= 170000
  const priv = await client.query(
    `SELECT r.rolname FROM pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated')
        AND (has_table_privilege(r.rolname, 'public."ListingAd"', $1)
             OR has_any_column_privilege(r.rolname, 'public."ListingAd"', 'SELECT,INSERT,UPDATE,REFERENCES'))
     UNION ALL
     SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = 'public."ListingAd"'::regclass AND a.grantee = 0`,
    [`SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER${v17 ? ',MAINTAIN' : ''}`])
  if (priv.rows.length) throw new Error(`ListingAd still grants ${JSON.stringify(priv.rows)} — rolled back.`)
  await client.query('COMMIT')
  console.log('✓ committed')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
