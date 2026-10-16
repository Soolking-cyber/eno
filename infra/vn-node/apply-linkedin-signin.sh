#!/usr/bin/env bash
# Turn on "Sign in with LinkedIn" (GoTrue's linkedin_oidc provider) on the VN box — AFTER the code is deployed.
#   LINKEDIN_CLIENT_ID='…' LINKEDIN_CLIENT_SECRET='…' bash infra/vn-node/apply-linkedin-signin.sh
#   … add DRY_RUN=1 to run every check and change nothing.
#
# See linkedin-signin.md for the LinkedIn developer app this needs and for why each check exists. The buttons follow
# GoTrue: once /auth/v1/settings says linkedin_oidc is on, the teacher pages offer it within ~10 minutes (the app's probe
# cache) — no app env, no redeploy.
set -euo pipefail
KEY="${ENO_SSH_KEY:-$HOME/Desktop/eno.vn server/CS-Linux-20260821173657299.pem}"
HOST="${ENO_HOST:-root@162.4.176.233}"
PORT="${ENO_SSH_PORT:-24700}"
CID="${LINKEDIN_CLIENT_ID:-}"
SEC="${LINKEDIN_CLIENT_SECRET:-}"
DRY="${DRY_RUN:-0}"

trim() { printf '%s' "$1" | tr -d '[:space:]' | sed -e "s/^['\"]//" -e "s/['\"]$//"; }
CID="$(trim "$CID")"; SEC="$(trim "$SEC")"
# ⛔ REFUSE A PLACEHOLDER: an enabled provider with a junk secret fails every sign-in at LinkedIn's token endpoint.
[ -n "$CID" ] && [ -n "$SEC" ] || { echo "LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are required (linkedin-signin.md)"; exit 1; }
# LinkedIn client ids are short alphanumerics (~14 chars); a secret is longer. The one confusion that happens: swapping them.
[ "${#CID}" -ge 8 ] && [ "${#CID}" -le 40 ] || { echo "client id is ${#CID} chars — not a LinkedIn client id"; exit 1; }
[ "${#SEC}" -ge 12 ] || { echo "secret is only ${#SEC} chars — too short to be a LinkedIn client secret"; exit 1; }
[ "$CID" != "$SEC" ] || { echo "client id and secret are the same value"; exit 1; }
# ⛔ Both travel inside the ssh command line below: only the characters LinkedIn's ids and secrets are made of, so a
# quote can never end the string and run on the box (gate review, 2026-10-16).
case "$CID$SEC" in *[!A-Za-z0-9._=+/-]*) echo "client id or secret has characters a LinkedIn credential does not — check the paste"; exit 1 ;; esac

