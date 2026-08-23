#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Put a Cloudflare cache-purge token on the box so eno-deploy.sh purges by itself.
#
#   pbpaste | bash infra/vn-node/install-cf-token.sh      # macOS
#   bash infra/vn-node/install-cf-token.sh < token.txt
#
# ⛔ THE TOKEN ARRIVES ON STDIN, NEVER AS AN ARGUMENT. An ssh remote command is argv
# on the box: it shows in `ps` to every local user and lands in root's shell history.
# This project has already shipped that mistake once — setup-offsite-backup.sh went
# out with the Bizfly keys in argv, in a script whose own header warned against it.
#
# ⛔ MAKE THE TOKEN PURGE-ONLY. In the Cloudflare dashboard:
#     My Profile → API Tokens → Create Token → Custom token
#     Permissions: Zone · Cache Purge · Purge
#     Zone Resources: Include → Specific zone → eno.vn   (then Add → eno.forum)
#   Nothing else. A token that can only empty a cache is worth very little to an
#   attacker; a Zone:Edit or Global API Key on a box that faces the internet is worth
#   a great deal, and the difference costs nothing to choose correctly.
set -uo pipefail
KEY="${ENO_SSH_KEY:-$HOME/Desktop/eno.vn server/CS-Linux-20260821173657299.pem}"
HOST="${ENO_HOST:-root@162.4.176.208}"; PORT="${ENO_SSH_PORT:-24700}"
ZONES=(55e558b62f68a44f8177d7d98cb5369e cc81e3ff1d792c0aa5384e8feab21efa)  # eno.vn, eno.forum

TOKEN="$(cat)"; TOKEN="${TOKEN//[$'\t\r\n ']}"
[ -n "$TOKEN" ] || { echo "✗ nothing on stdin"; exit 1; }

# ⚠️ CHECK THE SHAPE BEFORE THE NETWORK, AND NEVER PRINT THE VALUE. Cloudflare answers a
# malformed token with the same "Authentication error" it gives a real token that lacks a
# permission, so the API cannot tell you which mistake you made. Two happen constantly:
# pasting the token ID (32 hex, shown in the token LIST) instead of the value, and pasting
# whatever landed on the clipboard since — copying the error message to share it overwrites
# the token, which is how this failed the first time it was run.
# ⛔ The value is shown ONCE, at creation. If it is gone, Roll the token; you cannot read it back.
if ! printf '%s' "$TOKEN" | grep -qE '^[A-Za-z0-9_-]{30,60}$'; then
  echo "✗ that does not look like a Cloudflare API token."
  echo "  got: ${#TOKEN} characters, starting with '$(printf '%s' "$TOKEN" | cut -c1)'"
  echo "  expected: ~40 characters of [A-Za-z0-9_-]"
  if printf '%s' "$TOKEN" | grep -qE '^[0-9a-f]{32}$'; then
    echo "  ⛔ that is the token ID, not the token VALUE. The ID is shown in the token list and"
    echo "     cannot authenticate. The value appears ONCE when you create the token."
  else
    echo "  ⛔ likely the clipboard changed — copying anything else replaces the token."
    echo "     Safer: paste the token into a file, then:  bash $0 < /path/to/token.txt"
  fi
  exit 1
fi

# ⛔ PROVE IT BEFORE STORING IT. A token that cannot purge is worse than no token: the
# deploy would report a successful purge path and visitors would keep the old page for
# six hours, which is precisely the silent-success failure this whole deploy path was
# rebuilt to eliminate. Verify against BOTH zones — a token scoped to one is a trap
# that works in testing and half-fails in production.
echo "verifying the token can actually purge, on both zones…"
for Z in "${ZONES[@]}"; do
  OUT=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$Z/purge_cache" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data '{"purge_everything":true}' 2>&1)
  if printf '%s' "$OUT" | grep -q '"success":[[:space:]]*true'; then
    echo "  ok   $Z"
  else
    echo "  ✗    $Z — $(printf '%s' "$OUT" | head -c 200)"
    echo "REFUSING to install a token that cannot purge both zones."
    exit 1
  fi
done

# ⚠️ Written by the REMOTE shell reading stdin, so the value never appears in argv on
# either machine. 0600 and root-owned: the app containers do not need it and must not
# get it — this token is for the deploy, not for the running site.
printf '%s' "$TOKEN" | ssh -i "$KEY" -p "$PORT" -o BatchMode=yes "$HOST" \
  'install -d -m 700 /opt/eno/secrets && umask 077 && cat > /opt/eno/secrets/cf-token && chmod 600 /opt/eno/secrets/cf-token && echo "  installed $(wc -c < /opt/eno/secrets/cf-token) bytes at /opt/eno/secrets/cf-token"'

echo "✅ done — eno-deploy.sh will now purge automatically. --skip-purge remains for the rare deliberate case."
