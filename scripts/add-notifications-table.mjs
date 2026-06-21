// Creates the public."Notification" table. prisma db push can't run here because
// of the public.Profile -> auth.users cross-schema FK (Supabase-managed auth
// schema), so we create the table by hand to match the Prisma `Notification`
// model exactly (id text, recipientId uuid FK -> Profile, etc.). Idempotent.
//
//   set -a; . ./.env; set +a; node scripts/add-notifications-table.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

await client.query(`
  create table if not exists public."Notification" (
    "id"             text primary key,
    "recipientId"    uuid not null,
    "type"           text not null,
    "title"          text not null,
    "body"           text,
    "actorName"      text,
    "conversationId" text,
    "listingId"      text,
    "read"           boolean not null default false,
    "createdAt"      timestamp(3) not null default now(),
    constraint "Notification_recipientId_fkey" foreign key ("recipientId")
      references public."Profile"("id") on delete cascade
  );
`)
await client.query(`create index if not exists "Notification_recipientId_createdAt_idx" on public."Notification" ("recipientId", "createdAt");`)
await client.query(`create index if not exists "Notification_recipientId_read_idx" on public."Notification" ("recipientId", "read");`)

const { rows } = await client.query(`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'Notification'
  order by ordinal_position;
`)
console.log(rows.length
  ? `✓ Notification table ready (${rows.length} cols): ${rows.map((r) => r.column_name).join(', ')}`
  : '✗ Notification table not found')
await client.end()
