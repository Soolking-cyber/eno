#!/usr/bin/env bash
# Prepare Connect Facebook (Settings › Privacy) on the VN box, BEFORE the deploy that carries it and after Meta knows the
# redirect URI (facebook-signin.md § Connect):
#   bash infra/vn-node/apply-facebook-connect.sh            (DRY_RUN=1 runs every check and changes nothing)
#
# What it does: (1) proves the guards and the two functions below in a rolled-back trial, then installs them in one transaction; (2) copies
# Facebook's app id and secret from GoTrue's env into eno.vn's env file. The app picks those up at its next `up`, so the
# row, /privacy and the help text all go live with that one deploy. GoTrue is not touched: no failed sign-ins.
# ⛔ eno.vn ONLY: eno.forum stopped serving the app on 2026-11-04 (its domain hosts Reach), and Meta knows no redirect for it.
#
# ⛔ GOTRUE'S MANUAL LINKING STAYS OFF (src/lib/auth/facebook-connect.ts says why). This script refuses to run if it is on.
set -euo pipefail
KEY="${ENO_SSH_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}"
HOST="${ENO_HOST:-root@162.4.176.233}"
PORT="${ENO_SSH_PORT:-24700}"
DRY="${DRY_RUN:-0}"

{ printf 'FB_DRY=%q\n' "$DRY"; cat <<'REMOTE'
umask 077
set -Eeuo pipefail
E=/opt/eno/supabase/.env
DBC=$(cd /opt/eno/supabase && docker compose ps -q db 2>/dev/null | head -1)
[ -n "$DBC" ] || { echo "  ⛔ the database container is not running. Stop."; exit 3; }
AUTHC=$(cd /opt/eno/supabase && docker compose ps -q auth 2>/dev/null | head -1)
[ -n "$AUTHC" ] || { echo "  ⛔ GoTrue's container is not running. Stop."; exit 3; }
psqlx() { docker exec -i "$DBC" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -tA "$@"; }
psqlq() { docker exec "$DBC" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -tA -c "$1" </dev/null; }

echo "=== PREFLIGHT (nothing is written unless every check passes) ==="
ML=$(docker exec "$AUTHC" printenv GOTRUE_SECURITY_MANUAL_LINKING_ENABLED 2>/dev/null </dev/null || true)
case "$ML" in ''|false|False|0) echo "  GoTrue manual linking: off ✅" ;; *) echo "  ⛔ GoTrue manual linking is ON: its link CSRF is what this flow exists to avoid. Stop."; exit 3 ;; esac
AID=$(grep -m1 '^GOTRUE_EXTERNAL_FACEBOOK_CLIENT_ID=' "$E" | cut -d= -f2- | tr -d "\"' \r" || true)
SEC=$(grep -m1 '^GOTRUE_EXTERNAL_FACEBOOK_SECRET=' "$E" | cut -d= -f2- | tr -d "\"' \r" || true)
case "$AID" in ''|*[!0-9]*) echo "  ⛔ no Facebook app id in GoTrue's env. Stop."; exit 3 ;; esac
[ "${#SEC}" -eq 32 ] || { echo "  ⛔ GoTrue's env holds no 32-character Facebook secret. Stop."; exit 3; }
echo "  Facebook app $AID and its secret are in GoTrue's env ✅"
ICOLS=$(psqlq "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and column_name in ('provider', 'user_id', 'identity_data', 'provider_id', 'email', 'last_sign_in_at', 'created_at', 'updated_at')")
[ "$ICOLS" = "created_at,email,identity_data,last_sign_in_at,provider,provider_id,updated_at,user_id" ] || { echo "  ⛔ auth.identities is not the shape these functions write (got: '$ICOLS'). Stop."; exit 3; }
GEN=$(psqlq "select is_generated from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and column_name = 'email'")
[ "$GEN" = ALWAYS ] || { echo "  ⛔ auth.identities.email is not generated from identity_data: removing the address would not clear it. Stop."; exit 3; }
echo "  auth.identities has the columns they write, and email is generated ✅"
[ "$(psqlq "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'auth' and table_name = 'sessions' and column_name in ('id', 'user_id')")" = "id,user_id" ] || { echo "  ⛔ auth.sessions is not the shape Disconnect deletes from. Stop."; exit 3; }
N=$(psqlq "select count(*) from information_schema.tables where table_schema = 'auth' and table_name = 'eno_facebook_refused_emails'")
[ "$N" = 1 ] || { echo "  ⛔ the operators' table is missing: run apply-facebook-signin.sh first. Stop."; exit 3; }
OPS1=$(psqlq "select email from auth.eno_facebook_refused_emails order by email limit 1")
[ -n "$OPS1" ] || { echo "  ⛔ the operators' table is empty: the guard would hold nobody. Stop."; exit 3; }
echo "  the operators' table holds addresses ✅"
# The role the app connects with is the only role allowed to call the functions.
role_of() { grep -m1 '^DATABASE_URL=' "$1" | cut -d= -f2- | tr -d "\"'" | sed -E 's#^[a-z]+://([^:@/]+).*#\1#' | cut -d. -f1; }
R_VN=$(role_of /opt/eno/secrets/eno-vn.env)
case "$R_VN" in supabase_auth_admin|anon|authenticated|service_role|'') echo "  ⛔ the app's role '$R_VN' must not be given this. Stop."; exit 3 ;; esac
[ "$(psqlq "select count(*) from pg_roles where rolname = '$R_VN'")" = 1 ] || { echo "  ⛔ role '$R_VN' does not exist here. Stop."; exit 3; }
# It calls the functions and reads which identities an account has. Nothing here grants that: it must already hold.
[ "$(psqlq "select has_schema_privilege('$R_VN', 'auth', 'USAGE') and has_table_privilege('$R_VN', 'auth.identities', 'SELECT') and has_table_privilege('$R_VN', 'auth.users', 'SELECT')")" = t ] || { echo "  ⛔ role '$R_VN' can't read auth.identities and auth.users. Stop."; exit 3; }
echo "  the app connects as '$R_VN', which can read auth.identities and auth.users ✅"
if [ "${FB_DRY:-0}" = "1" ]; then echo "=== DRY RUN: every check passed, nothing written ==="; exit 0; fi

