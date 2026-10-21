#!/usr/bin/env bash
# In-app calls — install the Cloudflare Realtime TURN key on the VN box, for BOTH editions.
#
# Without typing a secret anywhere: copy the Key ID and run `pbpaste > ~/.eno-turn-id`, copy the API token and run
# `pbpaste > ~/.eno-turn-token`, then `bash infra/vn-node/apply-calls-relay.sh`. (CF_TURN_KEY_ID / CF_TURN_KEY_API_TOKEN
# in the environment work too.) The files are made 0600 and kept — the local end-to-end harness reads them
# (src/lib/calls/client/engine.harness.test.ts).
#
# The key comes from the Cloudflare dashboard: Realtime → TURN Server → Create (it shows the Key ID and the API token
# once). Design: ~/eno-calls-research-2026-10/DESIGN.md v3 §3.4–§3.5; code: src/lib/calls/server/relay.ts.
#
# ⚠️ IT TAKES EFFECT AT THE NEXT DEPLOY. This only writes the two lines into /opt/eno/secrets/eno-{vn,forum}.env;
# eno-deploy.sh recreates both app containers from those files. No container is restarted here — no downtime.
# ⚠️ THE KEY IS TESTED AGAINST CLOUDFLARE FIRST, from this machine: a 60-second credential is minted and revoked at
# once. A wrong key is refused before anything on the box changes.
# ⚠️ THE TOKEN NEVER APPEARS IN A COMMAND LINE (commit-gate review): curl reads its Authorization header from a 0600
# temp file, and the box receives both values on ssh's STDIN as %q-quoted assignments — not in `ps`, not in a remote
# shell string a quote character could break.
# ⚠️ CALLS STAY OFF until the runtime switch says otherwise (scripts/calls-mode.mjs). Installing the key turns nothing on.
set -euo pipefail
KEY="${ENO_SSH_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}"
HOST="${ENO_HOST:-root@162.4.176.233}"
PORT="${ENO_SSH_PORT:-24700}"

clean() { printf '%s' "$1" | tr -d '[:space:]' | sed -e "s/^['\"]//" -e "s/['\"]$//"; }
ID_FILE="${CF_TURN_KEY_ID_FILE:-$HOME/.eno-turn-id}"
TOK_FILE="${CF_TURN_KEY_API_TOKEN_FILE:-$HOME/.eno-turn-token}"
for f in "$ID_FILE" "$TOK_FILE"; do [ -f "$f" ] && chmod 600 "$f"; done
ID="$(clean "${CF_TURN_KEY_ID:-$( [ -f "$ID_FILE" ] && cat "$ID_FILE" )}")"
TOK="$(clean "${CF_TURN_KEY_API_TOKEN:-$( [ -f "$TOK_FILE" ] && cat "$TOK_FILE" )}")"
[ -n "$ID" ] && [ -n "$TOK" ] || { echo "CF_TURN_KEY_ID and CF_TURN_KEY_API_TOKEN are both required (Cloudflare → Realtime → TURN Server)"; exit 1; }
case "$ID" in *[!A-Za-z0-9]*) echo "the Key ID should be letters and digits only — check you copied the ID, not the token"; exit 1 ;; esac
[ "${#TOK}" -ge 20 ] || { echo "the API token is only ${#TOK} characters — too short; copy the whole token"; exit 1; }
[ "$ID" != "$TOK" ] || { echo "the Key ID and the token are the same value — one of them was pasted twice"; exit 1; }
case "$TOK" in *[!A-Za-z0-9._~+/=-]*) echo "the API token has characters a Cloudflare token never has — copy it again"; exit 1 ;; esac

HDR="$(mktemp)"; chmod 600 "$HDR"; trap 'rm -f "$HDR"' EXIT
printf 'Authorization: Bearer %s\n' "$TOK" > "$HDR"

echo "1/2 testing the key against Cloudflare (a 60 s credential, revoked at once)…"
RES="$(curl -s --max-time 15 -w '\n%{http_code}' -X POST \
  "https://rtc.live.cloudflare.com/v1/turn/keys/$ID/credentials/generate-ice-servers" \
  -H @"$HDR" -H 'Content-Type: application/json' --data '{"ttl":60}')"
