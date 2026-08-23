#!/usr/bin/env bash
# ⛔ THIS WRITES TO GCP SECRET MANAGER, WHICH PRODUCTION NO LONGER READS (2026-08-23).
# The app moved to the VN box on 2026-08-21 and Cloud Run was deleted on 2026-08-23. The
# containers now read /opt/eno/secrets/{eno-vn,eno-forum}.env at CREATE time — nothing on
# the serving path consults Secret Manager any more.
#
# ⚠️ SO THIS SCRIPT WILL REPORT SUCCESS AND CHANGE NOTHING FOR USERS. That is the same
# silent-success shape that let production drift fourteen commits behind: a green result
# from a pipeline pointed somewhere that had stopped mattering. To actually take effect:
#
#   1. edit the value in /opt/eno/secrets/eno-forum.env on 162.4.176.208
#   2. re-create the container — env is read at CREATE, not at request time, so a plain
#      restart is NOT enough:  docker compose -f infra/vn-node/apps.compose.yml up -d
#
# Kept as-is rather than rewritten because Secret Manager still holds the canonical copy
# of these values and the GCP project is still ACTIVE; fix the destination deliberately,
# not as a side effect of a commit.
# Arm Zalo ZNS OTP — validating the credentials AND seeding the rotating token chain.
#
# Usage:
#   1. Put four lines in ~/zalo-zns.txt, in this order:
#        ZALO_APP_ID
#        ZALO_APP_SECRET
#        ZALO_ZNS_TEMPLATE_ID
#        ZALO_INIT_REFRESH_TOKEN
#   2. bash scripts/zalo-zns-go-live.sh
#
# ⛔ THE REFRESH TOKEN IS SINGLE-USE, AND THAT CHANGES WHAT "VALIDATE" MEANS. Every refresh
# returns a NEW refresh token and kills the old one (3-month life). So unlike the PayPal
# equivalent, proving the credentials CONSUMES them — a check-then-store script would leave a
# dead token in the secret and the first real OTP would fail. This script therefore does the
# bootstrap itself: it exchanges the token once, SEEDS zalo_oauth_token (id=1) with the pair it
# gets back, and stores the NEW refresh token in the env as the recovery value. After this the
# chain self-maintains and the env value is only read again if the table is emptied.
#
# ⚠️ eno-root-env — ZNS is marketplace sign-in (eno.vn), not a services surface.
set -euo pipefail
umask 077

PROJECT=speedy-victory-500106-h8
SECRET=eno-root-env
SRC="${1:-$HOME/zalo-zns.txt}"

[ -f "$SRC" ] || { echo "✗ $SRC not found. Four lines: app id, app secret, template id, init refresh token."; exit 1; }
APP_ID=$(sed -n '1p' "$SRC" | tr -d ' \t\r\n')
APP_SECRET=$(sed -n '2p' "$SRC" | tr -d ' \t\r\n')
TEMPLATE_ID=$(sed -n '3p' "$SRC" | tr -d ' \t\r\n')
INIT_REFRESH=$(sed -n '4p' "$SRC" | tr -d ' \t\r\n')
for p in APP_ID APP_SECRET TEMPLATE_ID INIT_REFRESH; do
  [ -n "${!p}" ] || { echo "✗ line for $p is empty"; exit 1; }
done
echo "app id ${APP_ID}, template ${TEMPLATE_ID}, refresh token ${#INIT_REFRESH} chars"

