#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · install the 400-day nginx log retention policy on the origin box.
#
#   bash /opt/eno/app/infra/vn-node/install-logrotate.sh          # install + verify
#   bash /opt/eno/app/infra/vn-node/install-logrotate.sh --check  # verify only, change nothing
#
# Installs infra/vn-node/nginx/logrotate-nginx.conf as /etc/logrotate.d/eno-nginx, BESIDE the nginx
# package's own /etc/logrotate.d/nginx, which it never touches. Read that policy file for why: the
# package file is a dpkg conffile, and editing it would make unattended-upgrades hold nginx security
# updates back; `ignoreduplicates` on the eno stanza is what lets the two coexist.
# The 12-month figure is per counsel review, PENDING LAWYER CONFIRMATION, of Decree 333/2026/ND-CP
# Art. 20(3) (system logs >= 12 months) — source, LuatVietnam's English translation, Art 20:
#   https://english.luatvietnam.vn/decree-no-333-2026-nd-cp-dated-august-19-2026-of-the-government-detailing-a-number-of-articles-and-measures-for-implementation-of-the-law-on-cyberse-445089-doc1.html
#
# ⛔ STRICT, AND MEANT TO BE: every check that fails makes it exit 1, including an `error:` logrotate
# reports for a file that is not ours. Such an error does not stop the eno stanza (measured with
# logrotate 3.21.0: a broken file beside it left every nginx log under 'rotate 400'), but it is a
# defect in the box's rotation, and many (a log that is missing without `missingok`, for one) make
# the daily run exit non-zero — logrotate.service then fails every day, and that red buries any
# later real failure, eno's included.
# bootstrap.sh runs it LAST in its step 6 and reports a failure loudly without aborting — a log
# policy must never stand between a new box and its security updates — but run on its own, a
# non-zero exit is the answer.
#
# ⚠️ IDEMPOTENT: re-running with the same policy changes nothing and says so.
#
# ⚠️ IT VERIFIES, NOT JUST COPIES. A logrotate policy that does not apply fails silently — the
# logs simply vanish after 14 days as before — so after installing it checks: logrotate is new
# enough for `ignoreduplicates`; the whole configuration parses with no error; in logrotate's OWN
# dry run, every /var/log/nginx/*.log on disk is rotated under THIS policy's count (not the
# package's 14, not anyone else's); every access_log/error_log nginx actually uses is under the
# policy's glob; something runs logrotate daily. Any of those failing exits 1. It also warns (does
# not fail) when the package's conffile is no longer byte-identical to what dpkg installed.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
export LC_ALL=C LANG=C

HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/nginx/logrotate-nginx.conf"
DEST=/etc/logrotate.d/eno-nginx
PKG_FILE=/etc/logrotate.d/nginx
LOG_DIR=/var/log/nginx   # the policy's glob is $LOG_DIR/*.log
MIN_LOGROTATE=3.21.0     # first release with `ignoreduplicates` (logrotate ChangeLog, 3.21.0)
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

