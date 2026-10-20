-- The exact shape of the four job-DM tables that scripts/teacher-job-dms-ddl.mjs creates: ONE ROW PER DIFFERENCE, none
-- when the database matches. ONE definition, run in both places that need it (codex + opus, gates 6c–6f): by the DDL
-- script (--check, and inside its transaction before COMMIT) and by infra/vn-node/job-dms/install.sh before it enables
-- anything on the box (docker exec -i supabase-db psql -U postgres -At -v ON_ERROR_STOP=1 < this file).
--   column      name, type, NOT NULL, default (as written here: lower case, casts and outer brackets dropped)
--   constraint  name and definition as PostgreSQL prints them (pg_get_constraintdef: PRIMARY KEY, CHECK, FOREIGN KEY)
--   index       name, unique or not, its columns in order, partial or not (not its method, operator classes or
--               predicate text: every index here is a plain btree the DDL script made — codex, gate 6g)
--   rls         on — and no policy at all (the app reads these tables through Prisma only)
-- ⛔ src/lib/teachers/job-dms/ddl.test.ts derives every column, index and rls row from the DDL script's text, and every
-- constraint NAME — change the two files together.
-- ⚠️ The constraint rows are PostgreSQL's own printing, taken from a scratch database the DDL script built (PostgreSQL
-- 14, 2026-10-20). A server that prints one differently is REPORTED, never passed: read the two lines it gives.
with want(tbl, kind, item) as (values
  ('ExternalJobPost', 'column', $$id text not null$$),
  ('ExternalJobPost', 'column', $$source text not null$$),
  ('ExternalJobPost', 'column', $$externalKey text not null$$),
  ('ExternalJobPost', 'column', $$sourceName text not null$$),
  ('ExternalJobPost', 'column', $$sourceRef text$$),
  ('ExternalJobPost', 'column', $$groupPublic boolean$$),
  ('ExternalJobPost', 'column', $$url text$$),
  ('ExternalJobPost', 'column', $$applyText text$$),
  ('ExternalJobPost', 'column', $$title text$$),
  ('ExternalJobPost', 'column', $$company text$$),
  ('ExternalJobPost', 'column', $$locationText text$$),
  ('ExternalJobPost', 'column', $$text text not null$$),
  ('ExternalJobPost', 'column', $$textSig text$$),
  ('ExternalJobPost', 'column', $$lang text$$),
  ('ExternalJobPost', 'column', $$postedAt timestamp(3) without time zone$$),
  ('ExternalJobPost', 'column', $$receivedAt timestamp(3) without time zone not null default current_timestamp$$),
  ('ExternalJobPost', 'column', $$status text not null default 'new'$$),
  ('ExternalJobPost', 'column', $$statusReason text$$),
  ('ExternalJobPost', 'column', $$facts jsonb$$),
  ('ExternalJobPost', 'column', $$factsVersion text$$),
  ('ExternalJobPost', 'column', $$expiresAt timestamp(3) without time zone$$),
  ('ExternalJobPost', 'column', $$updatedAt timestamp(3) without time zone not null default current_timestamp$$),
  ('ExternalJobPost', 'constraint', $$ExternalJobPost_pkey PRIMARY KEY (id)$$),
  ('ExternalJobPost', 'constraint', $$ExternalJobPost_source_check CHECK ((source = ANY (ARRAY['fb'::text, 'linkedin'::text, 'intake'::text])))$$),
  ('ExternalJobPost', 'constraint', $$ExternalJobPost_status_check CHECK ((status = ANY (ARRAY['new'::text, 'ready'::text, 'held'::text, 'dropped'::text, 'expired'::text])))$$),
  ('ExternalJobPost', 'constraint', $$ExternalJobPost_text_bounds CHECK (((char_length(text) >= 1) AND (char_length(text) <= 6000)))$$),
  ('ExternalJobPost', 'index', $$ExternalJobPost_pkey unique (id)$$),
  ('ExternalJobPost', 'index', $$ExternalJobPost_source_externalKey_key unique (source,externalKey)$$),
  ('ExternalJobPost', 'index', $$ExternalJobPost_status_receivedAt_idx (status,receivedAt)$$),
  ('ExternalJobPost', 'index', $$ExternalJobPost_expiresAt_idx (expiresAt)$$),
  ('ExternalJobPost', 'index', $$ExternalJobPost_textSig_idx (textSig)$$),
  ('ExternalJobPost', 'rls', $$on$$),
  ('TeacherJobDmConsent', 'column', $$profileId uuid not null$$),
  ('TeacherJobDmConsent', 'column', $$optIn boolean not null default false$$),
  ('TeacherJobDmConsent', 'column', $$optInAt timestamp(3) without time zone$$),
  ('TeacherJobDmConsent', 'column', $$noticeVersion text$$),
  ('TeacherJobDmConsent', 'column', $$withdrawnAt timestamp(3) without time zone$$),
  ('TeacherJobDmConsent', 'column', $$invitedAt timestamp(3) without time zone$$),
  ('TeacherJobDmConsent', 'column', $$pausedAt timestamp(3) without time zone$$),
  ('TeacherJobDmConsent', 'column', $$updatedAt timestamp(3) without time zone not null default current_timestamp$$),
  ('TeacherJobDmConsent', 'constraint', $$TeacherJobDmConsent_evidence CHECK (((NOT "optIn") OR (("optInAt" IS NOT NULL) AND ("noticeVersion" IS NOT NULL))))$$),
  ('TeacherJobDmConsent', 'constraint', $$TeacherJobDmConsent_pkey PRIMARY KEY ("profileId")$$),
  ('TeacherJobDmConsent', 'constraint', $$TeacherJobDmConsent_profileId_fkey FOREIGN KEY ("profileId") REFERENCES "Profile"(id) ON UPDATE CASCADE ON DELETE CASCADE$$),
  ('TeacherJobDmConsent', 'index', $$TeacherJobDmConsent_pkey unique (profileId)$$),
  ('TeacherJobDmConsent', 'rls', $$on$$),
  ('TeacherJobDm', 'column', $$id text not null$$),
  ('TeacherJobDm', 'column', $$profileId uuid not null$$),
  ('TeacherJobDm', 'column', $$jobKey text not null$$),
  ('TeacherJobDm', 'column', $$mode text not null$$),
  ('TeacherJobDm', 'column', $$kind text not null$$),
  ('TeacherJobDm', 'column', $$day text not null$$),
  ('TeacherJobDm', 'column', $$conversationId text$$),
  ('TeacherJobDm', 'column', $$score integer not null$$),
  ('TeacherJobDm', 'column', $$reasons jsonb not null default '[]'$$),
  ('TeacherJobDm', 'column', $$preview text$$),
  ('TeacherJobDm', 'column', $$createdAt timestamp(3) without time zone not null default current_timestamp$$),
  ('TeacherJobDm', 'constraint', $$TeacherJobDm_day_check CHECK ((day ~ '^\d{4}-\d{2}-\d{2}$'::text))$$),
  ('TeacherJobDm', 'constraint', $$TeacherJobDm_jobKey_check CHECK (("jobKey" ~ '^(post|listing):.+$'::text))$$),
  ('TeacherJobDm', 'constraint', $$TeacherJobDm_kind_check CHECK ((kind = ANY (ARRAY['jobs'::text, 'cover'::text])))$$),
  ('TeacherJobDm', 'constraint', $$TeacherJobDm_mode_check CHECK ((mode = ANY (ARRAY['live'::text, 'shadow'::text])))$$),
  ('TeacherJobDm', 'constraint', $$TeacherJobDm_pkey PRIMARY KEY (id)$$),
  ('TeacherJobDm', 'constraint', $$TeacherJobDm_profileId_fkey FOREIGN KEY ("profileId") REFERENCES "Profile"(id) ON UPDATE CASCADE ON DELETE CASCADE$$),
  ('TeacherJobDm', 'index', $$TeacherJobDm_pkey unique (id)$$),
  ('TeacherJobDm', 'index', $$TeacherJobDm_profileId_jobKey_mode_key unique (profileId,jobKey,mode)$$),
  ('TeacherJobDm', 'index', $$TeacherJobDm_profileId_day_idx (profileId,day)$$),
  ('TeacherJobDm', 'rls', $$on$$),
  ('TeacherJobDmDay', 'column', $$profileId uuid not null$$),
  ('TeacherJobDmDay', 'column', $$day text not null$$),
  ('TeacherJobDmDay', 'column', $$kind text not null$$),
  ('TeacherJobDmDay', 'column', $$conversationId text not null$$),
  ('TeacherJobDmDay', 'column', $$sentAt timestamp(3) without time zone not null default current_timestamp$$),
  ('TeacherJobDmDay', 'constraint', $$TeacherJobDmDay_day_check CHECK ((day ~ '^\d{4}-\d{2}-\d{2}$'::text))$$),
  ('TeacherJobDmDay', 'constraint', $$TeacherJobDmDay_kind_check CHECK ((kind = ANY (ARRAY['jobs'::text, 'cover'::text])))$$),
  ('TeacherJobDmDay', 'constraint', $$TeacherJobDmDay_pkey PRIMARY KEY ("profileId", day, kind)$$),
  ('TeacherJobDmDay', 'constraint', $$TeacherJobDmDay_profileId_fkey FOREIGN KEY ("profileId") REFERENCES "Profile"(id) ON UPDATE CASCADE ON DELETE CASCADE$$),
  ('TeacherJobDmDay', 'index', $$TeacherJobDmDay_pkey unique (profileId,day,kind)$$),
  ('TeacherJobDmDay', 'rls', $$on$$)
),
tbls as (select distinct tbl from want),
rel as (
  select c.oid, c.relname::text as tbl, c.relrowsecurity
  from pg_class c join tbls on tbls.tbl = c.relname::text
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
),
have(tbl, kind, item) as (
  select rel.tbl, 'column'::text, (a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
      || case when a.attnotnull then ' not null' else '' end
      || coalesce(' default ' || btrim(regexp_replace(regexp_replace(lower(pg_get_expr(d.adbin, d.adrelid)),
           '::[a-z]+(\(\d+\))?( with(out)? time zone)?', '', 'g'), '^\((.*)\)$', '\1')), ''))::text
  from rel
  join pg_attribute a on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select rel.tbl, 'constraint', (con.conname || ' ' || pg_get_constraintdef(con.oid))::text
  from rel join pg_constraint con on con.conrelid = rel.oid and con.contype in ('p', 'u', 'c', 'f', 'x')
  union all
  select rel.tbl, 'index', (ic.relname || case when i.indisunique then ' unique' else '' end || ' ('
      || array_to_string(array(
           select coalesce(a.attname::text, '(expression)')
           from unnest(i.indkey::int2[]) with ordinality k(n, o)
           left join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.n
           order by k.o), ',') || ')'
      || case when i.indpred is not null then ' partial' else '' end)::text
  from rel join pg_index i on i.indrelid = rel.oid join pg_class ic on ic.oid = i.indexrelid
  union all
  select rel.tbl, 'rls', case when rel.relrowsecurity then 'on' else 'off' end from rel
  union all
  select p.tablename::text, 'policy', p.policyname::text
  from pg_policies p join tbls on tbls.tbl = p.tablename::text
  where p.schemaname = 'public'
)
select problem from (
  select 'missing ' || tbl || ' ' || kind || ': ' || item as problem
  from (select tbl, kind, item from want except select tbl, kind, item from have) m
  union all
  select 'extra   ' || tbl || ' ' || kind || ': ' || item
  from (select tbl, kind, item from have except select tbl, kind, item from want) e
) p
order by problem;
