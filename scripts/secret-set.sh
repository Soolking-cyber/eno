#!/usr/bin/env bash
# ── secret-set — put a secret into local + prod storage without it ever being visible ────────────
#
# Owner, 2026-08-03: "i tell you now secret coming and you blindly save it to secure place".
# The intent is right; the mechanism had to change. A secret PASTED INTO A CHAT is already written
# to ~/.claude/projects/**/*.jsonl in plaintext before anything can act on it — so "save it blindly"
# protects nothing, because the exposure already happened at the paste. This script is the version
# that actually works: the value is typed into a hidden prompt on this machine and goes straight to
# storage, never crossing the transcript, the shell history, or a log.
#
#   ./scripts/secret-set.sh VNPT_EKYC_CLIENT_SECRET            # → .env.local + vault
#   ./scripts/secret-set.sh VNPT_EKYC_CLIENT_SECRET --prod     # → also queue for eno-root-env
#
# ⚠️ THE VALUE IS NEVER AN ARGUMENT. Only the NAME is. A secret passed as argv lands in shell
# history AND is world-readable in `ps` output for the lifetime of the process — on a shared or
# compromised machine that is a full disclosure, and it is the single most common way secrets leak
# from "secure" tooling.
set -euo pipefail

NAME="${1:-}"
PROD="${2:-}"
[ -n "$NAME" ] || { echo "usage: $0 <ENV_VAR_NAME> [--prod]" >&2; exit 2; }
case "$NAME" in
  # Defensive: a name with shell metacharacters would be interpolated into sed/grep below.
  *[!A-Za-z0-9_]*) echo "refusing: name must be [A-Za-z0-9_] only" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"

# ⚠️ REQUIRE A TTY, OR FAIL IMMEDIATELY. Without this the script HANGS on an invisible prompt when
# run through an agent shell or any non-interactive context — which is exactly what happened
# 2026-08-03: the prompt printed, `read -s` blocked on stdin that could never arrive, and the only
# symptom was a frozen terminal with no explanation. Worse than hanging is the alternative: reading
# whatever happens to be on a pipe and silently storing the wrong value as a credential.
# ⚠️ The one legitimate non-TTY caller is the test suite, which pipes a known value in deliberately.
if [ ! -t 0 ] && [ "${SECRET_SET_ALLOW_PIPE:-}" != "1" ]; then
  cat >&2 <<'MSG'
✖ No terminal attached — refusing to read a secret from a pipe.

  Run this in Terminal.app or iTerm, NOT through an agent shell or the `!` prefix:

      cd ~/eno.vn && ./scripts/secret-set.sh <NAME>

  (Set SECRET_SET_ALLOW_PIPE=1 only for automated tests with throwaway values.)
MSG
  exit 2
fi

# ⚠️ mktemp, NOT A FIXED PATH — a predictable /tmp name can be pre-created as a symlink by another
# local user, redirecting the write. And umask 077 so the file is 600 from the instant it exists.
umask 077
TMP="$(mktemp "${TMPDIR:-/tmp}/.secret.XXXXXXXX")"
# ⚠️ TRAP ON EVERY EXIT PATH, INCLUDING Ctrl-C. Without INT/TERM here, interrupting at the prompt
# leaves the plaintext on disk — the exact failure this script exists to prevent.
# ⚠️ SHRED EVERY TEMP, NOT JUST $TMP. The upsert below writes a filtered copy of the WHOLE
# .env.local to "$TMP.env" — every other secret in the file — and the original trap only cleaned
# "$TMP", leaving that copy in /tmp indefinitely. agy caught it. A tool that exists to protect one
# secret must not strand all the others.
cleanup() {
  for f in "$TMP" "$TMP.env"; do
    [ -f "$f" ] && { command -v shred >/dev/null && shred -u "$f" 2>/dev/null || rm -f "$f"; }
  done
  return 0
}
trap cleanup EXIT INT TERM

