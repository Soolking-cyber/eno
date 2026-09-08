/**
 * Create the WhatsApp bridge's dedupe/consent table.
 *
 *   node --env-file=.env scripts/whatsapp-inbound-ddl.mjs
 *
 * ⛔ ADDITIVE DDL, RUN BY HAND — `prisma db push` IS BANNED ON THIS PROJECT and would emit 18
 * DROP TABLEs for everything Prisma does not manage (see CLAUDE.md). One CREATE TABLE IF NOT
 * EXISTS plus its indexes is the whole change; it takes no locks worth naming and is safe to
 * re-run.
 * ⚠️ NO FOREIGN KEYS, deliberately — see the model's note in schema.prisma. That is what keeps
 * this outside the profile_auth_fk drop/restore dance.
 */
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const SQL = `
create table if not exists whatsapp_inbound (
  wamid           text primary key,
  "profileId"     uuid not null,
  "conversationId" text not null,
  "waId"          text not null,
  -- NULL = claimed but not yet delivered; see the model's note in schema.prisma.
  "deliveredAt"   timestamp(3),
  "createdAt"     timestamp(3) not null default now()
);
create index if not exists whatsapp_inbound_conversation_idx on whatsapp_inbound ("conversationId", "createdAt");
create index if not exists whatsapp_inbound_profile_idx on whatsapp_inbound ("profileId");
-- Re-runnable on a table created before deliveredAt existed.
alter table whatsapp_inbound add column if not exists "deliveredAt" timestamp(3);
`

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  // ⚠️ A DDL TRANSACTION NEEDS A LOCK TIMEOUT — the lesson from the KYC migration. Without it a
  // statement waiting on a lock blocks every reader behind it for as long as the wait lasts.
  await client.query("set lock_timeout = '5s'")
  await client.query('begin')
  await client.query(SQL)
  await client.query('commit')
  const { rows } = await client.query(
    "select count(*)::int as n from information_schema.tables where table_name = 'whatsapp_inbound'")
  console.log(`whatsapp_inbound present: ${rows[0].n === 1 ? 'yes' : 'NO'}`)
} catch (e) {
  await client.query('rollback').catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await client.end()
}
