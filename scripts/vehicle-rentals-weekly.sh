#!/usr/bin/env bash
# HCMC vehicle-rental refresh for eno.vn — EVERY 3 DAYS, triggered DAILY. Owner, 2026-10-13: "every 3 days it should
# check and update … remove most of car rental leave only reliable fresh ones same with motorbike rentals maybe 7-10
# days old ones" (it was weekly since 2026-09-28: "yes to a weekly re-scrape + retire").
# ⚠️ THE NAME STILL SAYS "weekly" ON PURPOSE: the installed LaunchAgent (vn.eno.vehicle-rentals-weekly) and the
# ~/eno-vehicles-job worktree point at this path, so a fast-forward of the worktree keeps the job running even
# before the new plist is installed — the cadence lives in the gate below, not in the name.
#
#   0. gate      an --apply run goes ahead only when the last SUCCESSFUL run STARTED ≥ 66 h ago (src/lib/vehicle-job-gate.ts,
#                stamp $JROOT/.last-success = that run's start, written only at the very end of a fully successful
#                --apply run): a failed or refused run retries the next morning, and a trigger missed in sleep fires on
#                wake. Then ONE RUN AT A TIME (atomic mkdir lock in $HOME, a dead holder's lock cleared) under caffeinate.
#   1. scrape    Mioto (HCMC query points), BonbonCar (HCMC), the five HCMC bike shops — EACH GROUP ON ITS OWN: a group
#                whose scrape fails is left out of this run (its rows untouched, alert), the others go on
#   2. trips     snapshot this scrape's Mioto trip counts (seeding from the older snapshots on disk) —
#                scripts/vehicle-trips-history.ts; the 14-day trip test reads them (a dry run: a preview copy)
#   3. gone      positive gone signals only, 80% count guard (scripts/vehicle-rentals-gone.py) → 'hidden'
#   4. photos    host the photos of what will be written: reliable cars and listed bikes only
#   5. import    create / update reliable cars + listed bikes, hide the gone ones, then the STATUS STEP — expire
#                cars that fail the reliability rule or vanished from complete scrapes and bikes missing from
#                their shop's last 3 checks; revive expired ones that are fresh again (journal + per-page
#                tombstones + per-source count / shrink / growth guards; src/lib/vehicle-status-plan.ts). The
#                database itself is probed right before (SELECT 1 — a port that answers is not a tunnel that
#                works), the supervised tunnel (scripts/db-tunnel.sh) restarted if it does not answer, and the stage
#                retried ONCE if it died on the database.
#   6. baseline  the gone helper's next baseline — only after an --apply import went through
#   7. stamp     the success stamp — only when every step succeeded and nothing was refused or failed; a run whose
#                problems (a refused source, a failed scrape group) were ALL problems on the last run too stamps anyway
#                (alerting), so a lasting fault costs no daily re-scrapes — never a run in which every scrape failed
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
#                     scratch DATABASE_URL for a dry proof — probed, but no tunnel is ever opened then)
#   VEH_JOURNAL       journal root (default ~/eno-import-journals/vehicles) — the lock is NOT under it (see LOCKDIR)
#   VEH_SKIP_SCRAPE=1 reuse the datasets already on disk (proof runs; never in the scheduled job)
#   VEH_FORCE_RUN=1   an --apply hand run that ignores the 66 h gate (the lock still applies)
#   VEH_ACCEPT=a,b    pass `--accept a,b` to the import: for one run, ALL of those sources' guards are overridden (count,
#                     shrink, growth — creations included); check the dry run first
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
SUCCESS="$JROOT/.last-success"  # ISO START of the last fully successful --apply run — the 66 h gate reads it
REFUSED="$JROOT/.last-refused"  # the last run's problems (refused sources, failed scrape groups), one per line (step 7)
# ⛔ ONE LOCK FOR THE MACHINE, NEVER UNDER $JROOT (review 2026-10-13): what it guards are the SHARED scrape folders
# (~/mioto_rentals_vn/state, ~/bonboncar_rentals_vn/raw/detail), which VEH_JOURNAL does not move — a test run with a
# scratch journal took its own lock and could move the scheduled run's Mioto checkpoints aside mid-scrape.
LOCKDIR="$HOME/.eno-vehicle-refresh.lock"
SHOPS="janmotorbike theextramile dungmotorbikes tuanmotorbike rentabikevn"
PY=/usr/bin/python3             # the python.org 3.13 here lacks CA certs; the system one works
# Every way this job can end badly notifies — including the early exits, before any scrape.
# (Double quotes and backslashes are stripped: inside the AppleScript string literal they would end or escape it.)
notify() { local m="${1//\"/}"; m="${m//\\/}"; /usr/bin/osascript -e "display notification \"${m:0:220}\" with title \"${2:-eno vehicle-rentals FAILED}\" sound name \"Basso\"" 2>/dev/null; }
die() { echo "── $(date '+%F %T') $1"; notify "$1"; exit 1; }
# The lock, the problem memory and the error classifier (tested: src/lib/vehicle-job-shell.test.ts) — from THIS checkout.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || die "cannot find the script's own directory"
. "$HERE/vehicle-job-lib.sh" || die "$HERE/vehicle-job-lib.sh missing — install the job worktree whole"
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
# A live holder is normal for a daily trigger landing on a long run — quiet, unless it has held the lock for over 12 h.
if ! take_lock; then
  [ "$LOCK_WHY" = pid-unwritable ] && die "could not write $LOCKDIR/pid — this run did nothing"
  holder="$(cat "$LOCKDIR/pid" 2>/dev/null)"
  if [ "$LOCK_WHY" = alive ] && ! recent "$LOCKDIR" 720; then die "run pid ${holder:-?} has held $LOCKDIR for over 12 h — stuck? This run did nothing"; fi
  echo "── $(date '+%F %T') another vehicle refresh (pid ${holder:-?}, $LOCK_WHY) holds the lock — this one did nothing"; exit 0
