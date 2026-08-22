#!/usr/bin/env bash
# Save Bizfly Simple Storage keys to the vault, then wire off-box backups and prove
# they work.
#
#   bash infra/vn-node/save-bizfly-keys.sh
#
# Prompts for the two values. ⛔ IT DOES NOT TAKE THEM AS ARGUMENTS: argv is
# world-readable in `ps`, which is the same mistake that put a Google client secret
# on display earlier in this migration. Reading them prompted keeps them out of the
# process table, out of your shell history, and out of any transcript.
set -euo pipefail
cd "$(dirname "$0")/../.."
VAULT="$HOME/eno-vault/vault.sh"
[ -x "$VAULT" ] || { echo "no vault at $VAULT"; exit 1; }

read -rsp "Bizfly ACCESS KEY:    " K; echo
read -rsp "Bizfly SECRET KEY:    " S; echo
read -rp  "Bucket [eno]: " B; B="${B:-eno}"
[ -n "$K" ] && [ -n "$S" ] || { echo "both values are required"; exit 1; }

# 1. Durable copy FIRST. If the box is rebuilt, or the disk this all lives on dies,
#    the keys must not die with it — which is the entire point of the exercise.
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
chmod 600 "$TMP"
printf 'BIZFLY_ACCESS_KEY=%s\nBIZFLY_SECRET_KEY=%s\nBIZFLY_ENDPOINT=https://hcm.ss.bfcplatform.vn\nBIZFLY_BUCKET=%s\n' "$K" "$S" "$B" > "$TMP"
"$VAULT" put bizfly-object-storage "$TMP"
echo "saved to the vault as 'bizfly-object-storage' (click Allow on the Keychain prompt)"

# 2. Then configure the box and PROVE it — auth, bucket, byte-exact round trip, and a
#    real backup landing off-disk. Nothing is assumed: this provider has never been
#    tested with live keys and eno-backup.sh's off-box branch has never executed.
BIZFLY_KEY="$K" BIZFLY_SECRET="$S" bash infra/vn-node/setup-offsite-backup.sh "$B"

echo
echo "⚠️  Now confirm the vault copy is readable, because a write you cannot read back"
echo "    is not a backup of anything:"
echo "      ~/eno-vault/vault.sh get bizfly-object-storage | head -1"
