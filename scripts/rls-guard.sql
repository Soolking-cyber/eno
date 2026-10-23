-- RLS guard for the public schema. Idempotent, restore-safe, safe to re-run.
--
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql
--
-- ⛔ WHY THIS FILE EXISTS: THE SAME LEAK, TWICE. Self-hosted Supabase serves every relation in
-- `public` through PostgREST at sb.eno.vn/rest/v1/, and its DEFAULT PRIVILEGES (measured: both
-- `postgres` and `supabase_admin` carry them) grant `anon` and `authenticated` ALL privileges on every
-- new table and view. Row-level security is therefore the only thing between a new table and anyone
-- holding the anon key — which ships in every browser bundle. That is not hypothetical:
--   · 2026-09-01: seller_payout (bank account numbers), Order, OrderEvent, CustodyWallet.
--   · 2026-09-23: whatsapp_inbound (waId = the user's phone number, joined to profileId — 26 rows),
--     ProfilePhoneBackup20260909 (email + phone), DeletedListing24hStore100 (206 deleted listings,
--     incl. soldToProfileId / saleBuyerHistory / verificationNotes), ListingTextBackup20260908
--     (19,469 listing-text snapshots). Confirmed from the attacker side with a count-only request:
--     PostgREST answered */26, */1, */206, */19469 to the public key.
-- Both times the cause was one missing line in a DDL script, and both times the tables were created
-- AFTER the previous sweep had declared the schema clean. A per-script checklist cannot stop the
-- third one; the database has to refuse to create an exposed relation in the first place.
--
-- ⚠️ SAFE FOR THE APP. Every server-side read and write goes through Prisma — or, for the visa
-- tables, a server-only supabase client in route.svc.ts files — as a role with BYPASSRLS, and
-- Postgres exempts such roles from row security entirely, FORCE included. NOTHING in the browser
-- reads a table directly (measured: every `.from('visa_*')` call is in a server route; those tables
-- have RLS on and ZERO policies). Only PostgREST callers are affected, which is the point. A FUTURE
-- relation that genuinely must be readable from the browser now needs an explicit policy / grant.
-- ⚠️ That failure is CLOSED, not loud: PostgREST answers `[]`, so a browser feature built on a new
-- table would look empty rather than error. Grant deliberately when you mean it.
--
-- ⚠️ THREE SEPARATE STEPS, EACH ITS OWN UNIT, BECAUSE A REVIEWER FOUND THE FIRST VERSION COULD UNDO
-- ITSELF. It asserted "nothing else is open" inside the same transaction as the fix, so ANY other open
-- table would have raised, rolled back the four closures, and left them exposed. Now: close (commit),
-- install the guard (commit), then REPORT — the report can fail the run loudly, but by then nothing it
-- could roll back is still pending.

-- ── Step 1: close the four relations found open on 2026-09-23 ─────────────────────────────────────
-- ⚠️ Existence-checked, because a fresh restore or a later DROP of the dated backups must not abort the
-- script before the guard in step 2 is installed.
BEGIN;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_inbound', 'ProfilePhoneBackup20260909', 'DeletedListing24hStore100', 'ListingTextBackup20260908']
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;
COMMIT;

-- ── Step 1b: the API roles never WRITE `public` (security review, 2026-10-22) ─────────────────────
-- RLS is the only thing between a write grant and the row, and a policy can be wrong: `profile_update_own`
-- let any signed-in user UPDATE every column of their own Profile through PostgREST — enforcement state,
-- trust tier, report strikes, email — because UPDATE was granted (the default privileges) and the policy
-- had no column limit. Nothing in the browser writes a table (see the header), so the API roles lose
-- INSERT/UPDATE/DELETE/TRUNCATE on every existing table here, and on every future one (step 2 and the
-- default privileges below). SELECT is untouched: RLS + step 3 already govern reads.
-- ⚠️ Role-checked like step 2, so CI or a bare restore without Supabase roles does not abort.
-- ⚠️ A non-owner REVOKE on a table another role owns only WARNS ("no privileges could be revoked") —
-- step 4 is what proves the end state, by name.
BEGIN;
DO $$
BEGIN
  IF to_regrole('anon') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
  END IF;
  IF to_regrole('authenticated') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;
  END IF;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC;
  IF to_regclass('public."Profile"') IS NOT NULL THEN
    DROP POLICY IF EXISTS profile_update_own ON public."Profile";
  END IF;
END $$;

-- Future objects created by the roles that create our tables and functions. Each role is tried on its
-- own, because ALTER DEFAULT PRIVILEGES FOR ROLE x needs membership in x: running as `postgres` (not a
-- superuser here) cannot alter `supabase_admin`'s defaults, and that must not abort the rest.
-- ⚠️ FUNCTIONS TOO: Postgres grants EXECUTE on every new function to PUBLIC, and PostgREST serves every
-- executable function in `public` as /rest/v1/rpc/<name>. The 18 SECURITY DEFINER functions in scripts/
-- each revoke it by hand today; this makes the safe state the default for the next one. A function the
-- browser must call (is_convo_participant) keeps its explicit GRANT.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    IF to_regrole(r) IS NULL THEN CONTINUE; END IF;
    BEGIN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM PUBLIC', r);
      -- ⚠️ GLOBAL, NOT `IN SCHEMA public`: EXECUTE-to-PUBLIC on functions is a built-in GLOBAL default, and
      -- Postgres cannot revoke a global default per schema (measured on a scratch PG16: the per-schema
      -- form left a new function executable by anon through PUBLIC). Functions this role creates in any
      -- schema now start with no PUBLIC grant; their owner (the app's role) still executes them.
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', r);
      IF to_regrole('anon') IS NOT NULL THEN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon', r);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon', r);
      END IF;
      IF to_regrole('authenticated') IS NOT NULL THEN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM authenticated', r);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated', r);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'rls-guard: cannot alter default privileges for role % from here (not a member) — step 2''s trigger still closes its new tables', r;
    END;
  END LOOP;
