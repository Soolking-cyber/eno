// Teachers DDL (2026-09-30) — the parts Prisma cannot model. Idempotent; re-run any time.
//
//   set -a; . ./.env; set +a; node scripts/teachers-ddl.mjs
//
// Run AFTER the teacher tables exist (the safe flow in prisma/CLAUDE.md creates them from
// schema.prisma). Adds only a CHECK constraint on a new, local-matcher-written table and the
// PRIVATE storage bucket for CVs. Nothing existing is altered or dropped.
//
// ⛔ THE CHECK IS THE ONLY THING THAT MAKES `TeacherJobMatch` DEDUPE. Its two unique keys are
// (teacherProfileId, listingId) and (leadId, listingId); a row with BOTH ids null satisfies both
// (Postgres treats NULLs as distinct), so the matcher could re-email and re-list the same pair
// forever. Exactly one owner per row closes that (Opus plan review, 2026-09-30).
//
// ⛔ `teacher-cvs` IS PRIVATE. A CV carries the phone and email the whole feature withholds until
// the teacher taps "Share"; a public bucket would publish them at an unguessable-but-leakable URL.
// Served only by a 10-minute signed URL from /api/teachers/[id]/cv.

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

const exists = await client.query(`select to_regclass('public."TeacherJobMatch"') as t`)
if (!exists.rows[0].t) {
  console.error('TeacherJobMatch does not exist yet — create the teacher tables first (prisma/CLAUDE.md safe flow).')
  process.exit(1)
}

await client.query(`
  do $$ begin
    if not exists (select 1 from pg_constraint where conname = 'TeacherJobMatch_one_owner') then
      alter table "TeacherJobMatch" add constraint "TeacherJobMatch_one_owner"
        check (("teacherProfileId" is null) <> ("leadId" is null));
    end if;
  end $$`)
console.log('ok  TeacherJobMatch_one_owner')

// Storage lives in the `storage` schema only on Supabase; a scratch Postgres has none.
const hasStorage = await client.query(`select to_regclass('storage.buckets') as t`)
if (hasStorage.rows[0].t) {
  await client.query(
    `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
     values ('teacher-cvs', 'teacher-cvs', false, 10485760, array['application/pdf'])
     on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types`)
  const b = await client.query(`select public from storage.buckets where id = 'teacher-cvs'`)
  console.log(`ok  bucket teacher-cvs (public=${b.rows[0].public})`)
} else {
  console.log('skip bucket: no storage schema (scratch database)')
}

await client.end()
