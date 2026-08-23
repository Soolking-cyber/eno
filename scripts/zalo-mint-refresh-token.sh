#!/usr/bin/env bash
# Mint the FIRST Zalo OA token pair (the ZALO_INIT_REFRESH_TOKEN bootstrap).
#
#   Step 1:  bash scripts/zalo-mint-refresh-token.sh
#            → prints an authorize URL. Open it AS AN ADMIN OF THE OA, approve.
#   Step 2:  bash scripts/zalo-mint-refresh-token.sh "<the full redirected URL>"
#            → exchanges the code and appends the refresh token to ~/zalo-zns.txt as line 4.
#
# Reads app id/secret from lines 1-2 of ~/zalo-zns.txt so nothing is retyped.
#
# ⚠️ REDIRECT URI MUST BE REGISTERED on the Zalo app first (Đăng nhập → Official Account →
# callback url). It does not need to serve anything: the code arrives as a QUERY PARAMETER, so
# a 404 page is fine — you copy the URL out of the address bar. This is why eno.vn had to be
# domain-verified on the Zalo platform.
#
# ⚠️ PKCE is REQUIRED by Zalo's v4 OA flow: the authorize call carries code_challenge and the
# exchange must present the matching code_verifier. The verifier is kept in a 0600 file between
# the two steps; a mismatch is the usual cause of `-201 invalid code_verifier`.
set -euo pipefail
umask 077

SRC="$HOME/zalo-zns.txt"
STATE_FILE="$HOME/.zalo-pkce"
OA_ID="${ZALO_OA_ID:-412676197230395829}"
REDIRECT="${ZALO_REDIRECT_URI:-https://eno.vn/}"

[ -f "$SRC" ] || { echo "✗ $SRC not found (need app id on line 1, app secret on line 2)"; exit 1; }
APP_ID=$(sed -n '1p' "$SRC" | tr -d ' \t\r\n')
APP_SECRET=$(sed -n '2p' "$SRC" | tr -d ' \t\r\n')
[ -n "$APP_ID" ] && [ -n "$APP_SECRET" ] || { echo "✗ lines 1-2 of $SRC must hold the app id and secret"; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

if [ $# -eq 0 ]; then
  VERIFIER=$(openssl rand -hex 48)
  CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | b64url)
  printf '%s\n' "$VERIFIER" > "$STATE_FILE"
  echo "✓ PKCE verifier saved to $STATE_FILE"
  echo
  echo "OPEN THIS AS AN ADMIN OF OA $OA_ID, and approve:"
  echo
  echo "  https://oauth.zaloapp.com/v4/oa/permission?app_id=${APP_ID}&redirect_uri=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$REDIRECT")&code_challenge=${CHALLENGE}&state=enozns"
  echo
  echo "The page you land on will 404 — that is expected. Copy the FULL url from the address"
  echo "bar (it carries ?code=...) and run:"
  echo "  bash scripts/zalo-mint-refresh-token.sh \"<that url>\""
  exit 0
fi

[ -f "$STATE_FILE" ] || { echo "✗ $STATE_FILE missing — run step 1 first (the verifier must match)"; exit 1; }
VERIFIER=$(cat "$STATE_FILE")
CODE=$(python3 -c "
import sys,urllib.parse
q=urllib.parse.urlparse(sys.argv[1]).query
print(urllib.parse.parse_qs(q).get('code',[''])[0])
" "$1")
[ -n "$CODE" ] || { echo "✗ no ?code= in that url"; exit 1; }
echo "→ exchanging authorization code (${#CODE} chars)…"

HTTP=$(curl -s -o /tmp/zmint.json -w '%{http_code}' -X POST \
  -H "secret_key: $APP_SECRET" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "code=$CODE" \
  --data-urlencode "app_id=$APP_ID" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code_verifier=$VERIFIER" \
  https://oauth.zaloapp.com/v4/oa/access_token)
REFRESH=$(python3 -c "import json;print(json.load(open('/tmp/zmint.json')).get('refresh_token',''))" 2>/dev/null || true)
if [ "$HTTP" != "200" ] || [ -z "$REFRESH" ]; then
  echo "✗ exchange failed (HTTP $HTTP). Zalo said:"; cat /tmp/zmint.json; echo
  echo "  -201 invalid code_verifier → step 1 and step 2 used different verifiers, re-run step 1."
  echo "  Authorization codes are short-lived and single-use; re-authorize if it expired."
  rm -f /tmp/zmint.json; exit 1
fi
rm -f /tmp/zmint.json "$STATE_FILE"

# Append as line 4, replacing any previous attempt so a re-run cannot leave two.
python3 - "$SRC" "$REFRESH" <<'PY'
import sys
path, token = sys.argv[1], sys.argv[2]
lines = open(path).read().split('\n')
while len(lines) < 4: lines.append('')
lines[3] = token
open(path, 'w').write('\n'.join(l for l in lines[:4]) + '\n')
PY
echo "✓ refresh token (${#REFRESH} chars) written to line 4 of $SRC"
awk '{printf "  line %d: %d chars\n", NR, length($0)}' "$SRC"
echo
echo "⚠️ SINGLE-USE, so do this NEXT, not later:"
echo "     bash scripts/zalo-zns-go-live.sh"