# ⛔ THE PROOF RUNS FIRST, INSIDE THE TRANSACTION THAT INSTALLS, AND ROLLS BACK (commit gate, codex, 2026-11-04): a failed proof must
# leave production as it was, not with new triggers on every Facebook sign-in. Only a clean trial is then installed for real.
INSTALL_SQL=$(cat <<'SQL'
-- ENO-FB-GUARD-BEGIN (byte-identical in apply-facebook-signin.sh: a re-run of either must never restore an older guard; src/lib/apply-facebook-connect.test.ts)
CREATE OR REPLACE FUNCTION auth.eno_refuse_facebook_identity() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, auth AS $fn$
DECLARE em text; acct text;
BEGIN
  IF lower(coalesce(NEW.provider, '')) <> 'facebook' THEN RETURN NEW; END IF;
  SELECT lower(coalesce(u.email, '')) INTO acct FROM auth.users u WHERE u.id = NEW.user_id;
  -- Never ADDED to an account someone already uses by GoTrue's automatic linking by email: one that is confirmed or has
  -- ever been signed in to, with or without an identity row. A brand-new account is neither when its Facebook identity is
  -- written (v2.189: signupNewUser, then createNewIdentity, then Confirm). An email-code sign-up nobody finished is
  -- GoTrue's own case: it links that one and drops its unconfirmed identities itself.
  -- ⛔ THE ONE EXCEPTION IS auth.eno_connect_facebook, the person's own Connect (src/lib/auth/facebook-connect.ts). The
  -- setting alone is not enough: GoTrue's own connection never qualifies, whatever it set.
  IF NOT (coalesce(current_setting('eno.fb_link', true), '') = 'on' AND session_user <> 'supabase_auth_admin') THEN
    IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id
               AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'eno: Facebook is never linked into an existing account';
    END IF;
  END IF;
  -- Never an operator's address, on the account OR in Facebook's answer, with or without the exception above.
  em := lower(coalesce(NEW.identity_data->>'email', ''));
  IF EXISTS (SELECT 1 FROM auth.eno_facebook_refused_emails r WHERE r.email IN (em, coalesce(acct, ''))) THEN
    RAISE EXCEPTION 'eno: Facebook is never an operator''s way in';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS eno_refuse_facebook_identity ON auth.identities;
CREATE TRIGGER eno_refuse_facebook_identity BEFORE INSERT ON auth.identities
  FOR EACH ROW EXECUTE FUNCTION auth.eno_refuse_facebook_identity();
-- ⛔ A FACEBOOK IDENTITY KEEPS NO ADDRESS BUT THE ACCOUNT'S OWN (found 2026-11-04, reading GoTrue's models/linking.go).
-- DetermineAccountLinking links a new sign-in into whichever user holds an IDENTITY with that verified email, and it counts
-- Facebook's emails as verified. So a connected Facebook whose address differs from the account's would pull a stranger in:
-- the real owner of that address, signing in with Google or Apple for the first time, would land in THIS account. Stripped
-- on INSERT and on GoTrue's UPDATE at every Facebook sign-in; the generated identities.email is then NULL and matches nothing.
-- ⚠️ NAMED TO FIRE AFTER eno_refuse_… (same-event BEFORE triggers run in name order): that one reads the address first.
CREATE OR REPLACE FUNCTION auth.eno_strip_facebook_identity_email() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, auth AS $fn$
DECLARE acct text;
BEGIN
  IF lower(coalesce(NEW.provider, '')) <> 'facebook' OR NOT (NEW.identity_data ? 'email') THEN RETURN NEW; END IF;
  SELECT lower(coalesce(u.email, '')) INTO acct FROM auth.users u WHERE u.id = NEW.user_id;
  IF lower(coalesce(NEW.identity_data->>'email', '')) IS DISTINCT FROM coalesce(acct, '') THEN
    NEW.identity_data := NEW.identity_data - 'email' - 'email_verified';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS eno_strip_facebook_identity_email ON auth.identities;