CODE="${RES##*$'\n'}"
BODY="${RES%$'\n'*}"
if [ "$CODE" != "201" ] && [ "$CODE" != "200" ]; then
  echo "  ⛔ Cloudflare answered $CODE — the key or token is wrong (nothing on the box was changed)"; exit 1
fi
USER_HANDLE="$(printf '%s' "$BODY" | python3 -c 'import json,sys
d=json.load(sys.stdin)
print(next((s.get("username","") for s in d.get("iceServers",[]) if s.get("username")),""))' 2>/dev/null || true)"
[ -n "$USER_HANDLE" ] || { echo "  ⛔ Cloudflare answered without a TURN credential — check the key type (Realtime TURN)"; exit 1; }
RCODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST -H @"$HDR" \
  "https://rtc.live.cloudflare.com/v1/turn/keys/$ID/credentials/$USER_HANDLE/revoke" || true)"
[ "$RCODE" = "204" ] || [ "$RCODE" = "200" ] || echo "  note: revoking the 60 s test credential answered $RCODE — it expires on its own within a minute"
echo "  ✅ the key works"

echo "2/2 writing it into both editions' env on the box…"
{
  printf 'CF_TURN_KEY_ID=%q\nCF_TURN_KEY_API_TOKEN=%q\n' "$ID" "$TOK"
  cat <<'REMOTE'
set -euo pipefail
# ONE pass for BOTH files and BOTH keys (round-5 review): every new file is written to a sibling temp file, flushed,
# and given the original's mode AND owner first; only then are both renamed over their originals, back to back — a
# failure before the renames changes nothing. The one window left is between the two renames (no rename spans two
# files): the read-back below then says so, and running this again — it is idempotent — evens them out.
# The values travel in the ENVIRONMENT, never argv (`ps` shows arguments).
CF_TURN_KEY_ID="$CF_TURN_KEY_ID" CF_TURN_KEY_API_TOKEN="$CF_TURN_KEY_API_TOKEN" python3 - <<'PY'
import os, sys, tempfile
FILES = ['/opt/eno/secrets/eno-vn.env', '/opt/eno/secrets/eno-forum.env']
WANT = {k: os.environ[k] for k in ('CF_TURN_KEY_ID', 'CF_TURN_KEY_API_TOKEN')}
for p in FILES:
    if not os.path.isfile(p):
        print(f'  ⛔ {p} is missing — nothing was changed'); sys.exit(1)

def rewritten(text):
    lines = text.split('\n')
    seen = set()
    for i, l in enumerate(lines):
        for k, v in WANT.items():
            if l.startswith(k + '='):
                lines[i] = k + '=' + v
                seen.add(k)
    out = '\n'.join(lines)
    missing = [k for k in WANT if k not in seen]
    if missing:
        # A file without a final newline would glue the first new line onto its last variable.
        if out and not out.endswith('\n'):
            out += '\n'
        out += ''.join(k + '=' + WANT[k] + '\n' for k in missing)
    return out

staged = []
try:
    for p in FILES:
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p))
        staged.append((tmp, p))
        with os.fdopen(fd, 'w') as out:
            out.write(rewritten(open(p).read()))
            out.flush()
            os.fsync(out.fileno())
        st = os.stat(p)
        os.chmod(tmp, st.st_mode & 0o777)
        # The owner too, not only the mode (round-6 review): whoever reads the file at deploy must still be able to.
        os.chown(tmp, st.st_uid, st.st_gid)
except BaseException:
    for tmp, _ in staged:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    print('  ⛔ could not prepare the env files — nothing was changed')
    raise
for tmp, p in staged:
    os.replace(tmp, p)

# Read back: both files must now carry exactly these two values (compared here, never printed).
def values(p):
    got = {}
    for l in open(p).read().split('\n'):
        k, _, v = l.partition('=')
        if k in WANT:
            got[k] = v
    return got
bad = [p for p in FILES if values(p) != WANT]
if bad:
    print('  ⛔ ' + ', '.join(bad) + ' did not read back the new key — run this script again')
    sys.exit(1)
print('  ✅ both env files carry the key (it reaches the apps at the next deploy)')
PY
REMOTE
} | ssh -i "$KEY" -p "$PORT" -o IdentitiesOnly=yes -o BatchMode=yes "$HOST" 'bash -s'