END $$;
COMMIT;

-- ── Step 2: every future relation in `public` is born closed ──────────────────────────────────────
-- Tables and partitioned tables get RLS ENABLED. Views, materialized views and foreign tables cannot
-- carry RLS at all, and a view runs with its OWNER's rights — a view owned by a BYPASSRLS role would hand anon
-- the rows of an RLS-protected table. So for those the guard revokes anon/authenticated instead.
--
-- ⚠️ ENABLE ONLY, NOT FORCE, for tables. ENABLE is what shuts out anon/authenticated. FORCE would also
-- subject a table's OWNER to row security, and an owner without BYPASSRLS would lock itself out of its
-- own new table. The four tables above are FORCEd to match the 2026-09-01 remediation.
-- ⚠️ CREATE OR REPLACE VIEW carries the CREATE VIEW tag, so replacing a view revokes again. A view
-- that deliberately grants anon must re-grant after every replace — deliberate, and loud when forgotten.
-- ⚠️ Role-existence is checked with to_regrole: on a non-Supabase target (CI, a bare restore) there is
-- no `anon` role, and a bare REVOKE ... FROM anon would abort the caller's CREATE VIEW.
--
-- ✅ MEASURED 2026-09-23 in a rolled-back transaction on production, before this was applied —
-- because the one external reviewer that answered at the time (agy) claimed the opposite on each:
--   · `postgres` (NOT superuser, BYPASSRLS) CAN create this event trigger here (supautils allows it);
--   · it fires for a top-level CREATE TABLE, for CREATE TABLE inside a DO block, and for
--     CREATE TABLE AS — the backup-snapshot pattern behind today's leak;
--   · a table named "eno probe A" (with a space) came out RLS-enabled: `%s` + object_identity quotes
--     correctly — object_identity is ALREADY a quoted, schema-qualified name, and `%I` would have
--     double-quoted it into a nonexistent relation;
--   · a TEMP table is left alone (not in `public`); after ROLLBACK nothing persisted.
-- ⚠️ No REVOKE EXECUTE on the function: PostgREST lists it as an rpc endpoint, but a function
-- returning `event_trigger` cannot be called directly, so exposure is nil.
BEGIN;

