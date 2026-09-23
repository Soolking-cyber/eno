#!/usr/bin/env bash
# Deploy infra/cloudflare/eno-mailer.js — the Worker every app email leaves through — and manage
# its two HMAC secrets. Sibling of deploy-worker.sh; the runbook is eno-mailer.README.md.
#
#   deploy-mailer.sh                   deploy the Worker (bindings, vars, workers.dev, previews off)
#   deploy-mailer.sh set-secret NAME   set one secret; the VALUE IS READ FROM STDIN, never argv
#   deploy-mailer.sh status            show bindings, secret names and the workers.dev setting
#
# ⚠️ A PUT REPLACES THE WHOLE SCRIPT, INCLUDING ITS SETTINGS. Every binding the metadata below does
# not send is DROPPED — so it sends ALL of them: both send_email bindings, the KV namespace and the
# three budget vars. Secrets are the one exception: `keep_bindings: ["secret_text"]` carries the
# already-set MAILER_KEY_* values across the PUT, which is why a deploy never needs them and never
# sees them. Adding a binding means adding it HERE, or the next deploy silently unbinds it.
#
# ⚠️ THE TOKEN. `$CF_TOKEN` if exported, else `$CF_TOKEN_FILE`. There is NO default: the box's
# /opt/eno/secrets/cf-token is PURGE-SCOPED (measured 2026-09-22, see eno-html-edge-cache.js), a
# Workers PUT with it answers "No access to the specified resource", and this script runs on a
# laptop (eno-mailer.README.md step 2), where that path means nothing. The token this script needs:
#   Account · Workers Scripts: Edit       (upload, secrets, workers.dev subdomain)
#   Account · Workers KV Storage: Read    (the namespace lookup by title; Edit to create it)
#   Account · Email Sending: Edit         (only if the PUT refuses the send_email bindings)
# ⛔ THE TOKEN NEVER GOES IN ARGV. curl reads its Authorization header from a 0600 config file (or
# stdin), because a header on the command line is readable by any user on the box via `ps`.
# ⛔ RUN IT FROM A LAPTOP, NOT THE BOX (eno-mailer.README.md steps 2–5). A Workers-edit token can
# redeploy eno-mailer with an unrestricted send_email binding — with Email Sending: Edit it can send
# as either domain outright — so it never lives in /opt/eno/secrets. Give it an expiry; revoke it
# after the deploy.
set -euo pipefail

ACCOUNT=${CF_ACCOUNT_ID:-c91cf27edd31b01aba677ac9e007d569}
NAME=eno-mailer
COMPAT=2026-09-01
SRC=${MAILER_SRC:-"$(cd "$(dirname "$0")" && pwd)/eno-mailer.js"}
API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT"

# The account's daily quota and the shares reserved for sign-in/security. Override per deploy,
# e.g. `DAILY_QUOTA=5000 ./deploy-mailer.sh` after Cloudflare raises the limit.
DAILY_QUOTA=${DAILY_QUOTA:-1000}
PRIORITY_RESERVE=${PRIORITY_RESERVE:-400}
SECURITY_RESERVE=${SECURITY_RESERVE:-25}
KV_TITLE=${MAILER_KV_TITLE:-eno-mailer}

CF_TOKEN_FILE=${CF_TOKEN_FILE:-}
if [ -z "${CF_TOKEN:-}" ] && [ -n "$CF_TOKEN_FILE" ] && [ -r "$CF_TOKEN_FILE" ]; then
  CF_TOKEN=$(tr -d '\r\n' < "$CF_TOKEN_FILE")
fi
[ -n "${CF_TOKEN:-}" ] || { echo "  no CF_TOKEN and no readable CF_TOKEN_FILE (${CF_TOKEN_FILE:-unset}): create the short-lived Workers token in eno-mailer.README.md step 2" >&2; exit 1; }

umask 077
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
printf 'header = "Authorization: Bearer %s"\n' "$CF_TOKEN" > "$TMP/auth.conf"

