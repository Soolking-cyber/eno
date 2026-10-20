// Teacher job DMs DDL (2026-10-20) — the four tables of src/lib/teachers/job-dms. Idempotent; re-run any time.
//
//   set -a; . ./.env; set +a; node scripts/teacher-job-dms-ddl.mjs            # apply
//   set -a; . ./.env; set +a; node scripts/teacher-job-dms-ddl.mjs --check    # read-only: what exists, nothing written
//
// ⛔ NEW TABLES ONLY. Nothing existing is altered, so no running revision is affected (Prisma selects every scalar of a
// model, so an ADDED column on an existing table would break the deployed code first — none is added here). Run it on
// production BEFORE the deploy that ships the job-DM code: until then only the new cron routes can fail, and they are
// on timers that are not enabled.
// ⛔ RLS ON, NO POLICIES, asserted (the teachers-ddl.mjs rule): the app reads these through Prisma (BYPASSRLS) only.
// ⛔ ONE TRANSACTION: a failing step rolls everything back; every exit before COMMIT leaves nothing behind.
// The columns must match prisma/schema.prisma exactly (ExternalJobPost, TeacherJobDmConsent, TeacherJobDm,
// TeacherJobDmDay) — src/lib/teachers/job-dms/ddl.test.ts reads both files and fails if they drift.

import pg from 'pg'
import { readFileSync } from 'node:fs'

const check = process.argv.includes('--check')
const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const TABLES = ['ExternalJobPost', 'TeacherJobDmConsent', 'TeacherJobDm', 'TeacherJobDmDay']

// ⚠️ "IF NOT EXISTS" NEVER REPAIRS A TABLE (codex, gate 3b): an existing table of another shape would pass silently and
// fail on Prisma's first read — or, missing its unique index, record one offer twice. So the tables' exact SHAPE is
// checked against the database, in --check and inside the transaction before COMMIT, by scripts/teacher-job-dms-shape.sql
// — one row per difference: every column's type, NOT NULL and default, every constraint's definition, every index's
// columns, RLS on and no policy. infra/vn-node/job-dms/install.sh runs the SAME file on the box before it enables
// anything (codex + opus, gates 6c–6f: one definition, both places).
const SHAPE_SQL = readFileSync(new URL('./teacher-job-dms-shape.sql', import.meta.url), 'utf8')
const shapeProblems = async () => (await client.query(SHAPE_SQL)).rows.map((r) => r.problem)

const client = new pg.Client({ connectionString: url })
await client.connect()

if (check) {
  const problems = await shapeProblems()
  for (const t of TABLES) if (!problems.some((p) => p.split(' ').filter(Boolean)[1] === t)) console.log(`ok     ${t}`)
  for (const p of problems) console.log(`WRONG  ${p}`)
  await client.end()
  process.exit(problems.length ? 3 : 0)
}

await client.query('begin')
// The FKs need a short lock on "Profile"; never queue sign-ins behind a long wait. A timeout rolls back; re-run.
await client.query("set local lock_timeout = '5s'")
process.on('unhandledRejection', async (e) => { console.error(e); try { await client.query('rollback') } catch {} process.exit(1) })

await client.query(`
  create table if not exists "ExternalJobPost" (
    "id" text not null,
    "source" text not null,
    "externalKey" text not null,
    "sourceName" text not null,
    "sourceRef" text,
    "groupPublic" boolean,
    "url" text,
    "applyText" text,
    "title" text,
    "company" text,
    "locationText" text,
    "text" text not null,
    "textSig" text,
    "lang" text,
    "postedAt" timestamp(3),
    "receivedAt" timestamp(3) not null default current_timestamp,
    "status" text not null default 'new',
    "statusReason" text,
    "facts" jsonb,
    "factsVersion" text,
    "expiresAt" timestamp(3),
    "updatedAt" timestamp(3) not null default current_timestamp,
    constraint "ExternalJobPost_pkey" primary key ("id"),
    constraint "ExternalJobPost_source_check" check ("source" in ('fb', 'linkedin', 'intake')),
    constraint "ExternalJobPost_status_check" check ("status" in ('new', 'ready', 'held', 'dropped', 'expired')),
    constraint "ExternalJobPost_text_bounds" check (char_length("text") between 1 and 6000)
  )`)
await client.query(`create unique index if not exists "ExternalJobPost_source_externalKey_key" on "ExternalJobPost"("source", "externalKey")`)
await client.query(`create index if not exists "ExternalJobPost_status_receivedAt_idx" on "ExternalJobPost"("status", "receivedAt")`)
await client.query(`create index if not exists "ExternalJobPost_expiresAt_idx" on "ExternalJobPost"("expiresAt")`)
await client.query(`create index if not exists "ExternalJobPost_textSig_idx" on "ExternalJobPost"("textSig")`)
console.log('ok  ExternalJobPost')

