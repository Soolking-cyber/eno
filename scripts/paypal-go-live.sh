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
# Arm PayPal LIVE on eno.forum — validating the credentials before storing them.
#
# Usage:
#   1. printf 'CLIENT_ID\nCLIENT_SECRET\n' > ~/paypal-live.txt   (or paste into an editor)
#   2. bash scripts/paypal-go-live.sh
#
# ⛔ IT PROVES THE CREDENTIALS AGAINST api-m.paypal.com BEFORE WRITING ANYTHING, and that is the
# whole reason this exists rather than a one-line `gcloud secrets versions add`. Sandbox and live
# credentials are the same SHAPE — an 80-character id and a secret — so a wrong pairing is invisible
# until a real applicant reaches checkout and it fails. A live OAuth token exchange is the only
# check that distinguishes them, it costs one HTTP request, and PayPal returns 401 for a sandbox
# credential on the live host. Nothing is stored unless that exchange returns a token.
#
# ⚠️ eno-services-env ONLY. eno.vn is the licensed sàn TMĐT and may not sell visa services, so its
# PayPal keys should be REMOVED rather than upgraded — cloudbuild.services.yaml already records that
# intent. This script deliberately does not touch eno-root-env; see the note it prints at the end.
#
# ⚠️ `PAYPAL_ENV` MUST BE EXACTLY `live`. src/lib/visa/payments.ts accepts only 'live' or 'sandbox'
# and drops PayPal from the provider list otherwise — a typo like 'prod' fails CLOSED rather than
# silently falling back to sandbox, where play-money orders would satisfy real payment state.
set -euo pipefail
umask 077

PROJECT=speedy-victory-500106-h8
SECRET=eno-services-env
SRC="${1:-$HOME/paypal-live.txt}"

[ -f "$SRC" ] || { echo "✗ $SRC not found. Put the LIVE client id on line 1 and the secret on line 2."; exit 1; }

CID=$(sed -n '1p' "$SRC" | tr -d ' \t\r\n')
CSEC=$(sed -n '2p' "$SRC" | tr -d ' \t\r\n')
[ -n "$CID" ] && [ -n "$CSEC" ] || { echo "✗ need two non-empty lines (client id, then secret)"; exit 1; }
echo "client id: ${#CID} chars, starts ${CID:0:6}…"

# ── The proof ────────────────────────────────────────────────────────────────
echo "→ exchanging for a token on api-m.paypal.com (LIVE)…"
CODE=$(curl -s -o /tmp/pp.json -w '%{http_code}' -u "$CID:$CSEC" \
  -d 'grant_type=client_credentials' \
  https://api-m.paypal.com/v1/oauth2/token)
if [ "$CODE" != "200" ]; then
  echo "✗ LIVE token exchange returned $CODE — these are NOT valid live credentials. Nothing written."
  echo "  (a sandbox credential returns 401 here; check you copied from the dashboard's Live tab)"
  exit 1
fi
python3 - <<'PY'
import json
d=json.load(open('/tmp/pp.json'))
print(f"✓ live token OK — scope entries: {len(d.get('scope','').split())}, expires_in {d.get('expires_in')}s")
PY
rm -f /tmp/pp.json

# ── Write ────────────────────────────────────────────────────────────────────
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT" > "$D/env"
BEFORE=$(wc -l < "$D/env")
[ "$BEFORE" -lt 20 ] && { echo "✗ source env looks truncated ($BEFORE lines) — ABORT"; exit 1; }

grep -v '^PAYPAL_ENV=' "$D/env" | grep -v '^PAYPAL_CLIENT_ID=' | grep -v '^PAYPAL_CLIENT_SECRET=' > "$D/new"
{ echo "PAYPAL_ENV=live"
  echo "PAYPAL_CLIENT_ID=$CID"
  echo "PAYPAL_CLIENT_SECRET=$CSEC"
} >> "$D/new"
echo "lines $BEFORE → $(wc -l < "$D/new")"
gcloud secrets versions add "$SECRET" --data-file="$D/new" --project="$PROJECT"

rm -P "$SRC" 2>/dev/null || rm -f "$SRC"
echo "✓ stored in $SECRET, and $SRC shredded"
echo
echo "NEXT — none of this is live yet:"
echo "  1. Redeploy eno.forum (Cloud Run reads env at container start), e.g."
echo "     gcloud run services update eno-forum --region=asia-southeast1 --project=$PROJECT"
echo "  2. Make ONE real low-value payment yourself and confirm it lands in the PayPal account."
echo "  3. eno.vn still holds PayPal keys in eno-root-env. It may not sell visa services —"
echo "     those should be REMOVED there, not upgraded. Ask before doing it; it is a separate change."
