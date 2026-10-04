// Schools DDL (2026-10-04) — the parts Prisma cannot model. Idempotent; re-run any time.
//
//   set -a; . ./.env; set +a; node scripts/schools-ddl.mjs
//
// Run AFTER the School* tables exist (CLAUDE.md "safe flow": migrate diff → apply only the additive
// CREATE TABLE / CREATE INDEX / ADD CONSTRAINT statements). Nothing existing is altered or dropped.
//
// ⛔ WHY THE CHECKS LIVE IN THE DATABASE (plan review, codex + Opus 2026-10-04): every rule the
// ranking rests on — a vote is ±1, a review's pay is all-or-nothing, a current teacher has no leaving
// year — is also enforced by the API, but a ranking that a bad import or a future script can corrupt
// without an error is not one teachers can trust. The database refuses the row instead.
// ⛔ THE Profile FKs CASCADE (declared in schema.prisma): an erased account takes its votes, review votes
// and reviews with it (privacy first). Reports keep the row and only lose the reporter (SET NULL).
// ⛔ RLS ON, NO POLICIES: PostgREST must not serve these tables to the anon key (scripts/rls-guard.sql
// explains the two leaks that made this the rule). The app reads/writes through Prisma with BYPASSRLS.

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()
// ⛔ ONE TRANSACTION (codex, diff review): Postgres DDL is transactional, so a failing constraint rolls
// EVERYTHING back — RLS included — instead of leaving the tables half-protected.
await client.query('begin')
process.on('unhandledRejection', async (e) => { console.error(e); try { await client.query('rollback') } catch {} process.exit(1) })

const tables = ['School', 'SchoolAlias', 'SchoolVote', 'SchoolReview', 'SchoolReviewVote', 'SchoolReport']
for (const t of tables) {
  const r = await client.query(`select to_regclass('public."${t}"') as t`)
  if (!r.rows[0].t) {
    console.error(`${t} does not exist yet — create the School* tables first (CLAUDE.md safe flow).`)
    process.exit(1)
  }
}

// ⛔ RLS FIRST (diff review, codex + Opus): Supabase's default privileges hand `anon` every new public
// table, so RLS is the first thing this script does — not the last, where any failing constraint below
// would leave the tables open. (Production also enables it at CREATE TABLE time: the event trigger in
// scripts/rls-guard.sql, and the safe-flow transaction that creates them.)
for (const t of tables) {
  await client.query(`alter table "${t}" enable row level security`)
  const on = (await client.query(`select relrowsecurity from pg_class where oid = 'public."${t}"'::regclass`)).rows[0].relrowsecurity
  if (!on) { console.error(`RLS did not switch on for ${t} — stopping.`); process.exit(1) }
  console.log(`ok  RLS ${t}`)
}

/**
 * Add a constraint once; `def` is everything after ADD CONSTRAINT <name>. ⚠️ ADD-ONCE BY NAME: a later
 * change to a definition is NOT applied by re-running — give the new rule a new name (and retire the old
 * one in the same reviewed change), or the old rule silently stays.
 */
async function constraint(table, name, def) {
  await client.query(`
    do $$ begin
      if not exists (select 1 from pg_constraint where conname = '${name}' and conrelid = 'public."${table}"'::regclass) then
        alter table "${table}" add constraint "${name}" ${def};
      end if;
    end $$`)
  console.log(`ok  ${name}`)
}

const KINDS = `('language_centre','international_school','bilingual_school','agency','university')`
await constraint('School', 'School_kind_check', `check (kind in ${KINDS})`)
await constraint('School', 'School_status_check', `check (status in ('active','hidden'))`)
await constraint('School', 'School_slug_check', `check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`)

await constraint('SchoolAlias', 'SchoolAlias_alias_check', `check (alias = lower(alias) and length(alias) between 3 and 120)`)

await constraint('SchoolVote', 'SchoolVote_value_check', `check (value in (-1, 1))`)
await constraint('SchoolReviewVote', 'SchoolReviewVote_value_check', `check (value in (-1, 1))`)