fi
# ⛔ THE SUCCESS STAMP IS THIS RUN'S START, not its end (review 2026-10-13): a run ending after ~10:30 (a late start on
# wake, a 4-6 h scrape) left a stamp the third morning's 04:30 trigger could not pass, and the cadence slipped to 4 days.
RUN_START_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Only OUR lock is removed on exit (a run that lost a race must not delete the winner's).
trap '[ "$(cat "$LOCKDIR/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCKDIR"' EXIT
# Awake for the whole run (scraping is hours at 1 req/s): -i blocks idle sleep; -s blocks system sleep, which
# caffeinate(8) honours ONLY ON AC POWER — so this is "-s when on AC", a charger plugged in mid-run included.
# A lid closed on battery still sleeps the Mac: that is why the database is probed (and the tunnel replaced) below.
/usr/bin/caffeinate -i -s -w $$ >/dev/null 2>&1 &
mkdir -p "$RUN" || die "cannot create $RUN"
echo "── $(date '+%F %T') vehicle-rentals ${APPLY:-(dry run)}  repo $ENO @ $(git -C "$ENO" rev-parse --short HEAD 2>/dev/null)"

# ── 1. scrape — each group on its own ───────────────────────────────────────────────────────────
# ⛔ ONE BROKEN SCRAPER STOPS ONLY ITS OWN GROUP (review 2026-10-13: any of them used to `die` before anything was
# imported, and the whole 3-4 h scrape repeated every day until someone fixed it). A failed group (mioto, bonboncar,
# bikes) is left out of every later step — its rows untouched, its gone baseline kept — and is a problem in step 7:
# no stamp the first time (tomorrow retries), a stamp on the second run in a row (alerting).
FAILED=""
has_failed() { case " $FAILED " in *" $1 "*) return 0 ;; esac; return 1; }
if [ "${VEH_SKIP_SCRAPE:-}" != "1" ]; then
  # Mioto: last run's search/detail checkpoints move aside so this run asks again (both are resumable and
  # would otherwise skip every car already fetched). Photos stay — the downloader skips files it already has.
  # The moved details.jsonl is what step 2 snapshots as the trips history.
  # ⛔ A MOVE THAT FAILS FAILS THE GROUP (review 2026-10-13): a details.jsonl left in place makes the details step skip
  # every car it holds and the build re-stamp last run's records as new.
  ( cd "$MIOTO" || exit 1
    mkdir -p "state/prev-$STAMP" || exit 1
    for f in search_hits.jsonl search_state.json search.out windows.json details.jsonl details.out details_failed.json; do
      if [ -e "state/$f" ]; then mv "state/$f" "state/prev-$STAMP/" || exit 1; fi
    done
    export MIOTO_POINTS="ho_chi_minh,tan_an,ba_ria"   # found all 5,700 HCMC cars on 2026-09-28
    $PY scraper.py search  > "$RUN/mioto-search.log" 2>&1 || exit 1
    $PY scraper.py details > "$RUN/mioto-details.log" 2>&1 || exit 1
    $PY download_images.py > "$RUN/mioto-images.log" 2>&1 || exit 1
    $PY scraper.py build   > "$RUN/mioto-build.log" 2>&1 || exit 1
  ) || { FAILED="$FAILED mioto"; echo "  ⛔ mioto scrape FAILED — see $RUN/mioto-*.log; Mioto is left out of this run"; }
  # BonbonCar: detail pages are cached per SKU; move the cache aside so prices are re-read.
  ( cd "$BONBON" || exit 1
    if [ -d raw/detail ]; then mv raw/detail "raw/detail.prev-$STAMP" || exit 1; fi
    export BONBON_CITIES="Hồ Chí Minh"
    $PY scraper.py > "$RUN/bonbon-scrape.log" 2>&1 || exit 1
    $PY download_images.py > "$RUN/bonbon-images.log" 2>&1 || exit 1
    $PY scraper.py --reuse-index > "$RUN/bonbon-build.log" 2>&1 || exit 1
  ) || { FAILED="$FAILED bonboncar"; echo "  ⛔ bonboncar scrape FAILED — see $RUN/bonbon-*.log; BonbonCar is left out of this run"; }
  # Shops: each scraper keeps a bike's downloaded photos when its photo list is unchanged.
  ( cd "$BIKES" || exit 1
    for s in $SHOPS; do .venv/bin/python -m "scrapers.$s" >> "$RUN/bikes-scrape.log" 2>&1 || exit 1; done
    .venv/bin/python download_images.py $SHOPS > "$RUN/bikes-images.log" 2>&1 || exit 1
    .venv/bin/python build_dataset.py > "$RUN/bikes-build.log" 2>&1 || exit 1
  ) || { FAILED="$FAILED bikes"; echo "  ⛔ bike scrape FAILED — see $RUN/bikes-*.log; the shops are left out of this run"; }
  [ -z "$FAILED" ] && echo "  scrape ok"
  [ -n "$FAILED" ] && [ -n "$APPLY" ] && notify "scrape FAILED for:$FAILED — the other sources go on; see $RUN"