CREATE TRIGGER eno_strip_facebook_identity_email BEFORE INSERT OR UPDATE ON auth.identities
  FOR EACH ROW EXECUTE FUNCTION auth.eno_strip_facebook_identity_email();
-- And when the ACCOUNT's address changes (commit gate, codex + opus, 2026-11-04): a Facebook whose address matched the old one
-- would otherwise keep it, and whoever owns that old address could be pulled in the same way. Re-reads through the strip above.
CREATE OR REPLACE FUNCTION auth.eno_recheck_facebook_identity_email() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, auth AS $fn$
BEGIN
  UPDATE auth.identities i SET identity_data = i.identity_data
    WHERE i.user_id = NEW.id AND lower(i.provider) = 'facebook' AND i.identity_data ? 'email';
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS eno_recheck_facebook_identity_email ON auth.users;
CREATE TRIGGER eno_recheck_facebook_identity_email AFTER UPDATE OF email ON auth.users
  FOR EACH ROW WHEN (lower(coalesce(OLD.email, '')) IS DISTINCT FROM lower(coalesce(NEW.email, '')))
  EXECUTE FUNCTION auth.eno_recheck_facebook_identity_email();
-- ENO-FB-GUARD-END
-- ⛔ WHICH FACEBOOK ROWS CONNECT MADE (commit gate, opus, 2026-11-04). Disconnect needs to know the account's mailbox was really proved: an
-- account MADE with Facebook was confirmed on Facebook's word. app_metadata.provider can't say: GoTrue rewrites it to the oldest identity at
-- every sign-in (models/user.go), so an old account with no identity row would read "made with Facebook" after one Facebook sign-in, and
-- its owner, phished, could no longer disconnect. A row here means the person typed a code from that mailbox.
CREATE TABLE IF NOT EXISTS auth.eno_facebook_connected (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  connected_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON auth.eno_facebook_connected FROM PUBLIC;
GRANT SELECT ON auth.eno_facebook_connected TO :"app_role";
-- The person's own Connect. Answers a word; never says whose account holds a Facebook identity.
CREATE OR REPLACE FUNCTION auth.eno_connect_facebook(p_user uuid, p_provider_id text, p_identity jsonb) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth AS $fn$
DECLARE acct text; fbem text;
BEGIN
  IF p_provider_id IS NULL OR p_provider_id !~ '^[0-9]{5,30}$' OR p_identity IS NULL OR p_identity->>'sub' IS DISTINCT FROM p_provider_id THEN RETURN 'bad_input'; END IF;
  SELECT lower(coalesce(u.email, '')) INTO acct FROM auth.users u WHERE u.id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN 'no_account'; END IF;
  IF acct = '' THEN RETURN 'no_email'; END IF;
  fbem := lower(coalesce(p_identity->>'email', ''));
  IF EXISTS (SELECT 1 FROM auth.eno_facebook_refused_emails r WHERE r.email IN (acct, fbem)) THEN RETURN 'operator'; END IF;
  IF EXISTS (SELECT 1 FROM auth.identities i WHERE i.provider = 'facebook' AND i.user_id = p_user) THEN
    IF EXISTS (SELECT 1 FROM auth.identities i WHERE i.provider = 'facebook' AND i.user_id = p_user AND i.provider_id = p_provider_id) THEN RETURN 'already'; END IF;
    RETURN 'other_facebook';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.identities i WHERE i.provider = 'facebook' AND i.provider_id = p_provider_id) THEN RETURN 'held_elsewhere'; END IF;
  BEGIN
    PERFORM set_config('eno.fb_link', 'on', true);
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES (p_provider_id, p_user, p_identity, 'facebook', now(), now(), now());
    PERFORM set_config('eno.fb_link', '', true);
    INSERT INTO auth.eno_facebook_connected (user_id) VALUES (p_user) ON CONFLICT (user_id) DO UPDATE SET connected_at = now();
  EXCEPTION WHEN unique_violation THEN
    RETURN 'held_elsewhere';
  END;
  UPDATE auth.users u SET updated_at = now(), raw_app_meta_data = jsonb_set(coalesce(u.raw_app_meta_data, '{}'::jsonb), '{providers}', (
    SELECT coalesce(jsonb_agg(DISTINCT s.p), '[]'::jsonb) FROM (
      SELECT i.provider AS p FROM auth.identities i WHERE i.user_id = u.id
      UNION
      SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(u.raw_app_meta_data->'providers') = 'array' THEN u.raw_app_meta_data->'providers' ELSE '[]'::jsonb END)
    ) s
  )) WHERE u.id = p_user;
  RETURN 'ok';
