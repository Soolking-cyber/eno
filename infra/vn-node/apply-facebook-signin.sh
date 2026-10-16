#!/usr/bin/env bash
# Turn on "Continue with Facebook" (GoTrue's facebook provider) on the VN box — AFTER the code is deployed.
#   FACEBOOK_APP_ID='…' FACEBOOK_APP_SECRET="$(pbpaste)" bash infra/vn-node/apply-facebook-signin.sh
#   … add DRY_RUN=1 to run every check and change nothing.
#
# See facebook-signin.md for the Meta app this needs and for why each check exists. The buttons follow GoTrue: once
# /auth/v1/settings says facebook is on, every sign-in form offers it within ~10 minutes (the app's probe cache) — no app
# env, no redeploy. (The reviewed LinkedIn script's shape, removed with LinkedIn on 2026-10-16 — with its token trigger
# fixed: GoTrue reads auth.flow_state's token columns into Go strings, so the trigger writes '' — a NULL there would make
# every Facebook code exchange fail to scan.)
set -euo pipefail
# ⛔ THE CURRENT BOX AND ITS KEY (since 2026-09-20) — the retired box's Desktop .pem was the old scripts' default.
KEY="${ENO_SSH_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}"
HOST="${ENO_HOST:-root@162.4.176.233}"
PORT="${ENO_SSH_PORT:-24700}"
AID="${FACEBOOK_APP_ID:-}"
SEC="${FACEBOOK_APP_SECRET:-}"
DRY="${DRY_RUN:-0}"

trim() { printf '%s' "$1" | tr -d '[:space:]' | sed -e "s/^['\"]//" -e "s/['\"]$//"; }
AID="$(trim "$AID")"; SEC="$(trim "$SEC")"
# ⛔ REFUSE A PLACEHOLDER: an enabled provider with a junk secret fails every sign-in at Facebook's token endpoint.
[ -n "$AID" ] && [ -n "$SEC" ] || { echo "FACEBOOK_APP_ID and FACEBOOK_APP_SECRET are required (facebook-signin.md)"; exit 1; }
# A Meta App ID is all digits (15–16 today); the App Secret is 32 hex characters. The one confusion that happens: swapping
# them, or pasting the Client Token (also 32 hex, on Settings › Advanced) — say so, the shape cannot tell those apart.
case "$AID" in *[!0-9]*) echo "App ID must be digits only (App settings › Basic › App ID)"; exit 1 ;; esac
[ "${#AID}" -ge 10 ] && [ "${#AID}" -le 20 ] || { echo "App ID is ${#AID} digits — not a Meta App ID"; exit 1; }
case "$SEC" in *[!0-9a-f]*) echo "App Secret must be 32 lowercase hex characters (App settings › Basic › App secret › Show)"; exit 1 ;; esac
[ "${#SEC}" -eq 32 ] || { echo "App Secret is ${#SEC} characters — Meta's is 32"; exit 1; }
echo "  note: the App Secret is on App settings › Basic, NOT the Client Token on Advanced — both are 32 hex"

