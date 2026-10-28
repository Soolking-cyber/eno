// Teachers DDL (2026-09-30) — the parts Prisma cannot model. Idempotent; re-run any time.
//
//   set -a; . ./.env; set +a; node scripts/teachers-ddl.mjs
//
// Run AFTER the teacher tables exist (the safe flow in prisma/CLAUDE.md creates them from
// schema.prisma). Adds CHECK constraints (TeacherJobMatch's owner rule; TeacherProfile's cover-lesson bounds,
// 2026-10-07; its teach-area bounds, 2026-10-08), the later TeacherProfile columns (cover lessons, the intro video, the
// onboarding redesign, the "Identity verified" switch of 2026-10-16), TeacherContactShare.phoneShared (2026-10-09), the
// TeacherDraft table (2026-10-11), the two message-email tables (2026-10-12) and the PRIVATE
// storage buckets. Nothing existing
// is altered or dropped.
//
// ⛔ THE ONE LISTING COLUMN THE IDENTITY MARK NEEDS (Listing."identityMarkNotice", the card's display cache) IS NOT
// HERE, ON PURPOSE: scripts/listing-identity-mark-ddl.mjs adds it in its own short transaction. `ALTER TABLE "Listing"`
// takes an ACCESS EXCLUSIVE lock before `IF NOT EXISTS` is even checked, and this script is "re-run any time" in ONE
// transaction that also locks Conversation — every future run would stall Listing reads site-wide. Run BOTH on
// production BEFORE the deploy that declares the columns.
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
// 2026-10-28 (Hà Nội's districts, owner): the area cap is 60 (cover.ts COVER_LIMITS.areas; it was 40). `if not exists`
// matches the NAME only, so a database made with 40 keeps it here — scripts/teacher-cover-zalo-ddl.mjs widens it.
await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'TeacherProfile_cover_bounds' and conrelid = '"TeacherProfile"'::regclass) then
      alter table "TeacherProfile" add constraint "TeacherProfile_cover_bounds" check (
        coalesce(cardinality("coverSlots"), 0) <= 21 and coalesce(cardinality("coverAreas"), 0) <= 60
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

// ⛔ TEACHER ONBOARDING REDESIGN (owner, 2026-10-08) — the situation, the one teach-area list and the consent evidence.
// EXACTLY the sixteen `ADD COLUMN`s `prisma migrate diff` prints for schema.prisma's new TeacherProfile fields (diffed
// schema-to-schema, so `migrate diff` against a migrated database shows no drift), made idempotent and ADDITIVE ONLY.
// Every one is nullable or defaulted, so the old code keeps running against the migrated table, and nothing existing
// changes meaning: the old place / experience / native columns stay, written by every new save as mirrors
// (src/lib/teachers/projection.ts teacherMirrors) — the old revision, a rollback and the external matcher read them.
//   · the answers: livesIn (NULL = not answered — never defaulted), currentProvince, currentDistrictKey, teachAreas,
//     teachLanguages, englishLevel, experienceBand, and the server-written situationVersion (NULL = not yet migrated by
//     scripts/teachers-backfill.ts) and teachAreasConfirmedAt;
//   · the consent evidence (PDP Law 91/2025 Art 9(4)(d), Decree 356/2025 Art 6(3)): consentPublicVersion, and per
//     opt-in its time, the notice version shown and the withdrawal's time.
// ⚠️ RUN THIS ON PRODUCTION BEFORE THE DEPLOY (and before the backfill): GET /api/teachers/me reads every TeacherProfile
// column, so the new code against the old table answers 42703.
await client.query(`
  alter table "TeacherProfile"
    add column if not exists "consentPublicVersion" text,
    add column if not exists "currentDistrictKey" text,
    add column if not exists "currentProvince" text,
    add column if not exists "englishLevel" text,
    add column if not exists "experienceBand" text,
    add column if not exists "livesIn" text,
    add column if not exists "matchEmailNoticeVersion" text,
    add column if not exists "matchEmailOptInAt" timestamp(3),
    add column if not exists "matchEmailWithdrawnAt" timestamp(3),
    add column if not exists "situationVersion" integer,
    add column if not exists "staffContactNoticeVersion" text,
    add column if not exists "staffContactOptInAt" timestamp(3),
    add column if not exists "staffContactWithdrawnAt" timestamp(3),
    add column if not exists "teachAreas" text[] default array[]::text[],
    add column if not exists "teachAreasConfirmedAt" timestamp(3),
    add column if not exists "teachLanguages" text[] default array[]::text[]`)
console.log('ok  TeacherProfile onboarding columns')
// The database half of the list bounds: never more teach areas or taught languages than the form can produce. ⚠️ THE
// NUMBERS ARE src/lib/teachers/places.ts MAX_TEACH_AREAS and profile.ts LIMITS.teachLanguages — places.test.ts reads
// this file and fails if they drift. coalesce(): a CHECK accepts NULL. `if not exists` matches the NAME only: to change
// the numbers later, drop the constraint first (see TeacherProfile_cover_bounds above).
// 2026-10-28: 60, was 40 (places.ts MAX_TEACH_AREAS, Hà Nội's districts) — widened on an existing database by
// scripts/teacher-cover-zalo-ddl.mjs, as above.
await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'TeacherProfile_teach_bounds' and conrelid = '"TeacherProfile"'::regclass) then
      alter table "TeacherProfile" add constraint "TeacherProfile_teach_bounds" check (
        coalesce(cardinality("teachAreas"), 0) <= 60 and coalesce(cardinality("teachLanguages"), 0) <= 8);
    end if;
  end $$`)
console.log('ok  TeacherProfile_teach_bounds')

// ⛔ A CONTACT SHARE RECORDS WHETHER ITS TAP INCLUDED THE PHONE (gate review, 2026-10-09). The phone is optional since the
// redesign, so a teacher with none shares "email & CV" — and the contact route served the CURRENT private row, so a phone
// added later silently reached every school shared with before. Exactly Prisma's DDL for schema.prisma's
// TeacherContactShare.phoneShared, idempotent and additive. DEFAULT TRUE IS THE BACKFILL, AND IT IS EXACT: every
// existing row was made while a phone was required, under the line "Shared my phone, email and CV" (and a rolled-back
// revision, which never writes the column, still inserts). On Postgres 11+ a constant default is metadata only — no
// rewrite of the table. ⚠️ RUN THIS ON PRODUCTION BEFORE THE DEPLOY: the conversation GET selects the column on EVERY
// thread open, so the new code against the old table breaks every conversation, not only teacher threads.
await client.query(`alter table "TeacherContactShare" add column if not exists "phoneShared" boolean not null default true`)
console.log('ok  TeacherContactShare.phoneShared')

// ⛔ "IDENTITY VERIFIED" — THE TEACHER'S SWITCH (owner, 2026-10-15; AUTOMATIC since 2026-10-16) — the switch and its
// record: when it was last switched on (or, since the mark became automatic, shown again) and under which
// IDENTITY_MARK_NOTICE_VERSION, and when it was last switched off (since: hidden). EXACTLY the four `ADD COLUMN`s
// `prisma migrate diff` prints for schema.prisma's TeacherProfile.identityMark* fields, made idempotent and ADDITIVE
// ONLY. Every existing row reads the switch false (`not null default false` — on Postgres 11+ a constant default is
// catalogue-only, no table rewrite) and the three records NULL, and NOTHING IS BACKFILLED — the automatic rule needs no
// DDL either: src/lib/teachers/identity-mark.ts reads "hidden" as the switch false WITH a hide time, so an untouched
// row (false, NULL) is not hidden and shows the mark while the identity check is live, and a row switched off under the
// opt-in (false, a time) stays hidden. ⛔ Never flip this default or backfill the switch: under the opt-in a false meant
// "never chose", and a true written by a script would claim an act nobody made.
// The card's display cache is Listing."identityMarkNotice" — scripts/listing-identity-mark-ddl.mjs (see the header).
// ⚠️ RUN THIS ON PRODUCTION BEFORE THE DEPLOY: GET /api/teachers/me and every teacher save read every TeacherProfile
// column, so the new code against the old table answers 42703. The old code is unaffected by the new columns.
await client.query(`
  alter table "TeacherProfile"
    add column if not exists "identityMarkAt" timestamp(3),
    add column if not exists "identityMarkNoticeVersion" text,
    add column if not exists "identityMarkOn" boolean not null default false,
    add column if not exists "identityMarkWithdrawnAt" timestamp(3)`)
console.log('ok  TeacherProfile identity-mark columns')

// ⛔ SAVED, RESUMABLE TEACHER DRAFTS (owner, 2026-10-11: "every step they input should be saved and able to resume when
// they want to", and a "continue" row in the dashboard once step 1 has answers). One row per account: the form's answers
// so far — ⛔ never a consent, an upload, the cover switch or the phone (src/lib/teachers/draft.ts draftDataOf) — the
// step to reopen on, and an integer revision every save compares and bumps (/api/teachers/me/draft). PRIVATE: no public,
// matcher, school or feed reader touches it; RLS on, no policies. Deleted with the account (the foreign key), by the
// publish (in its transaction), by "Start over", and 90 days after its last change (/api/cron/teacher-draft-retention).
// Exactly Prisma's own DDL for the TeacherDraft model, made idempotent. ⚠️ RUN THIS ON PRODUCTION BEFORE THE DEPLOY:
// every teacher publish, edit and profile delete deletes from it inside its transaction, and the account export reads
// it — all fail without the table (only the dashboard's read is guarded, as a backstop: it costs just the row).
await client.query(`
  create table if not exists "TeacherDraft" (
    "profileId" uuid not null,
    "data" jsonb not null,
    "step" text not null,
    "rev" integer not null default 1,
    "gen" uuid not null default gen_random_uuid(),
    "createdAt" timestamp(3) not null default current_timestamp,
    "updatedAt" timestamp(3) not null default current_timestamp,
    constraint "TeacherDraft_pkey" primary key ("profileId")
  )`)
// Production has no TeacherDraft before this script's first run (BEFORE the deploy): the table above is made with "gen".
// Only a table an earlier run of this script made without it (a scratch or preview database) needs the column added.
await client.query(`alter table "TeacherDraft" add column if not exists "gen" uuid not null default gen_random_uuid()`)
await client.query(`alter table "TeacherDraft" enable row level security`)
if (!(await client.query(`select relrowsecurity from pg_class where oid = 'public."TeacherDraft"'::regclass`)).rows[0].relrowsecurity) {
  console.error('RLS did not switch on for TeacherDraft — stopping.'); process.exit(1)
}
await client.query(`create index if not exists "TeacherDraft_updatedAt_idx" on "TeacherDraft"("updatedAt")`)
await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'TeacherDraft_profileId_fkey' and conrelid = '"TeacherDraft"'::regclass) then
      alter table "TeacherDraft" add constraint "TeacherDraft_profileId_fkey"
        foreign key ("profileId") references "Profile"("id") on delete cascade on update cascade;
    end if;
  end $$`)
