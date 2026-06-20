// Adds the per-user "delete conversation" columns to public."Conversation".
// prisma db push can't run here because of the public.Profile -> auth.users
// cross-schema FK (Supabase-managed auth schema). These two columns map exactly
// to the Prisma `DateTime?` fields (nullable timestamp(3)). Idempotent.
//
//   set -a; . ./.env; set +a; node scripts/add-convo-delete-cols.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

await client.query(`
  alter table public."Conversation"
    add column if not exists "buyerDeletedAt" timestamp(3),
    add column if not exists "sellerDeletedAt" timestamp(3);
`)

const { rows } = await client.query(`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'Conversation'
    and column_name in ('buyerDeletedAt', 'sellerDeletedAt')
  order by column_name;
`)
console.log(rows.length === 2
  ? `✓ columns present: ${rows.map((r) => `${r.column_name} (${r.data_type}, nullable=${r.is_nullable})`).join('; ')}`
  : `✗ expected 2 columns, found ${rows.length}`)
await client.end()
