#!/usr/bin/env node
// ── "Zalo for urgent cover" (owner, 2026-10-28): TeacherPrivate's four Zalo columns + the TeacherZaloReveal ledger ──
//
//   set -a; . ./.env; set +a; node scripts/teacher-zalo-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// ⛔ RUN ON PRODUCTION BEFORE THE DEPLOY THAT DECLARES THEM. Prisma selects every scalar column it knows, so the new
// revision against a TeacherPrivate without the columns answers 42703 on every read of it (the teacher form, every save,
// the contact route). ADDITIVE ONLY — four nullable columns and a new table — so the CURRENT revision is unaffected:
// database first is always the safe order. prisma/ changed, so eno-deploy.sh refuses the deploy unless SCHEMA_OK = the
// full sha of the HEAD being deployed.
// EXACTLY Prisma's own DDL for schema.prisma (`prisma migrate diff` printed it, 2026-10-28), made idempotent;
// src/lib/teachers/zalo-ddl.test.ts pins every statement to the schema and runs `run()` in PGlite.
// ⛔ RLS ON, NO POLICY, asserted for both tables (the teachers-ddl.mjs rule): the app reads them through Prisma
// (BYPASSRLS) only; with RLS on and no policy, PostgREST's anon/authenticated roles read no row — the number never
// reaches sb.eno.vn. ⚠️ "IF NOT EXISTS" NEVER REPAIRS (codex, job-DMs gate 3b): an existing table or column of another
// shape would pass silently, so the SHAPE is read back inside the transaction before COMMIT and anything else rolls it all
// back. ⛔ ONE TRANSACTION under a 5 s lock_timeout (ADD COLUMN takes an ACCESS EXCLUSIVE lock on TeacherPrivate for
// an instant; a queued ALTER would stall every read behind it) — re-run it in a quieter moment if it gives up.
//
// Idempotent; safe to re-run any time.
import { pathToFileURL } from 'node:url'

/** [label, SQL] — Prisma's statements, each made idempotent. */
export const STATEMENTS = [
  ['TeacherPrivate.coverZalo', `ALTER TABLE "TeacherPrivate" ADD COLUMN IF NOT EXISTS "coverZalo" TEXT`],
  ['TeacherPrivate.coverZaloAt', `ALTER TABLE "TeacherPrivate" ADD COLUMN IF NOT EXISTS "coverZaloAt" TIMESTAMP(3)`],
  ['TeacherPrivate.coverZaloVersion', `ALTER TABLE "TeacherPrivate" ADD COLUMN IF NOT EXISTS "coverZaloVersion" TEXT`],
  ['TeacherPrivate.coverZaloWithdrawnAt', `ALTER TABLE "TeacherPrivate" ADD COLUMN IF NOT EXISTS "coverZaloWithdrawnAt" TIMESTAMP(3)`],
  ['TeacherZaloReveal', `CREATE TABLE IF NOT EXISTS "TeacherZaloReveal" (
    "id" TEXT NOT NULL,
    "viewerProfileId" UUID,
    "viewerName" TEXT NOT NULL,
    "teacherProfileId" TEXT,
    "grantAt" TIMESTAMP(3) NOT NULL,
    "day" TEXT NOT NULL,
    "poolKey" TEXT,
    "revealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeacherZaloReveal_pkey" PRIMARY KEY ("id")
  )`],
  ['TeacherZaloReveal_viewerProfileId_day_idx', `CREATE INDEX IF NOT EXISTS "TeacherZaloReveal_viewerProfileId_day_idx" ON "TeacherZaloReveal"("viewerProfileId", "day")`],
  ['TeacherZaloReveal_teacherProfileId_day_idx', `CREATE INDEX IF NOT EXISTS "TeacherZaloReveal_teacherProfileId_day_idx" ON "TeacherZaloReveal"("teacherProfileId", "day")`],
  ['TeacherZaloReveal_poolKey_day_idx', `CREATE INDEX IF NOT EXISTS "TeacherZaloReveal_poolKey_day_idx" ON "TeacherZaloReveal"("poolKey", "day")`],
  ['TeacherZaloReveal_viewerProfileId_teacherProfileId_grantAt_key', `CREATE UNIQUE INDEX IF NOT EXISTS "TeacherZaloReveal_viewerProfileId_teacherProfileId_grantAt_key" ON "TeacherZaloReveal"("viewerProfileId", "teacherProfileId", "grantAt")`],
  ['foreign keys', `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeacherZaloReveal_viewerProfileId_fkey' AND conrelid = '"TeacherZaloReveal"'::regclass) THEN
      ALTER TABLE "TeacherZaloReveal" ADD CONSTRAINT "TeacherZaloReveal_viewerProfileId_fkey" FOREIGN KEY ("viewerProfileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TeacherZaloReveal_teacherProfileId_fkey' AND conrelid = '"TeacherZaloReveal"'::regclass) THEN
      ALTER TABLE "TeacherZaloReveal" ADD CONSTRAINT "TeacherZaloReveal_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$`],
  ['TeacherZaloReveal RLS', `ALTER TABLE "TeacherZaloReveal" ENABLE ROW LEVEL SECURITY`],
]