# ⛔ THE SECRET TRAVELS ON STDIN, ahead of the script — never in a command line, where `ps` shows it on either machine
# (gate review, 2026-10-16). printf is a shell builtin: no process of its own carries it either.
{ printf 'LI_CID=%q\nLI_SEC=%q\nLI_DRY=%q\n' "$CID" "$SEC" "$DRY"; cat <<'REMOTE'
set -euo pipefail
E=/opt/eno/supabase/.env
OV=/opt/eno/supabase/docker-compose.override.yml
K=$(grep -m1 '^ANON_KEY=' "$E" | cut -d= -f2-)
settings() { curl -s --max-time 10 http://127.0.0.1:8000/auth/v1/settings -H "apikey: $K"; }
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }

echo "=== PREFLIGHT (nothing is written unless every check passes) ==="
S=$(settings)
# ⛔ ACCOUNT TAKEOVER GUARD. GoTrue links a provider identity to the existing user with the same email when that email
# counts as verified — and with mailer_autoconfirm on it counts EVERY email as verified (linking.go:
# `email.Verified || config.Mailer.Autoconfirm`), LinkedIn's unverified ones included. Off, or this stops here.
AC=$(printf '%s' "$S" | field "['mailer_autoconfirm']")
[ "$AC" = "False" ] || { echo "  ⛔ mailer_autoconfirm=$AC — a LinkedIn email would link into any same-email account. Stop."; exit 3; }
echo "  mailer_autoconfirm: False ✅"
DS=$(printf '%s' "$S" | field "['disable_signup']")
[ "$DS" = "False" ] || { echo "  ⛔ disable_signup=$DS — every new teacher would fail with signup_disabled. Stop."; exit 3; }
echo "  disable_signup: False ✅"
AUTHC=$(cd /opt/eno/supabase && docker compose ps -q auth 2>/dev/null | head -1)
[ -n "$AUTHC" ] || { echo "  ⛔ cannot find the running GoTrue (auth) container"; exit 3; }
UV=$(docker exec "$AUTHC" printenv GOTRUE_MAILER_ALLOW_UNVERIFIED_EMAIL_SIGN_INS 2>/dev/null || true)
case "$UV" in ''|false|False|0) echo "  allow unverified email sign-ins: off ✅" ;; *) echo "  ⛔ GOTRUE_MAILER_ALLOW_UNVERIFIED_EMAIL_SIGN_INS=$UV — stop."; exit 3 ;; esac
# ⛔ THE CODE FIRST. Enabling the provider before the deploy lets anyone start a LinkedIn flow to the callback (nginx pins
# the return URL and PKCE, not the provider) while the callback cannot strip LinkedIn's token — refused until it can.
L=$(curl -sk -o /dev/null -w '%{redirect_url}' --max-time 20 --resolve eno.vn:443:127.0.0.1 'https://eno.vn/auth/linkedin/start?next=%2Fteachers%2Fjoin')
case "$L" in *li=notice*) echo "  deployed app has /auth/linkedin/start ✅" ;; *) echo "  ⛔ /auth/linkedin/start is not deployed (got: ${L:0:80}) — deploy first."; exit 3 ;; esac
# LinkedIn reachable FROM THE BOX, with the issuer GoTrue hardcodes (https://www.linkedin.com/oauth — changed 2024-04).
ISS=$(curl -s --max-time 15 https://www.linkedin.com/oauth/.well-known/openid-configuration | field "['issuer']" || true)
[ "$ISS" = "https://www.linkedin.com/oauth" ] || { echo "  ⛔ LinkedIn discovery unreachable from the box or issuer is '$ISS' — GoTrue would fail every sign-in."; exit 3; }
echo "  LinkedIn discovery issuer: $ISS ✅"
JW=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://www.linkedin.com/oauth/openid/jwks)
[ "$JW" = "200" ] || { echo "  ⛔ LinkedIn JWKS answered $JW from the box"; exit 3; }
echo "  LinkedIn JWKS: 200 ✅"
# ⛔ THE TOKEN GUARD NEEDS GoTrue's flow table AS v2.189 HAS IT. GoTrue writes LinkedIn's 60-day bearer token onto the
# auth.flow_state row at its callback, and only a COMPLETED code exchange deletes the row — an abandoned or failed
# sign-in would leave it in this database and its backups (review, 2026-10-16). A trigger (below) stops it being written.
DBC=$(cd /opt/eno/supabase && docker compose ps -q db 2>/dev/null | head -1)
[ -n "$DBC" ] || { echo "  ⛔ cannot find the running Postgres (db) container"; exit 3; }
psqlx() { docker exec -i "$DBC" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -tA "$@"; }
COLS=$(psqlx -c "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'auth' and table_name = 'flow_state' and column_name in ('provider_type', 'provider_access_token', 'provider_refresh_token')")
[ "$COLS" = "provider_access_token,provider_refresh_token,provider_type" ] || { echo "  ⛔ auth.flow_state lacks the columns the token guard needs (got: '$COLS') — stop."; exit 3; }
echo "  auth.flow_state has the token columns the guard clears ✅"

if [ "${LI_DRY:-0}" = "1" ]; then echo "=== DRY RUN: every check passed, nothing written ==="; exit 0; fi

echo "=== WRITE ==="
# ⛔ THE TOKEN GUARD FIRST, before anything that can turn LinkedIn on (gate review, 2026-10-16): a run that stops half-way
# must never leave a config that a later restart turns on WITHOUT it. Harmless on its own (it touches LinkedIn rows only).
psqlx <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION auth.eno_drop_linkedin_provider_tokens() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF lower(coalesce(NEW.provider_type, '')) = 'linkedin_oidc' THEN
    NEW.provider_access_token := NULL;
    NEW.provider_refresh_token := NULL;
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS eno_drop_linkedin_provider_tokens ON auth.flow_state;
CREATE TRIGGER eno_drop_linkedin_provider_tokens BEFORE INSERT OR UPDATE ON auth.flow_state
  FOR EACH ROW EXECUTE FUNCTION auth.eno_drop_linkedin_provider_tokens();
UPDATE auth.flow_state SET provider_access_token = NULL, provider_refresh_token = NULL
  WHERE lower(coalesce(provider_type, '')) = 'linkedin_oidc' AND (provider_access_token IS NOT NULL OR provider_refresh_token IS NOT NULL);
COMMIT;
SQL
echo "  auth.flow_state: LinkedIn tokens are never written (trigger eno_drop_linkedin_provider_tokens)"

STAMP=$(date +%Y%m%d%H%M%S)
cp "$E" "$E.bak-linkedin-$STAMP"
cp "$OV" "$OV.bak-linkedin-$STAMP"
# Anything failing from here puts both files back and recreates auth as it was — never a half-applied box.
rollback() {
  echo "  ↩ rolling back: restoring .env and the compose override from *.bak-linkedin-$STAMP"
  cp "$E.bak-linkedin-$STAMP" "$E"; cp "$OV.bak-linkedin-$STAMP" "$OV"
  (cd /opt/eno/supabase && docker compose up -d auth >/dev/null 2>&1) || echo "  ⛔ auth did not come back — run: cd /opt/eno/supabase && docker compose up -d auth"
}
trap 'rollback' ERR
# …and an interrupt, a dropped connection or a kill rolls back too — never a half-written config a later restart applies.
trap 'rollback; exit 1' INT TERM HUP PIPE
# The value goes to python through the environment — never an argument (sed's command line showed the secret in `ps`).
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
set_kv GOTRUE_EXTERNAL_LINKEDIN_OIDC_ENABLED true
set_kv GOTRUE_EXTERNAL_LINKEDIN_OIDC_CLIENT_ID "$LI_CID"
set_kv GOTRUE_EXTERNAL_LINKEDIN_OIDC_SECRET "$LI_SEC"
# The SUPABASE callback (the envoy gateway routes /auth/v1/*), registered in the LinkedIn app as an exact URL.
set_kv GOTRUE_EXTERNAL_LINKEDIN_OIDC_REDIRECT_URI https://sb.eno.vn/auth/v1/callback
# ⛔ supabase/supabase#50831: GoTrue's default authorize host is api.linkedin.com, which bounces to a full password login
# EVERY time; LinkedIn's documented host keeps "Continue as <name>" (chooseHost moves authorize AND token).
set_kv GOTRUE_EXTERNAL_LINKEDIN_OIDC_URL https://www.linkedin.com
echo "  gotrue .env updated"

# ⛔ .env ALONE DOES NOTHING (google-signin.md): Supabase's compose names every GOTRUE_* explicitly, so the keys must be
# passed through the ONE services.auth.environment mapping of the override. A line-level merge: every existing byte kept;
# anything ambiguous is refused, never guessed.
python3 - "$OV" <<'PYEOF'
import re, sys
p = sys.argv[1]
KEYS = ['GOTRUE_EXTERNAL_LINKEDIN_OIDC_ENABLED', 'GOTRUE_EXTERNAL_LINKEDIN_OIDC_CLIENT_ID', 'GOTRUE_EXTERNAL_LINKEDIN_OIDC_SECRET',
        'GOTRUE_EXTERNAL_LINKEDIN_OIDC_REDIRECT_URI', 'GOTRUE_EXTERNAL_LINKEDIN_OIDC_URL']
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
# A LinkedIn key already there must be the .env passthrough — a pinned value would survive every rotation.
for i in body:
    m = re.match(r'^ *(GOTRUE_EXTERNAL_LINKEDIN_OIDC_[A-Z_]+)\s*:\s*(.*)$', lines[i])
    if m and m.group(2).strip().strip('"\'') != '${' + m.group(1) + '}':
        die(f'{m.group(1)} is pinned to a value in the override — make it ${{{m.group(1)}}} by hand')
add = [f"{' ' * ki}{k}: ${{{k}}}" for k in KEYS if k not in present]
if not add: print('  compose override: already wired'); sys.exit(0)
out = lines[:body[-1] + 1] + [' ' * ki + '# Sign in with LinkedIn: passthroughs from .env (infra/vn-node/apply-linkedin-signin.sh)'] + add + lines[body[-1] + 1:]
open(p, 'w').write('\n'.join(out) + '\n')
print(f'  compose override: {len(add)} LinkedIn vars wired into services.auth.environment')
PYEOF

cd /opt/eno/supabase && docker compose up -d auth >/dev/null 2>&1
echo "=== VERIFY ==="
LOK=no
for i in $(seq 1 15); do
  # `|| true`: while auth restarts the gateway answers 502 with no JSON — that is a retry, never errexit's rollback.
  v=$(settings | field "['external'].get('linkedin_oidc')" || true)
  [ "$v" = "True" ] && { LOK=yes; break; }
  sleep 4
done
[ "$LOK" = yes ] || { echo "  ⛔ GoTrue does not report linkedin_oidc — see 'cd /opt/eno/supabase && docker compose logs auth'"; rollback; exit 1; }
echo "  gotrue external.linkedin_oidc: True ✅"
TG=$(psqlx -c "select count(*) from pg_trigger where tgname = 'eno_drop_linkedin_provider_tokens' and tgrelid = 'auth.flow_state'::regclass and tgenabled <> 'D'")
[ "$TG" = "1" ] || { echo "  ⛔ the LinkedIn token guard trigger is missing or disabled"; rollback; exit 1; }
echo "  token guard trigger on auth.flow_state ✅"
# …and it WORKS: a LinkedIn row written inside a transaction that is rolled back must come out without its token.
# ⛔ FAILS CLOSED: a check that cannot run (another GoTrue schema) is not a pass — LinkedIn stays off until it can.
GUARD=$(psqlx <<'SQL' 2>&1 || true
BEGIN;
INSERT INTO auth.flow_state (id, auth_code, code_challenge_method, code_challenge, provider_type, provider_access_token, provider_refresh_token, authentication_method)
  VALUES (gen_random_uuid(), 'eno-guard-check', 's256', 'eno-guard-check', 'linkedin_oidc', 'secret', 'secret', 'oauth')
  RETURNING CASE WHEN provider_access_token IS NULL AND provider_refresh_token IS NULL THEN 'GUARD_BLANKS' ELSE 'GUARD_KEEPS' END;
ROLLBACK;
SQL
)
case "$GUARD" in
  *GUARD_BLANKS*) echo "  token guard blanks a LinkedIn token ✅" ;;
  *GUARD_KEEPS*) echo "  ⛔ the token guard did NOT blank a LinkedIn token"; rollback; exit 1 ;;
  *) echo "  ⛔ could not exercise the token guard (${GUARD:0:160}) — adjust the check's INSERT to this GoTrue's auth.flow_state, then re-run"; rollback; exit 1 ;;