# ⛔ THE SECRET TRAVELS ON STDIN, ahead of the script — never in a command line, where `ps` shows it on either machine.
# printf is a shell builtin: no process of its own carries it either.
{ printf 'FB_AID=%q\nFB_SEC=%q\nFB_DRY=%q\n' "$AID" "$SEC" "$DRY"; cat <<'REMOTE'
umask 077
# ⛔ -E (errtrace): the ERR trap that rolls back must also fire for a failure INSIDE a function (set_kv's python) —
# without it bash runs no ERR trap there and `set -e` exits mid-write with no rollback (gate review, 2026-10-16).
set -Eeuo pipefail
E=/opt/eno/supabase/.env
OV=/opt/eno/supabase/docker-compose.override.yml
K=$(grep -m1 '^ANON_KEY=' "$E" | cut -d= -f2-)
settings() { curl -s --max-time 10 http://127.0.0.1:8000/auth/v1/settings -H "apikey: $K"; }
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }

echo "=== PREFLIGHT (nothing is written unless every check passes) ==="
S=$(settings)
# ⛔ ACCOUNT TAKEOVER GUARD. GoTrue links a provider identity to the existing user with the same email when that email
# counts as verified — Facebook's always do (GoTrue's facebook provider marks them Verified) — and with mailer_autoconfirm
# on it counts EVERY email as verified. Off, or this stops here.
AC=$(printf '%s' "$S" | field "['mailer_autoconfirm']")
[ "$AC" = "False" ] || { echo "  ⛔ mailer_autoconfirm=$AC — any provider email would link into any same-email account. Stop."; exit 3; }
echo "  mailer_autoconfirm: False ✅"
DS=$(printf '%s' "$S" | field "['disable_signup']")
[ "$DS" = "False" ] || { echo "  ⛔ disable_signup=$DS — every new account would fail with signup_disabled. Stop."; exit 3; }
echo "  disable_signup: False ✅"
AUTHC=$(cd /opt/eno/supabase && docker compose ps -q auth 2>/dev/null | head -1)
[ -n "$AUTHC" ] || { echo "  ⛔ cannot find the running GoTrue (auth) container"; exit 3; }
UV=$(docker exec "$AUTHC" printenv GOTRUE_MAILER_ALLOW_UNVERIFIED_EMAIL_SIGN_INS 2>/dev/null || true)
case "$UV" in ''|false|False|0) echo "  allow unverified email sign-ins: off ✅" ;; *) echo "  ⛔ GOTRUE_MAILER_ALLOW_UNVERIFIED_EMAIL_SIGN_INS=$UV — stop."; exit 3 ;; esac
# ⛔ EMAIL STAYS REQUIRED (plan v4 review): an account with neither email nor phone has no recovery and gets no messages.
# A Facebook account without an email gets "use your email instead" from /auth/callback (no_email).
EO=$(docker exec "$AUTHC" printenv GOTRUE_EXTERNAL_FACEBOOK_EMAIL_OPTIONAL 2>/dev/null || true)
case "$EO" in ''|false|False|0) echo "  facebook email optional: off ✅" ;; *) echo "  ⛔ GOTRUE_EXTERNAL_FACEBOOK_EMAIL_OPTIONAL=$EO — stop."; exit 3 ;; esac
# ⛔ THE CODE FIRST. Enabling the provider before the deploy would let a Facebook sign-in reach a callback that cannot
# strip Facebook's token, and a profile that would take Facebook's expiring picture link — refused until it can.
P=$(curl -sk --max-time 20 --resolve eno.vn:443:127.0.0.1 'https://eno.vn/api/auth/providers' || true)
case "$P" in *'"facebook":'*) echo "  deployed app has /api/auth/providers ✅" ;; *) echo "  ⛔ /api/auth/providers is not deployed (got: ${P:0:80}) — deploy first."; exit 3 ;; esac
# ⛔ …AND THE NOTICE: Facebook becomes a source of personal data the moment it is on, so the deployed /privacy must already
# name it (gate review, 2026-10-16) — on both editions, which share this GoTrue.
# (www.eno.forum: the forum's canonical host — its apex only redirects there.)
for H in eno.vn www.eno.forum; do
  PV=$(curl -sk --max-time 20 --resolve "$H:443:127.0.0.1" "https://$H/privacy" -H 'Cookie: lang=en' || true)
  case "$PV" in *'Meta (Continue with Facebook)'*) echo "  $H/privacy names Facebook sign-in ✅" ;; *) echo "  ⛔ $H/privacy does not name Facebook sign-in yet — deploy the /privacy update first."; exit 3 ;; esac
