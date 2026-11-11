#!/usr/bin/env node
// ── DealConfirmation + DealConfirmationEvent + Review.basis: reviews after a confirmed rental, lesson or service ─────────
//
//   set -a; . ./.env; set +a; node scripts/deal-confirmation-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// Owner, 2026-11-11 ("1 and 2 do recommended"): a renter, student or client can review once the seller confirms in chat
// that the rental or lesson happened (src/lib/service-deal.ts, POST /api/conversations/[id]/deal).
//
// ⛔ RUN ON PRODUCTION BEFORE THE DEPLOY THAT DECLARES THE MODELS — and before any local `preview:vn` / `dev:vn` of that
// branch, both of which read the production database. Prisma selects every scalar column it knows about, so the new
// build against an un-migrated database throws 42703 on an unscoped Review query. The new revision TOLERATES the two
// missing TABLES (every DealConfirmation read answers "no deal" on P2021/P2022), but not a missing Review.basis on a
// select-less Review query — nor on trust.ts's reviews read, which FILTERS on `basis: null` (spec v3 A4: a service-deal
// review is no trust input), so every trust recompute would fail too. Database first is always the safe order (root
// CLAUDE.md). ⚠️ DEPLOY-ORDER RISK (spec v3 A6), left here on purpose: the owner applies this BEFORE the deploy; run in
// the other order, Review reads and the trust recompute throw 42703 until it has run.
//
// EXACTLY Prisma's own DDL for the two models (`prisma migrate diff` from the previous schema prints these CREATE TABLEs,
// CREATE INDEXes, the one foreign key and the ADD COLUMN and nothing else, so it shows no drift once this has run), made
// idempotent; src/lib/deal-confirmation-ddl.test.ts pins it to schema.prisma and runs it — twice — in PGlite.
//
// TWO TRANSACTIONS, EACH UNDER `SET LOCAL lock_timeout = '5s'`:
//   1. the two NEW tables, their indexes (built on empty tables — safe inside the transaction; no index is added to an
//      existing table), the one FK to Conversation (it takes a SHARE ROW EXCLUSIVE lock on the busy Conversation table for
//      an instant — the new table is empty, so there is nothing to validate), RLS enabled + FORCED on both, the API
//      roles revoked — and relrowsecurity ASSERTED on both before COMMIT.
//   2. Review.basis on its OWN: `ALTER TABLE "Review"` takes an ACCESS EXCLUSIVE lock before IF NOT EXISTS is checked, so
//      it holds that lock for one catalogue change and nothing else. A nullable column with no default is catalogue-only:
//      existing rows read NULL ("Verified buyer"), nothing is rewritten.
// 55P03 (lock_not_available) = the 5 s ran out: nothing changed in that transaction; re-run in a quieter moment.
//
// ⛔ CLOSED TO THE API ROLES: RLS on (and FORCED) with NO policy, AND anon/authenticated/PUBLIC revoked — RLS is not what
// keeps PostgREST out, grants are (rum-ddl.mjs, seller-blocks-ddl.mjs). The app writes as postgres (BYPASSRLS).
// No DROP, no CHECK constraint (kind and action are validated in code — the Message.kind convention), no change to any
// existing column, index or cross-schema FK. Idempotent; safe to re-run any time.
import pg from 'pg'

