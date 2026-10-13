#!/usr/bin/env bash
# HCMC vehicle-rental refresh for eno.vn — EVERY 3 DAYS, triggered DAILY. Owner, 2026-10-13: "every 3 days it should
# check and update … remove most of car rental leave only reliable fresh ones same with motorbike rentals maybe 7-10
# days old ones" (it was weekly since 2026-09-28: "yes to a weekly re-scrape + retire").
# ⚠️ THE NAME STILL SAYS "weekly" ON PURPOSE: the installed LaunchAgent (vn.eno.vehicle-rentals-weekly) and the
# ~/eno-vehicles-job worktree point at this path, so a fast-forward of the worktree keeps the job running even
# before the new plist is installed — the cadence lives in the gate below, not in the name.
#
#   0. gate      an --apply run goes ahead only when the last SUCCESSFUL run is ≥ 66 h old (src/lib/vehicle-job-gate.ts,
#                stamp $JROOT/.last-success, written only at the very end of a fully successful --apply run): a
#                failed or refused run retries the next morning, and a trigger missed in sleep fires on wake.
#                Then ONE RUN AT A TIME (atomic mkdir lock, a dead holder's lock cleared) under caffeinate.
#   1. scrape    Mioto (HCMC query points), BonbonCar (HCMC), the five HCMC bike shops
#   2. trips     snapshot this scrape's Mioto trip counts (seeding from the older snapshots on disk) —
#                scripts/vehicle-trips-history.ts; the 14-day trip test reads them
#   3. gone      positive gone signals only, 80% count guard (scripts/vehicle-rentals-gone.py) → 'hidden'
#   4. photos    host the photos of what will be written: reliable cars and listed bikes only
#   5. import    create / update reliable cars + listed bikes, hide the gone ones, then the STATUS STEP — expire
#                cars that fail the reliability rule or vanished from a complete scrape and bikes missing from
#                their shop's last 3 checks; revive expired ones that are fresh again (journal + per-page
#                tombstones + per-source count guards; src/lib/vehicle-status-plan.ts). The DB tunnel is the
#                supervised one (scripts/db-tunnel.sh), re-checked right before the stage.
#   6. baseline  the gone helper's next baseline — only after an --apply import went through
#   7. stamp     the success stamp — only when every step succeeded and no source was refused; a source refused
#                on two runs in a row stamps anyway (alerting), so a lasting refusal costs no daily re-scrapes
#
# DRY BY DEFAULT: scrapes and computes everything, prints what every write WOULD do, writes nothing to the database,
# storage, the trips/presence history or the stamp. `--apply` (what the LaunchAgent passes) writes.
#
# Run by ~/Library/LaunchAgents/vn.eno.vehicle-rentals-weekly.plist (scripts/vn.eno.vehicle-rentals-weekly.plist),
# daily at 04:30. Log: ~/eno-import-journals/vehicles/weekly.log; per run: …/vehicles/<stamp>/ (+ journal/).
#
# Env (all optional):
#   ENO_REPO          checkout whose scripts run (default ~/eno-vehicles-job — a CLEAN detached worktree at origin/main;
#                     fast-forward it + prisma generate after an importer change)
#   VEH_ENV_FILE      env file for DB + storage (default ~/eno.vn/.env; "none" = the caller's environment, e.g. a
#                     scratch DATABASE_URL for a dry proof — no tunnel is opened then)
#   VEH_SKIP_SCRAPE=1 reuse the datasets already on disk (proof runs; never in the scheduled job)
#   VEH_FORCE_RUN=1   an --apply hand run that ignores the 66 h gate (the lock still applies)
#   VEH_ACCEPT=a,b    pass `--accept a,b` to the status step: an operator overriding a refused guard for one run
#   MIOTO_DIR / BONBON_DIR / BIKES_DIR   dataset roots (defaults ~/mioto_rentals_vn …)
#
# ⚠️ `set -e` is NOT relied on (it is a no-op in this setup): every step that matters ends in a test.
# ⚠️ bash 3.2 (macOS /bin/bash): arrays expand as ${A[@]+"${A[@]}"} under `set -u`; zsh would not word-split.
set -uo pipefail
APPLY=""; [ "${1:-}" = "--apply" ] && APPLY="--apply"
ENO="${ENO_REPO:-$HOME/eno-vehicles-job}"
ENVF="${VEH_ENV_FILE:-$HOME/eno.vn/.env}"
MIOTO="${MIOTO_DIR:-$HOME/mioto_rentals_vn}"
BONBON="${BONBON_DIR:-$HOME/bonboncar_rentals_vn}"
BIKES="${BIKES_DIR:-$HOME/motorbike_rentals_vn}"
JROOT="${VEH_JOURNAL:-$HOME/eno-import-journals/vehicles}"
STAMP="$(date +%F-%H%M%S)"   # unique per run: a dry run and an --apply on one day must not collide
RUN="$JROOT/$STAMP"
BASE="$JROOT/latest"            # last applied run's datasets (the gone helper's baseline; the first status guard's fallback)
TRIPS="$JROOT/trips"            # Mioto trip counts, one snapshot per scrape (scripts/vehicle-trips-history.ts)
PRESENCE="$JROOT/presence"      # one entry per applied status step: the count guards' references + the bike checks
SUCCESS="$JROOT/.last-success"  # ISO time of the last fully successful --apply run — the 66 h gate reads it
REFUSED="$JROOT/.last-refused"  # the sources the last run's status step refused, one per line (step 7)
LOCKDIR="$JROOT/.refresh.lock"
SHOPS="janmotorbike theextramile dungmotorbikes tuanmotorbike rentabikevn"
PY=/usr/bin/python3             # the python.org 3.13 here lacks CA certs; the system one works
# Every way this job can end badly notifies — including the early exits, before any scrape.
# (Double quotes and backslashes are stripped: inside the AppleScript string literal they would end or escape it.)
notify() { local m="${1//\"/}"; m="${m//\\/}"; /usr/bin/osascript -e "display notification \"${m:0:220}\" with title \"${2:-eno vehicle-rentals FAILED}\" sound name \"Basso\"" 2>/dev/null; }
die() { echo "── $(date '+%F %T') $1"; notify "$1"; exit 1; }
mkdir -p "$JROOT" || exit 1
cd "$ENO" || die "repo $ENO missing — install the job worktree"