done
# Facebook reachable FROM THE BOX: GoTrue trades the code and reads /me on graph.facebook.com.
GC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://graph.facebook.com/ || true)
case "$GC" in 000) echo "  ⛔ graph.facebook.com unreachable from the box — GoTrue would fail every sign-in."; exit 3 ;; *) echo "  graph.facebook.com reachable (HTTP $GC) ✅" ;; esac
# ⛔ THE TOKEN GUARD NEEDS GoTrue's flow table AS v2.189 HAS IT. GoTrue writes Facebook's access token onto the
# auth.flow_state row at its callback and hands it back at the code exchange; only a COMPLETED exchange deletes the row —
# an abandoned sign-in would leave it in this database and its backups. A trigger (below) stops it being written.
DBC=$(cd /opt/eno/supabase && docker compose ps -q db 2>/dev/null | head -1)
[ -n "$DBC" ] || { echo "  ⛔ cannot find the running Postgres (db) container"; exit 3; }
# ⛔ TWO HELPERS, BECAUSE THIS SCRIPT IS ITSELF STDIN (gate review, 2026-10-16): the box runs it as `bash -s`, reading it
# from the ssh pipe — a child that inherits stdin can swallow the rest of the script. `psqlx` (docker exec -i) is ONLY for
# a heredoc, which replaces its stdin; `psqlq` runs one query with no stdin at all.
psqlx() { docker exec -i "$DBC" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -tA "$@"; }
psqlq() { docker exec "$DBC" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -tA -c "$1" </dev/null; }
COLS=$(psqlq "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'auth' and table_name = 'flow_state' and column_name in ('provider_type', 'provider_access_token', 'provider_refresh_token')")
[ "$COLS" = "provider_access_token,provider_refresh_token,provider_type" ] || { echo "  ⛔ auth.flow_state lacks the columns the token guard needs (got: '$COLS') — stop."; exit 3; }
echo "  auth.flow_state has the token columns the guard clears ✅"
# ⛔ THE LINK GUARD NEEDS auth.identities AS v2.189 HAS IT (gate review, 2026-10-16). GoTrue links a Facebook identity
# into the existing account with the same email and counts Facebook's emails as verified — whether Facebook ever returns an
# unconfirmed address is not documented — so a guard in /auth/callback alone was refuted: anyone can run GoTrue's flow and
# trade the code themselves. The boundary is the database: a Facebook identity is never ADDED to an account that already
# has another way in, and never created for an operator's address (ADMIN_EMAILS, both editions).
ICOLS=$(psqlq "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and column_name in ('provider', 'user_id', 'identity_data', 'provider_id')")
[ "$ICOLS" = "identity_data,provider,provider_id,user_id" ] || { echo "  ⛔ auth.identities lacks the columns the link guard reads (got: '$ICOLS') — stop."; exit 3; }
echo "  auth.identities has the columns the link guard reads ✅"
# ⛔ BOTH EDITIONS MUST ANSWER (gate review, 2026-10-16): one container down would silently leave its operators out of the guard.
OPS_VN=$(docker exec eno-vn-app printenv ADMIN_EMAILS 2>/dev/null </dev/null || true)
OPS_FORUM=$(docker exec eno-forum-app printenv ADMIN_EMAILS 2>/dev/null </dev/null || true)
[ -n "$OPS_VN" ] && [ -n "$OPS_FORUM" ] || { echo "  ⛔ ADMIN_EMAILS not readable from both eno-vn-app and eno-forum-app — the operator guard would miss someone. Stop."; exit 3; }
OPS=$(printf '%s\n%s\n' "$OPS_VN" "$OPS_FORUM" | tr ',' '\n' | tr -d ' \r' | tr 'A-Z' 'a-z' | grep -E '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]+$' | sort -u | paste -sd, - || true)
[ -n "$OPS" ] || { echo "  ⛔ ADMIN_EMAILS held no address — the operator guard would hold nobody. Stop."; exit 3; }
echo "  operators the guard keeps Facebook away from: $(printf '%s' "$OPS" | tr ',' '\n' | wc -l | tr -d ' ') address(es) ✅"
MISSING=0
for T in eno_drop_facebook_provider_tokens:flow_state eno_refuse_facebook_identity:identities; do
  N=$(psqlq "select count(*) from pg_trigger where tgname = '${T%%:*}' and tgrelid = 'auth.${T##*:}'::regclass and tgenabled <> 'D'" 2>/dev/null || echo 0)
  [ "$N" = 1 ] || MISSING=1
  echo "  trigger ${T%%:*} on auth.${T##*:}: $([ "$N" = 1 ] && echo present || echo 'missing')"
done
# ⛔ FACEBOOK ON WITHOUT ITS GUARDS IS THE ONE STATE THIS MUST NEVER CALL FINE (gate review, 2026-10-16) — e.g. after a
# Supabase upgrade rebuilt an auth table. A dry run then fails; a real run reinstalls them.
FBON=$(printf '%s' "$S" | field "['external'].get('facebook')" || true)
if [ "$FBON" = "True" ] && [ "$MISSING" = 1 ]; then
  echo "  ⛔ Facebook sign-in is ON but a guard is missing — run this script without DRY_RUN to reinstall them (or switch Facebook off)."
  [ "${FB_DRY:-0}" = "1" ] && exit 3