await constraint('SchoolReview', 'SchoolReview_tenure_check', `check (tenure in ('lt1','1to2','2plus'))`)
await constraint('SchoolReview', 'SchoolReview_role_check', `check (role in ('teacher','head_teacher','assistant','other'))`)
await constraint('SchoolReview', 'SchoolReview_employment_check', `check (employment in ('full_time','part_time','contract'))`)
await constraint('SchoolReview', 'SchoolReview_status_check', `check (status in ('pending','published','rejected','removed'))`)
await constraint('SchoolReview', 'SchoolReview_left_check', `check ((current and "leftYear" is null) or (not current and ("leftYear" is null or "leftYear" between 1990 and 2100)))`)
await constraint('SchoolReview', 'SchoolReview_text_check', `check (length(pros) between 20 and 2000 and length(cons) between 20 and 2000 and (advice is null or length(advice) <= 1000))`)
// ⛔ payVnd IS WHAT THE PUBLIC RANGE IS BUILT FROM, so the database pins it to what the teacher entered:
// VND = the amount itself (and no rate); USD = amount × the stored rate (±1: JS rounds .5 up, Postgres
// rounds a double half-to-even — Opus, diff review); and either way inside the same
// sanity band the API applies (logic.ts payInBand). A script cannot slip a fabricated figure past this.
await constraint('SchoolReview', 'SchoolReview_pay_check', `check (
  ("payAmount" is null and "payCurrency" is null and "payPeriod" is null and "payVnd" is null and "fxRate" is null and "fxDate" is null)
  -- ⛔ EXPLICIT NOT NULLs: a CHECK passes when it evaluates to NULL, so without them a row with an amount
  -- and no payVnd would slip through every comparison below (codex, diff review).
  or ("payAmount" is not null and "payVnd" is not null and "payCurrency" is not null and "payPeriod" is not null
      and "payAmount" > 0 and "payPeriod" in ('hour','month')
      and (("payCurrency" = 'VND' and "payVnd" = "payAmount" and "fxRate" is null and "fxDate" is null)
        or ("payCurrency" = 'USD' and "fxRate" between 5000 and 100000 and "fxDate" is not null and abs("payVnd" - "payAmount" * "fxRate") <= 1))
      and (("payPeriod" = 'hour' and "payVnd" between 50000 and 5000000) or ("payPeriod" = 'month' and "payVnd" between 3000000 and 300000000))))`)

await constraint('SchoolReport', 'SchoolReport_kind_check', `check (kind in ('review_report','school_complaint'))`)
await constraint('SchoolReport', 'SchoolReport_status_check', `check (status in ('open','resolved','dismissed'))`)
// (No "a review_report must name a review" CHECK: when the reviewer's account is erased the review goes
// and reviewId is SET NULL, and the report must survive as the moderation trail. The API requires it.)
// A report's review must be a review OF THAT SCHOOL (codex, diff review). ⚠️ A TRIGGER, NOT A COMPOSITE FK:
// Prisma cannot model a relation over an optional + a required column, and a constraint Prisma does not
// know about comes back as a DROP in every future `migrate diff` (measured on the scratch DB) — one
// careless apply would silently remove it. Prisma ignores triggers. CREATE OR REPLACE: idempotent, no DROP.
await client.query(`
  create or replace function public.school_report_review_matches() returns trigger language plpgsql as $f$
  begin
    if new."reviewId" is not null and not exists (
      select 1 from "SchoolReview" r where r.id = new."reviewId" and r."schoolId" = new."schoolId") then
      -- Plain RAISE (P0001): its message reaches the caller; Prisma rewrites a 23503 into a generic FK error.
      raise exception 'SchoolReport: review % does not belong to school %', new."reviewId", new."schoolId";
    end if;
    return new;
  end $f$`)
await client.query(`
  create or replace trigger school_report_review_matches
  before insert or update of "reviewId", "schoolId" on "SchoolReport"
  for each row execute function public.school_report_review_matches()`)
console.log('ok  trigger school_report_review_matches')
// …and a review never moves to another school (codex, diff review), which keeps that check true for the
// reports already filed against it. Nothing in the app moves one; this makes it impossible.
await client.query(`
  create or replace function public.school_review_school_fixed() returns trigger language plpgsql as $f$
  begin
    if new."schoolId" is distinct from old."schoolId" then
      raise exception 'SchoolReview: a review cannot move to another school';
    end if;
    return new;
  end $f$`)
await client.query(`
  create or replace trigger school_review_school_fixed
  before update of "schoolId" on "SchoolReview"
  for each row execute function public.school_review_school_fixed()`)
console.log('ok  trigger school_review_school_fixed')

// ⚠️ THE FOREIGN KEYS ARE PRISMA RELATIONS (schema.prisma), NOT HERE: Profile → votes / reviews / review
// votes CASCADE (an erased account takes them), the reporter SET NULL, School.sellerId → Seller SET NULL
// (a dangling id would lift the owner's exclusion). Declared there so a future `migrate diff` never
// proposes dropping them; the safe flow creates them with the tables.

await client.query('commit')
await client.end()
