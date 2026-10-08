// Teachers DDL (2026-09-30) — the parts Prisma cannot model. Idempotent; re-run any time.
//
//   set -a; . ./.env; set +a; node scripts/teachers-ddl.mjs
//
// Run AFTER the teacher tables exist (the safe flow in prisma/CLAUDE.md creates them from
// schema.prisma). Adds CHECK constraints (TeacherJobMatch's owner rule; TeacherProfile's cover-lesson bounds,
// 2026-10-07) and the PRIVATE storage bucket for CVs. Nothing existing is altered or dropped.
//
// ⛔ THE CHECK IS THE ONLY THING THAT MAKES `TeacherJobMatch` DEDUPE. Its two unique keys are
// (teacherProfileId, listingId) and (leadId, listingId); a row with BOTH ids null satisfies both
// (Postgres treats NULLs as distinct), so the matcher could re-email and re-list the same pair
// forever. Exactly one owner per row closes that (Opus plan review, 2026-09-30).
//
// ⛔ `teacher-cvs` IS PRIVATE. A CV carries the phone and email the whole feature withholds until
// the teacher taps "Share"; a public bucket would publish them at an unguessable-but-leakable URL.
// Served only by a 10-minute signed URL from /api/teachers/[id]/cv.
//
// ⛔ RLS ON, NO POLICIES, for every teacher table (2026-10-07): Supabase's default privileges give anon/authenticated ALL
// on each new public table, and the app reads them only through Prisma (BYPASSRLS). Production also enables RLS at
// CREATE TABLE time (the event trigger in scripts/rls-guard.sql), but this script asserts it rather than depending on
// that. ⚠️ After running it on production, run the schema-wide check too:
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()
// ⛔ ONE TRANSACTION (gate review, 2026-10-07 — the schools-ddl.mjs pattern): Postgres DDL is transactional, so a failing
// step rolls EVERYTHING back instead of leaving, say, TeacherVideoShare created without its unique key and foreign key.
// Every `process.exit(1)` below leaves without COMMIT, and Postgres rolls an uncommitted transaction back on disconnect.
await client.query('begin')
// Never queue thread opens behind a long wait: the FK step needs a lock on the busy Conversation table while this
// transaction already holds the teacher tables. A timeout rolls everything back; the script is safe to re-run.
await client.query("set local lock_timeout = '5s'")
process.on('unhandledRejection', async (e) => { console.error(e); try { await client.query('rollback') } catch {} process.exit(1) })

const exists = await client.query(`select to_regclass('public."TeacherJobMatch"') as t`)
if (!exists.rows[0].t) {
  console.error('TeacherJobMatch does not exist yet — create the teacher tables first (prisma/CLAUDE.md safe flow).')
  process.exit(1)
}

await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'TeacherJobMatch_one_owner' and conrelid = '"TeacherJobMatch"'::regclass) then
      alter table "TeacherJobMatch" add constraint "TeacherJobMatch_one_owner"
        check (("teacherProfileId" is null) <> ("leadId" is null));
    end if;
  end $$`)
console.log('ok  TeacherJobMatch_one_owner')

// ⛔ COVER LESSONS (2026-10-07) — the database half of the cover rules: cover ON means a rate inside the published
// range, at least one free period and one area, and a recorded consent; never more periods or areas than the form
// can produce. A save that broke these is a code bug, and this makes it a loud one rather than a profile that
// matches searches it cannot answer. ⚠️ THE NUMBERS ARE src/lib/teachers/cover.ts COVER_LIMITS (rateMin, rateMax,
// slots, areas) — cover.test.ts reads this file and fails if the two drift.
// ⚠️ `if not exists` matches the NAME (on this table) only: to change the numbers later, drop the constraint first (or add the
// changed one under a new name and drop the old), or the database keeps the old bounds while this file shows new ones.
// ⚠️ coalesce() everywhere because a CHECK ACCEPTS NULL: a NULL rate or array would otherwise slip past the rules.
//
// ⛔ THE COLUMNS THEMSELVES ARE ADDED HERE TOO, idempotently and ADDITIVELY ONLY — exactly the eight `ADD COLUMN`s
// `prisma migrate diff` produces for schema.prisma's TeacherProfile cover fields, so the migration is a reviewed,
// committed, repeatable step rather than a loose SQL file (gate review, 2026-10-07). That same diff also proposes
// DROP TABLE for the tables Prisma does not manage — never apply it wholesale (CLAUDE.md "SCHEMA CHANGES").
// ⚠️ RUN THIS ON PRODUCTION BEFORE THE DEPLOY: GET /api/teachers/me reads every TeacherProfile column, so the new
// code against the old table answers 42703. The old code is unaffected by the new columns.
await client.query(`
  alter table "TeacherProfile"
    add column if not exists "coverOpen" boolean not null default false,
    add column if not exists "coverSlots" text[] default array[]::text[],
    add column if not exists "coverAreas" text[] default array[]::text[],
    add column if not exists "coverRateVnd" integer,
    add column if not exists "coverConfirmedAt" timestamp(3),
    add column if not exists "coverConsentAt" timestamp(3),
    add column if not exists "coverConsentVersion" text,
    add column if not exists "coverWithdrawnAt" timestamp(3)`)
console.log('ok  TeacherProfile cover columns')
await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'TeacherProfile_cover_bounds' and conrelid = '"TeacherProfile"'::regclass) then
      alter table "TeacherProfile" add constraint "TeacherProfile_cover_bounds" check (
        coalesce(cardinality("coverSlots"), 0) <= 21 and coalesce(cardinality("coverAreas"), 0) <= 40
        and ("coverRateVnd" is null or "coverRateVnd" between 0 and 100000000)
        and (not "coverOpen" or (
          coalesce("coverRateVnd", 0) between 50000 and 2000000
          and "coverConsentVersion" is not null
          and coalesce(cardinality("coverSlots"), 0) >= 1 and coalesce(cardinality("coverAreas"), 0) >= 1
          and "coverConsentAt" is not null)));
    end if;
  end $$`)