fi

if [ "${FB_DRY:-0}" = "1" ]; then echo "=== DRY RUN: every check passed, nothing written ==="; exit 0; fi

echo "=== WRITE ==="
# ⛔ BOTH GUARDS FIRST, IN ONE TRANSACTION, before anything that can turn Facebook on: a run that stops half-way never
# leaves a config that a later restart turns on without them — nor one guard without the other (gate review,
# 2026-10-16: a dropped connection between two transactions could). Harmless on their own (they touch Facebook rows only).
# The operators' list is refreshed on every run — re-run after ADMIN_EMAILS changes.
# ⛔ '' NOT NULL: GoTrue scans the token columns into Go strings (models/flow_state.go) — a NULL fails the scan, and with
# it the exchange.
psqlx -v ops="$OPS" <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION auth.eno_drop_facebook_provider_tokens() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF lower(coalesce(NEW.provider_type, '')) = 'facebook' THEN
    NEW.provider_access_token := '';
    NEW.provider_refresh_token := '';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS eno_drop_facebook_provider_tokens ON auth.flow_state;
CREATE TRIGGER eno_drop_facebook_provider_tokens BEFORE INSERT OR UPDATE ON auth.flow_state
  FOR EACH ROW EXECUTE FUNCTION auth.eno_drop_facebook_provider_tokens();
UPDATE auth.flow_state SET provider_access_token = '', provider_refresh_token = ''
  WHERE lower(coalesce(provider_type, '')) = 'facebook' AND (coalesce(provider_access_token, '') <> '' OR coalesce(provider_refresh_token, '') <> '');
CREATE TABLE IF NOT EXISTS auth.eno_facebook_refused_emails (email text PRIMARY KEY);
DELETE FROM auth.eno_facebook_refused_emails;
INSERT INTO auth.eno_facebook_refused_emails (email)
  SELECT DISTINCT lower(trim(e)) FROM unnest(string_to_array(:'ops', ',')) AS e WHERE trim(e) <> '';
