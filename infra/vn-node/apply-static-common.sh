#!/usr/bin/env bash
# Put nginx/static-common.conf and its parity test on the box and prove them, with the deploy lock held. From the Mac:
#   bash infra/vn-node/apply-static-common.sh
# The previous snippet comes back by itself if the boundary check, nginx, the direct Brotli question or the parity test says no.
# ENO_SSH_KEY=… points at the box key. Safe to run again.
#
# ⛔ WHY IT ASKS NGINX INSTEAD OF TRUSTING THE RELOAD (2026-11-02): `disable_symlinks … from=$document_root` made brotli_static
# decline without a word in any log, so a clean reload still served .gz (static-common.conf has the measurement).
#
# AFTER IT: the edge still holds every already-seen chunk at Cloudflare's own quality, for up to a year (immutable). Verify bytes
# through Cloudflare on a fresh cache key, then purge Cache-Tag `eno-static` once on both zones. Retained builds stay on disk
# (eno-static-sync.sh: 30 days and the 10 newest), so the purge costs one re-fetch per file.
set -euo pipefail
KEY=${ENO_SSH_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}
H=root@162.4.176.233; P=24700
here=$(cd "$(dirname "$0")" && pwd)
SSH=(ssh -o IdentitiesOnly=yes -i "$KEY" -p "$P" "$H")
D=$("${SSH[@]}" 'mktemp -d /root/eno-static-common.XXXXXX')   # root's, 0700: nothing else on the box can swap these files
scp -q -o IdentitiesOnly=yes -i "$KEY" -P "$P" "$here/nginx/static-common.conf" "$here/nginx/static-parity-test.sh" "$H:$D/"
rc=0
"${SSH[@]}" "timeout 300 flock -n -E 75 /var/lock/eno-deploy.lock bash -s -- $D" <<'REMOTE' || rc=$?
set -euo pipefail
D=$1
SNIP=/etc/nginx/snippets/eno-static-common.conf
PREV=$D/previous.conf
cp -p "$SNIP" "$PREV"   # set -e: without this copy nothing below runs

# ON EVERY WAY OUT: a failed command under set -e, the timeout, or a dropped connection cannot leave an unproven snippet live.
proven=0
leave() {
  rc=$?; trap - EXIT
  [ "$proven" = 1 ] && exit 0
  [ "$rc" != 0 ] || rc=1   # stopping short (a child ate the script on stdin) is never a success
  if install -m 0644 "$PREV" "$SNIP" && nginx -t > "$D/restore.log" 2>&1 && systemctl reload nginx; then echo "previous snippet restored"
  else echo "⛔ RESTORE FAILED: nginx may hold the new snippet; the previous one is $PREV (see $D/restore.log)"; fi
  echo "STATIC-COMMON EXIT $rc"; exit "$rc"
}
trap leave EXIT
trap 'exit 143' TERM HUP INT PIPE
fail() { echo "FAILED: $2"; exit "$1"; }

install -m 0644 "$D/static-common.conf" "$SNIP" || fail 2 "install"
/opt/eno/bin/check-static-boundary.sh > /dev/null || fail 2 "boundary check"
nginx -t || fail 2 "nginx -t"
systemctl reload nginx || fail 2 "reload"
sleep 2   # reload only signals: the old workers can still answer for a moment

# Asked as Cloudflare asks, per edition. The answer must be the .br itself, byte for byte, and that .br must decode to the file.
for pair in marketplace:eno.vn services:www.eno.forum; do
  e=${pair%%:*}; host=${pair#*:}
  f=$(find "/var/www/eno-static/$e/_next/static/chunks" -name '*.js' -size +20k -print -quit)
  [ -n "$f" ] || fail 3 "$e: no chunk to ask about"
  u=${f#/var/www/eno-static/$e}
  ce=$(curl -gs -o "$D/answer" -D - -H "Host: $host" -H 'Accept-Encoding: gzip, br' "http://127.0.0.1:8181$u" | tr -d '\r' | grep -i '^content-encoding:' | tr 'A-Z' 'a-z') || true
  echo "$host $u: ${ce:-no content-encoding}, $(stat -c %s "$D/answer") bytes (.br on disk: $(stat -c %s "$f.br"))"
  [ "$ce" = "content-encoding: br" ] && cmp -s "$D/answer" "$f.br" || fail 3 "$host did not answer with the .br"
  brotli -dc "$f.br" | cmp -s - "$f" || fail 3 "$u: its .br does not decode to the file"
done

parity=0
(cd /opt/eno/bin && bash -s) < "$D/static-parity-test.sh" > "$D/parity.out" 2>&1 || parity=$?
echo "parity test: exit $parity, $(grep -c '^PARITY' "$D/parity.out" || true) parity lines, $(grep -c '^FAIL' "$D/parity.out" || true) failures"
grep '^FAIL' "$D/parity.out" | head -8 || true
[ "$parity" = 0 ] || fail 4 "parity test, full output $D/parity.out"

install -m 0755 "$D/static-parity-test.sh" /opt/eno/bin/static-parity-test.sh
proven=1
echo "previous snippet kept at $PREV"
echo "STATIC-COMMON EXIT 0"
REMOTE
if [ "$rc" = 75 ]; then "${SSH[@]}" "rm -rf -- $D"; echo "a deploy holds the lock: nothing changed, run this again after it"; fi
exit "$rc"