say(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok(){  printf '  \033[32m[ok]\033[0m %s\n' "$*"; }
bad(){ printf '  \033[31m[XX]\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m[!!]\033[0m %s\n' "$*"; }
FAIL=0

[ "$(id -u)" -eq 0 ] || { bad "run as root"; exit 1; }
[ -f "$SRC" ] || { bad "policy not found at $SRC — run this from the repo checkout (infra/vn-node/)"; exit 1; }
command -v logrotate >/dev/null 2>&1 || { bad "logrotate is not installed (apt-get install logrotate)"; exit 1; }
# The count the policy promises, read from the policy, so the dry-run check below cannot drift from it.
WANT=$(sed -n 's/^[[:space:]]*rotate[[:space:]][[:space:]]*\([0-9][0-9]*\)[[:space:]]*$/\1/p' "$SRC" | head -1)
[ -n "$WANT" ] || { bad "could not read a 'rotate N' line from $SRC"; exit 1; }
# ⚠️ THE FILE NAME IS LOAD-BEARING: logrotate reads /etc/logrotate.d in sorted order and the FIRST
# stanza to claim a file keeps it. Refuse a DEST that would sort after the package's file.
if [ "$(printf '%s\n%s\n' "$(basename "$DEST")" "$(basename "$PKG_FILE")" | sort | head -1)" != "$(basename "$DEST")" ]; then
  bad "$DEST must sort before $PKG_FILE, or the package's 14-day stanza claims the logs first"; exit 1
fi

say "1. which nginx"
# ⛔ THE POSTROTATE IN THE POLICY SIGNALS A HOST nginx (invoke-rc.d → USR1 to /run/nginx.pid). If
# nginx were ever moved into a container, that hook would reopen nothing and every rotated file
# would keep receiving writes until it was compressed and deleted — so refuse rather than install a
# policy whose reopen step cannot work.
if ! command -v nginx >/dev/null 2>&1; then
  bad "no nginx binary on the host — this policy is for the host nginx the origin runs"; exit 1
fi
# A here-string, never `docker ps | grep -q` under pipefail (grep -q closing the pipe early can fail
# the pipeline and hide the match — see src/lib/deploy-script.test.ts for the measured case).
# ⚠️ WHAT MATTERS IS WHO WRITES $LOG_DIR, NOT WHETHER ANY nginx IMAGE RUNS. The box also runs mailcow's
# own nginx container (ghcr.io/mailcow/nginx), which logs inside its container — matching on the image
# name refused the install on the real box (2026-10-01). Refuse only when a container BIND-MOUNTS the
# host's $LOG_DIR (then its nginx writes these files and the host-signal postrotate cannot reopen them),
# or when the host nginx is not the one running.
# `|| true`: a container exiting between `ps` and `inspect`, or no docker daemon, must not abort the
# script silently under pipefail. Any mount of $LOG_DIR OR AN ANCESTOR (/var/log, /var, /) counts: a
# container given /var/log writes /var/log/nginx just the same (codex + opus, 2026-10-01).
MOUNTS=$( { command -v docker >/dev/null 2>&1 && docker ps -aq 2>/dev/null | xargs -r docker inspect --format '{{.Name}} {{range .Mounts}}{{.Source}} {{end}}' 2>/dev/null; } || true)
ANCESTORS="${LOG_DIR}"; d="$LOG_DIR"; while [ "$d" != "/" ]; do d=$(dirname "$d"); ANCESTORS="$ANCESTORS|$d"; done
if grep -qE "[[:space:]](${ANCESTORS//\//\\/})(/?)([[:space:]]|$)" <<<"$MOUNTS"; then
  bad "a CONTAINER (running or stopped) mounts $LOG_DIR or a parent of it — the policy's postrotate signals the HOST nginx; adapt it first"; exit 1
fi
if command -v systemctl >/dev/null 2>&1 && [ "$(systemctl is-active nginx 2>/dev/null)" != "active" ]; then
  bad "the host nginx service is not active — this policy is for the host nginx the origin runs"; exit 1
fi
if ! command -v invoke-rc.d >/dev/null 2>&1 || [ ! -x /etc/init.d/nginx ]; then
  bad "invoke-rc.d or /etc/init.d/nginx is missing — the postrotate hook would fail"; exit 1
fi
ok "host nginx: $(nginx -v 2>&1 | sed 's/^nginx version: //'), pid file $(sed -nE 's/^[[:space:]]*pid[[:space:]]+([^;]*);.*/\1/p' /etc/nginx/nginx.conf | head -1)"

say "2. logrotate supports ignoreduplicates"
# ⛔ WITHOUT IT THE TWO STANZAS ARE A "duplicate log entry" ERROR that fails every daily run. An
# older logrotate would also reject the unknown keyword — refuse up front with the reason instead.
LR_VER=$(logrotate --version 2>&1 | sed -n '1s/^logrotate[[:space:]]*\([0-9][0-9.]*\).*/\1/p')
if [ -z "$LR_VER" ]; then
  bad "could not read the logrotate version"; exit 1
elif [ "$(printf '%s\n%s\n' "$MIN_LOGROTATE" "$LR_VER" | sort -V | head -1)" != "$MIN_LOGROTATE" ]; then
  bad "logrotate $LR_VER is older than $MIN_LOGROTATE (no ignoreduplicates) — Ubuntu 24.04 ships 3.21.0"; exit 1
fi
ok "logrotate $LR_VER (>= $MIN_LOGROTATE)"

say "3. install the policy"
if cmp -s "$SRC" "$DEST"; then
  ok "$DEST already holds this policy — nothing to change"
elif [ "$CHECK_ONLY" = 1 ]; then
  bad "$DEST does NOT hold the eno policy (--check: not installing)"; FAIL=1
else
  # Validate the CANDIDATE on its own before it is installed: a syntax error here would stop rotation
  # of every nginx log (logrotate skips a stanza that does not parse), worse than the 14 days it fixes.
  STATE=$(mktemp) || exit 1
  if ! logrotate -d -s "$STATE" "$SRC" >/dev/null 2>"$STATE.err"; then
    bad "the policy does not parse — NOT installed:"; sed 's/^/      /' "$STATE.err"; rm -f "$STATE" "$STATE.err"; exit 1
  fi
  rm -f "$STATE" "$STATE.err"
  install -m 0644 -o root -g root "$SRC" "$DEST" || { bad "could not write $DEST"; exit 1; }
  ok "installed $DEST (rotate $WANT, daily, compressed); $PKG_FILE left as the package shipped it"
fi

say "4. the whole configuration parses, and logrotate itself puts every nginx log under this policy"
# ⚠️ A THROWAWAY STATE FILE (-s), as in step 3 — never logrotate's default one. In a dry run
# logrotate still OPENS its state file, and any failure other than "does not exist" is printed as
# `error: error opening state file …; assuming empty state` (logrotate.c readState, 3.21.0). Ubuntu's
# /var/lib/logrotate/status is 0640 root:root after any real run, so a non-root caller (the e2e test
# in src/lib/nginx-logrotate.test.ts, on CI) would fail this check over a file that is not the
# policy. Nothing read below depends on the state: the pattern headers and "considering log" lines
# are printed before logrotate consults it.
DRY_STATE=$(mktemp) || exit 1
DRY=$(logrotate -d -s "$DRY_STATE" /etc/logrotate.conf 2>&1)
rm -f "$DRY_STATE"
# ⚠️ `^error:` ONLY. The debug output names /var/log/nginx/error.log on ordinary lines, so a bare
# `grep error` fails a healthy config; logrotate prefixes its real complaints with "error:".
if grep -qE '^error:' <<<"$DRY"; then
  bad "logrotate -d /etc/logrotate.conf reports errors (fix them — many kinds make the daily run exit non-zero):"
  grep -E '^error:' <<<"$DRY" | head -20 | sed 's/^/      /'; FAIL=1
else
  ok "logrotate -d /etc/logrotate.conf: no errors"
fi
# ⚠️ FROM THE DRY RUN, NOT FROM FILE NAMES: which stanza a log ends up in depends on read order and
# `ignoreduplicates`, and only logrotate's own output says what it decided. Each "considering log X"
# line belongs to the "rotating pattern: … (N rotations)" header above it.
ROT=$(awk -v d="considering log $LOG_DIR/" '
  /^rotating pattern: /{ n="?"; if (match($0, /\([0-9]+ rotations\)/)) n=substr($0, RSTART+1, RLENGTH-12) }
  index($0, d) == 1 { print $3, n }' <<<"$DRY")
ON_DISK=$(find "$LOG_DIR" -maxdepth 1 -type f -name '*.log' 2>/dev/null | sort)
if [ -z "$ON_DISK" ]; then
  bad "no $LOG_DIR/*.log on disk — nothing to prove the policy against (start nginx, then re-run with --check)"; FAIL=1
else
  WRONG=""
  for f in $ON_DISK; do
    n=$(awk -v f="$f" '$1==f{print $2; exit}' <<<"$ROT")
    [ "$n" = "$WANT" ] || WRONG="$WRONG $f(rotate:${n:-none})"
  done
  if [ -n "$WRONG" ]; then
    bad "logrotate's dry run does not rotate these under the eno policy's $WANT:"; printf '      %s\n' $WRONG; FAIL=1
  else
    ok "every $LOG_DIR/*.log rotates under 'rotate $WANT': $(printf '%s ' $ON_DISK)"
  fi
fi

say "5. every log nginx writes is covered"
# ⚠️ FROM `nginx -T`, THE CONFIG nginx IS ACTUALLY RUNNING, not from the repo's eno.conf: a vhost
# added on the box by hand, or a log path changed there, is exactly what a repo-side check misses.
# ERE (-E), not GNU-only BRE escapes, so the same line also runs under BSD sed.
PATHS=$(nginx -T 2>/dev/null | sed -nE 's/^[[:space:]]*(access_log|error_log)[[:space:]]+([^[:space:];]+).*/\2/p' | sort -u)
UNCOVERED=""
for p in $PATHS; do
  case "$p" in
    off|syslog:*|stderr|/dev/*) continue ;;
    "$LOG_DIR"/*/*) UNCOVERED="$UNCOVERED $p" ;;   # the glob does not recurse
    "$LOG_DIR"/*.log) ;;
    *) UNCOVERED="$UNCOVERED $p" ;;
  esac
done
if [ -z "$PATHS" ]; then
  bad "nginx -T returned no access_log/error_log lines — cannot prove coverage"; FAIL=1
elif [ -n "$UNCOVERED" ]; then
  bad "nginx writes logs the policy does NOT rotate (glob $LOG_DIR/*.log):"; printf '      %s\n' $UNCOVERED; FAIL=1
else
  ok "covered: $(printf '%s ' $PATHS)"
fi

say "6. the package's own logrotate file is untouched (advisory)"
# ⚠️ AN EDITED (OR DELETED) CONFFILE IS HOW NGINX SECURITY UPDATES GET HELD BACK: the next
# nginx-common that changes this file makes unattended-upgrades skip it — "has conffile prompt and
# needs to be upgraded manually" — and nginx with it. Compared against the md5 dpkg recorded at install.
PKG_MD5=$(dpkg-query -W -f='${Conffiles}\n' nginx-common 2>/dev/null | awk -v f="$PKG_FILE" '$1==f{print $2; exit}')
# The INSTALLED version's copy, not the candidate's: dpkg's md5 was recorded for what is installed.
PKG_VER=$(dpkg-query -W -f='${Version}' nginx-common 2>/dev/null)
RESTORE="restore it from the installed package, then re-run with --check: cd /tmp && apt-get download nginx-common=${PKG_VER:-<installed version>} && dpkg-deb --fsys-tarfile nginx-common_*.deb | tar -xO .${PKG_FILE} > ${PKG_FILE}"
if [ -z "$PKG_MD5" ]; then
  warn "dpkg records no conffile $PKG_FILE for nginx-common — cannot check (not an Ubuntu/Debian nginx?)"
elif [ ! -e "$PKG_FILE" ]; then
  warn "$PKG_FILE is MISSING — unattended-upgrades treats that as modified and will hold nginx back; $RESTORE"
elif [ "$(md5sum < "$PKG_FILE" | cut -d' ' -f1)" = "$PKG_MD5" ]; then
  ok "$PKG_FILE is byte-identical to what dpkg installed — no conffile prompt can hold nginx updates back"
else
  warn "$PKG_FILE was EDITED — unattended-upgrades will hold nginx back the next time the package changes it; $RESTORE"
fi

say "7. logrotate actually runs"
if systemctl is-enabled --quiet logrotate.timer 2>/dev/null && systemctl is-active --quiet logrotate.timer 2>/dev/null; then
  ok "logrotate.timer enabled and active ($(systemctl show -p NextElapseUSecRealtime --value logrotate.timer 2>/dev/null || echo 'next run unknown'))"
elif [ -x /etc/cron.daily/logrotate ]; then
  ok "/etc/cron.daily/logrotate present"
else
  bad "neither logrotate.timer nor /etc/cron.daily/logrotate is active — nothing will rotate"; FAIL=1
fi

say "8. disk projection (advisory)"
# ⚠️ MEASURED FROM WHAT IS ON DISK, never assumed: the mean size of the compressed days already
# rotated, times the retention. With no .gz yet (a fresh box) there is nothing honest to project from.
GZ_COUNT=$(find "$LOG_DIR" -maxdepth 1 -name '*.gz' 2>/dev/null | wc -l | tr -d ' ')
if [ "$GZ_COUNT" -gt 0 ]; then
  GZ_KB=$(find "$LOG_DIR" -maxdepth 1 -name '*.gz' -print0 2>/dev/null | du -ck --files0-from=- 2>/dev/null | tail -1 | cut -f1)
  LOGS=$(find "$LOG_DIR" -maxdepth 1 -name '*.log' 2>/dev/null | wc -l | tr -d ' ')
  PER_DAY_KB=$(( GZ_KB * ${LOGS:-1} / GZ_COUNT ))
  PROJ_MB=$(( PER_DAY_KB * WANT / 1024 ))
  AVAIL_MB=$(df -Pm /var/log | awk 'NR==2{print $4}')
  ok "~${PER_DAY_KB} KB/day compressed across ${LOGS} logs → ~${PROJ_MB} MB at ${WANT} days (free on /var/log: ${AVAIL_MB} MB)"
  if [ -n "$AVAIL_MB" ] && [ "$PROJ_MB" -gt $(( AVAIL_MB / 2 )) ]; then
    warn "the projection is more than half the free space — plan off-box shipping or a larger disk before month 6"
  fi
else
  warn "no rotated .gz yet — re-run with --check after a week to get a real projection"
fi

echo
if [ "$FAIL" = 0 ]; then ok "nginx log retention: $WANT days, verified"; exit 0; fi
bad "nginx log retention is NOT verified — see the [XX] lines above"; exit 1