-- ⛔ SECURITY DEFINER (gate review, 2026-10-16): GoTrue inserts identities as ITS database role, which has no grant on the
-- operators' table this script owns — invoker's rights would make every Facebook sign-up fail with "permission denied".
-- A fixed search_path, so the definer's rights reach nothing but what is named here.
CREATE OR REPLACE FUNCTION auth.eno_refuse_facebook_identity() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, auth AS $fn$
DECLARE em text;
BEGIN
  IF lower(coalesce(NEW.provider, '')) <> 'facebook' THEN RETURN NEW; END IF;
  -- Never ADDED to an account someone already uses (GoTrue's automatic linking by email): one that is confirmed or has
  -- ever been signed in to — with or without an identity row (an old or an admin-made one included). A brand-new account
  -- is neither when its Facebook identity is written (v2.189: signupNewUser, then createNewIdentity, then Confirm —
  -- external.go). ⚠️ A GoTrue that ever confirmed FIRST would make this refuse every new Facebook sign-up — closed, and
  -- seen at once (facebook-signin.md: re-test a new sign-up after a Supabase upgrade); no time window that could let a
  -- link through instead (gate review, 2026-10-16). An email-code sign-up nobody finished is GoTrue's own case: it links
  -- that one and drops its unconfirmed identities itself (RemoveUnconfirmedIdentities — its pre-account-takeover rule).
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id
             AND (u.email_confirmed_at IS NOT NULL OR u.phone_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'eno: Facebook is never linked into an existing account';
  END IF;
  -- Never an operator's address, even as a new account.
  em := lower(coalesce(NULLIF(NEW.identity_data->>'email', ''), (SELECT u.email FROM auth.users u WHERE u.id = NEW.user_id), ''));
  IF em <> '' AND EXISTS (SELECT 1 FROM auth.eno_facebook_refused_emails r WHERE r.email = em) THEN
    RAISE EXCEPTION 'eno: Facebook is never an operator''s way in';
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS eno_refuse_facebook_identity ON auth.identities;
CREATE TRIGGER eno_refuse_facebook_identity BEFORE INSERT ON auth.identities
  FOR EACH ROW EXECUTE FUNCTION auth.eno_refuse_facebook_identity();
COMMIT;
SQL
echo "  auth.flow_state + auth.identities: Facebook's token never written, never linked into an account in use, never an operator's (both triggers, one transaction)"

STAMP=$(date +%Y%m%d%H%M%S)
cp "$E" "$E.bak-facebook-$STAMP"
cp "$OV" "$OV.bak-facebook-$STAMP"
chmod 600 "$E.bak-facebook-$STAMP" "$OV.bak-facebook-$STAMP"
# The .env backups hold the App Secret: only the last three runs' are kept (gate review, 2026-10-16).
ls -1t "$E".bak-facebook-* 2>/dev/null | tail -n +4 | while read -r OLD; do rm -f "$OLD"; done
ls -1t "$OV".bak-facebook-* 2>/dev/null | tail -n +4 | while read -r OLD; do rm -f "$OLD"; done
# Anything failing from here puts both files back and recreates auth as it was — never a half-applied box.
rollback() {
  echo "  ↩ rolling back: restoring .env and the compose override from *.bak-facebook-$STAMP"
  cp "$E.bak-facebook-$STAMP" "$E"; cp "$OV.bak-facebook-$STAMP" "$OV"
  # ⛔ …AND FACEBOOK LEFT OFF, whatever it was before (gate review, 2026-10-16): this run already replaced the database
  # guards, so a failed run must not hand back "on" beside a guard that just failed its proof. Fail closed; re-run to fix.
  if grep -q '^GOTRUE_EXTERNAL_FACEBOOK_ENABLED=' "$E"; then
    sed -i 's/^GOTRUE_EXTERNAL_FACEBOOK_ENABLED=.*/GOTRUE_EXTERNAL_FACEBOOK_ENABLED=false/' "$E"
    echo "  ↩ Facebook sign-in left OFF until a run passes"
  fi
  (cd /opt/eno/supabase && docker compose up -d auth </dev/null >/dev/null 2>&1) || echo "  ⛔ auth did not come back — run: cd /opt/eno/supabase && docker compose up -d auth"
}
trap 'rollback' ERR
# …and an interrupt, a dropped connection or a kill rolls back too — never a half-written config a later restart applies.
trap 'rollback; exit 1' INT TERM HUP PIPE
# The value goes to python through the environment — never an argument (sed's command line shows a secret in `ps`).
set_kv() {
  KV_KEY="$1" KV_VALUE="$2" python3 - "$E" <<'PYKV'
import os, sys
p, k, v = sys.argv[1], os.environ['KV_KEY'], os.environ['KV_VALUE']
lines = open(p).read().split('\n')
hit = False
for i, l in enumerate(lines):
    if l.startswith(k + '='):
        lines[i] = f'{k}={v}'; hit = True
if not hit:
    if lines and lines[-1] == '': lines.insert(len(lines) - 1, f'{k}={v}')
    else: lines.append(f'{k}={v}')
open(p, 'w').write('\n'.join(lines))
PYKV
}
set_kv GOTRUE_EXTERNAL_FACEBOOK_ENABLED true
set_kv GOTRUE_EXTERNAL_FACEBOOK_CLIENT_ID "$FB_AID"
set_kv GOTRUE_EXTERNAL_FACEBOOK_SECRET "$FB_SEC"
# The SUPABASE callback (the envoy gateway routes /auth/v1/*), registered in the Meta app as a Valid OAuth Redirect URI.
set_kv GOTRUE_EXTERNAL_FACEBOOK_REDIRECT_URI https://sb.eno.vn/auth/v1/callback
echo "  gotrue .env updated"

# ⛔ .env ALONE DOES NOTHING (google-signin.md): Supabase's compose names every GOTRUE_* explicitly, so the keys must be
# passed through the ONE services.auth.environment mapping of the override. A line-level merge: every existing byte kept;
# anything ambiguous is refused, never guessed.
python3 - "$OV" <<'PYEOF'
import re, sys
p = sys.argv[1]
KEYS = ['GOTRUE_EXTERNAL_FACEBOOK_ENABLED', 'GOTRUE_EXTERNAL_FACEBOOK_CLIENT_ID', 'GOTRUE_EXTERNAL_FACEBOOK_SECRET',
        'GOTRUE_EXTERNAL_FACEBOOK_REDIRECT_URI']
def die(m): print('  ⛔ override: ' + m); sys.exit(4)
text = open(p).read()
if '\r' in text or '\t' in text: die('CRLF or tabs — edit by hand')
lines = text.rstrip('\n').split('\n')
ind = lambda l: len(l) - len(l.lstrip(' '))
sig = lambda l: l.strip() and not l.strip().startswith('#')
svc = [i for i, l in enumerate(lines) if re.match(r'^services\s*:\s*(#.*)?$', l)]
if len(svc) != 1: die(f'expected one top-level services:, found {len(svc)}')
end_of = lambda start, base: next((j for j in range(start + 1, len(lines)) if sig(lines[j]) and ind(lines[j]) <= base), len(lines))
s_end = end_of(svc[0], 0)
auth = [i for i in range(svc[0] + 1, s_end) if re.match(r'^ {1,8}auth\s*:\s*(#.*)?$', lines[i])]
if len(auth) != 1: die(f'expected one services.auth, found {len(auth)} — merge by hand')
a0 = auth[0]; ai = ind(lines[a0]); a_end = end_of(a0, ai)
env = [i for i in range(a0 + 1, a_end) if re.match(r'^ +environment\s*:\s*(#.*)?$', lines[i]) and ind(lines[i]) > ai]
if len(env) != 1: die(f'expected one services.auth.environment block mapping, found {len(env)}')
e0 = env[0]; ei = ind(lines[e0]); e_end = end_of(e0, ei)
body = [i for i in range(e0 + 1, e_end) if sig(lines[i])]
if not body: die('services.auth.environment is empty')
ki = ind(lines[body[0]])
if any(lines[i].lstrip().startswith('-') for i in body): die('services.auth.environment is a list, expected KEY: value')
present = {re.match(r'^ *([A-Z0-9_]+)\s*:', lines[i]).group(1) for i in body if re.match(r'^ *([A-Z0-9_]+)\s*:', lines[i])}
# A Facebook key already there must be the .env passthrough — a pinned value would survive every rotation.
for i in body:
    m = re.match(r'^ *(GOTRUE_EXTERNAL_FACEBOOK_[A-Z_]+)\s*:\s*(.*)$', lines[i])
    if m and m.group(2).strip().strip('"\'') != '${' + m.group(1) + '}':
        die(f'{m.group(1)} is pinned to a value in the override — make it ${{{m.group(1)}}} by hand')
add = [f"{' ' * ki}{k}: ${{{k}}}" for k in KEYS if k not in present]
if not add: print('  compose override: already wired'); sys.exit(0)
out = lines[:body[-1] + 1] + [' ' * ki + '# Continue with Facebook: passthroughs from .env (infra/vn-node/apply-facebook-signin.sh)'] + add + lines[body[-1] + 1:]
open(p, 'w').write('\n'.join(out) + '\n')
print(f'  compose override: {len(add)} Facebook vars wired into services.auth.environment')
PYEOF

cd /opt/eno/supabase && docker compose up -d auth </dev/null >/dev/null 2>&1
echo "=== VERIFY ==="
FOK=no
for i in $(seq 1 15); do
  # `|| true`: while auth restarts the gateway answers 502 with no JSON — that is a retry, never errexit's rollback.
  v=$(settings | field "['external'].get('facebook')" || true)
  [ "$v" = "True" ] && { FOK=yes; break; }
  sleep 4
done
[ "$FOK" = yes ] || { echo "  ⛔ GoTrue does not report facebook — see 'cd /opt/eno/supabase && docker compose logs auth'"; rollback; exit 1; }
echo "  gotrue external.facebook: True ✅"
TG=$(psqlq "select count(*) from pg_trigger where tgname = 'eno_drop_facebook_provider_tokens' and tgrelid = 'auth.flow_state'::regclass and tgenabled <> 'D'")
[ "$TG" = "1" ] || { echo "  ⛔ the Facebook token guard trigger is missing or disabled"; rollback; exit 1; }
echo "  token guard trigger on auth.flow_state ✅"
# …and it WORKS: a Facebook row written inside a transaction that is rolled back must come out with its tokens blank —
# and blank, not NULL (GoTrue's scan). ⛔ FAILS CLOSED: a check that cannot run (another GoTrue schema) is not a pass.
GUARD=$(psqlx <<'SQL' 2>&1 || true
BEGIN;
INSERT INTO auth.flow_state (id, auth_code, code_challenge_method, code_challenge, provider_type, provider_access_token, provider_refresh_token, authentication_method)
  VALUES (gen_random_uuid(), 'eno-guard-check', 's256', 'eno-guard-check', 'facebook', 'secret', 'secret', 'oauth')
  RETURNING CASE WHEN provider_access_token = '' AND provider_refresh_token = '' THEN 'GUARD_BLANKS' ELSE 'GUARD_KEEPS' END;
ROLLBACK;
SQL
)
case "$GUARD" in
  *GUARD_BLANKS*) echo "  token guard blanks a Facebook token ✅" ;;
  *GUARD_KEEPS*) echo "  ⛔ the token guard did NOT blank a Facebook token"; rollback; exit 1 ;;
  *) echo "  ⛔ could not exercise the token guard (${GUARD:0:160}) — adjust the check's INSERT to this GoTrue's auth.flow_state, then re-run"; rollback; exit 1 ;;