cf() { curl -sS --config "$TMP/auth.conf" "$@"; }

check() { # check <json> <what>
  python3 - "$1" "$2" <<'PY'
import json, sys
r = json.loads(sys.argv[1] or '{}')
if not r.get("success"):
    print("  FAILED (%s):" % sys.argv[2], json.dumps(r.get("errors"), ensure_ascii=False)); sys.exit(1)
PY
}

cmd=${1:-deploy}

case "$cmd" in
  set-secret)
    SECRET=${2:-}
    case "$SECRET" in
      MAILER_KEY_VN|MAILER_KEY_FORUM|MAILER_KEY_VN_OLD|MAILER_KEY_FORUM_OLD) ;;
      *) echo "  usage: $0 set-secret MAILER_KEY_VN|MAILER_KEY_FORUM|MAILER_KEY_VN_OLD|MAILER_KEY_FORUM_OLD  (value on stdin)" >&2; exit 2 ;;
    esac
    if [ -t 0 ]; then printf '  value for %s (input hidden): ' "$SECRET" >&2; IFS= read -rs VALUE; echo >&2
    else IFS= read -r VALUE || true; fi
    [ "${#VALUE}" -ge 32 ] || { echo "  refusing: a key shorter than 32 characters (use: openssl rand -hex 32)" >&2; exit 1; }
    # The body is built by python from stdin and handed to curl on stdin: the value is never an
    # argument to anything.
    resp=$(printf '%s' "$VALUE" | python3 -c 'import json,sys; print(json.dumps({"name": sys.argv[1], "type": "secret_text", "text": sys.stdin.read()}))' "$SECRET" \
      | cf -X PUT "$API/workers/scripts/$NAME/secrets" -H 'content-type: application/json' --data-binary @-)
    unset VALUE
    check "$resp" "set $SECRET"
    echo "  $SECRET set on $NAME (a new version was deployed with it)"
    exit 0
    ;;
  status)
    echo "  bindings:"
    cf "$API/workers/scripts/$NAME/settings" | python3 -c 'import json,sys; r=json.load(sys.stdin); [print("   ", b.get("type"), b.get("name"), b.get("allowed_sender_addresses") or b.get("namespace_id") or b.get("text") or "") for b in (r.get("result") or {}).get("bindings", [])]'
    echo "  secrets:"
    cf "$API/workers/scripts/$NAME/secrets" | python3 -c 'import json,sys; r=json.load(sys.stdin); [print("   ", s.get("name")) for s in (r.get("result") or [])]'
    echo "  workers.dev:"
    cf "$API/workers/scripts/$NAME/subdomain" | python3 -c 'import json,sys; r=json.load(sys.stdin); print("   ", r.get("result"))'
    exit 0
    ;;
  deploy) ;;
  *) echo "  usage: $0 [deploy|set-secret NAME|status]" >&2; exit 2 ;;
esac

[ -r "$SRC" ] || { echo "  cannot read $SRC" >&2; exit 1; }