END
$fn$;
DROP FUNCTION IF EXISTS auth.eno_disconnect_facebook(uuid);
CREATE OR REPLACE FUNCTION auth.eno_disconnect_facebook(p_user uuid, p_keep_session uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, auth AS $fn$
BEGIN
  PERFORM 1 FROM auth.users u WHERE u.id = p_user FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = p_user AND lower(i.provider) = 'facebook') THEN RETURN 'not_connected'; END IF;
  -- Only a Facebook row Connect made: that mailbox was proved. An account MADE with Facebook keeps it (its mailbox may be dead).
  IF NOT EXISTS (SELECT 1 FROM auth.eno_facebook_connected c WHERE c.user_id = p_user) THEN RETURN 'only_way_in'; END IF;
  DELETE FROM auth.eno_facebook_connected c WHERE c.user_id = p_user;
  DELETE FROM auth.identities i WHERE i.user_id = p_user AND lower(i.provider) = 'facebook';
  -- A session opened through Facebook must not outlive the connection: every other session ends here, refresh tokens with them.
  DELETE FROM auth.sessions s WHERE s.user_id = p_user AND s.id IS DISTINCT FROM p_keep_session;
  -- What GoTrue merged in at a Facebook sign-in goes too, so Facebook's address doesn't stay in the session's metadata, but only
  -- if Facebook wrote it last: Google's or Apple's values aren't this function's. Names stay: they only ever seeded a profile.
  UPDATE auth.users u SET updated_at = now(),
    raw_user_meta_data = CASE WHEN u.raw_user_meta_data->>'iss' LIKE 'https://graph.facebook.com/%'
      THEN u.raw_user_meta_data - 'iss' - 'sub' - 'provider_id' - 'picture' - 'avatar_url' - 'email' - 'email_verified' - 'phone_verified'
      ELSE u.raw_user_meta_data END,
    raw_app_meta_data = jsonb_set(coalesce(u.raw_app_meta_data, '{}'::jsonb), '{providers}', (
    SELECT coalesce(jsonb_agg(DISTINCT s.p), '[]'::jsonb) FROM (
      SELECT i.provider AS p FROM auth.identities i WHERE i.user_id = u.id
      UNION
      SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(u.raw_app_meta_data->'providers') = 'array' THEN u.raw_app_meta_data->'providers' ELSE '[]'::jsonb END)
    ) s WHERE lower(s.p) <> 'facebook'
  )) WHERE u.id = p_user;
  RETURN 'ok';