esac
# …and the link guard WORKS: inside a transaction that is rolled back, a Facebook identity for an account that already has
# an email identity, and one for an operator's address, must both be refused — and a plain new one accepted.
LG=$(psqlx -v op="${OPS%%,*}" <<'SQL' 2>&1 || true
BEGIN;
-- The operator's address rides a setting: psql does not interpolate inside the dollar-quoted blocks below.
SELECT set_config('eno.guard_op', :'op', true);
-- As GoTrue's own database role, where it exists: the guard must work for the role that really inserts identities.
DO $r$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN EXECUTE 'SET LOCAL ROLE supabase_auth_admin'; RAISE NOTICE 'AS_GOTRUE_ROLE'; END IF;
END $r$;
-- Placeholder accounts (never an operator's address in auth.users — that one is unique and may exist for real).
-- fb01 an account in use (confirmed, with its email identity) · fb02 brand new · fb03 brand new, an operator's address in
-- Facebook's answer · fb04 an old confirmed account with no identity row · fb05 an email-code sign-up nobody finished.
INSERT INTO auth.users (id, email, created_at, email_confirmed_at, last_sign_in_at) VALUES
  ('00000000-0000-4000-8000-00000000fb01', 'eno-guard-1@example.invalid', now() - interval '30 days', now() - interval '30 days', now() - interval '1 day'),
  ('00000000-0000-4000-8000-00000000fb02', 'eno-guard-2@example.invalid', now(), NULL, NULL),
  ('00000000-0000-4000-8000-00000000fb03', 'eno-guard-3@example.invalid', now(), NULL, NULL),
  ('00000000-0000-4000-8000-00000000fb04', 'eno-guard-4@example.invalid', now() - interval '400 days', now() - interval '400 days', NULL),
  ('00000000-0000-4000-8000-00000000fb05', 'eno-guard-5@example.invalid', now() - interval '2 hours', NULL, NULL),
  ('00000000-0000-4000-8000-00000000fb06', 'eno-guard-6@example.invalid', now(), now(), NULL);
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) VALUES
  ('eno-guard-1', '00000000-0000-4000-8000-00000000fb01', '{"email":"eno-guard-1@example.invalid"}', 'email'),
  ('eno-guard-5', '00000000-0000-4000-8000-00000000fb05', '{"email":"eno-guard-5@example.invalid"}', 'email');
DO $d$ BEGIN
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider)
    VALUES ('eno-guard-fb-1', '00000000-0000-4000-8000-00000000fb01', '{"email":"eno-guard-1@example.invalid"}', 'facebook');
  RAISE NOTICE 'LINK_ALLOWED';
