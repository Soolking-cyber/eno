#!/usr/bin/env bash
# Activate Google sign-in on the VN box.
#   GOOGLE_CLIENT_SECRET='…' bash infra/vn-node/apply-google-signin.sh
#
# See google-signin.md for why this needs a secret at all. Everything else is
# already built and tested; this is the last mile.
set -euo pipefail
KEY="${ENO_SSH_KEY:-$HOME/Desktop/eno.vn server/CS-Linux-20260821173657299.pem}"
HOST="${ENO_HOST:-root@162.4.176.208}"
PORT="${ENO_SSH_PORT:-24700}"
SEC="${GOOGLE_CLIENT_SECRET:-}"

# ⛔ REFUSE A PLACEHOLDER. googleOauthConfigured() checks only that the secret is
# non-empty, so any junk value ACTIVATES the first-party flow — which then fails at
# Google's token endpoint, and the fallback it drops to needs the same real secret.
# An empty secret leaves one broken path; a fake one leaves two.
[ -n "$SEC" ] || { echo "GOOGLE_CLIENT_SECRET is required (see google-signin.md)"; exit 1; }
case "$SEC" in *[!A-Za-z0-9_-]*) echo "secret has unexpected characters — check you pasted the SECRET, not the ID"; exit 1 ;; esac
[ "${#SEC}" -ge 20 ] || { echo "secret is only ${#SEC} chars — that is not a Google client secret"; exit 1; }

ssh -i "$KEY" -p "$PORT" -o BatchMode=yes "$HOST" "GOOGLE_CLIENT_SECRET='$SEC' bash -s" <<'REMOTE'
set -euo pipefail
SEC="$GOOGLE_CLIENT_SECRET"
CID=$(docker exec eno-vn-app printenv NEXT_PUBLIC_GOOGLE_CLIENT_ID)
[ -n "$CID" ] || { echo "no NEXT_PUBLIC_GOOGLE_CLIENT_ID on the box"; exit 1; }
echo "  client id: ${CID%%-*}-… (len ${#CID})"

# 1. the app containers — this is what googleOauthConfigured() reads.
for f in /opt/eno/secrets/eno-vn.env /opt/eno/secrets/eno-forum.env; do
  grep -q '^GOOGLE_CLIENT_SECRET=' "$f" \
    && sed -i "s|^GOOGLE_CLIENT_SECRET=.*|GOOGLE_CLIENT_SECRET=$SEC|" "$f" \
    || printf 'GOOGLE_CLIENT_SECRET=%s\n' "$SEC" >> "$f"
done
echo "  app env updated (both editions)"

# 2. the box's GoTrue — needed for signInWithIdToken to accept our token at all
#    (it validates the id_token's `aud` against this client id), and for the
#    signInWithOAuth fallback to have somewhere to go.
E=/opt/eno/supabase/.env
set_kv() { grep -q "^$1=" "$E" && sed -i "s|^$1=.*|$1=$2|" "$E" || printf '%s=%s\n' "$1" "$2" >> "$E"; }
set_kv GOTRUE_EXTERNAL_GOOGLE_ENABLED true
set_kv GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID "$CID"
set_kv GOTRUE_EXTERNAL_GOOGLE_SECRET "$SEC"
set_kv GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI https://sb.eno.vn/auth/v1/callback
echo "  gotrue env updated"

cd /opt/eno/supabase && docker compose up -d auth >/dev/null 2>&1
docker rm -f eno-vn-app eno-forum-app >/dev/null 2>&1 || true
mk() { B=$(mktemp); cp "$2" "$B"; printf '\nNEXT_PUBLIC_ENO_EDITION=%s\n' "$3" >> "$B"
       [ "$3" = marketplace ] && printf 'MARKETPLACE_HOSTS_SERVICES=true\n' >> "$B"
       docker run -d --name "$1" --restart unless-stopped --network supabase_default \
         -p 127.0.0.1:$4:8080 --env-file "$B" "$5" >/dev/null; rm -f "$B"; }
mk eno-vn-app    /opt/eno/secrets/eno-vn.env    marketplace 3001 eno-vn:local
mk eno-forum-app /opt/eno/secrets/eno-forum.env services    3002 eno-forum:local

echo "  waiting for readiness…"
for i in $(seq 1 24); do
  a=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3001/ -H 'Host: eno.vn')
  [ "$a" = "200" ] && break; sleep 5
done

echo "=== VERIFY ==="
K=$(grep -m1 '^ANON_KEY=' "$E" | cut -d= -f2-)
echo -n "  gotrue external.google: "
curl -s --max-time 15 http://127.0.0.1:8000/auth/v1/settings -H "apikey: $K" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["external"]["google"])'
# ⛔ THE REAL TEST: does /auth/google/start go to GOOGLE, or bounce to the fallback?
L=$(curl -sk -o /dev/null -w '%{redirect_url}' --max-time 20 --resolve eno.vn:443:127.0.0.1 \
      'https://eno.vn/auth/google/start?next=%2F')
case "$L" in
  https://accounts.google.com/*) echo "  ✅ start -> accounts.google.com (first-party flow LIVE)" ;;
  *g=fallback*)                  echo "  ⛔ start -> fallback; the secret did not take" ;;
  *)                             echo "  ? start -> ${L:0:90}" ;;
esac
REMOTE
