#!/usr/bin/env bash
# ── secret-push-prod — merge named keys from .env.local into a GCP Secret Manager env blob ───────
#
#   ./scripts/secret-push-prod.sh VNPT_EKYC_TOKEN_ID VNPT_EKYC_TOKEN_KEY …
#   ./scripts/secret-push-prod.sh --vnpt          # the five VNPT keys, by name
#
# ⚠️ WHY THIS EXISTS INSTEAD OF THREE gcloud COMMANDS. `eno-root-env` is ONE blob containing the
# WHOLE environment. The obvious sequence — fetch, append, upload — has a failure mode that is
# catastrophic and silent: if the fetch is truncated or empty (network blip, expired auth, wrong
# project), the append still "succeeds" and you upload a near-empty env. The next Cloud Run revision
# then boots with most of its configuration missing. That is a total outage produced by a helper
# script, so every guard below exists to make that specific outcome impossible.
#
# ⚠️ ALLOWLIST, NEVER BULK-COPY. Only the key names given on the command line are pushed.
# .env.local legitimately contains LOCAL-ONLY values (LOCAL_AUTH=1, localhost URLs); copying it
# wholesale into production would turn auth off in prod, which is precisely the class of accident
# that a "just sync my env" script causes.
set -euo pipefail

SECRET_NAME="${SECRET_NAME:-eno-root-env}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"