console.log('ok  TeacherDraft (RLS on)')

// ⛔ MESSAGE EMAILS TO TEACHERS (owner, 2026-10-12) — the cron's state (src/lib/teachers/message-emails.ts): one row per
// teacher (`lastEmailAt`, the compare-and-set the send claims; `optedOutAt`, list=teacher-messages) and one row per teacher
// thread whose school has triggered an email. Ids and times only — no address, no message text. NEW TABLES, never a column on
// an existing one, so a deploy that lands before this script breaks only the new cron and the new unsubscribe list, never a
// teacher or chat query. Exactly Prisma's own DDL for the two models, made idempotent. ⚠️ RUN THIS ON PRODUCTION BEFORE THE
// DEPLOY, then scripts/rls-guard.sql.
await client.query(`
  create table if not exists "TeacherMessageEmailState" (
    "profileId" uuid not null,
    "lastEmailAt" timestamp(3),
    "optedOutAt" timestamp(3),
    "updatedAt" timestamp(3) not null default current_timestamp,
    constraint "TeacherMessageEmailState_pkey" primary key ("profileId")
  )`)
await client.query(`
  create table if not exists "TeacherMessageEmailThread" (
    "conversationId" text not null,
    "profileId" uuid not null,
    "emailedAt" timestamp(3) not null,
    "kind" text not null default 'new',
    constraint "TeacherMessageEmailThread_pkey" primary key ("conversationId")
  )`)