console.log('ok  TeacherProfile_cover_bounds')

// ⛔ INTRO VIDEO: SHOW, OR KEEP PRIVATE AND SEND ON REQUEST (owner, 2026-10-07). Exactly Prisma's own DDL for these
// schema.prisma fields (`migrate diff` shows no drift after this runs), made idempotent: the teacher's choice and the
// server's change counter on TeacherProfile, the private object path on TeacherPrivate, and TeacherVideoShare — its
// own grant table, NEVER TeacherContactShare (a row there already means "phone, email and CV shared").
// ⚠️ RUN THIS ON PRODUCTION BEFORE THE DEPLOY: the conversation GET selects teacherVideoShare on EVERY thread open,
// so the new code against the old schema breaks every conversation, not only teacher threads.
await client.query(`
  alter table "TeacherProfile"
    add column if not exists "videoOnRequest" boolean not null default false,
    add column if not exists "videoVersion" integer not null default 0`)
await client.query(`alter table "TeacherPrivate" add column if not exists "videoPath" text`)
await client.query(`
  create table if not exists "TeacherVideoShare" (
    "id" text not null,
    "conversationId" text not null,
    "requestedAt" timestamp(3),
    "sharedAt" timestamp(3),
    "revokedAt" timestamp(3),
    constraint "TeacherVideoShare_pkey" primary key ("id")
  )`)
// RLS before anything else touches the new table — and for the four older teacher tables, which no script asserted.
for (const t of ['TeacherProfile', 'TeacherPrivate', 'TeacherContactShare', 'TeacherVideoShare', 'TeacherJobMatch']) {
  await client.query(`alter table "${t}" enable row level security`)
  const on = (await client.query(`select relrowsecurity from pg_class where oid = 'public."${t}"'::regclass`)).rows[0].relrowsecurity
  if (!on) { console.error(`RLS did not switch on for ${t} — stopping.`); process.exit(1) }
  console.log(`ok  RLS ${t}`)
}
await client.query(`create unique index if not exists "TeacherVideoShare_conversationId_key" on "TeacherVideoShare"("conversationId")`)
await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'TeacherVideoShare_conversationId_fkey' and conrelid = '"TeacherVideoShare"'::regclass) then
      alter table "TeacherVideoShare" add constraint "TeacherVideoShare_conversationId_fkey"
        foreign key ("conversationId") references "Conversation"("id") on delete cascade on update cascade;
    end if;
  end $$`)
console.log('ok  intro video columns + TeacherVideoShare')

// Storage lives in the `storage` schema only on Supabase; a scratch Postgres has none.
const hasStorage = await client.query(`select to_regclass('storage.buckets') as t`)
if (hasStorage.rows[0].t) {
  await client.query(
    `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
     values ('teacher-cvs', 'teacher-cvs', false, 10485760, array['application/pdf'])
     on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types`)
  const b = await client.query(`select public from storage.buckets where id = 'teacher-cvs'`)
  if (b.rows[0].public !== false) { console.error('teacher-cvs is PUBLIC — stopping.'); process.exit(1) }
  console.log('ok  bucket teacher-cvs (private)')
  // The private intro videos (TeacherPrivate.videoPath): PRIVATE, the listing-videos limit, the same three types.
  await client.query(
    `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
     values ('teacher-videos', 'teacher-videos', false, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
     on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types`)
  const v = await client.query(`select public from storage.buckets where id = 'teacher-videos'`)
  if (v.rows[0].public !== false) { console.error('teacher-videos is PUBLIC — stopping.'); process.exit(1) }
  console.log('ok  bucket teacher-videos (private)')
} else {
  console.log('skip bucket: no storage schema (scratch database)')
}

await client.query('commit')
console.log('ok  committed')
await client.end()