VNPT_KEYS=(VNPT_EKYC_TOKEN_ID VNPT_EKYC_TOKEN_KEY VNPT_EKYC_PUBLIC_KEY VNPT_EKYC_CLIENT_ID VNPT_EKYC_CLIENT_SECRET)
if [ "${1:-}" = "--vnpt" ]; then KEYS=("${VNPT_KEYS[@]}"); else KEYS=("$@"); fi
[ ${#KEYS[@]} -gt 0 ] || { echo "usage: $0 <KEY> [KEY…]  |  $0 --vnpt" >&2; exit 2; }

for k in "${KEYS[@]}"; do
  case "$k" in *[!A-Za-z0-9_]*) echo "refusing: bad key name '$k'" >&2; exit 2 ;; esac
done

command -v gcloud >/dev/null || { echo "✖ gcloud not found" >&2; exit 2; }
[ -f "$ENV_FILE" ] || { echo "✖ $ENV_FILE not found — run scripts/vnpt-setup.sh first" >&2; exit 2; }

umask 077
WORK="$(mktemp -d "${TMPDIR:-/tmp}/.envpush.XXXXXXXX")"
cleanup() {
  # ⚠️ SHRED, NOT rm. These files hold the ENTIRE production environment in plaintext.
  find "$WORK" -type f -exec sh -c 'command -v shred >/dev/null && shred -u "$1" 2>/dev/null || rm -f "$1"' _ {} \; 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

CUR="$WORK/current.env"
NEW="$WORK/new.env"

# ⚠️ RECORD WHICH VERSION WE READ. Two operators pushing at once both fetch "latest", both edit
# their own copy, and the second upload silently discards the first one's keys (codex). Capturing
# the version and re-checking it immediately before the write turns a silent lost update into a
# refusal. Not a true compare-and-swap — Secret Manager offers none — but it closes the realistic
# window, which is minutes of human editing, not microseconds.
BASE_VERSION=$(gcloud secrets versions list "$SECRET_NAME" --limit=1 --format="value(name)" 2>/dev/null || echo "")
echo "  Fetching current $SECRET_NAME (version ${BASE_VERSION:-?}) …" >&2
if ! gcloud secrets versions access latest --secret="$SECRET_NAME" > "$CUR" 2>"$WORK/err"; then
  echo "✖ fetch failed — NOTHING was written:" >&2; sed 's/^/    /' "$WORK/err" >&2; exit 1
fi

# ── Guard 1: the fetch must look like a real environment ────────────────────────────────────────
# ⚠️ A SENTINEL, NOT JUST A LINE COUNT. An empty or truncated fetch can still have a few lines. The
# secret MUST contain a key we know is always there; if it does not, we are not looking at the file
# we think we are, and continuing would overwrite production with garbage.
OLD_LINES=$(grep -c '=' "$CUR" || true)
if [ "$OLD_LINES" -lt 10 ] || ! grep -qE '^(DATABASE_URL|NEXT_PUBLIC_APP_URL|DIRECT_URL)=' "$CUR"; then
  echo "✖ fetched blob does not look like a full environment ($OLD_LINES keys, no sentinel)." >&2
  echo "  Refusing to write. Check auth: gcloud auth list / gcloud config get project" >&2
  exit 1
fi
echo "  ✔ current version looks sane ($OLD_LINES keys)" >&2

# ── Build the new blob: upsert each named key from .env.local ────────────────────────────────────
cp "$CUR" "$NEW"
ADDED=(); UPDATED=(); MISSING=()
for k in "${KEYS[@]}"; do
  line=$(grep -m1 "^${k}=" "$ENV_FILE" || true)
  if [ -z "$line" ]; then MISSING+=("$k"); continue; fi
  # Strip the single quotes secret-set.sh adds for local shell safety. ⚠️ The Secret Manager blob is
  # read by the runtime as literal KEY=VALUE, so a stored value wrapped in quotes would arrive WITH
  # the quotes and fail auth in a way that looks like a wrong credential.
  val="${line#*=}"
  case "$val" in "'"*"'") val="${val#\'}"; val="${val%\'}" ;; esac
  # ⚠️ UNDO THE SHELL ESCAPE TOO. secret-set.sh stores an embedded quote as '\'' so the local file
  # stays shell-safe; stripping only the OUTER quotes would ship those four characters to
  # production as part of the credential (codex, agy). Secret Manager values are literal.
  val=$(printf '%s' "$val" | sed "s/'\\\\''/'/g")
  if grep -q "^${k}=" "$NEW"; then
    grep -v "^${k}=" "$NEW" > "$NEW.tmp" && mv "$NEW.tmp" "$NEW"
    UPDATED+=("$k")
  else
    ADDED+=("$k")
  fi
  printf '%s=%s\n' "$k" "$val" >> "$NEW"
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "✖ not found in .env.local: ${MISSING[*]}" >&2
  echo "  Run ./scripts/vnpt-setup.sh first. Nothing written." >&2
  exit 1
fi

NEW_LINES=$(grep -c '=' "$NEW" || true)

# ── Guard 2: never shrink ───────────────────────────────────────────────────────────────────────
# ⚠️ THE OUTAGE GUARD. Whatever else went wrong, an upload with FEWER keys than we fetched means we
# are about to delete production configuration. There is no legitimate path through this script that
# reduces the key count, so a shrink is proof of a bug and must abort.
if [ "$NEW_LINES" -lt "$OLD_LINES" ]; then
  echo "✖ new blob is SMALLER than current ($NEW_LINES < $OLD_LINES). Aborting — this would delete config." >&2
  exit 1
fi

# ── Confirm, showing NAMES and COUNTS only — never values ───────────────────────────────────────
cat >&2 <<EOF

  Secret : $SECRET_NAME
  Keys   : $OLD_LINES → $NEW_LINES
  Added  : ${ADDED[*]:-none}
  Updated: ${UPDATED[*]:-none}

EOF
if [ ! -t 0 ]; then echo "✖ needs a terminal to confirm. Run in Terminal.app." >&2; exit 2; fi
printf '  Type "push" to write a new version: ' >&2
read -r ANSWER
[ "$ANSWER" = "push" ] || { echo "  aborted — nothing written." >&2; exit 1; }

NOW_VERSION=$(gcloud secrets versions list "$SECRET_NAME" --limit=1 --format="value(name)" 2>/dev/null || echo "")
if [ -n "$BASE_VERSION" ] && [ "$NOW_VERSION" != "$BASE_VERSION" ]; then
  echo "✖ $SECRET_NAME changed while you were editing (v$BASE_VERSION → v$NOW_VERSION)." >&2
  echo "  Someone else pushed. Re-run so your keys merge onto THEIR version instead of erasing it." >&2
  exit 1
fi
gcloud secrets versions add "$SECRET_NAME" --data-file="$NEW" >/dev/null
echo "  ✔ new version added" >&2

# ── Guard 3: verify what actually landed ────────────────────────────────────────────────────────
# ⚠️ READ IT BACK. "The command exited 0" is not evidence the right bytes are stored, and this repo
# has been bitten before by a green command masking a broken result.
VERIFY="$WORK/verify.env"
gcloud secrets versions access latest --secret="$SECRET_NAME" > "$VERIFY"
VLINES=$(grep -c '=' "$VERIFY" || true)
FAIL=0
for k in "${KEYS[@]}"; do grep -q "^${k}=" "$VERIFY" || { echo "  ✖ $k MISSING after write" >&2; FAIL=1; }; done
[ "$VLINES" -eq "$NEW_LINES" ] || { echo "  ✖ key count mismatch: expected $NEW_LINES, stored $VLINES" >&2; FAIL=1; }
[ "$FAIL" -eq 0 ] && echo "  ✔ verified: $VLINES keys, all requested keys present" >&2

cat >&2 <<'EOF'

  ⚠️ NOT LIVE YET. Cloud Run reads the secret at REVISION START, so the running
     revision still has the old environment. A new deploy is required — and per the
     standing rule, that is the owner's call, not something this script does.
EOF
