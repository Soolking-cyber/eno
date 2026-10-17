#!/usr/bin/env node
// ── _hide_secondhand_20261016: the second-hand cap's pool (2026-10-16) — the weekly showcase's only source of restores ──
//
//   set -a; . ./.env; set +a; node scripts/secondhand-pool-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// The table was made by hand with the keep-5 cap on 2026-10-16 (6,920 ids); this is its definition, for a rebuild
// (⚠️ OUTSIDE PRISMA — CLAUDE.md lists it among the tables `prisma db push` would DROP) and to bring its grants in line.
// Measured on prod 2026-10-17: `id text PRIMARY KEY, hidden_at timestamptz DEFAULT now()`, RLS on with no policy (the API
// roles read and delete nothing) — but anon and authenticated still held table grants, which this revokes.
// ⚠️ hidden_at IS timestamptz: the pool read (src/lib/secondhand-showcase-run.ts POOL_SQL) compares it `AT TIME ZONE 'UTC'`
// with Listing."updatedAt", a UTC `timestamp`; and the run's trims insert with `ON CONFLICT (id)`, which needs the key.
// Written only through db.$executeRaw as postgres (BYPASSRLS). Idempotent; one transaction with a 5 s lock timeout.
import pg from 'pg'

const STATEMENTS = [
  [
    'pool table',
    `CREATE TABLE IF NOT EXISTS public._hide_secondhand_20261016 (
       id        text PRIMARY KEY,
       hidden_at timestamptz DEFAULT now()
     )`,
  ],
  ['pool RLS on', `ALTER TABLE public._hide_secondhand_20261016 ENABLE ROW LEVEL SECURITY`],
  // ⚠️⚠️ REVOKE — RLS IS NOT WHAT KEEPS PostgREST OUT, GRANTS ARE (apple-siwa-ddl.mjs): Supabase's default privileges
  // hand new public tables to `anon` and `authenticated`.
  ['pool revoke API roles', `REVOKE ALL ON public._hide_secondhand_20261016 FROM anon, authenticated, PUBLIC`],
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
  // Assert rather than assume — a table made by hand may differ from this definition, and CREATE IF NOT EXISTS keeps it.
  const cols = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '_hide_secondhand_20261016' ORDER BY ordinal_position`)
  const shape = cols.rows.map((r) => `${r.column_name}:${r.data_type}`).join(',')
  if (shape !== 'id:text,hidden_at:timestamp with time zone') throw new Error(`unexpected columns (${shape}) — rolled back.`)
  const pk = await client.query(
    `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'public._hide_secondhand_20261016'::regclass AND i.indisprimary`)
  const key = pk.rows.map((r) => r.attname).join(',')
  if (key !== 'id') throw new Error(`the primary key is (${key || 'none'}), not (id) — the trims insert ON CONFLICT (id); rolled back.`)
  const rel = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public._hide_secondhand_20261016'::regclass`)
  if (!rel.rows[0]?.relrowsecurity) throw new Error('RLS did not switch on — rolled back.')
  // has_table_privilege asks Postgres directly, whoever runs this (rum-ddl.mjs: information_schema lists only grants
  // involving the current role); PUBLIC through aclexplode (grantee 0).
  // …and MAINTAIN on Postgres 17+ (it allows LOCK TABLE; the keyword errors on 16 and older).
  const v17 = Number((await client.query(`SELECT current_setting('server_version_num') AS v`)).rows[0].v) >= 170000
  const priv = await client.query(
    `SELECT r.rolname FROM pg_roles r
      WHERE r.rolname IN ('anon', 'authenticated')
        AND (has_table_privilege(r.rolname, 'public._hide_secondhand_20261016', $1)
             OR has_any_column_privilege(r.rolname, 'public._hide_secondhand_20261016', 'SELECT,INSERT,UPDATE,REFERENCES'))
     UNION ALL
     SELECT 'PUBLIC' FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = 'public._hide_secondhand_20261016'::regclass AND a.grantee = 0`,
    [`SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER${v17 ? ',MAINTAIN' : ''}`])
  if (priv.rows.length) throw new Error(`the pool still grants ${JSON.stringify(priv.rows)} — rolled back.`)
  await client.query('COMMIT')
  console.log('✓ committed')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