# ── 0. gate, lock, caffeinate ───────────────────────────────────────────────────────────────────
if [ -n "$APPLY" ] && [ "${VEH_FORCE_RUN:-}" != "1" ]; then
  GATE="$(npx tsx scripts/vehicle-job-gate.ts --stamp "$SUCCESS" 2>&1)"; rc=$?
  case "$rc" in
    0) ;;
    10) echo "── $(date '+%F %T') vehicle refresh not due: $GATE"; exit 0 ;;
    *) die "success gate FAILED (exit $rc): $GATE" ;;
  esac
fi
# ⛔ ONE RUN AT A TIME, whoever starts it (launchd or a hand run): two would both move the Mioto checkpoints aside,
# re-scrape and apply the same stages. mkdir is atomic; a lock whose holder is dead is cleared — UNDER A SECOND mkdir
# ($LOCKDIR.break), so two starters that both saw the same dead holder cannot both clear it and both run (review
# 2026-10-13: the bare check-then-remove let the loser delete the winner's fresh lock). Inside the break the pid is
# read again: only the lock of the dead holder seen before is removed. A lock just created, whose pid is not yet
# written, is left alone for a minute. A live holder is normal for a daily trigger landing on a long run — quiet,
# unless it has held the lock for over 12 hours.
recent() { [ -n "$(find "$1" -maxdepth 0 -mmin "-$2" 2>/dev/null)" ]; }   # modified within the last $2 minutes
LOCK_WHY=""                     # why take_lock backed off: alive | young | breaking | lost
# A lock whose pid could not be written would be nobody's (the EXIT trap would not remove it, a later starter
# would break it while this run goes on): give it back and stop.
own_lock() { echo $$ > "$LOCKDIR/pid" 2>/dev/null && return 0; rm -rf "$LOCKDIR"; LOCK_WHY=pid-unwritable; return 1; }
take_lock() {
  mkdir "$LOCKDIR" 2>/dev/null && { own_lock; return $?; }
  local holder ok=1
  holder="$(cat "$LOCKDIR/pid" 2>/dev/null)"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then LOCK_WHY=alive; return 1; fi
  if [ -z "$holder" ] && recent "$LOCKDIR" 1; then LOCK_WHY=young; return 1; fi
  LOCK_WHY=breaking
  if ! mkdir "$LOCKDIR.break" 2>/dev/null; then
    # A breaker killed mid-break (it takes milliseconds) leaves this behind: cleared after 10 minutes.
    recent "$LOCKDIR.break" 10 || rmdir "$LOCKDIR.break" 2>/dev/null
    return 1
  fi
  if [ "$(cat "$LOCKDIR/pid" 2>/dev/null)" = "$holder" ]; then
    echo "── $(date '+%F %T') clearing a lock left by pid ${holder:-?}, which is not running"
    rm -rf "$LOCKDIR"
  fi
  LOCK_WHY=lost
  mkdir "$LOCKDIR" 2>/dev/null && own_lock && ok=0
  rmdir "$LOCKDIR.break" 2>/dev/null
  return $ok
}
if ! take_lock; then
  [ "$LOCK_WHY" = pid-unwritable ] && die "could not write $LOCKDIR/pid — this run did nothing"
  holder="$(cat "$LOCKDIR/pid" 2>/dev/null)"
  if [ "$LOCK_WHY" = alive ] && ! recent "$LOCKDIR" 720; then die "run pid ${holder:-?} has held $LOCKDIR for over 12 h — stuck? This run did nothing"; fi
  echo "── $(date '+%F %T') another vehicle refresh (pid ${holder:-?}, $LOCK_WHY) holds the lock — this one did nothing"; exit 0