else
  echo "  scrape SKIPPED (VEH_SKIP_SCRAPE=1) — datasets on disk as-is"
fi

PARTIAL=""; ALL_FAILED=""; TOMB_FAILED=""
if has_failed mioto && has_failed bonboncar && has_failed bikes; then
  ALL_FAILED=1
  echo "  every scrape group FAILED — nothing to import this run"
else
  # ── 2. trips history (no database) ────────────────────────────────────────────────────────────
  TRIPS_USE="$TRIPS"
  if ! has_failed mioto; then
    if [ -n "$APPLY" ]; then
      TRIPS_ARGS=(--out "$TRIPS" --apply)
    else
      # A dry run writes no history — so it judges with a PREVIEW COPY that this scrape's snapshot is filed into
      # (review 2026-10-13: on a fresh install the dry run otherwise had no snapshot at all and showed no Mioto change).
      TRIPS_USE="$RUN/trips-preview"
      if [ -d "$TRIPS" ]; then cp -R "$TRIPS" "$TRIPS_USE" || die "cannot copy $TRIPS for the preview"; else mkdir -p "$TRIPS_USE" || die "cannot create $TRIPS_USE"; fi
      TRIPS_ARGS=(--out "$TRIPS_USE" --apply)
    fi
    npx tsx scripts/vehicle-trips-history.ts --mioto "$MIOTO" "${TRIPS_ARGS[@]}" > "$RUN/trips.log" 2>&1 \
      || die "trips history FAILED — see $RUN/trips.log"
    grep -E " new| REPLACES|wrote|would write|nothing to write|^  !" "$RUN/trips.log" | sed 's/^/  [trips] /'
  fi

  # ── 3. gone list ──────────────────────────────────────────────────────────────────────────────
  GONE="$RUN/gone.txt"
  GONE_SRC=()
  has_failed mioto || GONE_SRC+=(--mioto "$MIOTO")
  has_failed bonboncar || GONE_SRC+=(--bonbon "$BONBON")
  has_failed bikes || GONE_SRC+=(--bikes "$BIKES")
  $PY "$ENO/scripts/vehicle-rentals-gone.py" --prev "$BASE" ${GONE_SRC[@]+"${GONE_SRC[@]}"} \
    --out "$GONE" --next-baseline "$RUN/next-baseline" | tee "$RUN/gone.log" || die "gone list FAILED — see $RUN/gone.log"

  # ── 4. photos (storage, no database) ──────────────────────────────────────────────────────────
  if [ "$ENVF" != "none" ]; then
    set -a; . "$ENVF" || die "env file $ENVF unreadable"; set +a
  fi
  # ⛔ THE DATABASE ITSELF ANSWERS, NOT A PORT (review 2026-10-13). `db-tunnel.sh status` passes on anything listening
  # on :5433 — another job's bare `ssh -fN`, or a tunnel whose connection died in sleep and still holds its port for
  # up to ~90 s — and the import then died on "cached translations unreadable". So: SELECT 1 (10 s). A listener that
  # carries nothing gets ~2 min to give up its port (ServerAlive ends a dead ssh within ~90 s) or to recover; once
  # nothing listens, the supervised tunnel is started and must answer. ⛔ A TUNNEL STILL LISTENING IS NEVER KILLED
  # HERE (gate review): it is live and may be another job's — what does not answer then is the database, so the run stops.
  db_probe() { npx tsx scripts/vehicle-db-probe.ts >> "$RUN/tunnel.log" 2>&1; }
  db_up() {
    db_probe && return 0
    [ "$ENVF" = "none" ] && die "the database (VEH_ENV_FILE=none: the caller's DATABASE_URL) does not answer — see $RUN/tunnel.log"
    local i
    for i in 1 2 3 4 5 6 7 8; do
      nc -z 127.0.0.1 5433 >/dev/null 2>&1 || break
      sleep 15
      db_probe && return 0
    done
    nc -z 127.0.0.1 5433 >/dev/null 2>&1 \
      && die "the database does not answer through the tunnel listening on :5433 (left alone: it may be another job's) — see $RUN/tunnel.log; a stuck tunnel: bash scripts/db-tunnel.sh stop, then start"
    echo "  nothing listens on :5433 — starting the supervised tunnel (scripts/db-tunnel.sh)"
    bash "$ENO/scripts/db-tunnel.sh" start >> "$RUN/tunnel.log" 2>&1 || die "DB tunnel to the box FAILED — see $RUN/tunnel.log"
    db_probe || die "the database does not answer even through a fresh supervised tunnel — see $RUN/tunnel.log"
  }
  # The photos stage needs storage, not the database (only --stage import reads the cached translations), so the
  # database is checked right before the import below — the stage that needs it.
  SRC=(--manifest "$JROOT/photos-manifest.jsonl")
  has_failed mioto || SRC+=(--mioto "$MIOTO" --trips "$TRIPS_USE")
  has_failed bonboncar || SRC+=(--bonbon "$BONBON")
  has_failed bikes || SRC+=(--bikes "$BIKES")
  npx tsx scripts/import-vehicle-rentals.ts --stage photos "${SRC[@]}" $APPLY > "$RUN/photos.log" 2>&1 \
    || { tail -5 "$RUN/photos.log" | sed 's/^/  /'; die "photos stage FAILED — see $RUN/photos.log"; }
  grep -E "reliability|trips history|trips snapshot|shop presence|staged|dropped|rows needing|^\{|mode" "$RUN/photos.log" | sed 's/^/  /'

  # ── 5. import + status ────────────────────────────────────────────────────────────────────────
  STATUS_ARGS=(--presence "$PRESENCE" --prev "$BASE")
  [ -n "$APPLY" ] && STATUS_ARGS+=(--journal-dir "$RUN/journal")
  [ -n "${VEH_ACCEPT:-}" ] && STATUS_ARGS+=(--accept "$VEH_ACCEPT")
  # VEH_RUN_START: rows created since this run began are its own (the retry below counts them in the growth budget).
  run_import() { VEH_RUN_START="$RUN_START_UTC" npx tsx scripts/import-vehicle-rentals.ts --stage import "${SRC[@]}" --gone "$GONE" "${STATUS_ARGS[@]}" $APPLY > "$RUN/import.log" 2>&1; }
  db_up
  run_import; rc=$?
  # ⛔ ONE RETRY, ONLY WHEN THE DATABASE LOOKS LIKE THE CAUSE — its error is in the log, or it does not answer right
  # after. Safe to re-run whatever the cause: the scrape on disk is reused, every write is conditional (an upsert, a
  # status move from the row's read state), a refusal refuses again, and the run history counts a re-record of one
  # scrape once. The first attempt's status journals are re-tombstoned first: a move it wrote before dying is not
  # re-planned, and its after-write purge may never have run.
  if [ "$rc" != 0 ] && [ "$rc" != 3 ] && { ! db_probe || is_conn_error "$RUN/import.log"; }; then
    mv "$RUN/import.log" "$RUN/import-attempt1.log"
    echo "  import stage lost the database (exit $rc, $RUN/import-attempt1.log) — database re-checked, stage retried once"
    db_up
    for j in "$RUN"/journal/vehicle-status-*.json; do
      [ -f "$j" ] || continue
      # A failure here is a PROBLEM (step 7: no stamp, alert) — pages of rows the first attempt moved may be stale.
      npx tsx scripts/vehicle-rentals-status.ts --tombstone "$j" >> "$RUN/import-attempt1.log" 2>&1 \
        || { TOMB_FAILED=1; echo "  ⛔ re-tombstoning $j FAILED — retry by hand: npx tsx scripts/vehicle-rentals-status.ts --tombstone $j"; }
    done
    run_import; rc=$?
  fi
  case "$rc" in
    0) ;;
    3) PARTIAL=1 ;;   # written, but a source's status step or creations were refused (short scrape, a shrink / growth guard)
    *) tail -5 "$RUN/import.log" | sed 's/^/  /'; die "import stage FAILED (exit $rc) — see $RUN/import.log" ;;
  esac
  grep -E "hosted \+ ready|created|CREATIONS HELD|gone → hidden|guard |→ expire|→ revive|REFUSED|WARNING|EXPIRED|journal  |run recorded|DRY RUN" "$RUN/import.log" | sed 's/^/  /'
  # A warning does not stop the run or the stamp (a retry tomorrow cannot fix it — e.g. a trips history too young to
  # judge Mioto heals only as its snapshots age), but it is worth a look: notify, carry on.
  W="$(grep -m1 "STATUS STEP WARNINGS" "$RUN/import.log")"
  [ -n "$W" ] && [ -n "$APPLY" ] && notify "$W" "eno vehicle-rentals WARNING"

  # ── 6. baseline for the gone helper — only once this run's state is actually in the database ───
  # The gone helper built it: this run's rows plus every absent row that got no answer (asked again next run), and
  # the previous baseline untouched for a source its 80% guard skipped or this run left out. ⛔ A source whose
  # CREATIONS the import held this run keeps last run's file too (gate review): a spike of new rows nobody vouched for
  # must not become the gone helper's reference, or every correct scrape after it reads as short. (Only creations: a
  # shrink or revival refusal says nothing against the scrape's count — and bikes.json is all five shops' file.)
  if [ -n "$APPLY" ]; then
    mkdir -p "$BASE" || die "cannot create $BASE"
    REFUSED_NOW=" $( [ -n "$PARTIAL" ] && creation_refused_sources "$RUN/import.log" | tr '\n' ' ') "
    for f in mioto.json bonbon.json bikes.json; do
      case "$f" in mioto.json) in_file="mioto" ;; bonbon.json) in_file="bonboncar" ;; *) in_file="$SHOPS" ;; esac
      kept=""
      for s in $in_file; do case "$REFUSED_NOW" in *" $s "*) kept="$s" ;; esac; done
      if [ -n "$kept" ]; then echo "  baseline $f kept as it was ($kept's creations were held this run)"; continue; fi
      # copy-then-rename: a crash or a full disk leaves last run's file whole, never a truncated one
      [ -f "$RUN/next-baseline/$f" ] && { cp "$RUN/next-baseline/$f" "$BASE/$f.tmp-$$" && mv "$BASE/$f.tmp-$$" "$BASE/$f" || die "baseline copy FAILED ($f)"; }
    done
    echo "  baseline updated → $BASE"
  fi