/**
 * Every column the change makes — table:column:type:precision:nullable:default — read back, never assumed. ⛔ THE
 * PRECISION TOO (review round 4): a grant is told apart by `coverZaloAt`, so a TIMESTAMP(0) would merge two number changes
 * in one second into one grant — the second shown with no count and no bell.
 */
export const SHAPE = [
  'TeacherPrivate:coverZalo:text::YES:NULL',
  'TeacherPrivate:coverZaloAt:timestamp without time zone:3:YES:NULL',
  'TeacherPrivate:coverZaloVersion:text::YES:NULL',
  'TeacherPrivate:coverZaloWithdrawnAt:timestamp without time zone:3:YES:NULL',
  'TeacherZaloReveal:day:text::NO:NULL',
  'TeacherZaloReveal:grantAt:timestamp without time zone:3:NO:NULL',
  'TeacherZaloReveal:id:text::NO:NULL',
  'TeacherZaloReveal:poolKey:text::YES:NULL',
  'TeacherZaloReveal:revealedAt:timestamp without time zone:3:NO:CURRENT_TIMESTAMP',
  'TeacherZaloReveal:teacherProfileId:text::YES:NULL',
  'TeacherZaloReveal:viewerName:text::NO:NULL',
  'TeacherZaloReveal:viewerProfileId:uuid::YES:NULL',
]
const SHAPE_SQL = `SELECT table_name || ':' || column_name || ':' || data_type || ':' || coalesce(datetime_precision::text, '') || ':' || is_nullable || ':' || coalesce(column_default, 'NULL') AS s
  FROM information_schema.columns
  WHERE table_schema = 'public' AND ((table_name = 'TeacherPrivate' AND column_name LIKE 'coverZalo%') OR table_name = 'TeacherZaloReveal')
  ORDER BY 1`
/**
 * The indexes and keys the ledger's rules stand on (the unique key IS "never counted or rung twice") — name, unique, and
 * the COLUMNS, read from Postgres's own definition (review, 2026-10-28: a same-named index on other columns must not pass).
 */
