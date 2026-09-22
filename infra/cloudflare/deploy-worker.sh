#!/usr/bin/env bash
# Deploy infra/cloudflare/eno-html-edge-cache.js to Cloudflare.
#
# ⛔ THIS EXISTS BECAUSE THE WORKER USED TO LIVE ONLY IN THE CLOUDFLARE DASHBOARD. There was no
# checked-in source and no way to redeploy it, so the edge cache — which both zones' HTML latency
# depends on — could be neither reviewed nor restored. The .js beside this script is now the source
# of truth and this is the only supported way to push it.
#
# ⚠️ RUN IT ON THE BOX, NOT FROM A LAPTOP. The Cloudflare token lives at $CF_TOKEN_FILE on the box
# and deliberately never leaves it; that is the same file eno-deploy.sh purges with. An exported
# CF_TOKEN still wins, for a one-off from somewhere else.
#
# ⚠️ A PUT REPLACES THE WHOLE SCRIPT, INCLUDING ITS SETTINGS. Bindings and compatibility flags that
# are not sent are DROPPED. Verified 2026-09-22: this worker has zero bindings and zero flags, so
# metadata below is complete. Re-check with GET .../settings before adding one, or the next deploy
# silently unbinds it.
# ⚠️ Routes are NOT part of the script and survive a PUT — they are zone-level and point at the
# script NAME (12 routes per zone, both apex and www). Do not "restore" them after deploying.
set -euo pipefail

ACCOUNT=c91cf27edd31b01aba677ac9e007d569
NAME=eno-html-edge-cache
COMPAT=2026-09-01
SRC=${1:-"$(cd "$(dirname "$0")" && pwd)/eno-html-edge-cache.js"}

CF_TOKEN_FILE=${CF_TOKEN_FILE:-/opt/eno/secrets/cf-token}
if [ -z "${CF_TOKEN:-}" ] && [ -r "$CF_TOKEN_FILE" ]; then
  CF_TOKEN=$(tr -d '\r\n' < "$CF_TOKEN_FILE")
fi
[ -n "${CF_TOKEN:-}" ] || { echo "  no CF_TOKEN and no readable $CF_TOKEN_FILE" >&2; exit 1; }
[ -r "$SRC" ] || { echo "  cannot read $SRC" >&2; exit 1; }

echo "  deploying $(basename "$SRC") ($(wc -c < "$SRC" | tr -d ' ') bytes, sha $( { shasum -a 256 "$SRC" 2>/dev/null || sha256sum "$SRC"; } | cut -c1-16 ))"

# `main_module` is what makes this a MODULE worker (`export default {fetch}`). Omit it and
# Cloudflare parses the same file as a service-worker script and the upload fails on `export`.
# ⛔ THE TOKEN GOES IN ON STDIN, NEVER IN ARGV. `-H "Authorization: Bearer $CF_TOKEN"` puts a
# credential with write access to every Worker on the account into the process list, where any
# other user on the box can read it with `ps`. `--config -` reads the header from stdin instead,
# so it never appears in the command line. The `-F` file is still read from disk, not stdin.
resp=$(printf 'header = "Authorization: Bearer %s"\n' "$CF_TOKEN" | curl -sS -X PUT --config - \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/scripts/$NAME" \
  -F "metadata={\"main_module\":\"worker.js\",\"compatibility_date\":\"$COMPAT\",\"bindings\":[],\"compatibility_flags\":[]};type=application/json" \
  -F "worker.js=@$SRC;type=application/javascript+module")

python3 - "$resp" <<'PY'
import json, sys
r = json.loads(sys.argv[1])
if r.get("success"):
    print("  deployed:", r["result"].get("id"), "modified", r["result"].get("modified_on"))
else:
    print("  FAILED:", json.dumps(r.get("errors"), ensure_ascii=False)); sys.exit(1)
PY