const TABLE_STATEMENTS = [
  [
    'DealConfirmation table',
    `CREATE TABLE IF NOT EXISTS public."DealConfirmation" (
       "id" TEXT NOT NULL,
       "conversationId" TEXT NOT NULL,
       "listingId" TEXT NOT NULL,
       "sellerId" TEXT NOT NULL,
       "sellerProfileId" UUID NOT NULL,
       "buyerProfileId" UUID NOT NULL,
       "kind" TEXT NOT NULL,
       "confirmedAt" TIMESTAMP(3),
       "revokedAt" TIMESTAMP(3),
       "declinedAt" TIMESTAMP(3),
       "confirmCount" INTEGER NOT NULL DEFAULT 0,
       "reviewId" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL,
       CONSTRAINT "DealConfirmation_pkey" PRIMARY KEY ("id")
     )`,
  ],
  ['DealConfirmation (conversationId) unique', `CREATE UNIQUE INDEX IF NOT EXISTS "DealConfirmation_conversationId_key" ON public."DealConfirmation"("conversationId")`],
  ['DealConfirmation (reviewId) unique', `CREATE UNIQUE INDEX IF NOT EXISTS "DealConfirmation_reviewId_key" ON public."DealConfirmation"("reviewId")`],
  ['DealConfirmation (sellerId, confirmedAt) index', `CREATE INDEX IF NOT EXISTS "DealConfirmation_sellerId_confirmedAt_idx" ON public."DealConfirmation"("sellerId", "confirmedAt")`],
  [
    'DealConfirmation → Conversation foreign key',
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DealConfirmation_conversationId_fkey' AND conrelid = 'public."DealConfirmation"'::regclass) THEN
         ALTER TABLE public."DealConfirmation" ADD CONSTRAINT "DealConfirmation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
       END IF;
     END $$`,
  ],
  [
    'DealConfirmationEvent table',
    `CREATE TABLE IF NOT EXISTS public."DealConfirmationEvent" (
       "id" TEXT NOT NULL,
       "conversationId" TEXT NOT NULL,
       "listingId" TEXT NOT NULL,
       "sellerId" TEXT NOT NULL,
       "actorProfileId" UUID NOT NULL,
       "buyerProfileId" UUID NOT NULL,
       "action" TEXT NOT NULL,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "DealConfirmationEvent_pkey" PRIMARY KEY ("id")
     )`,
  ],
  ['DealConfirmationEvent (conversationId, createdAt) index', `CREATE INDEX IF NOT EXISTS "DealConfirmationEvent_conversationId_createdAt_idx" ON public."DealConfirmationEvent"("conversationId", "createdAt")`],
  ['DealConfirmationEvent (actorProfileId, action, createdAt) index', `CREATE INDEX IF NOT EXISTS "DealConfirmationEvent_actorProfileId_action_createdAt_idx" ON public."DealConfirmationEvent"("actorProfileId", "action", "createdAt")`],
  ['DealConfirmation RLS on', `ALTER TABLE public."DealConfirmation" ENABLE ROW LEVEL SECURITY`],
  ['DealConfirmation RLS forced', `ALTER TABLE public."DealConfirmation" FORCE ROW LEVEL SECURITY`],
  ['DealConfirmationEvent RLS on', `ALTER TABLE public."DealConfirmationEvent" ENABLE ROW LEVEL SECURITY`],
  ['DealConfirmationEvent RLS forced', `ALTER TABLE public."DealConfirmationEvent" FORCE ROW LEVEL SECURITY`],
  [
    // ⚠️⚠️ REVOKE — Supabase's default privileges hand every new public table to `anon` and `authenticated`. Each role only
    // where it exists (rls-guard.sql's to_regrole): a scratch Postgres has neither, and a bare REVOKE would abort the run.
    'revoke API roles on both tables',
    `DO $$ BEGIN
       IF to_regrole('anon') IS NOT NULL THEN
         EXECUTE 'REVOKE ALL ON public."DealConfirmation" FROM anon';
         EXECUTE 'REVOKE ALL ON public."DealConfirmationEvent" FROM anon';
       END IF;
       IF to_regrole('authenticated') IS NOT NULL THEN
         EXECUTE 'REVOKE ALL ON public."DealConfirmation" FROM authenticated';
         EXECUTE 'REVOKE ALL ON public."DealConfirmationEvent" FROM authenticated';
       END IF;
       EXECUTE 'REVOKE ALL ON public."DealConfirmation" FROM PUBLIC';
       EXECUTE 'REVOKE ALL ON public."DealConfirmationEvent" FROM PUBLIC';
     END $$`,
  ],
]

/** Review.basis — its own transaction (see the header). */
const REVIEW_BASIS_STATEMENT = `ALTER TABLE public."Review" ADD COLUMN IF NOT EXISTS "basis" TEXT`

/** Both tables as the statements above make them — asserted, because CREATE TABLE IF NOT EXISTS keeps one of another shape. */
const SHAPES = {
  DealConfirmation: [
    'id:text:NO', 'conversationId:text:NO', 'listingId:text:NO', 'sellerId:text:NO', 'sellerProfileId:uuid:NO', 'buyerProfileId:uuid:NO',
    'kind:text:NO', 'confirmedAt:timestamp without time zone:YES', 'revokedAt:timestamp without time zone:YES',
    'declinedAt:timestamp without time zone:YES', 'confirmCount:integer:NO', 'reviewId:text:YES',
    'createdAt:timestamp without time zone:NO', 'updatedAt:timestamp without time zone:NO',
  ].join(','),
  DealConfirmationEvent: [
    'id:text:NO', 'conversationId:text:NO', 'listingId:text:NO', 'sellerId:text:NO', 'actorProfileId:uuid:NO', 'buyerProfileId:uuid:NO',
    'action:text:NO', 'createdAt:timestamp without time zone:NO',
  ].join(','),
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DIRECT_URL or DATABASE_URL required — refusing to guess a target.')
  process.exit(1)
}
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  // ── 1. The two new tables ────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ SET LOCAL INSIDE A TRANSACTION, not a bare SET: on the pooled DATABASE_URL (transaction pooling) a session-level SET
  // does not survive to the next statement, so the timeout would be silently absent exactly when it matters.
  await client.query('BEGIN')
  await client.query("SET LOCAL lock_timeout = '5s'")
  const base = await client.query(`SELECT to_regclass('public."Conversation"') AS c, to_regclass('public."Review"') AS r`)
  if (!base.rows[0]?.c || !base.rows[0]?.r) throw new Error('Conversation or Review does not exist — this is not the eno database; rolled back.')
  for (const [label, sql] of TABLE_STATEMENTS) {
    await client.query(sql)
    console.log(`✓ ${label}`)
  }
  // Assert rather than assume: the shapes, the foreign key, RLS on AND forced on both, and no grant left for the API roles.
  for (const [table, want] of Object.entries(SHAPES)) {
    const cols = await client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])
    const shape = cols.rows.map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`).join(',')
    if (shape !== want) throw new Error(`unexpected ${table} columns (${shape}) — rolled back.`)
  }
  const fks = await client.query(
    `SELECT c.conname || ':' || t.relname || ':' || c.confdeltype::text AS f FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid
      WHERE c.conrelid IN ('public."DealConfirmation"'::regclass, 'public."DealConfirmationEvent"'::regclass) AND c.contype = 'f' ORDER BY c.conname`)
  const fk = fks.rows.map((r) => r.f).join(',')
  if (fk !== 'DealConfirmation_conversationId_fkey:Conversation:c') throw new Error(`unexpected foreign keys (${fk || 'none'}) — rolled back.`)
  const rls = await client.query(
    `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE oid IN ('public."DealConfirmation"'::regclass, 'public."DealConfirmationEvent"'::regclass) ORDER BY relname`)
  if (rls.rows.length !== 2 || rls.rows.some((r) => !r.relrowsecurity || !r.relforcerowsecurity)) {
    throw new Error(`RLS is not enabled AND forced on both tables (${JSON.stringify(rls.rows)}) — rolled back.`)
  }
  // has_table_privilege asks Postgres directly, whoever runs this; COLUMN grants through has_any_column_privilege; PUBLIC
  // through aclexplode (grantee 0); and MAINTAIN on Postgres 17+ (the keyword errors on 16 and older).
  const v17 = Number((await client.query(`SELECT current_setting('server_version_num') AS v`)).rows[0].v) >= 170000
  for (const table of Object.keys(SHAPES)) {
    const rel = `public."${table}"`
    const priv = await client.query(
      `SELECT r.rolname FROM pg_roles r
        WHERE r.rolname IN ('anon', 'authenticated')
          AND (has_table_privilege(r.rolname, $2, $1)
               OR has_any_column_privilege(r.rolname, $2, 'SELECT,INSERT,UPDATE,REFERENCES'))
       UNION ALL
       SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = $2::regclass AND a.grantee = 0`,
      [`SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER${v17 ? ',MAINTAIN' : ''}`, rel])
    if (priv.rows.length) throw new Error(`${table} still grants ${JSON.stringify(priv.rows)} — rolled back.`)
  }
  await client.query('COMMIT')
  console.log('✓ committed (tables)')

  // ── 2. Review.basis, alone ───────────────────────────────────────────────────────────────────────────────────────────
  process.stdout.write('  Review.basis … ')
  await client.query('BEGIN')
  await client.query("SET LOCAL lock_timeout = '5s'")
  await client.query(REVIEW_BASIS_STATEMENT)
  await client.query('COMMIT')
  console.log('ok')
  const { rows } = await client.query(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Review' AND column_name = 'basis'`)
  // The shape the code relies on: text, NULLABLE, no default (NULL = a goods / offer review).
  if (!rows[0] || rows[0].data_type !== 'text' || rows[0].is_nullable !== 'YES' || rows[0].column_default !== null) {
    console.error('  ⚠️ Review.basis is missing or not `text NULL` with no default — stop and look before deploying')
    process.exitCode = 1
  }
  console.log('Next: psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  // 55P03 = lock_not_available: the lock_timeout fired. Nothing changed in that transaction; try again later.
  console.error(e?.code === '55P03' ? '⚠️ could not get a lock within 5s — nothing changed in that step; re-run when the site is quieter' : (e instanceof Error ? e.message : e))
  process.exitCode = 1
} finally {
  await client.end()
}