printf 'Paste value for %s (input hidden, nothing is echoed): ' "$NAME" >&2
# -r so backslashes survive verbatim; -s so nothing is displayed.
IFS= read -rs VALUE
echo >&2
[ -n "$VALUE" ] || { echo "empty — nothing written." >&2; exit 1; }

printf '%s' "$VALUE" > "$TMP"

# ── 1. .env.local (gitignored; .gitignore:59 `.env*`) ───────────────────────────────────────────
# ⚠️ UPSERT, NEVER APPEND. A duplicate key in a .env file resolves to whichever line the parser
# happens to read last — so a blind append leaves the OLD value winning on some loaders and the new
# one on others, which is the worst possible outcome: it works on your machine and not in the build.
touch "$ENV_FILE"
# ⚠️ GUARANTEE A TRAILING NEWLINE BEFORE APPENDING (agy). Without one, the new KEY=VALUE is glued
# onto the end of the previous line, silently corrupting BOTH entries — and .env parsers do not
# complain, they just hand back a wrong value.
[ -s "$ENV_FILE" ] && [ "$(tail -c1 "$ENV_FILE" | wc -l)" -eq 0 ] && printf '\n' >> "$ENV_FILE"
# ⚠️ SINGLE-QUOTE THE VALUE. VNPT's secret contains '@'; others contain '$' or '#', each of which is
# interpolated or treated as a comment by some loaders. Embedded single quotes are escaped '\'' .
ESCAPED=$(printf '%s' "$VALUE" | sed "s/'/'\\\\''/g")
if grep -q "^${NAME}=" "$ENV_FILE" 2>/dev/null; then
  # A temp file rather than sed -i: the value can contain any character, including sed delimiters.
  grep -v "^${NAME}=" "$ENV_FILE" > "${TMP}.env" && mv "${TMP}.env" "$ENV_FILE"
  ACTION="updated"
else
  ACTION="added"
fi
printf "%s='%s'\n" "$NAME" "$ESCAPED" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "  ✔ ${ACTION} in .env.local" >&2

# ── 2. eno-vault (Keychain-gated, encrypted at rest) ────────────────────────────────────────────
# The durable copy. .env.local is convenience; this is the backup that survives a working-tree wipe.
if [ -x "$HOME/eno-vault/vault.sh" ]; then
  if "$HOME/eno-vault/vault.sh" put "$NAME" "$TMP" >/dev/null 2>&1; then
    echo "  ✔ stored in eno-vault (Keychain-gated)" >&2
  else
    echo "  ⚠️  vault write failed or was denied — .env.local still holds it" >&2
  fi
else
  echo "  ⚠️  ~/eno-vault/vault.sh not found — skipped the encrypted store" >&2
fi

# ── 3. Production (GCP Secret Manager) ──────────────────────────────────────────────────────────
# ⚠️ NOT AUTOMATED, AND DELIBERATELY SO. `eno-root-env` is ONE blob holding the whole environment,
# so adding a key means fetch → edit → add-version. Scripting that unattended risks writing a
# TRUNCATED env — if the fetch half-fails and the script uploads anyway, the next Cloud Run
# revision boots with most of its configuration missing. That is a total outage from a helper
# script, so this only prints the commands and lets a human watch each one.
if [ "$PROD" = "--prod" ]; then
  cat >&2 <<'EOF'

  For production, use the dedicated script — it fetches, sanity-checks, merges only the
  named keys, refuses to shrink the blob, and reads the result back to verify:

      ./scripts/secret-push-prod.sh <KEY> [KEY...]      # or --vnpt for all five

  ⚠️ eno-root-env ONLY. eno.forum does not use VNPT (docs/compliance-2026.md §0.1),
     so eno-services-env stays unset — that is correct, not an omission.
EOF
fi

echo "  done. The value was never printed, never in argv, never in shell history." >&2
