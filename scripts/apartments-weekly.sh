#!/usr/bin/env bash
# Imported PROPERTY-rental refresh for eno.vn — every place type, 7 days at most, refreshed every 3 days, swept daily.
# (The file and its LaunchAgent keep their old names — vn.eno.apartments-weekly — so the installed agent is updated in
# place; the job is no longer apartments-only, nor weekly.)
#
# Owner, 2026-10-13: "remove all rental properties that are 7 days older every 3 days it should check and update up to
# 7 day old ones no older than 7 days". (2026-10-01: "only 7 days old apartments fetched weekly, remove else".)
# The rule and its layers are in src/lib/apartment-freshness.ts (header, "SINCE 2026-10-13").
#
# ⛔ SCHEDULE: launchd starts this DAILY at 06:00 (scripts/vn.eno.apartments-weekly.plist), and — so a refresh that
# outlasts a day cannot cost the daily sweep (launchd never starts a second instance of a running job) — its own
# `--sweep-only` agent daily at 05:30 (scripts/vn.eno.rentals-sweep.plist), which also alerts on a refresh stuck for
# LOCK_ALERT_HOURS. Each GATE UNIT (a source;
# Muaban is two: its apartments with their set, and its houses/rooms/offices) runs only when its last SUCCESS is ≥ 66 h
# old (scripts/apartments-gate.sh — one stamp per unit in the state dir, written only when that unit's refresh fully
# succeeded, holding this run's START), so a healthy unit refreshes every 3 days, a failed, partial or missed one
# retries the next morning, and a run the Mac slept through fires on wake. THE DAILY SWEEP
# (scripts/expire-rentals.ts --sweep: every live imported place row whose postedAt is older than 7 days → expired) runs
# at the end of EVERY run — on the days the gate skips every import too, and on a morning when the previous run is
# still refreshing (it holds the lock): that run then does the sweep alone.
#
# Per source, in this order:
#   1. read the source → stage (+ the apartment FRESH SET: every apartment ad dated inside the window)
#   2. apply the stage: create, update, REVIVE (expired/stale → active) and re-date ads of EVERY place type dated
#      inside 7 days — Nhà Tốt cg 1010/1020/1030/1050, Muaban apartments (+ set) and, as its own unit, house/room/office
#      (--fresh-crawl, no set), Batdongsan's whole rentals list, Honeycomb (apply at --since-days 7), Rever's check
#   3. expire every live APARTMENT of that source NOT in its fresh set (scripts/expire-apartment-rentals.ts — share
#      guard against a short crawl, carry-over for a rolling window like Honeycomb's, journal + rollback first,
#      per-page ISR tombstones). Apartments only by design: every coverage proof describes the apartment lists; the
#      daily sweep enforces the 7-day maximum on every type.
#   4. the BACKSTOP, whatever 1–3 did (expire-apartment-rentals.ts --backstop; a seller with no state file is
#      reported and skipped — the sweep covers it)
# then classify-apartment-rentals.ts once if any source ran (every import rewrites `attributes`), then THE SWEEP.
#
# ⛔ THE DB TUNNEL IS RE-CHECKED BEFORE EVERY DATABASE STEP (dbrun → scripts/db-tunnel.sh start, the SUPERVISED
# tunnel that redials after a drop). Until 2026-10-13 the job opened a bare `ssh -fN` once at the start; a lid-close
# sleep killed it, and every later step of every run since 10-01 failed with "Can't reach database server".
# ⚠️ The check proves the local listener: a step that starts in the seconds before a half-open connection is noticed
# (ServerAlive, ≤ 45 s) can still fail — that unit then gets no stamp, and the next morning retries it.
# ⛔ PER-SOURCE ISOLATION. A failed step skips THE REST OF THAT SOURCE'S PART (never its expiry on a partial set) and
# the job moves on; the run exits non-zero and posts a macOS notification naming what failed.
# ⛔ DRY BY DEFAULT: reads the sources and prints what every write WOULD do. `--apply` (what the launchd job passes)
# writes. Every write is journaled under $RUN. A dry run ignores the gate and writes no stamp.
#
# Arguments: [--apply] [--force-imports (ignore the 66 h gate)] [--sweep-only (no imports, no classify)]
# Log + journals: ~/eno-import-journals/apartments/<stamp>/; share-guard state + success stamps: …/apartments/state/.
#
# Env (all optional):
#   ENO_REPO       checkout whose scripts run (default ~/eno-apartments-job — a CLEAN detached worktree at
#                  origin/main; ~/eno.vn is a working tree and may be dirty or behind)
#   APT_ENV_FILE   env file for DB + storage (default ~/eno.vn/.env; "none" = caller's environment, no tunnel)
#   APT_SOURCES    space-separated subset of the gate units: nhatot muaban muaban-places honeycomb rever batdongsan
#                  (default: all; muaban = its apartments + their set, muaban-places = its houses/rooms/offices)
#   BDS_DIR        Batdongsan dataset dir (default ~/batdongsan_rentals_hcmc)
#   BDS_PY         its interpreter (default $BDS_DIR/.venv/bin/python — playwright lives there, not in /usr/bin/python3)
#   GATE_HOURS     the success gate (default 66)
#   LOCK_ALERT_HOURS  alert when a refresh has held the lock this long (default 36)
#   APT_NOTIFY     0 = no macOS notification (dry proofs, the job's unit test)
#
# ⚠️ `set -e` is NOT relied on (memory: it is a no-op in this shell setup) — every step ends in a test.
# ⚠️ bash, not zsh, and arguments as ARRAYS: zsh does not word-split "$X" (the vehicle job died on it).
# ⚠️ macOS /bin/bash is 3.2: no associative arrays, and "${EMPTY[@]}" is an unbound-variable error
# under `set -u` — every array is expanded as ${A[@]+"${A[@]}"}.
set -uo pipefail
APPLY=""; FORCE=""; SWEEP_ONLY=""
for a in "$@"; do
  case "$a" in
    --apply) APPLY="--apply" ;;
    --force-imports) FORCE=1 ;;
    --sweep-only) SWEEP_ONLY=1 ;;
    *) echo "unknown argument $a (use --apply, --force-imports, --sweep-only)"; exit 2 ;;
  esac