END
$fn$;
REVOKE ALL ON FUNCTION auth.eno_connect_facebook(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth.eno_disconnect_facebook(uuid, uuid) FROM PUBLIC;
DO $g$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION auth.eno_connect_facebook(uuid, text, jsonb) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION auth.eno_disconnect_facebook(uuid, uuid) FROM %I', r);
    END IF;
  END LOOP;
END $g$;
GRANT EXECUTE ON FUNCTION auth.eno_connect_facebook(uuid, text, jsonb) TO :"app_role";
GRANT EXECUTE ON FUNCTION auth.eno_disconnect_facebook(uuid, uuid) TO :"app_role";
-- Existing Facebook rows whose address no longer matches their account (a changed email): the UPDATE fires the strip.
UPDATE auth.identities i SET identity_data = i.identity_data
  FROM auth.users u WHERE u.id = i.user_id AND lower(i.provider) = 'facebook' AND i.identity_data ? 'email'
  AND lower(i.identity_data->>'email') IS DISTINCT FROM lower(coalesce(u.email, ''));
SQL
)
PROOF_SQL=$(cat <<'SQL'
SELECT set_config('eno.guard_op', :'op', true);
SELECT set_config('eno.guard_role', :'app_role', true);
INSERT INTO auth.users (id, email, created_at, email_confirmed_at, last_sign_in_at, raw_app_meta_data) VALUES
  ('00000000-0000-4000-8000-00000000fc06', 'eno-conn-6@example.invalid', now() - interval '400 days', now() - interval '400 days', now(), '{"provider":"email"}'),
  ('00000000-0000-4000-8000-00000000fc01', 'eno-conn-1@example.invalid', now() - interval '30 days', now() - interval '30 days', now(), '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-4000-8000-00000000fc02', 'eno-conn-2@example.invalid', now() - interval '30 days', now() - interval '30 days', now(), '{"provider":"email","providers":["email"]}'),
  ('00000000-0000-4000-8000-00000000fc04', 'eno-conn-4@example.invalid', now() - interval '30 days', now() - interval '30 days', now(), '{"provider":"facebook","providers":["facebook"]}');
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) VALUES
  ('eno-conn-1', '00000000-0000-4000-8000-00000000fc01', '{"email":"eno-conn-1@example.invalid"}', 'email'),
  ('eno-conn-2', '00000000-0000-4000-8000-00000000fc02', '{"email":"eno-conn-2@example.invalid"}', 'email');