fi
# Only OUR lock is removed on exit (a run that lost a race must not delete the winner's).
trap '[ "$(cat "$LOCKDIR/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCKDIR"' EXIT
# Awake for the whole run (scraping is hours at 1 req/s): -i blocks idle sleep; -s blocks system sleep, which
# caffeinate(8) honours ONLY ON AC POWER — so this is "-s when on AC", a charger plugged in mid-run included.
# A lid closed on battery still sleeps the Mac: that is why the DB tunnel is supervised and re-checked below.
/usr/bin/caffeinate -i -s -w $$ >/dev/null 2>&1 &
mkdir -p "$RUN" || die "cannot create $RUN"
echo "── $(date '+%F %T') vehicle-rentals ${APPLY:-(dry run)}  repo $ENO @ $(git -C "$ENO" rev-parse --short HEAD 2>/dev/null)"

# ── 1. scrape ───────────────────────────────────────────────────────────────────────────────────
if [ "${VEH_SKIP_SCRAPE:-}" != "1" ]; then
  # Mioto: last run's search/detail checkpoints move aside so this run asks again (both are resumable and
  # would otherwise skip every car already fetched). Photos stay — the downloader skips files it already has.
  # The moved details.jsonl is what step 2 snapshots as the trips history.
  ( cd "$MIOTO" || exit 1
    mkdir -p "state/prev-$STAMP" || exit 1
    for f in search_hits.jsonl search_state.json search.out windows.json details.jsonl details.out details_failed.json; do
      [ -e "state/$f" ] && mv "state/$f" "state/prev-$STAMP/"
    done
    export MIOTO_POINTS="ho_chi_minh,tan_an,ba_ria"   # found all 5,700 HCMC cars on 2026-09-28
    $PY scraper.py search  > "$RUN/mioto-search.log" 2>&1 || exit 1
    $PY scraper.py details > "$RUN/mioto-details.log" 2>&1 || exit 1
    $PY download_images.py > "$RUN/mioto-images.log" 2>&1 || exit 1
    $PY scraper.py build   > "$RUN/mioto-build.log" 2>&1 || exit 1
  ) || die "mioto scrape FAILED — see $RUN/mioto-*.log"
  # BonbonCar: detail pages are cached per SKU; move the cache aside so prices are re-read.
  ( cd "$BONBON" || exit 1
    if [ -d raw/detail ]; then mv raw/detail "raw/detail.prev-$STAMP" || exit 1; fi
    export BONBON_CITIES="Hồ Chí Minh"
    $PY scraper.py > "$RUN/bonbon-scrape.log" 2>&1 || exit 1
    $PY download_images.py > "$RUN/bonbon-images.log" 2>&1 || exit 1
    $PY scraper.py --reuse-index > "$RUN/bonbon-build.log" 2>&1 || exit 1
  ) || die "bonboncar scrape FAILED — see $RUN/bonbon-*.log"
  # Shops: each scraper keeps a bike's downloaded photos when its photo list is unchanged.
  ( cd "$BIKES" || exit 1
    for s in $SHOPS; do .venv/bin/python -m "scrapers.$s" >> "$RUN/bikes-scrape.log" 2>&1 || exit 1; done
    .venv/bin/python download_images.py $SHOPS > "$RUN/bikes-images.log" 2>&1 || exit 1
    .venv/bin/python build_dataset.py > "$RUN/bikes-build.log" 2>&1 || exit 1
  ) || die "bike scrape FAILED — see $RUN/bikes-*.log"
  echo "  scrape ok"