EXCEPTION WHEN others THEN RAISE NOTICE 'LINK_REFUSED';
END $d$;
DO $d$ BEGIN
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider)
    VALUES ('eno-guard-fb-3', '00000000-0000-4000-8000-00000000fb03', jsonb_build_object('email', current_setting('eno.guard_op')), 'facebook');
  RAISE NOTICE 'OPERATOR_ALLOWED';
EXCEPTION WHEN others THEN RAISE NOTICE 'OPERATOR_REFUSED';
END $d$;
DO $d$ BEGIN
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider)
    VALUES ('eno-guard-fb-4', '00000000-0000-4000-8000-00000000fb04', '{"email":"eno-guard-4@example.invalid"}', 'facebook');
  RAISE NOTICE 'OLD_ALLOWED';
EXCEPTION WHEN others THEN RAISE NOTICE 'OLD_REFUSED';
END $d$;
DO $d$ BEGIN
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider)
    VALUES ('eno-guard-fb-5', '00000000-0000-4000-8000-00000000fb05', '{"email":"eno-guard-5@example.invalid"}', 'facebook');
  RAISE NOTICE 'UNFINISHED_ALLOWED';
EXCEPTION WHEN others THEN RAISE NOTICE 'UNFINISHED_REFUSED: %', SQLERRM;
END $d$;
DO $d$ BEGIN
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider)
    VALUES ('eno-guard-fb-6', '00000000-0000-4000-8000-00000000fb06', '{"email":"eno-guard-6@example.invalid"}', 'facebook');
  RAISE NOTICE 'NEWCONFIRMED_ALLOWED';
