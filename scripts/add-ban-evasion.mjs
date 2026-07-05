// Trust Phase 3 (identity layer): creates the public."BannedIdentity" table (ban-
// evasion anchors — phone is the anchor identity in a phone-verified marketplace)
// + its indexes, and adds public."Report"."preScreen" (repeat-false-reporter
// pre-screen) — matching the Prisma models exactly (Prisma-default names, so a
// future `prisma migrate diff` sees the DB as already-in-sync). The new column is
// defaulted, so existing rows stay valid. BannedIdentity.sourceProfileId has NO FK
// on purpose: the ban record must survive deletion of the banned account (deleting
// the old account to free its phone is exactly the evasion the table catches).
// prisma db push can't run here because of the public.Profile -> auth.users
// cross-schema FK (Supabase-managed auth schema). Idempotent — safe to re-run.
//
//   set -a; . ./.env; set +a; node scripts/add-ban-evasion.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

// ── Report: repeat-false-reporter pre-screen marker (≥2 strikes → triaged last) ──
await client.query(`
  alter table public."Report"
    add column if not exists "preScreen" boolean not null default false;
`)

// ── BannedIdentity: identities recorded on admin suspension, cleared on lift ──
await client.query(`
  create table if not exists public."BannedIdentity" (
    "id" text not null,
    "phone" text,
    "email" text,
    "sourceProfileId" uuid not null,
    "reason" text not null,
    "createdAt" timestamp(3) not null default current_timestamp,
    constraint "BannedIdentity_pkey" primary key ("id")
  );
`)

// Names match Prisma's defaults (`@@index` → *_idx).
await client.query(`create index if not exists "BannedIdentity_phone_idx" on public."BannedIdentity" ("phone");`)
await client.query(`create index if not exists "BannedIdentity_email_idx" on public."BannedIdentity" ("email");`)
await client.query(`create index if not exists "BannedIdentity_sourceProfileId_idx" on public."BannedIdentity" ("sourceProfileId");`)

// No FK block: the schema intentionally declares none on BannedIdentity (see above),
// and Report.preScreen is a plain boolean. Nothing to catalog-guard here.

// ── Verify ──
const reportCols = await client.query(`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'Report' and column_name = 'preScreen';
`)
const table = await client.query(`
  select count(*)::int as n from information_schema.tables
  where table_schema = 'public' and table_name = 'BannedIdentity';
`)
const idx = await client.query(`
  select count(*)::int as n from pg_indexes
  where schemaname = 'public' and tablename = 'BannedIdentity'
    and indexname in ('BannedIdentity_phone_idx', 'BannedIdentity_email_idx', 'BannedIdentity_sourceProfileId_idx');
`)
const ok = reportCols.rows.length === 1 && table.rows[0].n === 1 && idx.rows[0].n === 3
console.log(ok
  ? `✓ Report.preScreen present, BannedIdentity table + ${idx.rows[0].n}/3 indexes present`
  : `✗ incomplete: Report.preScreen ${reportCols.rows.length}/1, table ${table.rows[0].n}/1, indexes ${idx.rows[0].n}/3`)
await client.end()