DO $d$ DECLARE r text; c text; e text; p jsonb; BEGIN
  -- As GoTrue's own login, with the setting forced on: its automatic link must stay refused.
  PERFORM set_config('eno.fb_link', 'on', true);
  EXECUTE 'SET LOCAL SESSION AUTHORIZATION supabase_auth_admin';
  BEGIN
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) VALUES ('991000001', '00000000-0000-4000-8000-00000000fc01', '{"sub":"991000001","email":"eno-conn-1@example.invalid"}', 'facebook');
    RAISE NOTICE 'GOTRUE_ALLOWED';
  EXCEPTION WHEN others THEN RAISE NOTICE 'GOTRUE_REFUSED';
  END;
  BEGIN
    SELECT auth.eno_connect_facebook('00000000-0000-4000-8000-00000000fc01', '991000001', '{"sub":"991000001"}') INTO r;
    RAISE NOTICE 'GOTRUE_CALL_ALLOWED';
  EXCEPTION WHEN others THEN RAISE NOTICE 'GOTRUE_CALL_REFUSED';
  END;
  EXECUTE 'RESET SESSION AUTHORIZATION';
  PERFORM set_config('eno.fb_link', '', true);
  -- Without the setting, even as this admin: refused.
  BEGIN
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) VALUES ('991000002', '00000000-0000-4000-8000-00000000fc01', '{"sub":"991000002"}', 'facebook');
    RAISE NOTICE 'PLAIN_ALLOWED';
  EXCEPTION WHEN others THEN RAISE NOTICE 'PLAIN_REFUSED';
  END;
  -- A person's Connect, as the app's own role, with a DIFFERENT Facebook address: linked, and the address gone.
  EXECUTE format('SET LOCAL ROLE %I', current_setting('eno.guard_role'));
  SELECT auth.eno_connect_facebook('00000000-0000-4000-8000-00000000fc01', '991000003', '{"sub":"991000003","email":"someone-else@example.invalid","email_verified":true}') INTO r;
  PERFORM EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id), u.email FROM auth.users u WHERE u.id = '00000000-0000-4000-8000-00000000fc01';
  RAISE NOTICE 'APPROLE_OK';
  EXECUTE 'RESET ROLE';
  SELECT i.email, i.identity_data INTO e, p FROM auth.identities i WHERE i.provider = 'facebook' AND i.provider_id = '991000003';
  SELECT u.raw_app_meta_data->>'providers' INTO c FROM auth.users u WHERE u.id = '00000000-0000-4000-8000-00000000fc01';
  RAISE NOTICE 'CONNECT=% EMAILCOL=% HASKEY=% PROVIDERS=%', r, coalesce(e, 'null'), (p ? 'email')::text, c;
  -- GoTrue's later update at a Facebook sign-in cannot put the address back.
  UPDATE auth.identities i SET identity_data = '{"sub":"991000003","email":"someone-else@example.invalid"}' WHERE i.provider = 'facebook' AND i.provider_id = '991000003';
  SELECT i.email INTO e FROM auth.identities i WHERE i.provider = 'facebook' AND i.provider_id = '991000003';
  RAISE NOTICE 'AFTERUPDATE=%', coalesce(e, 'null');
  -- The same Facebook on a second account; a second Facebook on the first; an operator; a matching address stays.
  SELECT auth.eno_connect_facebook('00000000-0000-4000-8000-00000000fc02', '991000003', '{"sub":"991000003"}') INTO r; RAISE NOTICE 'HELD=%', r;
  SELECT auth.eno_connect_facebook('00000000-0000-4000-8000-00000000fc01', '991000004', '{"sub":"991000004"}') INTO r; RAISE NOTICE 'OTHER=%', r;
  SELECT auth.eno_connect_facebook('00000000-0000-4000-8000-00000000fc01', '991000003', '{"sub":"991000003"}') INTO r; RAISE NOTICE 'AGAIN=%', r;
  SELECT auth.eno_connect_facebook('00000000-0000-4000-8000-00000000fc02', '991000005', jsonb_build_object('sub', '991000005', 'email', current_setting('eno.guard_op'))) INTO r; RAISE NOTICE 'OPERATOR=%', r;
  SELECT auth.eno_connect_facebook('00000000-0000-4000-8000-00000000fc02', '991000006', '{"sub":"991000006","email":"eno-conn-2@example.invalid"}') INTO r;
  SELECT i.email INTO e FROM auth.identities i WHERE i.provider = 'facebook' AND i.provider_id = '991000006';
  RAISE NOTICE 'MATCH=% KEEPS=%', r, coalesce(e, 'null');
  -- The account moves to another address: the old one, which matched, goes too.
  UPDATE auth.users u SET email = 'eno-conn-moved@example.invalid' WHERE u.id = '00000000-0000-4000-8000-00000000fc02';
  SELECT i.email INTO e FROM auth.identities i WHERE i.provider = 'facebook' AND i.provider_id = '991000006';
  RAISE NOTICE 'MOVED=%', coalesce(e, 'null');
  SELECT auth.eno_connect_facebook('00000000-0000-4000-8000-00000000fc02', 'not-digits', '{"sub":"not-digits"}') INTO r; RAISE NOTICE 'BAD=%', r;
  -- Disconnect: gone from identities and providers, other sessions ended, this one kept, Facebook's metadata gone.
  INSERT INTO auth.sessions (id, user_id) VALUES ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-00000000fc01'), ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-00000000fc01'), ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-00000000fc02');
  UPDATE auth.users u SET raw_user_meta_data = '{"iss":"https://graph.facebook.com/me?fields=x","email":"someone-else@example.invalid","full_name":"Kept"}' WHERE u.id = '00000000-0000-4000-8000-00000000fc01';
  SELECT auth.eno_disconnect_facebook('00000000-0000-4000-8000-00000000fc01', '00000000-0000-4000-8000-0000000000e1') INTO r;
  SELECT u.raw_app_meta_data->>'providers' INTO c FROM auth.users u WHERE u.id = '00000000-0000-4000-8000-00000000fc01';
  RAISE NOTICE 'DISCONNECT=% PROVIDERS2=%', r, c;
  RAISE NOTICE 'SESSIONS=% KEPT=% OTHERUSER=%', (SELECT count(*) FROM auth.sessions s WHERE s.user_id = '00000000-0000-4000-8000-00000000fc01'), (SELECT count(*) FROM auth.sessions s WHERE s.id = '00000000-0000-4000-8000-0000000000e1'), (SELECT count(*) FROM auth.sessions s WHERE s.id = '00000000-0000-4000-8000-0000000000e3');
  RAISE NOTICE 'META=%', (SELECT ((u.raw_user_meta_data ? 'email')::text || '/' || (u.raw_user_meta_data->>'full_name')) FROM auth.users u WHERE u.id = '00000000-0000-4000-8000-00000000fc01');
  SELECT auth.eno_disconnect_facebook('00000000-0000-4000-8000-00000000fc01', '00000000-0000-4000-8000-0000000000e1') INTO r; RAISE NOTICE 'NOTCONN=%', r;
  -- An old account with no identity row can disconnect, even after GoTrue rewrites its provider to facebook. One MADE with Facebook can't.
  SELECT auth.eno_connect_facebook('00000000-0000-4000-8000-00000000fc06', '991000009', '{"sub":"991000009"}') INTO r;
  UPDATE auth.users u SET raw_app_meta_data = u.raw_app_meta_data || '{"provider":"facebook"}' WHERE u.id = '00000000-0000-4000-8000-00000000fc06';
  SELECT auth.eno_disconnect_facebook('00000000-0000-4000-8000-00000000fc06', '00000000-0000-4000-8000-0000000000e1') INTO r; RAISE NOTICE 'NOROWS=%', r;
  PERFORM set_config('eno.fb_link', 'on', true);
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) VALUES ('991000007', '00000000-0000-4000-8000-00000000fc04', '{"sub":"991000007"}', 'facebook');
  PERFORM set_config('eno.fb_link', '', true);
  SELECT auth.eno_disconnect_facebook('00000000-0000-4000-8000-00000000fc04', '00000000-0000-4000-8000-0000000000e1') INTO r; RAISE NOTICE 'MADEWITHFB=%', r;