CREATE OR REPLACE FUNCTION public.eno_rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE schema_name = 'public'
      AND object_type IN ('table', 'partitioned table', 'view', 'materialized view', 'foreign table')
  LOOP
    IF cmd.object_type IN ('table', 'partitioned table') THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', cmd.object_identity);
      -- Step 1b's rule for new tables: the API roles may never write one, whatever policy is added
      -- later. SELECT stays governed by RLS, so a deliberate read policy still works.
      IF to_regrole('anon') IS NOT NULL THEN
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %s FROM anon', cmd.object_identity);
      END IF;
      IF to_regrole('authenticated') IS NOT NULL THEN
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %s FROM authenticated', cmd.object_identity);
      END IF;
    ELSE
      IF to_regrole('anon') IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON %s FROM anon', cmd.object_identity);
      END IF;
      IF to_regrole('authenticated') IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON %s FROM authenticated', cmd.object_identity);
      END IF;
      -- ⚠️ PUBLIC too: has_table_privilege('anon', …) counts grants to PUBLIC, so an explicit
      -- GRANT … TO PUBLIC would keep anon's access after the two revokes above. PUBLIC holds nothing
      -- on a new relation by default, so this is a no-op unless someone granted it on purpose.
      EXECUTE format('REVOKE ALL ON %s FROM PUBLIC', cmd.object_identity);
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS eno_rls_auto_enable;
CREATE EVENT TRIGGER eno_rls_auto_enable
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'CREATE VIEW', 'CREATE MATERIALIZED VIEW', 'CREATE FOREIGN TABLE')
  EXECUTE FUNCTION public.eno_rls_auto_enable();

-- Prove it before committing: a throwaway table must come out RLS-enabled, and a throwaway view
-- must not be readable by anon.
DO $$
DECLARE
  t_rls boolean;
  v_open boolean := false;
  t_writable boolean := false;
BEGIN
  CREATE TABLE public.eno_rls_guard_probe (id int);
  CREATE VIEW public.eno_rls_guard_probe_v AS SELECT 1 AS x;
  SELECT relrowsecurity INTO t_rls FROM pg_class WHERE oid = 'public.eno_rls_guard_probe'::regclass;
  IF to_regrole('anon') IS NOT NULL THEN
    v_open := has_table_privilege('anon', 'public.eno_rls_guard_probe_v', 'SELECT');
    t_writable := has_table_privilege('anon', 'public.eno_rls_guard_probe', 'INSERT,UPDATE,DELETE,TRUNCATE');
  END IF;
  IF to_regrole('authenticated') IS NOT NULL THEN
    t_writable := t_writable OR has_table_privilege('authenticated', 'public.eno_rls_guard_probe', 'INSERT,UPDATE,DELETE,TRUNCATE');
  END IF;
  DROP VIEW public.eno_rls_guard_probe_v;
  DROP TABLE public.eno_rls_guard_probe;
  IF NOT t_rls THEN RAISE EXCEPTION 'rls-guard: trigger did not enable RLS on a new table'; END IF;
  IF v_open THEN RAISE EXCEPTION 'rls-guard: trigger did not revoke anon from a new view'; END IF;
  IF t_writable THEN RAISE EXCEPTION 'rls-guard: trigger did not revoke API-role writes from a new table'; END IF;
END $$;

COMMIT;

