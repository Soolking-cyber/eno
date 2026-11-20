-- The schools ask's ledger (owner, 2026-11-20 — src/lib/teachers/schools-ask.ts). One row per teacher, ever: the row is
-- written in the SAME transaction as the chat message, so a teacher is asked at most once; emailedAt is the email's claim.
-- Outside Prisma (raw SQL, like rum_daily): no Prisma migration, no SCHEMA_OK. Idempotent; run on the production database:
--   docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/teacher-schools-ask.sql
begin;
set local lock_timeout = '5s';
create table if not exists public."TeacherSchoolsAsk" (
  "profileId"      uuid        primary key references public."Profile"(id) on delete cascade,
  "conversationId" text        not null,
  "sentAt"         timestamptz not null default now(),
  "emailedAt"      timestamptz
);
create index if not exists "TeacherSchoolsAsk_emailedAt_idx" on public."TeacherSchoolsAsk" ("emailedAt");
alter table public."TeacherSchoolsAsk" enable row level security;
-- ⚠️ REVOKE FIRST — grants, not RLS, keep PostgREST out (scripts/rum-ddl.mjs).
revoke all on public."TeacherSchoolsAsk" from anon, authenticated, public;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'TeacherSchoolsAsk' and policyname = 'service_only') then
    create policy service_only on public."TeacherSchoolsAsk" for all to service_role using (true) with check (true);
  end if;
end $$;
-- Refuse to commit while an API role still holds any grant on it.
do $$ begin
  if exists (select 1 from pg_roles r where r.rolname in ('anon', 'authenticated')
               and (has_table_privilege(r.rolname, 'public."TeacherSchoolsAsk"', 'SELECT,INSERT,UPDATE,DELETE')
                    or has_any_column_privilege(r.rolname, 'public."TeacherSchoolsAsk"', 'SELECT,INSERT,UPDATE'))) then
    raise exception 'TeacherSchoolsAsk still grants an API role — rolled back';
  end if;
end $$;
commit;