END $d$;
SQL
)
echo "=== TRIAL: install and prove inside a transaction that is rolled back ==="
PR=$(printf 'BEGIN;\n%s\n%s\nROLLBACK;\n' "$INSTALL_SQL" "$PROOF_SQL" | psqlx -v op="$OPS1" -v app_role="$R_VN" 2>&1 || true)
want() { case "$PR" in *"$1"*) ;; *) echo "  ⛔ proof failed: wanted '$1' in: ${PR:0:900}"; echo "  Nothing was changed. Fix, then re-run."; exit 1 ;; esac; }
want GOTRUE_REFUSED; want GOTRUE_CALL_REFUSED; want PLAIN_REFUSED
want 'CONNECT=ok EMAILCOL=null HASKEY=false'; want 'AFTERUPDATE=null'; want 'HELD=held_elsewhere'; want 'OTHER=other_facebook'; want 'AGAIN=already'
want 'APPROLE_OK'; want 'OPERATOR=operator'; want 'MATCH=ok KEEPS=eno-conn-2@example.invalid'; want 'MOVED=null'; want 'BAD=bad_input'; want 'DISCONNECT=ok'; want 'SESSIONS=1 KEPT=1 OTHERUSER=1'; want 'META=false/Kept'; want 'NOTCONN=not_connected'; want 'NOROWS=ok'; want 'MADEWITHFB=only_way_in'
case "$PR" in *PROVIDERS2*facebook*) echo "  ⛔ Disconnect left facebook in providers. Nothing was changed."; exit 1 ;; esac
echo "  GoTrue's own login: link refused, functions refused ✅ · Connect links and drops a different address ✅ · GoTrue's update can't restore it ✅"
echo "  one Facebook per account, one account per Facebook ✅ · operators refused ✅ · a matching address stays until the account moves ✅ · the app's role can do its part ✅ · Disconnect, its sessions and its metadata ✅"