-- ── Step 3: REPORT anything still exposed — names, not a count ────────────────────────────────────
-- Runs after both commits, so failing here undoes nothing. With ON_ERROR_STOP the run exits non-zero,
-- which is the point: an operator must see which relation is open.
-- ⚠️ The trigger cannot see a table MOVED into public (ALTER ... SET SCHEMA) or a later
-- DISABLE ROW LEVEL SECURITY; this report is what catches those, so re-run the file after DDL work.
-- ⚠️ PostgREST serves `public` and `graphql_public` (PGRST_DB_SCHEMAS, measured); graphql_public
-- holds no relations, and pg_graphql resolves through the same privileges and RLS as `public`.
DO $$
DECLARE open_list text;
BEGIN
  IF to_regrole('anon') IS NULL THEN
    RAISE NOTICE 'rls-guard: no anon role on this target — nothing is exposed through PostgREST';
    RETURN;
  END IF;
  SELECT string_agg(format('%s(%s)', c.relname, c.relkind), ', ' ORDER BY c.relname) INTO open_list
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND (
      (c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
        AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')))
      OR
      (c.relkind IN ('v', 'm', 'f')
        -- extension-owned objects (hypopg's views today) are not ours to police and expose no user
        -- data; matching them by pg_depend rather than by name keeps a future extension from
        -- wedging this report permanently.
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
        AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT')))
    );
  IF open_list IS NOT NULL THEN
    RAISE EXCEPTION 'rls-guard: still exposed to anon/authenticated: %', open_list;
  END IF;
  -- ⚠️ Scope, stated honestly: this proves no table is RLS-OFF and no view is anon-readable. It does
  -- NOT evaluate policies (step 4 checks the write side). Today's policies: Profile
  -- (own row, SELECT only) and auth_handoff (service_role only).
  RAISE NOTICE 'rls-guard: no RLS-off table and no anon-readable view in public (policies not evaluated)';
END $$;

-- ── Step 4: REPORT anything the API roles can WRITE or EXECUTE with elevated rights ────────────────
-- Added with step 1b (security review 2026-10-22). Step 3 proves reads are closed; it never looked at
-- writes, and a write policy is exactly what let a user rewrite their own Profile. Three checks, each
-- failing by NAME:
--   · a write grant (INSERT/UPDATE/DELETE/TRUNCATE) to anon or authenticated on any table in public;
--   · any non-SELECT policy that applies to PUBLIC, anon or authenticated (a policy with no TO clause
--     applies to PUBLIC, which is how profile_update_own was written);
--   · a SECURITY DEFINER function in public that anon or authenticated can EXECUTE — PostgREST serves it
--     as /rest/v1/rpc/<name>, running with its owner's rights. ALLOWED lists the deliberate ones.
-- ⚠️ ALLOWED is the whole exception list. is_convo_participant answers a yes/no for the CALLER only and
-- is what the Realtime channel policies call (scripts/messaging-realtime.mjs grants it on purpose).
DO $$
DECLARE
  writable text;
  write_policies text;
  definer_fns text;
  unpinned text;
  allowed text[] := ARRAY['is_convo_participant'];
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE NOTICE 'rls-guard: no Supabase API roles on this target — step 4 skipped';
    RETURN;
  END IF;

  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO writable
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND (has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'));

  SELECT string_agg(format('%s.%s(%s)', p.tablename, p.policyname, p.cmd), ', ' ORDER BY p.tablename, p.policyname)
    INTO write_policies
  FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.cmd <> 'SELECT'
    AND p.roles && ARRAY['public', 'anon', 'authenticated']::name[];

  SELECT string_agg(format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ' ORDER BY p.proname)
    INTO definer_fns
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND NOT (p.proname = ANY (allowed))
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  IF writable IS NOT NULL OR write_policies IS NOT NULL OR definer_fns IS NOT NULL THEN
    RAISE EXCEPTION 'rls-guard: API roles can still write or escalate — writable tables: [%]; write policies: [%]; SECURITY DEFINER functions they can execute: [%]',
      coalesce(writable, ''), coalesce(write_policies, ''), coalesce(definer_fns, '');
  END IF;
  -- Supabase lint 0011 (function_search_path_mutable) for the functions where it matters most: a SECURITY DEFINER
  -- function in public with no pinned search_path resolves unqualified names through its CALLER's path while running with
  -- its owner's rights. WARNING, the level the lint gives it: every definer function in scripts/ pins one today, so this
  -- names the next one that forgets (SET search_path = '' and schema-qualified names, per the lint's remediation).
  SELECT string_agg(format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ' ORDER BY p.proname)
    INTO unpinned
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS c(setting) WHERE c.setting LIKE 'search_path=%');
  IF unpinned IS NOT NULL THEN
    RAISE WARNING 'rls-guard: SECURITY DEFINER functions in public with no pinned search_path (Supabase lint 0011): [%]', unpinned;
  END IF;
  RAISE NOTICE 'rls-guard: anon/authenticated cannot write any table in public, hold no write policy, and can execute no SECURITY DEFINER function beyond %', allowed;
END $$;