done
ENO="${ENO_REPO:-$HOME/eno-apartments-job}"
ENVF="${APT_ENV_FILE:-$HOME/eno.vn/.env}"
SOURCES="${APT_SOURCES:-nhatot muaban muaban-places honeycomb rever batdongsan}"
BDS="${BDS_DIR:-$HOME/batdongsan_rentals_hcmc}"
BDS_PY="${BDS_PY:-$BDS/.venv/bin/python}"
JROOT="${APT_JOURNAL:-$HOME/eno-import-journals/apartments}"
STATE="$JROOT/state"
START_EPOCH="$(date +%s)"
# …and the pid: the two agents a waking Mac fires in the same second must not share (and overwrite) one run dir.
STAMP="$(date -r "$START_EPOCH" +%F-%H%M%S 2>/dev/null || date +%F-%H%M%S)-$$"
RUN="$JROOT/$STAMP"
KEY="${ENO_BOX_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}"
# The 7-day rule: FRESH_DAYS in src/lib/apartment-freshness.ts (= SWEEP_DAYS, src/lib/rental-sweep.ts). The importers'
# own --fresh-out checks refuse any other value, and a unit test pins this line to the lib.
AGE_DAYS=7
# Every way this job can end badly notifies — including the early exits below, before any source runs.
notify() { [ "${APT_NOTIFY:-1}" = 0 ] || /usr/bin/osascript -e "display notification \"$1\" with title \"eno property-rentals FAILED\" sound name \"Basso\"" 2>/dev/null; }
die() { echo "── $1"; notify "$1"; exit 1; }
mkdir -p "$RUN" "$STATE" || die "cannot create $RUN"
# ⛔ ONE REFRESH AT A TIME, whoever starts it (launchd or a hand-run): two would both archive and re-scrape the
# Batdongsan dataset and apply the same stages. mkdir is atomic; a lock whose pid is dead is cleared.
# ⛔ BUT NEVER A DAY WITHOUT THE SWEEP: a refresh can outlast a day (the first runs after the 2026-10-13 cut create
# thousands of rows, photo by photo), and the next morning's trigger used to die here. While another run holds the
# lock, this one does the DAILY SWEEP ALONE and exits — safe beside a refresh: the sweep writes a row only while it is
# exactly as the sweep read it (status and updatedAt), so a row a refresh revives or re-dates meanwhile is left alone.
# (The other way round — a refresh re-dating a row the sweep expired a moment before — the importers' writes are guarded
# on the status they read, or re-read it per row: at worst that row stays expired until the next refresh revives it.)
# ⛔ AND NEVER A SILENT ONE: a lock held for LOCK_ALERT_HOURS (a hung headed Chrome, a stalled upload) alerts every
# morning; a lock whose pid now belongs to some other process (reused after a crash) is not a run, and is cleared.
LOCKDIR="$JROOT/.weekly.lock"
LOCK_ALERT_HOURS="${LOCK_ALERT_HOURS:-36}"
case "$LOCK_ALERT_HOURS" in ''|*[!0-9]*) die "LOCK_ALERT_HOURS must be a whole number of hours, not \"$LOCK_ALERT_HOURS\" — this run did nothing" ;; esac
# lock_holder <dir> — the pid a lock records. A lock another run created a moment ago may not have its pid yet
# (mkdir, then the write): wait up to 3 s for it rather than read "no pid" as "dead" and take a live lock over.
lock_holder() {
  local d="$1" p="" i
  for i in 1 2 3 4; do
    p="$(cat "$d/pid" 2>/dev/null)"
    [ -n "$p" ] && break
    [ "$i" = 4 ] || sleep 1
  done
  printf '%s' "$p"
}
HELD_BY=""; HELD_LONG=""
# ⚠️ THE CONTRACT THAT BOUNDS THIS LOCK: launchd starts ONE instance of the job at a time, so two runs meet only when a
# person starts one by hand at the same moment — the takeover of a dead lock is not made race-proof against that.
# A --sweep-only run (a hand-run, or the sweep beside a refresh) never takes it: it would hold a morning's refresh off.
SWEEP_ONLY_ASKED="$SWEEP_ONLY"
if [ -z "$SWEEP_ONLY_ASKED" ] && ! mkdir "$LOCKDIR" 2>/dev/null; then
  holder="$(lock_holder "$LOCKDIR")"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null && ps -o command= -p "$holder" 2>/dev/null | grep -q 'apartments-weekly'; then
    HELD_BY="$holder"; SWEEP_ONLY=1
    [ -n "$(find "$LOCKDIR/pid" -mmin +$(( 10#$LOCK_ALERT_HOURS * 60 )) 2>/dev/null)" ] && HELD_LONG=1
  else
    rm -rf "$LOCKDIR"; mkdir "$LOCKDIR" 2>/dev/null || die "could not take $LOCKDIR — this run did nothing"
  fi