export const INDEXES = [
  'TeacherZaloReveal_pkey:unique:id',
  'TeacherZaloReveal_poolKey_day_idx::"poolKey", day',
  'TeacherZaloReveal_teacherProfileId_day_idx::"teacherProfileId", day',
  'TeacherZaloReveal_viewerProfileId_day_idx::"viewerProfileId", day',
  'TeacherZaloReveal_viewerProfileId_teacherProfileId_grantAt_key:unique:"viewerProfileId", "teacherProfileId", "grantAt"',
]
const INDEX_SQL = `SELECT indexname || ':' || CASE WHEN indexdef LIKE 'CREATE UNIQUE%' THEN 'unique' ELSE '' END || ':' || substring(indexdef from 'USING btree \\((.*)\\)$') AS s
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'TeacherZaloReveal' ORDER BY indexname`
/** The foreign keys, as Postgres prints them — the referenced table and column, and what a delete does. */
export const FKS = [
  'TeacherZaloReveal_teacherProfileId_fkey:FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"(id) ON UPDATE CASCADE ON DELETE SET NULL',
  'TeacherZaloReveal_viewerProfileId_fkey:FOREIGN KEY ("viewerProfileId") REFERENCES "Profile"(id) ON UPDATE CASCADE ON DELETE SET NULL',
]
const FK_SQL = `SELECT conname::text || ':' || pg_get_constraintdef(oid) AS s FROM pg_constraint WHERE conrelid = 'public."TeacherZaloReveal"'::regclass AND contype = 'f' ORDER BY conname`
/** Both tables: RLS on and NO policy — what keeps PostgREST's API roles from every row (rls-guard.sql). */
const RLS_SQL = `SELECT c.relname AS t, c.relrowsecurity AS rls, (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)::int AS policies
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('TeacherPrivate', 'TeacherZaloReveal') ORDER BY 1`

/** The whole change in one transaction on `client` (pg.Client, or anything with `query(sql, params)`); throws after ROLLBACK. */
export async function run(client, log = console.log) {
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '5s'")
    const t = await client.query(`SELECT to_regclass('public."TeacherPrivate"') AS p, to_regclass('public."TeacherProfile"') AS t, to_regclass('public."Profile"') AS f`)
    if (!t.rows[0]?.p || !t.rows[0]?.t || !t.rows[0]?.f) throw new Error('TeacherPrivate / TeacherProfile / Profile missing — this is not the eno database; rolled back.')
    for (const [label, sql] of STATEMENTS) {
      await client.query(sql)
      log(`✓ ${label}`)
    }
    const shape = (await client.query(SHAPE_SQL)).rows.map((r) => r.s)
    if (shape.join('\n') !== SHAPE.join('\n')) throw new Error(`the columns are not the shape this script makes:\n  ${shape.join('\n  ')}\n— stop and look; rolled back.`)
    const idx = (await client.query(INDEX_SQL)).rows.map((r) => r.s)
    if (idx.join('\n') !== INDEXES.join('\n')) throw new Error(`TeacherZaloReveal's indexes are:\n  ${idx.join('\n  ')}\n— expected:\n  ${INDEXES.join('\n  ')}\nrolled back.`)
    const fks = (await client.query(FK_SQL)).rows.map((r) => r.s)
    // Either side going → SET NULL: the teacher's record keeps the school's name; the day's counts keep a deleted profile's
    // reveal (never handed back) until the sweep (zalo.ts sweepZalo).
    if (fks.join('\n') !== FKS.join('\n')) throw new Error(`TeacherZaloReveal's foreign keys are:\n  ${fks.join('\n  ')}\nrolled back.`)
    const rls = (await client.query(RLS_SQL)).rows
    for (const r of rls) {
      if (!r.rls) throw new Error(`RLS is OFF on ${r.t} — run scripts/rls-guard.sql and look before deploying; rolled back.`)
      if (r.policies) throw new Error(`${r.t} has ${r.policies} RLS polic${r.policies === 1 ? 'y' : 'ies'} — the Zalo number must reach no API role; rolled back.`)
    }
    if (rls.length !== 2) throw new Error('RLS state of TeacherPrivate / TeacherZaloReveal could not be read; rolled back.')
    await client.query('COMMIT')
    log('✓ committed')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  }
}

// Run only when executed (`node scripts/teacher-zalo-ddl.mjs`), never when the test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) {
    console.error('DIRECT_URL or DATABASE_URL required')
    process.exit(1)
  }
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await run(client)
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