// A scratch database an earlier run of this script made before "kind" existed: add it (production has neither table yet).
await client.query(`alter table "TeacherMessageEmailThread" add column if not exists "kind" text not null default 'new'`)
for (const t of ['TeacherMessageEmailState', 'TeacherMessageEmailThread']) {
  await client.query(`alter table "${t}" enable row level security`)
  if (!(await client.query(`select relrowsecurity from pg_class where oid = 'public."${t}"'::regclass`)).rows[0].relrowsecurity) {
    console.error(`RLS did not switch on for ${t} — stopping.`); process.exit(1)
  }
}
await client.query(`create index if not exists "TeacherMessageEmailThread_profileId_idx" on "TeacherMessageEmailThread"("profileId")`)
await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'TeacherMessageEmailState_profileId_fkey' and conrelid = '"TeacherMessageEmailState"'::regclass) then
      alter table "TeacherMessageEmailState" add constraint "TeacherMessageEmailState_profileId_fkey"
        foreign key ("profileId") references "Profile"("id") on delete cascade on update cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'TeacherMessageEmailThread_conversationId_fkey' and conrelid = '"TeacherMessageEmailThread"'::regclass) then
      alter table "TeacherMessageEmailThread" add constraint "TeacherMessageEmailThread_conversationId_fkey"
        foreign key ("conversationId") references "Conversation"("id") on delete cascade on update cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'TeacherMessageEmailThread_profileId_fkey' and conrelid = '"TeacherMessageEmailThread"'::regclass) then
      alter table "TeacherMessageEmailThread" add constraint "TeacherMessageEmailThread_profileId_fkey"
        foreign key ("profileId") references "Profile"("id") on delete cascade on update cascade;
    end if;
  end $$`)
console.log('ok  TeacherMessageEmailState + TeacherMessageEmailThread (RLS on)')

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