fi

# ── 7. success stamp — the 66 h gate's clock starts only on a run with no problem ─────────────────
stamp_success() { printf '%s\n' "$RUN_START_UTC" > "$SUCCESS.tmp" && mv "$SUCCESS.tmp" "$SUCCESS" || die "could not write the success stamp $SUCCESS"; }
PROBLEMS=""
for g in $FAILED; do PROBLEMS="$PROBLEMS scrape:$g"; done
if [ -n "$PARTIAL" ]; then
  # Exit 3 always prints that line; one that cannot be read is still a problem — never a success (gate review).
  R="$(refused_sources "$RUN/import.log" | tr '\n' ' ')"
  PROBLEMS="$PROBLEMS ${R:-import:refused}"
fi
[ -n "$TOMB_FAILED" ] && PROBLEMS="$PROBLEMS retombstone"
PROBLEMS="$(echo $PROBLEMS)"   # trimmed, one space apart
if [ -n "$APPLY" ]; then
  if [ -n "$PROBLEMS" ]; then
    # A problem is usually one bad night: no stamp, so tomorrow's trigger runs again. ⛔ BUT ONLY ONCE PER EPISODE: a
    # run whose problems were ALL problems on the last run too is a lasting fault or a real change (a shop shrank more
    # than the guard allows, a scraper broke), and a daily multi-hour re-scrape fixes neither — that run stamps, so the
    # cadence goes back to every 3 days while every run keeps alerting until someone looks. One NEW problem keeps its
    # next-day retry, and a run in which EVERY scrape failed (the network, most likely) never stamps: it refreshed
    # nothing, and failing fast costs little.
    # A run in which every scrape failed says nothing about any one group: it leaves the memory as it was (gate review:
    # recorded, it made the next run's first real failure of one group read as a repeat, and stamp).
    [ -n "$ALL_FAILED" ] && die "every scrape group FAILED — nothing was refreshed; no success stamp, so the next trigger runs again ($RUN)"
    NEW="$(problems_new "$PROBLEMS" "$REFUSED")"
    if [ -z "$NEW" ]; then
      stamp_success
      die "problem again for: $PROBLEMS — all of it on the last run too: back to the 3-day cadence, alerting every run; check $RUN — a broken scraper needs fixing; VEH_ACCEPT=<source> overrides ALL that source's guards for one run"
    fi
    die "problem for: $PROBLEMS (new: ${NEW% }) — everything else was written; no success stamp, so the next trigger runs again ($RUN)"
  fi
  stamp_success
  rm -f "$REFUSED"
  echo "  success stamp $(cat "$SUCCESS") (this run's start) → next run due 66 h after it"
elif [ -n "$PROBLEMS" ]; then
  echo "  (dry run) an --apply run WOULD stop on: $PROBLEMS — see the lines above"
fi
echo "── $(date '+%F %T') done"