# ── The KV namespace: an explicit id wins, else look it up by title ────────────────────────────
if [ -z "${MAILER_KV_ID:-}" ]; then
  MAILER_KV_ID=$(cf "$API/storage/kv/namespaces?per_page=100" | python3 -c '
import json, sys
r = json.load(sys.stdin)
hits = [n["id"] for n in (r.get("result") or []) if n.get("title") == sys.argv[1]]
print(hits[0] if len(hits) == 1 else "")' "$KV_TITLE")
fi
[ -n "$MAILER_KV_ID" ] || { echo "  no KV namespace titled '$KV_TITLE' (create it first — see eno-mailer.README.md — or export MAILER_KV_ID)" >&2; exit 1; }

echo "  deploying $(basename "$SRC") ($(wc -c < "$SRC" | tr -d ' ') bytes, sha $( { shasum -a 256 "$SRC" 2>/dev/null || sha256sum "$SRC"; } | cut -c1-16 )) kv=$MAILER_KV_ID quota=$DAILY_QUOTA reserve=$PRIORITY_RESERVE/$SECURITY_RESERVE"

python3 - "$COMPAT" "$MAILER_KV_ID" "$DAILY_QUOTA" "$PRIORITY_RESERVE" "$SECURITY_RESERVE" > "$TMP/metadata.json" <<'PY'
import json, sys
compat, kv, quota, prio, sec = sys.argv[1:6]
for n in (quota, prio, sec):
    if not n.isdigit(): sys.exit("budget vars must be whole numbers")
if not (int(sec) <= int(prio) <= int(quota)): sys.exit("need SECURITY_RESERVE <= PRIORITY_RESERVE <= DAILY_QUOTA")
print(json.dumps({
    "main_module": "worker.js",
    "compatibility_date": compat,
    "compatibility_flags": [],
    "bindings": [
        # One binding per edition, each able to send ONLY from its own address. The Worker picks the
        # binding from the edition whose key verified; this list is the second guard.
        {"type": "send_email", "name": "EMAIL_VN", "allowed_sender_addresses": ["no-reply@eno.vn"]},
        {"type": "send_email", "name": "EMAIL_FORUM", "allowed_sender_addresses": ["no-reply@eno.forum"]},
        {"type": "kv_namespace", "name": "MAILER_KV", "namespace_id": kv},
        {"type": "plain_text", "name": "DAILY_QUOTA", "text": quota},
        {"type": "plain_text", "name": "PRIORITY_RESERVE", "text": prio},
        {"type": "plain_text", "name": "SECURITY_RESERVE", "text": sec},
    ],
    # MAILER_KEY_VN / MAILER_KEY_FORUM (and any *_OLD) survive the PUT. See the header.
    "keep_bindings": ["secret_text"],
    "observability": {"enabled": True, "head_sampling_rate": 1},
}))
PY

# `main_module` makes this a MODULE worker. The -F file is read from disk; the token from the conf.
resp=$(cf -X PUT "$API/workers/scripts/$NAME" \
  -F "metadata=@$TMP/metadata.json;type=application/json" \
  -F "worker.js=@$SRC;type=application/javascript+module")
check "$resp" "upload"
echo "  deployed: $(python3 -c 'import json,sys; r=json.loads(sys.argv[1])["result"]; print(r.get("id"), "modified", r.get("modified_on"))' "$resp")"

# ── workers.dev ON, preview/version URLs OFF ────────────────────────────────────────────────────
# ⛔ Previews OFF is a security setting, not tidiness: a version URL runs THAT version with ITS
# secrets, so after a key rotation an old version would keep accepting the rotated-out key.
resp=$(printf '%s' '{"enabled":true,"previews_enabled":false}' | cf -X POST "$API/workers/scripts/$NAME/subdomain" -H 'content-type: application/json' --data-binary @-)
check "$resp" "workers.dev subdomain"
echo "  workers.dev: enabled, previews disabled"

# ── Secrets present? (names only — values are write-only) ──────────────────────────────────────
names=$(cf "$API/workers/scripts/$NAME/secrets" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(" ".join(s.get("name","") for s in (r.get("result") or [])))')
missing=""
for s in MAILER_KEY_VN MAILER_KEY_FORUM; do
  case " $names " in *" $s "*) ;; *) missing="$missing $s" ;; esac
done
if [ -n "$missing" ]; then
  echo "  ⚠️  MISSING SECRETS:$missing — every request for that edition answers 401 until set" >&2
  echo "      (the Worker authenticates before it looks at config; Workers Logs say reason \"no_key\")." >&2
  echo "      Set each with '$0 set-secret NAME < keyfile' and put the SAME value in that edition's" >&2
  echo "      container env as MAILER_KEY — eno-mailer.README.md step 5 has the exact commands." >&2
else
  echo "  secrets: MAILER_KEY_VN MAILER_KEY_FORUM present"
fi