await client.query(`
  create table if not exists "TeacherJobDmConsent" (
    "profileId" uuid not null,
    "optIn" boolean not null default false,
    "optInAt" timestamp(3),
    "noticeVersion" text,
    "withdrawnAt" timestamp(3),
    "invitedAt" timestamp(3),
    "pausedAt" timestamp(3),
    "updatedAt" timestamp(3) not null default current_timestamp,
    constraint "TeacherJobDmConsent_pkey" primary key ("profileId"),
    -- an opt-in is provable: ON always carries its time and the notice it was given under
    constraint "TeacherJobDmConsent_evidence" check (not "optIn" or ("optInAt" is not null and "noticeVersion" is not null))
  )`)
// A table created before "pausedAt" existed gets it here (codex + opus, gate 3k): nullable, so instant and safe.
await client.query(`alter table "TeacherJobDmConsent" add column if not exists "pausedAt" timestamp(3)`)
console.log('ok  TeacherJobDmConsent')

await client.query(`
  create table if not exists "TeacherJobDm" (
    "id" text not null,
    "profileId" uuid not null,
    "jobKey" text not null,
    "mode" text not null,
    "kind" text not null,
    "day" text not null,
    "conversationId" text,
    "score" integer not null,
    "reasons" jsonb not null default '[]',
    "preview" text,
    "createdAt" timestamp(3) not null default current_timestamp,
    constraint "TeacherJobDm_pkey" primary key ("id"),
    constraint "TeacherJobDm_mode_check" check ("mode" in ('live', 'shadow')),
    constraint "TeacherJobDm_kind_check" check ("kind" in ('jobs', 'cover')),
    constraint "TeacherJobDm_jobKey_check" check ("jobKey" ~ '^(post|listing):.+$'),
    constraint "TeacherJobDm_day_check" check ("day" ~ '^\\d{4}-\\d{2}-\\d{2}$')
  )`)
await client.query(`create unique index if not exists "TeacherJobDm_profileId_jobKey_mode_key" on "TeacherJobDm"("profileId", "jobKey", "mode")`)
await client.query(`create index if not exists "TeacherJobDm_profileId_day_idx" on "TeacherJobDm"("profileId", "day")`)
console.log('ok  TeacherJobDm')

await client.query(`
  create table if not exists "TeacherJobDmDay" (
    "profileId" uuid not null,
    "day" text not null,
    "kind" text not null,
    "conversationId" text not null,
    "sentAt" timestamp(3) not null default current_timestamp,
    constraint "TeacherJobDmDay_pkey" primary key ("profileId", "day", "kind"),
    constraint "TeacherJobDmDay_kind_check" check ("kind" in ('jobs', 'cover')),
    constraint "TeacherJobDmDay_day_check" check ("day" ~ '^\\d{4}-\\d{2}-\\d{2}$')
  )`)
console.log('ok  TeacherJobDmDay')

await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'TeacherJobDmConsent_profileId_fkey' and conrelid = '"TeacherJobDmConsent"'::regclass) then
      alter table "TeacherJobDmConsent" add constraint "TeacherJobDmConsent_profileId_fkey"
        foreign key ("profileId") references "Profile"("id") on delete cascade on update cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'TeacherJobDm_profileId_fkey' and conrelid = '"TeacherJobDm"'::regclass) then
      alter table "TeacherJobDm" add constraint "TeacherJobDm_profileId_fkey"
        foreign key ("profileId") references "Profile"("id") on delete cascade on update cascade;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'TeacherJobDmDay_profileId_fkey' and conrelid = '"TeacherJobDmDay"'::regclass) then
      alter table "TeacherJobDmDay" add constraint "TeacherJobDmDay_profileId_fkey"
        foreign key ("profileId") references "Profile"("id") on delete cascade on update cascade;
    end if;
  end $$`)
console.log('ok  foreign keys (Profile, on delete cascade)')

for (const t of TABLES) {
  await client.query(`alter table "${t}" enable row level security`)
  if (!(await client.query(`select relrowsecurity from pg_class where oid = $1::regclass`, [`public."${t}"`])).rows[0].relrowsecurity) {
    console.error(`RLS did not switch on for ${t} — stopping.`); process.exit(1)
  }
}
console.log('ok  RLS on (no policies)')

const problems = await shapeProblems()
if (problems.length) {
  console.error(`The tables exist in another shape — rolled back; fix them by hand, then re-run:\n  ${problems.join('\n  ')}`)
  await client.query('rollback')
  process.exit(1)
}
console.log('ok  every table has exactly its shape (scripts/teacher-job-dms-shape.sql): columns, constraints, indexes, RLS, no policy')

await client.query('commit')
await client.end()
console.log('done')
