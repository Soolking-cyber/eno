#!/usr/bin/env bash
# ── vnpt-token — paste the 8h VNPT access token straight into the durable store ──────────────────
#
# VNPT publishes no token-minting endpoint (their doc: "Access Token Management, get the ... Access
# token"), and it expires in 8 hours. Until the generator API arrives this has to be done by hand
# roughly three times a day, so it needs to be ONE command with no deploy.
#
#   ./scripts/vnpt-token.sh              # writes to the DB in .env (local)
#   ENV=prod ./scripts/vnpt-token.sh     # writes to production
#
# ⚠️ THE TOKEN IS NEVER AN ARGUMENT. argv lands in shell history and is world-readable in `ps`.
# Hidden prompt only — the same rule as scripts/secret-set.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

[ -t 0 ] || { echo "✖ needs a terminal (hidden prompt). Run in Terminal.app." >&2; exit 2; }
[ -n "${DIRECT_URL:-}" ] || { echo "✖ DIRECT_URL not set" >&2; exit 2; }

printf 'Paste the VNPT access token (input hidden): ' >&2
IFS= read -rs TOKEN; echo >&2
[ -n "$TOKEN" ] || { echo "empty — nothing written." >&2; exit 1; }
TOKEN="${TOKEN#[Bb]earer }"   # the console shows it prefixed with "bearer "; store the raw JWT

# ⚠️ EXPIRY COMES FROM THE TOKEN, NOT FROM AN ASSUMED 8 HOURS. The console says 8h and a measured
# token carried 24h; they disagree, and guessing either expires a good token early or keeps a dead
# one. Also refuses a token that is ALREADY stale — storing one "succeeds" then fails on first use.
EXP=$(printf '%s' "$TOKEN" | cut -d. -f2 | tr '_-' '/+' | awk '{l=length($0)%4; if(l==2)$0=$0"=="; else if(l==3)$0=$0"="; print}' | base64 -d 2>/dev/null | sed -n 's/.*"exp":\([0-9]*\).*/\1/p')
[ -n "$EXP" ] || { echo "✖ could not read exp from that token — is it a JWT?" >&2; exit 1; }
NOW=$(date +%s)
[ "$EXP" -gt "$((NOW + 120))" ] || { echo "✖ that token expires in $(( (EXP-NOW)/60 ))m — already stale. Copy a fresh one." >&2; exit 1; }

psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO public.vnpt_access_token (id, access_token, expires_at, updated_at, updated_by)
VALUES (1, '$(printf '%s' "$TOKEN" | sed "s/'/''/g")', to_timestamp($EXP), now(), '$(whoami)')
ON CONFLICT (id) DO UPDATE SET access_token = EXCLUDED.access_token,
  expires_at = EXCLUDED.expires_at, updated_at = now(), updated_by = EXCLUDED.updated_by;
SQL
echo "  ✔ stored — valid until $(date -r "$EXP" '+%Y-%m-%d %H:%M %Z') ($(( (EXP-NOW)/3600 ))h $(( ((EXP-NOW)%3600)/60 ))m left)" >&2
echo "  Live within 60s on running revisions — no deploy needed." >&2
