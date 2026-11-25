#!/usr/bin/env node
// ── ListingAd + AdCreative + AdStat: paid ads bought over x402 (owner 2026-11-23; any lawful advertiser 2026-11-25;
//    prisma/schema.prisma models ListingAd, AdCreative, AdStat; src/lib/ads) ─────────────────────────────────────────
//
//   set -a; . ./.env; set +a; node scripts/listing-ad-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// RUN ON PRODUCTION BEFORE THE DEPLOY THAT DECLARES THE MODELS. prisma/ changed, so eno-deploy.sh's step 2 refuses that
// deploy unless SCHEMA_OK = the full sha of the HEAD being deployed. ⛔ DB FIRST: Prisma selects every scalar column, so a
// revision that knows `ListingAd.creativeId` against a table without it throws 42703 on the ad routes (the feed's ad
// lookup fails soft and serves the organic page). The old revision is unaffected by the new column and tables.
//
// EXACTLY Prisma's own DDL for the models (`prisma migrate diff --from-empty` prints these CREATE TABLEs and CREATE INDEXes),
// made idempotent; src/lib/ads/ddl.test.ts pins it to schema.prisma.
// ⛔ CLOSED TO THE API ROLES: RLS on with NO policy, AND anon/authenticated/PUBLIC revoked, on all three tables — they hold
// wallet addresses, signed payment authorizations and advertisers' tax codes. The app writes as postgres (BYPASSRLS).
// ⚠️ NO FOREIGN KEY anywhere: nothing here locks the Listing table.
//
// Three phases, each safe to re-run any time:
//   1. ONE transaction with a 5 s lock timeout: the tables, the columns, RLS, the revokes, and the one-target CHECK added
//      NOT VALID (the only change to an existing column is ListingAd.listingId DROP NOT NULL — a relaxation, no data moves);
//   2. its own transaction: VALIDATE the CHECK (SHARE UPDATE EXCLUSIVE — reads and writes go on while it scans);
//   3. alone, outside any transaction: the index on the EXISTING ListingAd table, CREATE INDEX CONCURRENTLY (prisma/CLAUDE.md:
//      a plain CREATE INDEX on an existing table blocks every write to it while it builds).
import pg from 'pg'

const STATEMENTS = [
  [
    'ListingAd table',
    `CREATE TABLE IF NOT EXISTS public."ListingAd" (
       "id" TEXT NOT NULL,
       "listingId" TEXT,
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
  // ── 2026-11-25: any lawful advertiser (a creative instead of a listing) ──────────────────────────────────────────────
  // A creative ad has no listing: the one column relaxed, never a column dropped or a row changed.
  ['ListingAd listingId nullable', `ALTER TABLE public."ListingAd" ALTER COLUMN "listingId" DROP NOT NULL`],
  ['ListingAd creativeId column', `ALTER TABLE public."ListingAd" ADD COLUMN IF NOT EXISTS "creativeId" TEXT`],
  [
    // Exactly one target per ad. NOT VALID here (no scan under the transaction's ACCESS EXCLUSIVE lock); phase 2 validates.
    'ListingAd one-target CHECK (NOT VALID)',
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ListingAd_one_target' AND conrelid = 'public."ListingAd"'::regclass) THEN
         ALTER TABLE public."ListingAd" ADD CONSTRAINT "ListingAd_one_target" CHECK (num_nonnulls("listingId", "creativeId") = 1) NOT VALID;
       END IF;
     END $$`,
  ],
  [
    'AdCreative table',
    `CREATE TABLE IF NOT EXISTS public."AdCreative" (
       "id" TEXT NOT NULL,
       "sellerId" TEXT NOT NULL,
       "legalName" TEXT NOT NULL,
       "taxCode" TEXT NOT NULL,
       "advertiserName" TEXT NOT NULL,
       "headline" TEXT NOT NULL,
       "body" TEXT,
       "sourceLang" TEXT NOT NULL,
       "permitRef" TEXT,
       "imageUrl" TEXT NOT NULL,
       "clickUrl" TEXT NOT NULL,
       "landingHost" TEXT NOT NULL,
       "contentHash" TEXT NOT NULL,
       "status" TEXT NOT NULL,
       "reasons" JSONB NOT NULL,
       "scores" JSONB NOT NULL,
       "reviewModel" TEXT NOT NULL,
       "reviewedAt" TIMESTAMP(3) NOT NULL,
       "removedAt" TIMESTAMP(3),
       "removedReason" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")
     )`,
  ],
  // A NEW table: its indexes are built in the transaction, before any row exists.
  ['AdCreative (sellerId, contentHash, createdAt) index', `CREATE INDEX IF NOT EXISTS "AdCreative_sellerId_contentHash_createdAt_idx" ON public."AdCreative"("sellerId", "contentHash", "createdAt")`],
  ['AdCreative (status, createdAt) index', `CREATE INDEX IF NOT EXISTS "AdCreative_status_createdAt_idx" ON public."AdCreative"("status", "createdAt")`],
  [
    'AdStat table',
    `CREATE TABLE IF NOT EXISTS public."AdStat" (
       "adId" TEXT NOT NULL,
       "bucket" TIMESTAMP(3) NOT NULL,
       "impressions" INTEGER NOT NULL DEFAULT 0,
       "clicks" INTEGER NOT NULL DEFAULT 0,
       "invalid" INTEGER NOT NULL DEFAULT 0,
       "reachNew" INTEGER NOT NULL DEFAULT 0,
       CONSTRAINT "AdStat_pkey" PRIMARY KEY ("adId","bucket")
     )`,
  ],
  ['AdCreative RLS on', `ALTER TABLE public."AdCreative" ENABLE ROW LEVEL SECURITY`],
  ['AdStat RLS on', `ALTER TABLE public."AdStat" ENABLE ROW LEVEL SECURITY`],
  [
    'AdCreative + AdStat revoke API roles',
    `DO $$ BEGIN
       IF to_regrole('anon') IS NOT NULL THEN
         EXECUTE 'REVOKE ALL ON public."AdCreative" FROM anon';
         EXECUTE 'REVOKE ALL ON public."AdStat" FROM anon';
       END IF;
       IF to_regrole('authenticated') IS NOT NULL THEN
         EXECUTE 'REVOKE ALL ON public."AdCreative" FROM authenticated';
         EXECUTE 'REVOKE ALL ON public."AdStat" FROM authenticated';
       END IF;
       EXECUTE 'REVOKE ALL ON public."AdCreative" FROM PUBLIC';
       EXECUTE 'REVOKE ALL ON public."AdStat" FROM PUBLIC';
     END $$`,
  ],
]

