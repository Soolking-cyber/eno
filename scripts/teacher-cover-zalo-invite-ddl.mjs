#!/usr/bin/env node
// ── The one-time "Zalo for urgent cover" message (owner, 2026-10-29: "go"): TeacherPrivate.coverZaloInvitedAt ──────────
//
//   set -a; . ./.env; set +a; node scripts/teacher-cover-zalo-invite-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// ⛔ RUN ON PRODUCTION BEFORE THE DEPLOY THAT DECLARES IT. Prisma selects every scalar column it knows, so the new revision
// against a TeacherPrivate without it answers 42703 on every read of the table. ADDITIVE ONLY — one nullable column — so
// the current revision is unaffected. prisma/ changed, so eno-deploy.sh refuses the deploy unless SCHEMA_OK = the full sha.
// The column is the invite's ONCE-ONLY CLAIM (src/lib/teachers/zalo-invite.ts): stamped in the same transaction as the
// message or the bell, by a compare-and-set on NULL.
// EXACTLY Prisma's own DDL for schema.prisma, made idempotent; src/lib/teachers/zalo-invite-ddl.test.ts pins it to the
// schema and runs `run()` in PGlite. ⚠️ "IF NOT EXISTS" NEVER REPAIRS: the shape is read back before COMMIT, and anything
// else rolls it back. ⛔ ONE TRANSACTION under a 5 s lock_timeout (ADD COLUMN takes an ACCESS EXCLUSIVE lock on
// TeacherPrivate for an instant) — re-run it in a quieter moment if it gives up. TeacherPrivate keeps RLS on, no policy.
//
// Idempotent; safe to re-run any time.
import { pathToFileURL } from 'node:url'

/** [label, SQL] — Prisma's statement, made idempotent. */
export const STATEMENTS = [
  ['TeacherPrivate.coverZaloInvitedAt', `ALTER TABLE "TeacherPrivate" ADD COLUMN IF NOT EXISTS "coverZaloInvitedAt" TIMESTAMP(3)`],
]

/** table:column:type:precision:nullable:default — read back, never assumed. */
export const SHAPE = ['TeacherPrivate:coverZaloInvitedAt:timestamp without time zone:3:YES:NULL']
const SHAPE_SQL = `SELECT table_name || ':' || column_name || ':' || data_type || ':' || coalesce(datetime_precision::text, '') || ':' || is_nullable || ':' || coalesce(column_default, 'NULL') AS s
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'TeacherPrivate' AND column_name = 'coverZaloInvitedAt'
  ORDER BY 1`
const RLS_SQL = `SELECT c.relrowsecurity AS rls, (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)::int AS policies
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'TeacherPrivate'`

/** The whole change in one transaction on `client` (pg.Client, or anything with `query(sql, params)`); throws after ROLLBACK. */
export async function run(client, log = console.log) {
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '5s'")
    const t = await client.query(`SELECT to_regclass('public."TeacherPrivate"') AS p`)
    if (!t.rows[0]?.p) throw new Error('TeacherPrivate missing — this is not the eno database; rolled back.')
    for (const [label, sql] of STATEMENTS) {
      await client.query(sql)
      log(`✓ ${label}`)
    }
    const shape = (await client.query(SHAPE_SQL)).rows.map((r) => r.s)
    if (shape.join('\n') !== SHAPE.join('\n')) throw new Error(`the column is not the shape this script makes:\n  ${shape.join('\n  ')}\n— stop and look; rolled back.`)
    const rls = (await client.query(RLS_SQL)).rows
    if (rls.length !== 1) throw new Error('RLS state of TeacherPrivate could not be read; rolled back.')
    if (!rls[0].rls) throw new Error('RLS is OFF on TeacherPrivate — run scripts/rls-guard.sql and look before deploying; rolled back.')
    if (rls[0].policies) throw new Error(`TeacherPrivate has ${rls[0].policies} RLS polic${rls[0].policies === 1 ? 'y' : 'ies'} — it must reach no API role; rolled back.`)
    await client.query('COMMIT')
    log('✓ committed')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  }
}

// Run only when executed, never when the test imports it.
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