else
  echo "  scrape SKIPPED (VEH_SKIP_SCRAPE=1) — datasets on disk as-is"
fi

# ── 2. trips history (no database) ──────────────────────────────────────────────────────────────
TRIPS_ARGS=(); [ -n "$APPLY" ] && TRIPS_ARGS=(--apply)
npx tsx scripts/vehicle-trips-history.ts --mioto "$MIOTO" --out "$TRIPS" ${TRIPS_ARGS[@]+"${TRIPS_ARGS[@]}"} > "$RUN/trips.log" 2>&1 \
  || die "trips history FAILED — see $RUN/trips.log"
grep -E " new| REPLACES|wrote|would write|nothing to write|^  !" "$RUN/trips.log" | sed 's/^/  [trips] /'

# ── 3. gone list ────────────────────────────────────────────────────────────────────────────────
GONE="$RUN/gone.txt"
$PY "$ENO/scripts/vehicle-rentals-gone.py" --prev "$BASE" --mioto "$MIOTO" --bonbon "$BONBON" --bikes "$BIKES" \
  --out "$GONE" --next-baseline "$RUN/next-baseline" | tee "$RUN/gone.log" || die "gone list FAILED — see $RUN/gone.log"

# ── 4. photos (storage, no database) ────────────────────────────────────────────────────────────
if [ "$ENVF" != "none" ]; then
  set -a; . "$ENVF" || die "env file $ENVF unreadable"; set +a
fi
# (Re)check the database tunnel right before a stage that needs it. eno.vn's database is reached only through
# the SSH tunnel on :5433; the SUPERVISED one restarts after a drop (a lid-close sleep killed the old bare
# `ssh -fN`, which this job opened once and never looked at again).
db_up() {
  [ "$ENVF" = "none" ] && return 0
  bash "$ENO/scripts/db-tunnel.sh" status >/dev/null 2>&1 && return 0
  echo "  DB tunnel down — starting the supervised one (scripts/db-tunnel.sh)"
  bash "$ENO/scripts/db-tunnel.sh" start >> "$RUN/tunnel.log" 2>&1 || die "DB tunnel to the box FAILED — see $RUN/tunnel.log"
}
# The photos stage needs storage, not the database (only --stage import reads the cached translations), so the
# tunnel is (re)checked right before the import below — the stage that needs it.
SRC=(--mioto "$MIOTO" --bonbon "$BONBON" --bikes "$BIKES" --manifest "$JROOT/photos-manifest.jsonl" --trips "$TRIPS")
npx tsx scripts/import-vehicle-rentals.ts --stage photos "${SRC[@]}" $APPLY > "$RUN/photos.log" 2>&1 \
  || { tail -5 "$RUN/photos.log" | sed 's/^/  /'; die "photos stage FAILED — see $RUN/photos.log"; }
grep -E "reliability|trips history|shop presence|staged|dropped|rows needing|^\{|mode" "$RUN/photos.log" | sed 's/^/  /'

# ── 5. import + status ──────────────────────────────────────────────────────────────────────────
STATUS_ARGS=(--presence "$PRESENCE" --prev "$BASE")
[ -n "$APPLY" ] && STATUS_ARGS+=(--journal-dir "$RUN/journal")
[ -n "${VEH_ACCEPT:-}" ] && STATUS_ARGS+=(--accept "$VEH_ACCEPT")
db_up
npx tsx scripts/import-vehicle-rentals.ts --stage import "${SRC[@]}" --gone "$GONE" "${STATUS_ARGS[@]}" $APPLY > "$RUN/import.log" 2>&1; rc=$?
PARTIAL=""
case "$rc" in
  0) ;;
  3) PARTIAL=1 ;;   # written, but a source's status step was refused (short scrape, expire-share guard, trips history)
  *) tail -5 "$RUN/import.log" | sed 's/^/  /'; die "import stage FAILED (exit $rc) — see $RUN/import.log" ;;
