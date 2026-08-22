#!/usr/bin/env bash
# Finish off-box backups once a Bizfly Simple Storage key pair exists.
#
#   BIZFLY_KEY=... BIZFLY_SECRET=... bash setup-offsite-backup.sh [bucket]
#
# ⛔ WHY THIS MATTERS MORE AFTER CUTOVER THAN BEFORE. Today the box holds a COPY:
# production still serves from Cloud Run and hosted Supabase, so losing this disk
# loses a snapshot. The moment DNS moves, this disk becomes the ONLY copy of the
# database, 250 storage objects of user media, and the backups themselves. Do this
# BEFORE the A records move, not after.
set -euo pipefail
KEY="${ENO_SSH_KEY:-$HOME/Desktop/eno.vn server/CS-Linux-20260821173657299.pem}"
HOST="${ENO_HOST:-root@162.4.176.208}"; PORT="${ENO_SSH_PORT:-24700}"
# Bucket `eno` at https://eno.hcm.ss.bfcplatform.vn, verified 2026-08-22: an
# unauthenticated GET returns AccessDenied naming BucketName=eno (a bucket that does
# NOT exist returns NoSuchBucket instead — checked, so this is existence and not a
# guess). Both virtual-hosted and path addressing answer, so rclone's default
# path-style needs no force_path_style override.
BUCKET="${1:-eno}"
: "${BIZFLY_KEY:?set BIZFLY_KEY}"; : "${BIZFLY_SECRET:?set BIZFLY_SECRET}"

# ⛔ THE SECRETS GO OVER STDIN, NEVER IN THE SSH COMMAND STRING. An ssh remote command
# is argv on this machine and shows in `ps` to every local user — the same exposure
# this script's own header warns about, and which it originally committed anyway.
# Only the bucket name, which is not a secret, travels as an argument.
# ⚠️ THE DELIMITER STAYS QUOTED. Unquoting it to interpolate the secrets expands the
# WHOLE remote script locally — $BUCKET, $C, $T, every loop variable — which silently
# ships a broken script. The secrets are prepended to stdin instead: printf expands
# here, the heredoc stays literal.
{
  printf 'BIZFLY_KEY=%q\nBIZFLY_SECRET=%q\n' "$BIZFLY_KEY" "$BIZFLY_SECRET"
  cat <<'REMOTE'
set -euo pipefail
C=/root/.config/rclone/rclone.conf
sed -i "s|^access_key_id =.*|access_key_id = $BIZFLY_KEY|;s|^secret_access_key =.*|secret_access_key = $BIZFLY_SECRET|" "$C"
chmod 600 "$C"

# ⛔ PROVE EVERY STEP. The off-box branch of eno-backup.sh has never once executed and
# this provider has never been tested with live keys, so nothing here is assumed.
echo "1. can we authenticate?"
rclone lsd eno-offsite: >/dev/null 2>&1 && echo "   ok" || { echo "   ⛔ auth failed — check the keys"; exit 1; }

echo "2. bucket exists (creating if not)"
rclone mkdir "eno-offsite:$BUCKET" 2>/dev/null || true
rclone lsd eno-offsite: | grep -q " $BUCKET$" && echo "   ok: $BUCKET" || { echo "   ⛔ bucket missing"; exit 1; }

echo "3. round-trip a canary — write, read back, compare, delete"
T=$(mktemp); head -c 4096 /dev/urandom > "$T"
rclone copyto "$T" "eno-offsite:$BUCKET/.canary" >/dev/null
R=$(mktemp); rclone copyto "eno-offsite:$BUCKET/.canary" "$R" >/dev/null
cmp -s "$T" "$R" && echo "   ok: bytes match" || { echo "   ⛔ round-trip MISMATCH"; exit 1; }
rclone delete "eno-offsite:$BUCKET/.canary" >/dev/null; rm -f "$T" "$R"

echo "4. wire it into the nightly backup"
install -d -m 0755 /etc/default
grep -q '^ENO_BACKUP_REMOTE=' /etc/default/eno-backup 2>/dev/null \
  && sed -i "s|^ENO_BACKUP_REMOTE=.*|ENO_BACKUP_REMOTE=eno-offsite:$BUCKET|" /etc/default/eno-backup \
  || echo "ENO_BACKUP_REMOTE=eno-offsite:$BUCKET" >> /etc/default/eno-backup
grep -q 'EnvironmentFile=/etc/default/eno-backup' /etc/systemd/system/eno-backup.service 2>/dev/null \
  || sed -i '/^\[Service\]/a EnvironmentFile=-/etc/default/eno-backup' /etc/systemd/system/eno-backup.service
systemctl daemon-reload

echo "5. run a REAL backup and confirm the dump lands off-box"
before=$(rclone ls "eno-offsite:$BUCKET" 2>/dev/null | wc -l)
systemctl start eno-backup.service
sleep 5
systemctl show eno-backup.service -p Result --value | sed 's/^/   backup result: /'
after=$(rclone ls "eno-offsite:$BUCKET" 2>/dev/null | wc -l)
echo "   objects off-box: $before -> $after"
[ "$after" -gt "$before" ] && echo "   ✅ a dump is genuinely off this disk" \
  || { echo "   ⛔ nothing landed — the off-box branch did not run"; exit 1; }
rclone ls "eno-offsite:$BUCKET" | tail -3 | sed 's/^/     /'
REMOTE
} | ssh -i "$KEY" -p "$PORT" -o BatchMode=yes "$HOST" "BUCKET='$BUCKET' bash -s"