fi
if [ -z "$HELD_BY" ] && [ -z "$SWEEP_ONLY_ASKED" ]; then
  echo $$ > "$LOCKDIR/pid"
  trap 'rm -rf "$LOCKDIR"' EXIT
fi
# A --sweep-only run (the daily sweep agent, vn.eno.rentals-sweep) only LOOKS at the refresh lock: launchd never starts
# a second refresh while one runs, so this is where a refresh stuck for LOCK_ALERT_HOURS is noticed.
if [ -n "$SWEEP_ONLY_ASKED" ] && [ -f "$LOCKDIR/pid" ]; then
  holder="$(cat "$LOCKDIR/pid" 2>/dev/null)"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null && ps -o command= -p "$holder" 2>/dev/null | grep -q 'apartments-weekly' \
     && [ -n "$(find "$LOCKDIR/pid" -mmin +$(( 10#$LOCK_ALERT_HOURS * 60 )) 2>/dev/null)" ]; then HELD_BY="$holder"; HELD_LONG=1; fi
fi
echo "── $(date '+%F %T') property-rentals ${APPLY:-(dry run)}${FORCE:+ --force-imports}${SWEEP_ONLY:+ --sweep-only}  repo $ENO @ $(git -C "$ENO" rev-parse --short HEAD 2>/dev/null)"
[ -n "$HELD_BY" ] && echo "── another property-rentals run (pid $HELD_BY) holds the refresh lock — this run does the daily sweep only"
[ -n "$HELD_LONG" ] && echo "── ⚠️ that run has held the lock for over $LOCK_ALERT_HOURS h — the imports are not refreshing; look at it"

cd "$ENO" || die "repo $ENO missing — install the job worktree"
# shellcheck source=scripts/apartments-gate.sh
. "$ENO/scripts/apartments-gate.sh" || die "cannot read $ENO/scripts/apartments-gate.sh — this run did nothing"
case "$GATE_HOURS" in ''|*[!0-9]*) die "GATE_HOURS must be a whole number of hours, not \"$GATE_HOURS\" — this run did nothing" ;; esac
if [ "$ENVF" != "none" ]; then
  set -a; . "$ENVF" || die "env file $ENVF unreadable — this run did nothing"; set +a
fi

# ensure_db — eno.vn's database is reached only through the SSH tunnel on :5433. Re-checked before EVERY database
# step: up → go on; down → scripts/db-tunnel.sh start (the supervised tunnel: it waits for a running supervisor to
# redial, or starts one, and fails after ~30–45 s). The supervisor outlives this run, as it does for a hand-started one.
ensure_db() {
  [ "$ENVF" = "none" ] && return 0
  nc -z 127.0.0.1 5433 2>/dev/null && return 0
  echo "  $(date '+%T') DB tunnel down — (re)starting the supervised tunnel" >> "$RUN/tunnel.log"
  ENO_BOX_KEY="$KEY" bash "$ENO/scripts/db-tunnel.sh" start >> "$RUN/tunnel.log" 2>&1
  nc -z 127.0.0.1 5433 2>/dev/null
}
# dbrun <log> <cmd…> — one database step: the tunnel re-checked first, then the command, its output to <log>. Returns
# the command's exit code, or TUNNEL_DOWN when the tunnel could not be brought up (the command did not run).
TUNNEL_DOWN=70
dbrun() {
  local log="$1"; shift
  if ! ensure_db; then echo "the DB tunnel to the box is down and could not be restarted (see $RUN/tunnel.log) — this step did not run" > "$log"; return "$TUNNEL_DOWN"; fi
  "$@" > "$log" 2>&1
}
ensure_db || echo "  ⚠️ the DB tunnel is not up yet — every database step below re-checks it (see $RUN/tunnel.log)"

