// Covering index on Message.senderProfileId (the FK to Profile) so joins and
// cascade-delete checks use an index scan instead of a seq scan — flagged as an
// unindexed foreign key by Supabase's performance advisor. Raw SQL because
// `prisma db push` is blocked by the Profile→auth.users cross-schema FK on this DB.
// Name matches Prisma's default for `@@index([senderProfileId])` so schema.prisma and
// the DB stay in sync. Idempotent; re-run after any DB reset. Run over DIRECT_URL:
//   set -a; . ./.env; set +a; node scripts/add-message-sender-index.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

// CREATE INDEX CONCURRENTLY can't run inside a transaction; pg runs each query in
// autocommit so this is fine, and CONCURRENTLY keeps it lock-free as Message grows.
await client.query(
  'create index concurrently if not exists "Message_senderProfileId_idx" on "Message" ("senderProfileId")',
)
console.log('✓ Message_senderProfileId_idx')

const { rows } = await client.query(
  "select indexname from pg_indexes where tablename = 'Message' and indexname = 'Message_senderProfileId_idx'",
)
console.log(rows.length ? '\n✓ Message senderProfileId FK index in place.' : '\n✗ MISSING')
await client.end()
