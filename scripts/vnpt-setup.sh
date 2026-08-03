#!/usr/bin/env bash
# ── vnpt-setup — guided entry of all five VNPT eKYC credentials ──────────────────────────────────
#
# One command, five hidden prompts, each labelled with EXACTLY which console field it comes from.
# Wraps scripts/secret-set.sh so every value still goes to .env.local + the Keychain-gated vault
# without ever appearing in the transcript, in argv, or in shell history.
#
#   ./scripts/vnpt-setup.sh
#
# ⚠️ RUN THIS IN A REAL TERMINAL (Terminal.app / iTerm), NOT THROUGH AN AGENT'S SHELL.
# The hidden prompt needs a TTY. Piped or non-interactive stdin means `read -s` either blocks
# forever or silently consumes whatever is on the pipe — and a secret read from a pipe you did not
# intend is exactly the corruption this whole design exists to avoid.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ⚠️ FAIL EARLY IF THERE IS NO TTY, rather than hanging on an invisible prompt with no explanation.
if [ ! -t 0 ]; then
  echo "✖ No terminal attached. Run this directly in Terminal.app or iTerm, not via an agent." >&2
  exit 2
fi

cat <<'EOF'

  VNPT eKYC credential setup
  ══════════════════════════
  Five values, from two tabs of Token Management in the VNPT console.
  Each prompt hides what you type — you will see NOTHING as you paste. That is correct.
  Paste, then press Enter.

EOF

# name | where to find it, verbatim from the console
FIELDS=(
  "VNPT_EKYC_TOKEN_ID|Bảo mật mức 1  →  'Token id'          (uuid, e.g. 58220bee-…)"
  "VNPT_EKYC_TOKEN_KEY|Bảo mật mức 1  →  'Token key'         (long base64, ends ==)"
  "VNPT_EKYC_PUBLIC_KEY|Bảo mật mức 1  →  'Public key CA'     (long base64, ends ==)"
  "VNPT_EKYC_CLIENT_ID|Bảo mật mức 2  →  your channel's Client ID  (starts idgv2-…)"
  "VNPT_EKYC_CLIENT_SECRET|Bảo mật mức 2  →  your channel's 'Client secret'"
)

i=1
for row in "${FIELDS[@]}"; do
  name="${row%%|*}"
  where="${row#*|}"
  printf '\n  [%d/5] %s\n        from: %s\n' "$i" "$name" "$where"
  # ⚠️ DELEGATE to secret-set.sh rather than reimplementing the write. One implementation of the
  # quoting/upsert/vault logic — a second copy here would drift, and the drift would be silent.
  "$ROOT/secret-set.sh" "$name"
  i=$((i + 1))
done

cat <<'EOF'

  ─────────────────────────────────────────────────────────────────
  All five stored locally. Verify with:

      grep -c VNPT_EKYC ~/eno.vn/.env.local     # expect 5
      ~/eno-vault/vault.sh list                  # expect the five names

  ⚠️ Nothing has been sent to production. eno-root-env is a separate,
     deliberate step — see scripts/secret-set.sh --prod.
  ⚠️ eno-services-env stays UNSET: eno.forum does not use VNPT.

EOF