# ── The exchange. This CONSUMES the init token; whatever comes back is the live chain. ───────
echo "→ exchanging the refresh token at oauth.zaloapp.com (this consumes it)…"
CODE=$(curl -s -o /tmp/zns.json -w '%{http_code}' -X POST \
  -H "secret_key: $APP_SECRET" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "refresh_token=$INIT_REFRESH" \
  --data-urlencode "app_id=$APP_ID" \
  --data-urlencode 'grant_type=refresh_token' \
  https://oauth.zaloapp.com/v4/oa/access_token)
NEW_ACCESS=$(python3 -c "import json;d=json.load(open('/tmp/zns.json'));print(d.get('access_token',''))" 2>/dev/null || true)
NEW_REFRESH=$(python3 -c "import json;d=json.load(open('/tmp/zns.json'));print(d.get('refresh_token',''))" 2>/dev/null || true)
EXPIRES=$(python3 -c "import json;d=json.load(open('/tmp/zns.json'));print(d.get('expires_in','0'))" 2>/dev/null || true)
if [ "$CODE" != "200" ] || [ -z "$NEW_ACCESS" ] || [ -z "$NEW_REFRESH" ]; then
  echo "✗ exchange failed (HTTP $CODE). Nothing written. Zalo said:"
  cat /tmp/zns.json; echo
  echo "  Common causes: wrong app secret; refresh token already used (they are single-use);"
  echo "  token older than 3 months; app id mismatch."
  rm -f /tmp/zns.json; exit 1
fi
rm -f /tmp/zns.json
echo "✓ exchange OK — access token ${#NEW_ACCESS} chars, expires_in ${EXPIRES}s, new refresh ${#NEW_REFRESH} chars"

# ── Seed the chain, because the init token is now spent. ─────────────────────────────────────
DB="${DIRECT_URL:-${DATABASE_URL:-}}"
[ -n "$DB" ] || { echo "✗ DIRECT_URL/DATABASE_URL not set — cannot seed zalo_oauth_token. ABORT (the token is spent; re-mint before retrying)."; exit 1; }
NOW_MS=$(python3 -c "import time;print(int(time.time()*1000))")
EXP_MS=$(python3 -c "import time,sys;print(int(time.time()*1000)+int(sys.argv[1])*1000)" "${EXPIRES:-90000}")
PGPASSWORD='' psql "$DB" -v ON_ERROR_STOP=1 -q \
  -c "insert into zalo_oauth_token (id, access_token, refresh_token, expires_ms, updated_ms)
      values (1, '$NEW_ACCESS', '$NEW_REFRESH', $EXP_MS, $NOW_MS)
      on conflict (id) do update set access_token = excluded.access_token,
        refresh_token = excluded.refresh_token, expires_ms = excluded.expires_ms,
        updated_ms = excluded.updated_ms;"
echo "✓ zalo_oauth_token seeded (id=1)"

# ── Env, with the NEW refresh token as the recovery value. ───────────────────────────────────
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT" > "$D/env"
BEFORE=$(wc -l < "$D/env")
[ "$BEFORE" -lt 20 ] && { echo "✗ source env looks truncated ($BEFORE lines) — ABORT"; exit 1; }
grep -vE '^(ZALO_APP_ID|ZALO_APP_SECRET|ZALO_ZNS_TEMPLATE_ID|ZALO_INIT_REFRESH_TOKEN|ZALO_ZNS_MODE)=' "$D/env" > "$D/new"
{ echo "ZALO_APP_ID=$APP_ID"
  echo "ZALO_APP_SECRET=$APP_SECRET"
  echo "ZALO_ZNS_TEMPLATE_ID=$TEMPLATE_ID"
  echo "ZALO_INIT_REFRESH_TOKEN=$NEW_REFRESH"
  echo "ZALO_ZNS_MODE=development"
} >> "$D/new"
echo "lines $BEFORE → $(wc -l < "$D/new")"
gcloud secrets versions add "$SECRET" --data-file="$D/new" --project="$PROJECT"
rm -P "$SRC" 2>/dev/null || rm -f "$SRC"
echo "✓ stored in $SECRET, and $SRC shredded"
echo
echo "⚠️ ZALO_ZNS_MODE=development — delivers ONLY to app/OA admin numbers. Prove it first:"
echo "     set -a; . ./.env; set +a; node scripts/zns-test.mjs <your-admin-09xxxxxxxx>"
echo "   Then remove that line (or set it to production) and redeploy to reach real users."
