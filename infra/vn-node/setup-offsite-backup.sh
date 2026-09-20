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
HOST="${ENO_HOST:-root@162.4.176.233}"; PORT="${ENO_SSH_PORT:-24700}"
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

# ⛔ BIZFLY REQUIRES SIGNATURE V2 FOR WRITES, AND FAILS IN THE MOST MISLEADING WAY.
# Reads work fine on v4, so auth and listing both succeed — then every v4 PUT returns
# `ServiceUnavailable` with an EMPTY message, which reads like a provider outage rather
# than a signing problem. Diagnosed 2026-08-22 by trying variants: default, no-ACL,
# storage-class and forced-path-style all failed identically, and only --s3-v2-auth
# wrote a byte. Without this line the nightly backup reports success forever while
# nothing ever leaves the disk.
grep -q '^v2_auth' /root/.config/rclone/rclone.conf || \
  sed -i '/^acl = private/a v2_auth = true' /root/.config/rclone/rclone.conf

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
# ⛔ THREE SEPARATE THINGS MUST BE TRUE, AND EACH HAS ALREADY BEEN GOT WRONG ONCE.
# The first version compared the bucket's OBJECT COUNT before and after. That is a
# false NEGATIVE: eno-backup.sh uploads the new dump AND prunes to "newest 2" in the
# same run, so the count never moves and a working pipeline reported "nothing landed"
# (measured 2026-09-20, while the journal said "off-box copy ok").
# The second version asserted the newest LOCAL dump was present off-box. Two reviewers
# independently caught that this is a false POSITIVE, which is strictly worse: if the
# unit fails and writes no dump at all, `ls -t` falls back to a PREVIOUS run's dump,
# that dump is already in the bucket, and the guard prints ✅ over a broken pipeline.
# So: the unit must succeed, the dump must be from THIS run, and it must be in the bucket.
START=$(date +%s)
# ⚠️ `--wait` IS NOT REDUNDANT EVEN THOUGH THE UNIT IS `Type=oneshot` TODAY (verified on the box
# 2026-09-20: `systemctl start` blocked for 30s and `Result` read `success` immediately after).
# Two reviewers flagged that the diff cannot prove that, and they are right: the invariant lives in
# eno-backup.service, not here. Without it, changing that unit to `Type=simple` would make this
# block read the PREVIOUS run's Result and report a healthy pipeline as broken.
systemctl start --wait eno-backup.service
RESULT=$(systemctl show eno-backup.service -p Result --value)
echo "   backup result: $RESULT"
[ "$RESULT" = "success" ] || { echo "   ⛔ eno-backup.service did not succeed ($RESULT)"; exit 1; }

NEWEST=$(ls -t /opt/eno/backups/*.dump 2>/dev/null | head -1)
[ -n "$NEWEST" ] || { echo "   ⛔ no local dump was produced at all"; exit 1; }
# ⛔ THIS LINE IS THE FALSE-POSITIVE GUARD. Without it a stale dump satisfies everything below.
[ "$(stat -c %Y "$NEWEST")" -ge "$START" ] \
  || { echo "   ⛔ newest dump ($(basename "$NEWEST")) predates this run — the unit wrote nothing"; exit 1; }

NAME=$(basename "$NEWEST")
# ⚠️ `lsf`, NOT `ls` — AND THE BASENAME IS STRIPPED, WHICH THE FIRST VERSION OF THIS GOT WRONG.
# `rclone ls` prints "<size> <path>", so matching it needs a leading space. `lsf` drops the size
# but still prints the path RELATIVE TO THE REMOTE, so an object under a prefix reads
# "db/eno-….dump" and a bare `grep -qFx "$NAME"` would miss it — reintroducing the false negative
# in a new shape (a reviewer caught exactly this). Uploads land at the bucket root today
# (eno-backup.sh: `rclone copy "$OUT/eno-$STAMP.dump" "$ENO_BACKUP_REMOTE"`), so stripping any
# prefix costs nothing now and keeps this correct if that ever changes.
if rclone lsf --files-only -R "eno-offsite:$BUCKET" 2>/dev/null | sed 's#.*/##' | grep -qFx -- "$NAME"; then
  echo "   ✅ $NAME is genuinely off this disk"
else
  echo "   ⛔ $NAME never reached the bucket — the off-box branch did not run"; exit 1
fi
rclone lsf --files-only -R "eno-offsite:$BUCKET" | tail -3 | sed 's/^/     /'
REMOTE
} | ssh -i "$KEY" -p "$PORT" -o BatchMode=yes "$HOST" "BUCKET='$BUCKET' bash -s"