echo "=== WRITE: guards and functions, one transaction ==="
printf 'BEGIN;\n%s\nCOMMIT;\n' "$INSTALL_SQL" | psqlx -v app_role="$R_VN" >/dev/null
echo "  installed ✅"

echo "=== WRITE: eno.vn's env (read at its next up) ==="
# In the environment, not the argv: `ps` shows an argv to everyone on the box.
cp -p /opt/eno/secrets/eno-vn.env "/opt/eno/secrets/eno-vn.env.bak-fbconnect-$(date +%Y%m%d%H%M%S)"
FB_AID="$AID" FB_SEC="$SEC" python3 - <<'PY'
import os, re
aid, sec = os.environ['FB_AID'], os.environ['FB_SEC']
p = '/opt/eno/secrets/eno-vn.env'
s = open(p).read()
for k, v in (('FACEBOOK_APP_ID', aid), ('FACEBOOK_APP_SECRET', sec)):
    s, n = re.subn(rf'^{k}=.*$', f'{k}={v}', s, flags=re.M)
    if not n:
        s = s.rstrip('\n') + f'\n{k}={v}\n'
t = p + '.tmp-fbconnect'
with open(t, 'w') as f:
    f.write(s)
os.chmod(t, os.stat(p).st_mode & 0o777)
os.replace(t, p)
print("  eno.vn's env file carries FACEBOOK_APP_ID and FACEBOOK_APP_SECRET ✅")
PY
echo "=== DONE. Now deploy: the row appears when the app next starts. ==="
REMOTE
} | ssh -i "$KEY" -p "$PORT" -o BatchMode=yes "$HOST" 'bash -s'