EXCEPTION WHEN others THEN RAISE NOTICE 'NEWCONFIRMED_REFUSED';
END $d$;
DO $d$ BEGIN
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider)
    VALUES ('eno-guard-fb-2', '00000000-0000-4000-8000-00000000fb02', '{"email":"eno-guard-2@example.invalid"}', 'facebook');
  RAISE NOTICE 'NEW_ALLOWED';
EXCEPTION WHEN others THEN RAISE NOTICE 'NEW_REFUSED: %', SQLERRM;
END $d$;
ROLLBACK;
SQL
)
case "$LG" in
  *LINK_REFUSED*OPERATOR_REFUSED*OLD_REFUSED*UNFINISHED_ALLOWED*NEWCONFIRMED_REFUSED*NEW_ALLOWED*)
    case "$LG" in *AS_GOTRUE_ROLE*) R="as GoTrue's role" ;; *) R="as supabase_admin (no supabase_auth_admin role here)" ;; esac
    echo "  link guard ($R): an account in use refused ✅, an operator refused ✅, an old account with no identity refused ✅, an unfinished email sign-up allowed ✅, any confirmed account refused ✅, a new account allowed ✅" ;;
  *) echo "  ⛔ the link guard did not behave (${LG:0:240}) — adjust the check to this GoTrue's auth schema, then re-run"; rollback; exit 1 ;;
esac
# The authorize hop must reach Facebook's dialog with THIS app id and our callback. A stale value pinned anywhere (an old
# override line) fails every sign-in at Facebook while everything else looks right.
CH=$(python3 -c "import secrets;print(secrets.token_urlsafe(32)[:43])")
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "http://127.0.0.1:8000/auth/v1/authorize?provider=facebook&redirect_to=https%3A%2F%2Feno.vn%2Fauth%2Fcallback&code_challenge=$CH&code_challenge_method=s256" -H "apikey: $K")
case "$LOC" in *"client_id=$FB_AID"*) echo "  ✅ authorize carries this app id" ;; *) echo "  ⛔ authorize does not carry this app id — a stale value is pinned somewhere"; rollback; exit 1 ;; esac
case "$LOC" in
  https://www.facebook.com/*dialog/oauth*redirect_uri=https%3A%2F%2Fsb.eno.vn%2Fauth%2Fv1%2Fcallback*) echo "  ✅ authorize -> www.facebook.com dialog with the sb.eno.vn callback" ;;
  *) echo "  ⛔ authorize -> ${LOC:0:120} — not Facebook's dialog with our callback"; rollback; exit 1 ;;
esac
trap - ERR INT TERM HUP PIPE
echo "  Sign-in forms pick this up within ~10 minutes (the app's probe cache). Test it — facebook-signin.md § Test."
REMOTE
} | ssh -i "$KEY" -p "$PORT" -o IdentitiesOnly=yes -o BatchMode=yes "$HOST" 'bash -s'