esac
grep -E "hosted \+ ready|created|gone → hidden|guard |→ expire|→ revive|REFUSED|WARNING|EXPIRED|journal  |run recorded|DRY RUN" "$RUN/import.log" | sed 's/^/  /'
# A warning does not stop the run or the stamp (a retry tomorrow cannot fix it — e.g. a trips history too young to
# judge Mioto heals only as its snapshots age), but it is worth a look: notify, carry on.
W="$(grep -m1 "STATUS STEP WARNINGS" "$RUN/import.log")"
[ -n "$W" ] && [ -n "$APPLY" ] && notify "$W" "eno vehicle-rentals WARNING"

# ── 6. baseline for the gone helper — only once this run's state is actually in the database ─────
# The gone helper built it: this run's rows plus every absent row that was NOT confirmed gone (asked again
# next run), and the previous baseline untouched for a source its 80% guard skipped.
if [ -n "$APPLY" ]; then
  mkdir -p "$BASE" || die "cannot create $BASE"
  for f in mioto.json bonbon.json bikes.json; do
    # copy-then-rename: a crash or a full disk leaves last run's file whole, never a truncated one
    [ -f "$RUN/next-baseline/$f" ] && { cp "$RUN/next-baseline/$f" "$BASE/$f.tmp-$$" && mv "$BASE/$f.tmp-$$" "$BASE/$f" || die "baseline copy FAILED ($f)"; }
  done
  echo "  baseline updated → $BASE"
fi

# ── 7. success stamp — the 66 h gate's clock starts only on a run with nothing refused ───────────
stamp_success() { date -u +%Y-%m-%dT%H:%M:%SZ > "$SUCCESS.tmp" && mv "$SUCCESS.tmp" "$SUCCESS" || die "could not write the success stamp $SUCCESS"; }
if [ -n "$PARTIAL" ] && [ -n "$APPLY" ]; then
  # A refused source (a short scrape) is usually one bad night: no stamp, so tomorrow's trigger scrapes again.
  # ⛔ BUT ONLY ONCE PER SOURCE AND EPISODE (review 2026-10-13): a source refused on the last run AND this one is a
  # real change (a shop shrank by more than the guard allows) or a lasting fault, and a daily multi-hour re-scrape
  # fixes neither — that run stamps, so the cadence goes back to every 3 days while every run keeps alerting until
  # someone looks (VEH_ACCEPT=<source> for one run accepts a real drop). Sources are named one per line in $REFUSED.
  NOW_REFUSED="$(grep -m1 '^STATUS STEP REFUSED for: ' "$RUN/import.log" | sed 's/^STATUS STEP REFUSED for: //' | tr '|' '\n' | sed 's/^ *//; s/:.*//' | sort -u)"
  AGAIN="$( [ -f "$REFUSED" ] && printf '%s\n' "$NOW_REFUSED" | grep -Fx -f "$REFUSED" | tr '\n' ' ')"
  printf '%s\n' "$NOW_REFUSED" > "$REFUSED" || true
  if [ -n "$AGAIN" ]; then
    stamp_success
    die "status step REFUSED again for: $AGAIN(REFUSED lines above; $RUN/import.log) — back to the 3-day cadence; check it, then VEH_ACCEPT=<source> for one run if the drop is real"
  fi
  die "status step REFUSED for: $(printf '%s ' $NOW_REFUSED)(REFUSED lines above; $RUN/import.log) — everything else was written; no success stamp, so the next trigger runs again"
fi
[ -n "$PARTIAL" ] && echo "  (dry run) the status step WOULD be refused for a source — the REFUSED lines above"
if [ -n "$APPLY" ]; then
  stamp_success
  rm -f "$REFUSED"
  echo "  success stamp $(cat "$SUCCESS") → next run due in 66 h"
fi
echo "── $(date '+%F %T') done"
