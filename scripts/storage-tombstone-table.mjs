// Creates public."StorageTombstone" — the durable erasure queue (see the model's docblock in
// prisma/schema.prisma). Idempotent; matches the Prisma model column for column so `prisma generate`
// and this table agree. Runs over DIRECT_URL like every other DDL script here (the Prisma `db push`
// flow is banned on this project: it destroys data behind the cross-schema auth FK).
//
// ⛔ RLS IS ENABLED WITH NO POLICIES, AND anon/authenticated ARE REVOKED. This table is reached only
// through Prisma (a direct Postgres role) and the service-role RPC — but it sits in `public`, which
// PostgREST exposes, and the 2026-09-01 pentest found four payments tables served to the anon key
// for exactly the reason "nobody thought about RLS on a Prisma table". Object paths are not secrets,
// but a KYC path carries a profile id and the queue is a map of what is being erased.
//
// Run:  set -a; . ./.env; set +a; node scripts/storage-tombstone-table.mjs
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }
const client = new pg.Client({ connectionString: url })
await client.connect()

const stmts = [
  `create table if not exists public."StorageTombstone" (
     "id"        text primary key,
     "bucket"    text not null,
     "path"      text not null,
     "reason"    text not null,
     -- ⚠️ UTC DEFAULTS. Prisma reads a timestamp WITHOUT time zone as UTC; a bare current_timestamp
     -- would be the session's wall clock (+07:00 on a Vietnamese box), hours off.
     "createdAt" timestamp(3) without time zone not null default (now() at time zone 'utc'),
     "notBefore" timestamp(3) without time zone not null default (now() at time zone 'utc'),
     "attempts"  integer not null default 0,
     "lastError" text
   )`,
  `create unique index if not exists "StorageTombstone_bucket_path_key" on public."StorageTombstone" ("bucket", "path")`,
  `create index if not exists "StorageTombstone_notBefore_idx" on public."StorageTombstone" ("notBefore")`,
  `alter table public."StorageTombstone" enable row level security`,
  `revoke all on public."StorageTombstone" from anon, authenticated`,
]

try {
  await client.query('begin')
  await client.query(`set local lock_timeout = '5s'`)
  for (const sql of stmts) await client.query(sql)
  await client.query('commit')
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error('failed:', e.message)
  process.exit(1)
}
const { rows } = await client.query(
  `select (select rowsecurity from pg_tables where schemaname='public' and tablename='StorageTombstone') as rls,
          (select count(*)::int from pg_indexes where schemaname='public' and tablename='StorageTombstone') as indexes`,
)
console.log('StorageTombstone ready:', rows[0])
await client.end()