FAILED=()
[ -n "$HELD_LONG" ] && FAILED+=("refresh-running-over-${LOCK_ALERT_HOURS}h")
# Locks left by an expiry that was killed (SIGKILL, a shutdown): the expiry script never takes a lock over —
# no pid-based takeover is race-free — so this job, the one scheduled refresh, clears the dead ones here. Never while
# another run holds the job's lock: an expiry of that run may be between creating its lock file and writing its pid.
if [ -z "$HELD_BY" ] && [ -z "$SWEEP_ONLY_ASKED" ]; then
  for lk in "$STATE"/*.lock; do
    [ -f "$lk" ] || continue
    pid="$(tr -cd '0-9' < "$lk")"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then echo "  stale lock $(basename "$lk") (pid ${pid:-?} not running) — removed"; rm -f "$lk"; fi
  done
fi
# fail <unit> <what> — the unit's refresh did not fully happen: alerted, and NO success stamp, so it runs again the next
# morning. Every incomplete refresh counts — a list cut short, rows that errored — not only a crash: the 66 h gate must
# never hold back the retry of something left undone (the sweep keeps expiring what a refresh did not re-date).
# Callers `return` after it when the rest of the unit cannot go on, and carry on (expiry included) when it can.
SRC_OK=1
fail() { FAILED+=("$1"); SRC_OK=0; echo "  ✗ $1 FAILED at: $2 — see $RUN/$1*.log"; }
# The journal arguments every write step shares. Dry runs get none (the scripts refuse --journal-dir
# without --apply in some importers, and a dry run writes nothing anyway).
JOURNAL=(); [ -n "$APPLY" ] && JOURNAL=(--journal-dir "$RUN/journal")
mkdir -p "$RUN/journal" || exit 1

# expire <source> <sellerId> <fresh.json>
expire() {
  local src="$1" seller="$2" fresh="$3"
  dbrun "$RUN/$src-expire.log" npx tsx scripts/expire-apartment-rentals.ts --seller "$seller" --fresh "$fresh" --state-dir "$STATE" \
    ${JOURNAL[@]+"${JOURNAL[@]}"} $APPLY
}
# backstop <source> <sellerId> — always runs, success or not. --backstop = the seller's own cutoff from the
# lib (its window + 7 days: 14, Honeycomb 37), never one number for every source. No state file: skipped, reported.
backstop() {
  local src="$1" seller="$2"
  ensure_db || { fail "$src-backstop" "the DB tunnel is down"; return; }
  npx tsx scripts/expire-apartment-rentals.ts --seller "$seller" --backstop --state-dir "$STATE" \
    ${JOURNAL[@]+"${JOURNAL[@]}"} $APPLY > "$RUN/$src-backstop.log" 2>&1 \
    || { echo "  ✗ $src backstop FAILED — see $RUN/$src-backstop.log"; FAILED+=("$src-backstop"); SRC_OK=0; }
  grep -E "BACKSTOP|marked|REFUSED" "$RUN/$src-backstop.log" | sed "s/^/  [$src] /"
}
summary() { grep -E "live apartments|marked|REFUSED|coverage" "$RUN/$1-expire.log" | sed "s/^/  [$1] /"; }

# A stage/import step exits 3 when it read the source but could NOT prove whole-window coverage: what it
# read is still applied (new and re-posted ads go live, re-posted expired ones come back), but there is no
# fresh set, so this source's expiry is skipped and the source is marked failed (alert, retried tomorrow). Any
# other non-zero exit is a plain failure of that source (TUNNEL_DOWN: the step never ran).
COVERAGE_REFUSED=3

run_nhatot() {
  local S=nhatot-import-seller-0001 STAGE="$RUN/nhatot-stage.json" FRESH="$RUN/nhatot-fresh.json" rc
  # All three cities (the default): the expiry acts on the whole seller, so a city left out of the set
  # would expire every live apartment there. Every place category (apartments 1010, houses 1020, offices 1030,
  # rooms 1050) — the read takes every city's apartments first; the set is cg 1010 only.
  dbrun "$RUN/nhatot-stage.log" npx tsx scripts/import-nhatot-com.ts --cg 1010,1020,1030,1050 --max-age-days "$AGE_DAYS" --save "$STAGE" --fresh-out "$FRESH"; rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq "$COVERAGE_REFUSED" ] || { fail nhatot stage; return; }
  # The set stands on the apartment lists alone (read first), so a house/office/room list cut short (a stop, a gap)
  # does not stop this source's apply or expiry — but the unit runs again tomorrow (the stage records "complete": false).
  if [ -f "$STAGE" ] && grep -qE '"complete":[[:space:]]*false' "$STAGE"; then fail nhatot-read-incomplete "a list was cut short (a stop or a gap) — what was read is imported, the rest retried tomorrow"; fi
  if [ -n "$APPLY" ] && [ -f "$STAGE" ]; then
    # --max-age-days on the apply too, or it creates 7.x-day-old ads the expiry removes minutes later.
    # Exit 1 also means "finished, but some rows errored" (a photo upload blip): the importer then prints
    # APPLY COMPLETED as its last line. That run still expires — the expiry's own guards stand — and is
    # flagged; only an apply that never finished skips it.
    if ! dbrun "$RUN/nhatot-apply.log" npx tsx scripts/import-nhatot-com.ts --src "$STAGE" --max-age-days "$AGE_DAYS" ${JOURNAL[@]+"${JOURNAL[@]}"} --apply; then
      grep -qx "APPLY COMPLETED" "$RUN/nhatot-apply.log" || { fail nhatot apply; return; }
      fail nhatot-apply-row-errors "the apply finished with row errors — retried tomorrow; the expiry still runs"
    fi
  fi
  [ "$rc" -eq 0 ] || { fail nhatot "coverage not proven — imported, expiry skipped"; return; }
  # The set AND the stage it came with: never expire on a set whose ads were not (or could not be) applied.
  [ -f "$FRESH" ] && [ -f "$STAGE" ] || { fail nhatot "stage or fresh set missing — expiry skipped"; return; }
  expire nhatot "$S" "$FRESH" || { fail nhatot expire; return; }
  summary nhatot
}

# Muaban's apartments: the fresh set's crawl (HCMC read district by district, every city), then its expiry.
muaban_apartments() {
  local S=muaban-net-import-seller-0001 STAGE="$RUN/muaban-stage.jsonl" FRESH="$RUN/muaban-fresh.json" rc
  dbrun "$RUN/muaban-stage.log" npx tsx scripts/import-muaban-net.ts --types apartment --stage "$STAGE" --fresh-out "$FRESH"; rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq "$COVERAGE_REFUSED" ] || { fail muaban stage; return; }
  if [ -n "$APPLY" ] && [ -f "$STAGE" ]; then
    dbrun "$RUN/muaban-apply.log" npx tsx scripts/import-muaban-net.ts --src "$STAGE" --journal "$RUN/journal" --apply || { fail muaban apply; return; }
  fi
  [ "$rc" -eq 0 ] || { fail muaban "coverage not proven — imported, expiry skipped"; return; }
  [ -f "$FRESH" ] && [ -f "$STAGE" ] || { fail muaban "stage or fresh set missing — expiry skipped"; return; }
  expire muaban "$S" "$FRESH" || { fail muaban expire; return; }
  summary muaban
}
# Muaban's houses, rooms and offices — their own gate unit (muaban-places): the same crawl with no set (--fresh-crawl).
# A list it cannot read whole is skipped (exit 3): what was read is still applied, and the unit runs again tomorrow —
# nothing is expired from this crawl, and a gap there never re-crawls the apartments.
muaban_places() {
  local STAGE="$RUN/muaban-places-stage.jsonl" rc
  dbrun "$RUN/muaban-places-stage.log" npx tsx scripts/import-muaban-net.ts --types house,room,office --stage "$STAGE" --fresh-crawl; rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq "$COVERAGE_REFUSED" ] || { fail muaban-places stage; return; }
  if [ -n "$APPLY" ]; then
    # No set to fall back on here: a stage that was not written is a refresh that did not happen, never a success.
    [ -f "$STAGE" ] || { fail muaban-places "the stage file was not written"; return; }
    dbrun "$RUN/muaban-places-apply.log" npx tsx scripts/import-muaban-net.ts --src "$STAGE" --journal "$RUN/journal" --apply || { fail muaban-places apply; return; }
  fi
  [ "$rc" -eq 0 ] || fail muaban-places-incomplete "a house/room/office list was not read whole — what was read is imported, the rest retried tomorrow"
  grep -E "CRAWL INCOMPLETE|every list read whole|TO IMPORT" "$RUN/muaban-places-stage.log" | sed 's/^/  [muaban places] /'
}
run_muaban() { muaban_apartments; }
run_muaban_places() { muaban_places; }

run_honeycomb() {
  local S=honeycomb-import-seller-0001 STAGE="$RUN/honeycomb-stage.json" FRESH="$RUN/honeycomb-fresh.json" days
  # ⛔ Its SET's window is 30 days, not 7 (the agency re-touches a listing every few weeks; a 7-day set held 0–7 ads)
  # — READ FROM THE ONE TABLE (windowDaysFor, src/lib/apartment-freshness.ts), never a copy here: the importer refuses
  # --fresh-out with any other --since-days, and the expiry refuses a set whose window is not the seller's. That set
  # only expires the flats the sitemap stopped listing.
  days="$(npx tsx -e "import { windowDaysFor } from './src/lib/apartment-freshness'; console.log(windowDaysFor('$S'))" 2> "$RUN/honeycomb-window.log")"
  case "$days" in ''|*[!0-9]*) fail honeycomb "reading its window from src/lib/apartment-freshness.ts"; return ;; esac
  # The stage exits non-zero when it cannot prove its sitemap read (it still writes the stage); a refused
  # run simply skips its apply and expiry.
  dbrun "$RUN/honeycomb-stage.log" npx tsx scripts/import-honeycomb-com-vn.ts --since-days "$days" --save "$STAGE" --fresh-out "$FRESH" || { fail honeycomb stage; return; }
  if [ -n "$APPLY" ]; then
    # ⛔ The APPLY judges by the 7-day rule (2026-10-13: nothing older than 7 days): --since-days $AGE_DAYS creates,
    # revives and re-dates only ads re-touched within 7 days of the stage's fetch (keepVerdict) — never the 8–30-day
    # ones its set keeps listed, which the daily sweep would expire again the same day.
    dbrun "$RUN/honeycomb-apply.log" npx tsx scripts/import-honeycomb-com-vn.ts --src "$STAGE" --since-days "$AGE_DAYS" ${JOURNAL[@]+"${JOURNAL[@]}"} --apply || { fail honeycomb apply; return; }
  fi
  expire honeycomb "$S" "$FRESH" || { fail honeycomb expire; return; }
  summary honeycomb
}

run_rever() {
  local S=cmub0wead0000zrq418bqq27m STATUS="$RUN/rever-status.jsonl" FRESH="$RUN/rever-fresh.json" rc
  # One detail GET per Rever apartment row we hold (live AND expired/stale), ≥1.5 s apart: retires let
  # flats, revives re-listed ones, re-dates updated ones. Rever has posted no new HCMC rental since
  # 2026-06-12, so new Rever ads are not imported.
  dbrun "$RUN/rever-check.log" npx tsx scripts/retire-rever-rentals.ts --save "$STATUS" --fresh-out "$FRESH"; rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq "$COVERAGE_REFUSED" ] || { fail rever check; return; }
  if [ -n "$APPLY" ] && [ -f "$STATUS" ]; then
    dbrun "$RUN/rever-apply.log" npx tsx scripts/retire-rever-rentals.ts --src "$STATUS" ${JOURNAL[@]+"${JOURNAL[@]}"} --apply || { fail rever apply; return; }
  fi
  [ "$rc" -eq 0 ] || { fail rever "coverage not proven — applied, expiry skipped"; return; }
  expire rever "$S" "$FRESH" || { fail rever expire; return; }
  summary rever
}

run_batdongsan() {
  local S=bds-vn-import-seller-0001 FRESH="$RUN/batdongsan-fresh.json" PREV STAMPED rc f
  # ⛔ A DRY RUN LEAVES THE DATASET ALONE. Archiving and re-scraping are real state: a dry run (or a same-day
  # rerun) would make an hours-old crawl the next --previous, every card would match "last time's" label,
  # and the carry-over check would call the whole market stale. The dry run only re-judges the scrape on disk.
  if [ -z "$APPLY" ]; then
    [ -f "$BDS/all_rentals.json" ] || { echo "  [batdongsan] dry run: no all_rentals.json on disk — nothing to judge"; return; }
  else
    # ⛔ The scraper's interpreter: its .venv (playwright is installed there — /usr/bin/python3 has none, and every
    # weekly scrape since 10-01 died on `No module named 'playwright'`).
    [ -x "$BDS_PY" ] || { fail batdongsan "no python at $BDS_PY (the scraper's playwright lives in its .venv)"; return; }
    # The scraper refuses to start (--new) while all_rentals.json exists, and the importer refuses a file born
    # > 24 h ago — so the last file and its crawl log move aside first.
    if [ -f "$BDS/all_rentals.json" ]; then
      STAMPED="$(date -r "$BDS/all_rentals.json" +%F-%H%M%S)"
      mv "$BDS/all_rentals.json" "$BDS/all_rentals.$STAMPED.json" || { fail batdongsan archive; return; }
      [ -f "$BDS/all_rentals.crawl.json" ] && { mv "$BDS/all_rentals.crawl.json" "$BDS/all_rentals.$STAMPED.crawl.json" || { fail batdongsan archive; return; }; }
    fi
    # The WHOLE rentals list (scraper.py's `all` list: every property type, since 2026-10-13 — it was --apartments,
    # the two apartment lists), to the end, plus a catch-up pass; a HEADED Chrome in the GUI session (Cloudflare
    # refuses headless). Writes all_rentals.json + all_rentals.crawl.json (per-page outcomes).
    ( cd "$BDS" && "$BDS_PY" scraper.py --to-end --new > "$RUN/batdongsan-scrape.log" 2>&1 ) || { fail batdongsan scrape; return; }
    ( cd "$BDS" && "$BDS_PY" enrich_dataset.py > "$RUN/batdongsan-enrich.log" 2>&1 ) || { fail batdongsan enrich; return; }
  fi
  # --previous (the carry-over check) must be a crawl from an EARLIER run: the newest archive at least 5 days
  # old, never one from a failed or repeated run hours ago.
  PREV=""
  for f in $(ls -1t "$BDS"/all_rentals.20*.json 2>/dev/null | grep -v '\.crawl\.json$'); do
    # -mtime +4 = more than 4 whole days, i.e. at least 5 days old.
    if [ -n "$(find "$f" -mtime +4 -print 2>/dev/null)" ]; then PREV="$f"; break; fi
  done
  [ -n "$PREV" ] || { fail batdongsan "no scrape at least 5 days old for the carry-over check"; return; }
  # No --subcat: every type is imported by the same 7-day judgement; the fresh set covers apartments.
  # Exit codes: 0 ok · 3 coverage refused (import applied, no set) · 4 page tombstones owed, set written
  # (a .retombstone.sql sits in the journal) · 5 tombstones owed AND set refused · anything else: failure.
  dbrun "$RUN/batdongsan-import.log" npx tsx scripts/import-batdongsan-rentals.ts --src "$BDS/all_rentals.json" --previous "$PREV" --max-age-days "$AGE_DAYS" \
    --fresh-out "$FRESH" --crawl-log "$BDS/all_rentals.crawl.json" \
    ${JOURNAL[@]+"${JOURNAL[@]}"} $APPLY; rc=$?
  case "$rc" in 0|3|4|5) ;; *) fail batdongsan import; return ;; esac
  if [ -n "$APPLY" ] && { [ "$rc" -eq 4 ] || [ "$rc" -eq 5 ]; }; then
    # Owed page tombstones: apply the repair file the importer wrote, so revived pages stop serving a cached
    # 404. No repair file, or a repair that fails, stops this source here (photos, expiry) — never a silent pass.
    ls "$RUN"/journal/batdongsan-*.retombstone.sql >/dev/null 2>&1 || { fail batdongsan "tombstones owed but no repair file"; return; }
    ensure_db || { fail batdongsan "owed tombstones: the DB tunnel is down"; return; }
    for f in "$RUN"/journal/batdongsan-*.retombstone.sql; do
      psql "${DIRECT_URL:-$DATABASE_URL}" -X -q -v ON_ERROR_STOP=1 -f "$f" >> "$RUN/batdongsan-retombstone.log" 2>&1 \
        || { fail batdongsan "owed tombstones could not be applied ($(basename "$f"))"; return; }
      echo "  [batdongsan] owed tombstones applied from $(basename "$f")"
    done
  fi
  if [ -n "$APPLY" ]; then
    dbrun "$RUN/batdongsan-photos.log" npx tsx scripts/attach-batdongsan-photos.ts --src "$BDS/all_rentals.json" --images "$BDS/images" --apply || { fail batdongsan photos; return; }
    # Rows still without a photo are hidden (never --restore: it republishes photo-bearing hidden rows).
    dbrun "$RUN/batdongsan-imageless.log" npx tsx scripts/hide-imageless-imports.ts --apply || { fail batdongsan imageless; return; }
  fi
  if [ "$rc" -eq 3 ] || [ "$rc" -eq 5 ] || [ ! -f "$FRESH" ]; then fail batdongsan "coverage not proven — imported, expiry skipped"; return; fi
  expire batdongsan "$S" "$FRESH" || { fail batdongsan expire; return; }
  summary batdongsan
}

seller_of() {
  case "$1" in
    nhatot) echo nhatot-import-seller-0001 ;; muaban) echo muaban-net-import-seller-0001 ;;
    muaban-places) echo muaban-net-import-seller-0001 ;;
    honeycomb) echo honeycomb-import-seller-0001 ;; rever) echo cmub0wead0000zrq418bqq27m ;;
    batdongsan) echo bds-vn-import-seller-0001 ;; *) return 1 ;;
  esac
}
# The LaunchAgent wraps this in `caffeinate -i`: an idle-sleeping Mac would stall a multi-hour run mid-crawl. (A
# lid-close still sleeps it — hence the tunnel re-check before every database step.)
RAN=()
if [ -z "$SWEEP_ONLY" ]; then
  for src in $SOURCES; do
    seller="$(seller_of "$src")" || { echo "unknown source $src"; FAILED+=("$src"); continue; }
    # ⛔ THE 66 h GATE (scripts/apartments-gate.sh): only --apply runs are gated; a dry run reads every source asked for.
    if [ -n "$APPLY" ] && [ -z "$FORCE" ] && ! source_due "$STATE/last-success-$src" "$START_EPOCH"; then
      echo "── $src: last success $(epoch_iso "$(stamp_read "$STATE/last-success-$src")") — under ${GATE_HOURS} h ago, not due"
      continue
    fi
    echo "── $(date '+%T') $src"
    # Owed from the first import on: a run killed (a shutdown, a lid-close) between an import and classify must not
    # leave rows without their derived aptType/furnishing until the next import — the marker goes only when it ran.
    [ -n "$APPLY" ] && : > "$STATE/classify-pending"
    SRC_OK=1
    RAN+=("$src")
    "run_$(printf '%s' "$src" | tr '-' '_')"
    # The backstop is per SELLER: muaban's runs with its apartment unit, not again with its places.
    [ "$src" = muaban-places ] || backstop "$src" "$seller"
    # ⛔ The success stamp — only after the source's whole refresh succeeded, and only for --apply runs.
    if [ -n "$APPLY" ] && [ "$SRC_OK" = 1 ]; then
      stamp_write "$STATE/last-success-$src" "$START_EPOCH" || { echo "  ✗ could not write $STATE/last-success-$src"; FAILED+=("$src-stamp"); }
    fi
  done

  # Every import rewrites `attributes`; classify puts the derived aptType/furnishing back. It runs after any import,
  # and — since a failed or interrupted one must not wait 66 h for the next import — every morning while the marker
  # (written before the first import of a run) is there, until it has succeeded once.
  PENDING="$STATE/classify-pending"
  [ "${#RAN[@]}" -gt 0 ] || echo "── no source due — the imports are skipped today; the sweep still runs"
  if [ "${#RAN[@]}" -gt 0 ] || [ -f "$PENDING" ]; then
    echo "── $(date '+%T') classify$([ "${#RAN[@]}" -gt 0 ] || echo ' (pending from an earlier run)')"
    if dbrun "$RUN/classify.log" npx tsx scripts/classify-apartment-rentals.ts ${JOURNAL[@]+"${JOURNAL[@]}"} $APPLY; then
      [ -n "$APPLY" ] && rm -f "$PENDING"
    else
      echo "  ✗ classify FAILED — it runs again tomorrow"; FAILED+=(classify)
      [ -n "$APPLY" ] && : > "$PENDING"
    fi
    tail -3 "$RUN/classify.log" | sed 's/^/  /'
  fi
fi

# ⛔ THE DAILY SWEEP — every run, whatever the gate did: every live imported place row (apartment, house, room,
# office, untyped) of the five rental import sellers whose postedAt is older than 7 days → expired. Its one refusal is
# per seller (src/lib/rental-sweep.ts): a seller that would lose over 95% of its live rows at once while its own
# refresh has not succeeded for 4+ days is HELD BACK — the others still expire — and the sweep exits 3 (alert).
echo "── $(date '+%T') sweep (live imported place rows past $AGE_DAYS days → expired)"
# One sweep at a time (a refresh's closing sweep and a sweep-only run beside it): the second one skips — the first
# is doing the same work. A lock whose pid is dead, or is no longer this job, is cleared.
SWEEPLOCK="$JROOT/.sweep.lock"
if ! mkdir "$SWEEPLOCK" 2>/dev/null; then
  sholder="$(lock_holder "$SWEEPLOCK")"
  if [ -n "$sholder" ] && kill -0 "$sholder" 2>/dev/null && ps -o command= -p "$sholder" 2>/dev/null | grep -q 'apartments-weekly'; then
    # A sweep takes minutes: one holding its lock for hours is hung, and every morning would skip silently — say so.
    [ -n "$(find "$SWEEPLOCK/pid" -mmin +360 2>/dev/null)" ] && FAILED+=(sweep-lock-held-over-6h)
    SWEEPLOCK=""
  else rm -rf "$SWEEPLOCK"; mkdir "$SWEEPLOCK" 2>/dev/null || SWEEPLOCK=""; fi
fi
if [ -z "$SWEEPLOCK" ]; then
  echo "  another sweep is running (pid ${sholder:-?}) — this one is skipped"
else
  echo $$ > "$SWEEPLOCK/pid"
  # The success stamps say, per seller, when its refresh last worked: the sweep's guard holds back a seller whose
  # refresh has been dead for days rather than empty its storefront in one go (src/lib/rental-sweep.ts).
  dbrun "$RUN/sweep.log" npx tsx scripts/expire-rentals.ts --sweep --stamps-dir "$STATE" ${JOURNAL[@]+"${JOURNAL[@]}"} $APPLY; rc=$?
  rm -rf "$SWEEPLOCK"
  case "$rc" in
    0) ;;
    3) echo "  ✗ sweep HELD BACK rows of a refresh that is dead (they would nearly all go at once) — see $RUN/sweep.log"; FAILED+=(sweep-held-back) ;;
    # (Each expiry and its page tombstones commit in one statement — expire-rentals.ts — so a failure owes no repair.)
    *) echo "  ✗ sweep FAILED — see $RUN/sweep.log"; FAILED+=(sweep) ;;
  esac
  grep -E "^SWEEP|REFUSED|EXPIRED|changed meanwhile|journal written" "$RUN/sweep.log" | sed 's/^/  /'
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  msg="property-rentals: FAILED ${FAILED[*]} — $RUN"
  echo "── $msg"
  notify "${FAILED[*]}"
  exit 1
fi
echo "── $(date '+%F %T') done"