/** Phase 2, its own transaction: the CHECK checked against the rows already there (every one of them a listing ad). */
const VALIDATE = `ALTER TABLE public."ListingAd" VALIDATE CONSTRAINT "ListingAd_one_target"`
/** Phase 3, alone: the index on the existing table. */
const CONCURRENT_INDEX = `CREATE INDEX CONCURRENTLY IF NOT EXISTS "ListingAd_creativeId_status_idx" ON public."ListingAd"("creativeId", "status")`

/** The table as the statement above makes it — asserted, because CREATE TABLE IF NOT EXISTS keeps one of another shape. */
const SHAPE = [
  'id:text:NO', 'listingId:text:NO', 'sellerId:text:NO', 'bookedByKeyId:text:NO', 'via:text:NO', 'status:text:NO',
  'startsAt:timestamp without time zone:YES', 'endsAt:timestamp without time zone:YES', 'amount:text:NO', 'asset:text:NO',
  'network:text:NO', 'payTo:text:NO', 'paymentId:text:NO', 'authFrom:text:NO', 'authNonce:text:NO', 'authValidBefore:text:NO',
  'signature:text:NO', 'payloadJson:jsonb:NO', 'txHash:text:YES', 'settlementJson:jsonb:YES', 'failReason:text:YES',
  'impressions:integer:NO', 'clicks:integer:NO', 'createdAt:timestamp without time zone:NO', 'updatedAt:timestamp without time zone:NO',
  'durationSec:integer:NO', 'creativeId:text:YES',
].join(',').replace('listingId:text:NO', 'listingId:text:YES')
const SHAPES = {
  ListingAd: SHAPE,
  AdCreative: [
    'id:text:NO', 'sellerId:text:NO', 'legalName:text:NO', 'taxCode:text:NO', 'advertiserName:text:NO', 'headline:text:NO',
    'body:text:YES', 'sourceLang:text:NO', 'permitRef:text:YES', 'imageUrl:text:NO', 'clickUrl:text:NO', 'landingHost:text:NO',
    'contentHash:text:NO', 'status:text:NO', 'reasons:jsonb:NO', 'scores:jsonb:NO', 'reviewModel:text:NO',
    'reviewedAt:timestamp without time zone:NO', 'removedAt:timestamp without time zone:YES', 'removedReason:text:YES',
    'createdAt:timestamp without time zone:NO', 'updatedAt:timestamp without time zone:NO',
  ].join(','),
  AdStat: ['adId:text:NO', 'bucket:timestamp without time zone:NO', 'impressions:integer:NO', 'clicks:integer:NO', 'invalid:integer:NO', 'reachNew:integer:NO'].join(','),
}
/** Each table's unique keys, as attribute lists per index. */
const UNIQUES = { ListingAd: 'id|paymentId', AdCreative: 'id', AdStat: 'adId,bucket' }

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
  // Assert rather than assume: the shapes, the keys, RLS on, and no grant left for the API roles — on all three tables.
  // has_table_privilege asks Postgres directly, whoever runs this (rum-ddl.mjs: information_schema lists only grants
  // involving the current role); COLUMN grants through has_any_column_privilege; PUBLIC through aclexplode (grantee 0);
  // and MAINTAIN on Postgres 17+ (it allows LOCK TABLE; the keyword errors on 16 and older).
  const v17 = Number((await client.query(`SELECT current_setting('server_version_num') AS v`)).rows[0].v) >= 170000
  for (const [table, want] of Object.entries(SHAPES)) {
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])
    const shape = cols.rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`).join(',')
    if (shape !== want) throw new Error(`unexpected columns on ${table} (${shape}) — rolled back.`)
    const uq = await client.query(
      `SELECT string_agg(a.attname, ',' ORDER BY array_position(i.indkey::int2[], a.attnum)) AS cols
         FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisunique GROUP BY i.indexrelid ORDER BY cols`, [`public."${table}"`])
    const uniques = uq.rows.map((r) => r.cols).join('|')
    // One payment must be one ad (paymentId); one ad-hour one AdStat row.
    if (uniques !== UNIQUES[table]) throw new Error(`unique keys on ${table} are (${uniques}), not (${UNIQUES[table]}) — rolled back.`)
    const rel = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public."${table}"`])
    if (!rel.rows[0]?.relrowsecurity) throw new Error(`RLS did not switch on for ${table} — rolled back.`)
    const priv = await client.query(
      `SELECT r.rolname FROM pg_roles r
        WHERE r.rolname IN ('anon', 'authenticated')
          AND (has_table_privilege(r.rolname, $2::regclass, $1)
               OR has_any_column_privilege(r.rolname, $2::regclass, 'SELECT,INSERT,UPDATE,REFERENCES'))
       UNION ALL
       SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = $2::regclass AND a.grantee = 0`,
      [`SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER${v17 ? ',MAINTAIN' : ''}`, `public."${table}"`])
    if (priv.rows.length) throw new Error(`${table} still grants ${JSON.stringify(priv.rows)} — rolled back.`)
  }
  await client.query('COMMIT')
  console.log('✓ committed')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
}
if (!process.exitCode) {
  try {
    // Phase 2: validated in its own transaction (a no-op once valid).
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query(VALIDATE)
    const ck = await client.query(
      `SELECT convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'ListingAd_one_target' AND conrelid = 'public."ListingAd"'::regclass`)
    if (!ck.rows[0]?.convalidated || !/num_nonnulls\("listingId", "creativeId"\) = 1/.test(ck.rows[0].def)) {
      throw new Error(`ListingAd_one_target is not the validated one-target CHECK (${JSON.stringify(ck.rows[0] ?? null)})`)
    }
    await client.query('COMMIT')
    console.log('✓ ListingAd one-target CHECK validated')
    // Phase 3: alone, outside any transaction.
    await client.query("SET lock_timeout = '5s'")
    await client.query(CONCURRENT_INDEX)
    // ⚠️ An interrupted CONCURRENTLY leaves an INVALID index that IF NOT EXISTS then skips for good. Asserted, never
    // repaired here (this script drops nothing): drop it by hand with DROP INDEX CONCURRENTLY and re-run.
    const ix = await client.query(
      `SELECT i.indisvalid, pg_get_indexdef(i.indexrelid) AS def FROM pg_index i
        WHERE i.indexrelid = to_regclass('public."ListingAd_creativeId_status_idx"')`)
    if (!ix.rows[0]?.indisvalid || !/\("creativeId", status\)/.test(ix.rows[0].def)) {
      throw new Error(`ListingAd_creativeId_status_idx is missing or INVALID (${JSON.stringify(ix.rows[0] ?? null)}): DROP INDEX CONCURRENTLY public."ListingAd_creativeId_status_idx" by hand, then re-run.`)
    }
    console.log('✓ ListingAd (creativeId, status) index')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  }
}
await client.end()
