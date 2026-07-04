// Adds the verified-buyer provenance columns to public."Review" (authorProfileId,
// listingId, conversationId) + their indexes and FKs, matching the Prisma `Review`
// model exactly. All three are NULLABLE so seeded/legacy rows stay valid (they
// simply render without the "Verified buyer" badge). The unique index on
// conversationId is the one-review-per-conversation dedup + proof key.
// prisma db push can't run here because of the public.Profile -> auth.users
// cross-schema FK (Supabase-managed auth schema). Idempotent — safe to re-run.
//
//   set -a; . ./.env; set +a; node scripts/add-review-cols.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

await client.query(`
  alter table public."Review"
    add column if not exists "authorProfileId" uuid,
    add column if not exists "listingId" text,
    add column if not exists "conversationId" text;
`)

// Names match Prisma's defaults (`@unique` → *_key, `@@index` → *_idx) so a future
// `prisma migrate diff` sees the DB as already-in-sync.
await client.query(`create unique index if not exists "Review_conversationId_key" on public."Review" ("conversationId");`)
await client.query(`create index if not exists "Review_authorProfileId_idx" on public."Review" ("authorProfileId");`)

// FKs (public schema only — no auth.* involvement). ADD CONSTRAINT has no
// IF NOT EXISTS, so guard via the catalog. Referential actions match the schema
// (`onDelete: SetNull`; Prisma's default onUpdate is Cascade).
await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'Review_authorProfileId_fkey') then
      alter table public."Review"
        add constraint "Review_authorProfileId_fkey" foreign key ("authorProfileId")
        references public."Profile"("id") on delete set null on update cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'Review_listingId_fkey') then
      alter table public."Review"
        add constraint "Review_listingId_fkey" foreign key ("listingId")
        references public."Listing"("id") on delete set null on update cascade;
    end if;
  end $$;
`)

const { rows } = await client.query(`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'Review'
    and column_name in ('authorProfileId', 'listingId', 'conversationId')
  order by column_name;
`)
console.log(rows.length === 3
  ? `✓ columns present: ${rows.map((r) => `${r.column_name} (${r.data_type}, nullable=${r.is_nullable})`).join('; ')}`
  : `✗ expected 3 columns, found ${rows.length}`)
await client.end()