esac
# The authorize hop must reach LinkedIn's DOCUMENTED host (the #50831 override took) with our callback.
CH=$(python3 -c "import secrets;print(secrets.token_urlsafe(32)[:43])")
LOC=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "http://127.0.0.1:8000/auth/v1/authorize?provider=linkedin_oidc&redirect_to=https%3A%2F%2Feno.vn%2Fauth%2Fcallback&code_challenge=$CH&code_challenge_method=s256" -H "apikey: $K")
# The client id GoTrue sends must be THIS run's — a stale value pinned anywhere (an old override line) fails every
# sign-in at LinkedIn while everything else looks right.
case "$LOC" in *"client_id=$LI_CID"*) echo "  ✅ authorize carries this client id" ;; *) echo "  ⛔ authorize does not carry this client id — a stale value is pinned somewhere"; rollback; exit 1 ;; esac
case "$LOC" in
  https://www.linkedin.com/oauth/v2/authorization*redirect_uri=https%3A%2F%2Fsb.eno.vn%2Fauth%2Fv1%2Fcallback*) echo "  ✅ authorize -> www.linkedin.com with the sb.eno.vn callback" ;;
  https://api.linkedin.com/*) echo "  ⛔ authorize -> api.linkedin.com: the URL override did not take (password every time, #50831)"; rollback; exit 1 ;;
  *) echo "  ⛔ authorize -> ${LOC:0:120} — not LinkedIn's documented host with our callback"; rollback; exit 1 ;;
esac
trap - ERR INT TERM HUP PIPE
echo "  The teacher pages pick this up within ~10 minutes (the app's probe cache). Test with a LinkedIn test profile."
REMOTE
} | ssh -i "$KEY" -p "$PORT" -o BatchMode=yes "$HOST" 'bash -s'
