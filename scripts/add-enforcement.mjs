// Trust Phase 2 (enforcement ladder): adds the enforcement columns to
// public."Profile" (enforcementState/enforcementUntil/goodStandingSince) and
// public."Report" (sellerResponse/sellerRespondedAt/remediatedAt), and creates the
// public."EnforcementAction" table + its indexes and FK — matching the Prisma models
// exactly (Prisma-default names, so a future `prisma migrate diff` sees the DB as
// already-in-sync). All new columns are nullable or defaulted, so existing rows stay
// valid. prisma db push can't run here because of the public.Profile -> auth.users
// cross-schema FK (Supabase-managed auth schema). Idempotent — safe to re-run.
//
//   set -a; . ./.env; set +a; node scripts/add-enforcement.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

// ── Profile: denormalized enforcement state + the good-standing insurance clock ──
await client.query(`
  alter table public."Profile"
    add column if not exists "enforcementState" text not null default 'good_standing',
    add column if not exists "enforcementUntil" timestamp(3),
    add column if not exists "goodStandingSince" timestamp(3);
`)

// ── Report: buyer-king SLA (seller response) + remediation marker ──
await client.query(`
  alter table public."Report"
    add column if not exists "sellerResponse" text,
    add column if not exists "sellerRespondedAt" timestamp(3),
    add column if not exists "remediatedAt" timestamp(3);
`)

// ── EnforcementAction: the due-process ledger (one row per enforcement episode) ──
await client.query(`
  create table if not exists public."EnforcementAction" (
    "id" text not null,
    "profileId" uuid not null,
    "state" text not null,
    "reason" text not null,
    "adminNote" text,
    "triggerReportId" text,
    "decidedBy" text not null,
    "status" text not null default 'active',
    "expiresAt" timestamp(3),
    "pulledListingIds" text,
    "appealText" text,
    "appealedAt" timestamp(3),
    "appealOutcome" text,
    "appealResolvedAt" timestamp(3),
    "liftedAt" timestamp(3),
    "createdAt" timestamp(3) not null default current_timestamp,
    constraint "EnforcementAction_pkey" primary key ("id")
  );
`)

// Names match Prisma's defaults (`@@index` → *_idx).
await client.query(`create index if not exists "EnforcementAction_profileId_status_idx" on public."EnforcementAction" ("profileId", "status");`)
await client.query(`create index if not exists "EnforcementAction_status_createdAt_idx" on public."EnforcementAction" ("status", "createdAt");`)

// FK (public schema only — no auth.* involvement). ADD CONSTRAINT has no
// IF NOT EXISTS, so guard via the catalog. Referential actions match the schema
// (`onDelete: Cascade`; Prisma's default onUpdate is Cascade).
await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'EnforcementAction_profileId_fkey') then
      alter table public."EnforcementAction"
        add constraint "EnforcementAction_profileId_fkey" foreign key ("profileId")
        references public."Profile"("id") on delete cascade on update cascade;
    end if;
  end $$;
`)

// ── Verify ──
const profileCols = await client.query(`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'Profile'
    and column_name in ('enforcementState', 'enforcementUntil', 'goodStandingSince');
`)
const reportCols = await client.query(`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'Report'
    and column_name in ('sellerResponse', 'sellerRespondedAt', 'remediatedAt');
`)
const table = await client.query(`
  select count(*)::int as n from information_schema.tables
  where table_schema = 'public' and table_name = 'EnforcementAction';
`)
const ok = profileCols.rows.length === 3 && reportCols.rows.length === 3 && table.rows[0].n === 1
console.log(ok
  ? `✓ Profile +${profileCols.rows.length} cols, Report +${reportCols.rows.length} cols, EnforcementAction table present`
  : `✗ incomplete: Profile ${profileCols.rows.length}/3, Report ${reportCols.rows.length}/3, table ${table.rows[0].n}/1`)
await client.end()
