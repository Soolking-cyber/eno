#!/usr/bin/env bash
# Weekly imported-APARTMENT refresh for eno.vn — the 7-day rule. Owner, 2026-10-01: "we need only 7 days
# old apartments fetched weekly, remove else, only new active apartments" → an imported apartment stays
# live only while its source shows it posted OR RE-POSTED within 7 days (src/lib/apartment-freshness.ts).
#
# Per source, in this order:
#   1. read the source → stage + FRESH SET (every apartment ad dated inside the window, incl. ads we have)
#   2. apply the stage: create new rows, update, REVIVE rows the rule had expired that are fresh again
#   3. expire every live row of that source NOT in the fresh set (scripts/expire-apartment-rentals.ts —
#      share guard against a short crawl, journal + rollback first, per-page ISR tombstones)
#   4. the BACKSTOP, whatever 1–3 did: a source with no applied fresh set for > 8 days has its rows older
#      than 14 days (postedAt) expired, so a source that keeps failing cannot keep old flats up forever
# then classify-apartment-rentals.ts once (every import rewrites `attributes` and drops the aptType /
# furnishing it derived — its own header).
#
# ⛔ PER-SOURCE ISOLATION. A failed step skips THE REST OF THAT SOURCE (never its expiry on a partial set)
# and the job moves on; the run exits non-zero and posts a macOS notification naming the failed sources.
# ⛔ DRY BY DEFAULT: reads the sources and prints what every write WOULD do. `--apply` (what the launchd
# job passes) writes. Every write is journaled under $RUN.
#
# Run by ~/Library/LaunchAgents/vn.eno.apartments-weekly.plist (scripts/vn.eno.apartments-weekly.plist).
# Log + journals: ~/eno-import-journals/apartments/<stamp>/; share-guard state: …/apartments/state/.
#
# Env (all optional):
#   ENO_REPO       checkout whose scripts run (default ~/eno-apartments-job — a CLEAN detached worktree at
#                  origin/main; ~/eno.vn is a working tree and may be dirty or behind)
#   APT_ENV_FILE   env file for DB + storage (default ~/eno.vn/.env; "none" = caller's environment)
#   APT_SOURCES    space-separated subset of: nhatot muaban honeycomb rever batdongsan (default: all)
#   BDS_DIR        Batdongsan dataset dir (default ~/batdongsan_rentals_hcmc)
#
# ⚠️ `set -e` is NOT relied on (memory: it is a no-op in this shell setup) — every step ends in a test.
# ⚠️ bash, not zsh, and arguments as ARRAYS: zsh does not word-split "$X" (the vehicle job died on it).
# ⚠️ macOS /bin/bash is 3.2: no associative arrays, and "${EMPTY[@]}" is an unbound-variable error
# under `set -u` — every array is expanded as ${A[@]+"${A[@]}"}.
set -uo pipefail
APPLY=""; [ "${1:-}" = "--apply" ] && APPLY="--apply"
ENO="${ENO_REPO:-$HOME/eno-apartments-job}"
ENVF="${APT_ENV_FILE:-$HOME/eno.vn/.env}"
SOURCES="${APT_SOURCES:-nhatot muaban honeycomb rever batdongsan}"
BDS="${BDS_DIR:-$HOME/batdongsan_rentals_hcmc}"
JROOT="${APT_JOURNAL:-$HOME/eno-import-journals/apartments}"
STATE="$JROOT/state"
STAMP="$(date +%F-%H%M%S)"
RUN="$JROOT/$STAMP"
KEY="${ENO_BOX_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}"
PY=/usr/bin/python3            # the python.org 3.13 here lacks CA certs; the system one works
BACKSTOP_DAYS=14
# Every way this job can end badly notifies — including the early exits below, before any source runs.
notify() { /usr/bin/osascript -e "display notification \"$1\" with title \"eno apartments-weekly FAILED\" sound name \"Basso\"" 2>/dev/null; }
die() { echo "── $1"; notify "$1"; exit 1; }
mkdir -p "$RUN" "$STATE" || die "cannot create $RUN" 
# ⛔ ONE RUN AT A TIME, whoever starts it (launchd or a hand-run): two would both archive and re-scrape the
# Batdongsan dataset and apply the same stages. mkdir is atomic; a lock whose pid is dead is cleared.
LOCKDIR="$JROOT/.weekly.lock"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  holder="$(cat "$LOCKDIR/pid" 2>/dev/null)"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then die "another apartments-weekly run (pid $holder) is in progress — this run did nothing"; fi
  rm -rf "$LOCKDIR"; mkdir "$LOCKDIR" 2>/dev/null || die "could not take $LOCKDIR — this run did nothing"
fi
echo $$ > "$LOCKDIR/pid"
trap 'rm -rf "$LOCKDIR"' EXIT
echo "── $(date '+%F %T') apartments-weekly ${APPLY:-(dry run)}  repo $ENO @ $(git -C "$ENO" rev-parse --short HEAD 2>/dev/null)"

cd "$ENO" || die "repo $ENO missing — install the job worktree"
if [ "$ENVF" != "none" ]; then
  # eno.vn's database is reached only through the SSH tunnel on :5433.
  if ! nc -z 127.0.0.1 5433 2>/dev/null; then
    ssh -o IdentitiesOnly=yes -i "$KEY" -p 24700 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
        -o ConnectTimeout=15 -fN -L 5433:127.0.0.1:5433 root@162.4.176.233 || die "DB tunnel to the box FAILED — this run did nothing"
    sleep 3
  fi
  set -a; . "$ENVF" || die "env file $ENVF unreadable — this run did nothing"; set +a
fi

FAILED=()
# Locks left by an expiry that was killed (SIGKILL, a shutdown): the expiry script never takes a lock over —
# no pid-based takeover is race-free — so this job, the one scheduled instance, clears the dead ones here.
for lk in "$STATE"/*.lock; do
  [ -f "$lk" ] || continue
  pid="$(tr -cd '0-9' < "$lk")"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then echo "  stale lock $(basename "$lk") (pid ${pid:-?} not running) — removed"; rm -f "$lk"; fi
done
fail() { FAILED+=("$1"); echo "  ✗ $1 FAILED at: $2 — see $RUN/$1-*.log"; }
# The journal arguments every write step shares. Dry runs get none (the scripts refuse --journal-dir
# without --apply in some importers, and a dry run writes nothing anyway).
JOURNAL=(); [ -n "$APPLY" ] && JOURNAL=(--journal-dir "$RUN/journal")
mkdir -p "$RUN/journal" || exit 1

# expire <source> <sellerId> <fresh.json>
expire() {
  local src="$1" seller="$2" fresh="$3"
  npx tsx scripts/expire-apartment-rentals.ts --seller "$seller" --fresh "$fresh" --state-dir "$STATE" \
    ${JOURNAL[@]+"${JOURNAL[@]}"} $APPLY > "$RUN/$src-expire.log" 2>&1
}
# backstop <source> <sellerId> — always runs, success or not
backstop() {
  local src="$1" seller="$2"
  npx tsx scripts/expire-apartment-rentals.ts --seller "$seller" --backstop-days "$BACKSTOP_DAYS" --state-dir "$STATE" \
    ${JOURNAL[@]+"${JOURNAL[@]}"} $APPLY > "$RUN/$src-backstop.log" 2>&1 \
    || { echo "  ✗ $src backstop FAILED — see $RUN/$src-backstop.log"; FAILED+=("$src-backstop"); }
  grep -E "BACKSTOP|marked|REFUSED" "$RUN/$src-backstop.log" | sed "s/^/  [$src] /"
}
summary() { grep -E "live apartments|marked|REFUSED|coverage" "$RUN/$1-expire.log" | sed "s/^/  [$1] /"; }

# A stage/import step exits 3 when it read the source but could NOT prove whole-window coverage: what it
# read is still applied (new and re-posted ads go live, re-posted expired ones come back), but there is no
# fresh set, so this source's expiry is skipped and the run is marked failed (alert). Any other non-zero
# exit is a plain failure of that source.
COVERAGE_REFUSED=3

run_nhatot() {
  local S=nhatot-import-seller-0001 STAGE="$RUN/nhatot-stage.json" FRESH="$RUN/nhatot-fresh.json" rc
  # All three cities (the default): the expiry acts on the whole seller, so a city left out of the set
  # would expire every live apartment there. cg 1010 = apartments.
  npx tsx scripts/import-nhatot-com.ts --cg 1010 --max-age-days 7 --save "$STAGE" --fresh-out "$FRESH" \
    > "$RUN/nhatot-stage.log" 2>&1; rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq "$COVERAGE_REFUSED" ] || { fail nhatot stage; return; }
  if [ -n "$APPLY" ] && [ -f "$STAGE" ]; then
    # --max-age-days on the apply too, or it creates 7.x-day-old ads the expiry removes minutes later.
    # Exit 1 also means "finished, but some rows errored" (a photo upload blip): the importer then prints
    # APPLY COMPLETED as its last line. That week still expires — the expiry's own guards stand — and is
    # flagged; only an apply that never finished skips it.
    if ! npx tsx scripts/import-nhatot-com.ts --src "$STAGE" --max-age-days 7 ${JOURNAL[@]+"${JOURNAL[@]}"} --apply \
         > "$RUN/nhatot-apply.log" 2>&1; then
      grep -qx "APPLY COMPLETED" "$RUN/nhatot-apply.log" || { fail nhatot apply; return; }
      FAILED+=("nhatot-apply-row-errors")
    fi
  fi
  [ "$rc" -eq 0 ] || { fail nhatot "coverage not proven — imported, expiry skipped"; return; }
  # The set AND the stage it came with: never expire on a set whose ads were not (or could not be) applied.
  [ -f "$FRESH" ] && [ -f "$STAGE" ] || { fail nhatot "stage or fresh set missing — expiry skipped"; return; }
  expire nhatot "$S" "$FRESH" || { fail nhatot expire; return; }
  summary nhatot
}

run_muaban() {
  local S=muaban-net-import-seller-0001 STAGE="$RUN/muaban-stage.jsonl" FRESH="$RUN/muaban-fresh.json" rc
  # HCMC only and apartments only are the importer's own --fresh-out scope; it seeds per district.
  npx tsx scripts/import-muaban-net.ts --types apartment --stage "$STAGE" --fresh-out "$FRESH" \
    > "$RUN/muaban-stage.log" 2>&1; rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq "$COVERAGE_REFUSED" ] || { fail muaban stage; return; }
  if [ -n "$APPLY" ] && [ -f "$STAGE" ]; then
    npx tsx scripts/import-muaban-net.ts --src "$STAGE" --journal "$RUN/journal" --apply > "$RUN/muaban-apply.log" 2>&1 || { fail muaban apply; return; }
  fi
  [ "$rc" -eq 0 ] || { fail muaban "coverage not proven — imported, expiry skipped"; return; }
  [ -f "$FRESH" ] && [ -f "$STAGE" ] || { fail muaban "stage or fresh set missing — expiry skipped"; return; }
  expire muaban "$S" "$FRESH" || { fail muaban expire; return; }
  summary muaban
}

run_honeycomb() {
  local S=honeycomb-import-seller-0001 STAGE="$RUN/honeycomb-stage.json" FRESH="$RUN/honeycomb-fresh.json"
  # The stage exits non-zero when it cannot prove its sitemap read (it still writes the stage); Honeycomb
  # yields 0–7 fresh posts a week, so a refused week simply skips its apply and expiry.
  npx tsx scripts/import-honeycomb-com-vn.ts --since-days 7 --save "$STAGE" --fresh-out "$FRESH" \
    > "$RUN/honeycomb-stage.log" 2>&1 || { fail honeycomb stage; return; }
  if [ -n "$APPLY" ]; then
    npx tsx scripts/import-honeycomb-com-vn.ts --src "$STAGE" ${JOURNAL[@]+"${JOURNAL[@]}"} --apply > "$RUN/honeycomb-apply.log" 2>&1 || { fail honeycomb apply; return; }
  fi
  expire honeycomb "$S" "$FRESH" || { fail honeycomb expire; return; }
  summary honeycomb
}

run_rever() {
  local S=cmub0wead0000zrq418bqq27m STATUS="$RUN/rever-status.jsonl" FRESH="$RUN/rever-fresh.json" rc
  # One detail GET per Rever apartment row we hold (live AND expired/stale), ≥1.5 s apart: retires let
  # flats, revives re-listed ones, re-dates updated ones. Rever has posted no new HCMC rental since
  # 2026-06-12, so new Rever ads are not imported.
  npx tsx scripts/retire-rever-rentals.ts --save "$STATUS" --fresh-out "$FRESH" > "$RUN/rever-check.log" 2>&1; rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq "$COVERAGE_REFUSED" ] || { fail rever check; return; }
  if [ -n "$APPLY" ] && [ -f "$STATUS" ]; then
    npx tsx scripts/retire-rever-rentals.ts --src "$STATUS" ${JOURNAL[@]+"${JOURNAL[@]}"} --apply > "$RUN/rever-apply.log" 2>&1 || { fail rever apply; return; }
  fi
  [ "$rc" -eq 0 ] || { fail rever "coverage not proven — applied, expiry skipped"; return; }
  expire rever "$S" "$FRESH" || { fail rever expire; return; }
  summary rever
}

run_batdongsan() {
  local S=bds-vn-import-seller-0001 FRESH="$RUN/batdongsan-fresh.json" PREV STAMPED rc f
  # ⛔ A DRY RUN LEAVES THE DATASET ALONE. Archiving and re-scraping are real state: a dry run (or a same-week
  # rerun) would make an hours-old crawl next week's --previous, every card would match "last week's" label,
  # and the carry-over check would call the whole market stale. The dry run only re-judges the scrape on disk.
  if [ -z "$APPLY" ]; then
    [ -f "$BDS/all_rentals.json" ] || { echo "  [batdongsan] dry run: no all_rentals.json on disk — nothing to judge"; return; }
  else
    # The scraper refuses to start (--new) while all_rentals.json exists, and the importer refuses a file born
    # > 24 h ago — so last week's file and its crawl log move aside first.
    if [ -f "$BDS/all_rentals.json" ]; then
      STAMPED="$(date -r "$BDS/all_rentals.json" +%F-%H%M%S)"
      mv "$BDS/all_rentals.json" "$BDS/all_rentals.$STAMPED.json" || { fail batdongsan archive; return; }
      [ -f "$BDS/all_rentals.crawl.json" ] && { mv "$BDS/all_rentals.crawl.json" "$BDS/all_rentals.$STAMPED.crawl.json" || { fail batdongsan archive; return; }; }
    fi
    # Both apartment lists, to the end, plus a catch-up pass; a HEADED Chrome in the GUI session (Cloudflare
    # refuses headless). Writes all_rentals.json + all_rentals.crawl.json (per-page outcomes).
    ( cd "$BDS" && $PY scraper.py --apartments --to-end --new > "$RUN/batdongsan-scrape.log" 2>&1 ) || { fail batdongsan scrape; return; }
    ( cd "$BDS" && $PY enrich_dataset.py > "$RUN/batdongsan-enrich.log" 2>&1 ) || { fail batdongsan enrich; return; }
  fi
  # --previous (the carry-over check) must be a crawl from an EARLIER week: the newest archive at least 5 days
  # old, never one from a failed or repeated run hours ago.
  PREV=""
  for f in $(ls -1t "$BDS"/all_rentals.20*.json 2>/dev/null | grep -v '\.crawl\.json$'); do
    # -mtime +4 = more than 4 whole days, i.e. at least 5 days old.
    if [ -n "$(find "$f" -mtime +4 -print 2>/dev/null)" ]; then PREV="$f"; break; fi
  done
  [ -n "$PREV" ] || { fail batdongsan "no scrape at least 5 days old for the carry-over check"; return; }
  # Exit codes: 0 ok · 3 coverage refused (import applied, no set) · 4 page tombstones owed, set written
  # (a .retombstone.sql sits in the journal) · 5 tombstones owed AND set refused · anything else: failure.
  npx tsx scripts/import-batdongsan-rentals.ts --src "$BDS/all_rentals.json" --previous "$PREV" --max-age-days 7 \
    --subcat apartment-rental --fresh-out "$FRESH" --crawl-log "$BDS/all_rentals.crawl.json" \
    ${JOURNAL[@]+"${JOURNAL[@]}"} $APPLY > "$RUN/batdongsan-import.log" 2>&1; rc=$?
  case "$rc" in 0|3|4|5) ;; *) fail batdongsan import; return ;; esac
  if [ -n "$APPLY" ] && { [ "$rc" -eq 4 ] || [ "$rc" -eq 5 ]; }; then
    # Owed page tombstones: apply the repair file the importer wrote, so revived pages stop serving a cached
    # 404. No repair file, or a repair that fails, stops this source here (photos, expiry) — never a silent pass.
    ls "$RUN"/journal/batdongsan-*.retombstone.sql >/dev/null 2>&1 || { fail batdongsan "tombstones owed but no repair file"; return; }
    for f in "$RUN"/journal/batdongsan-*.retombstone.sql; do
      psql "${DIRECT_URL:-$DATABASE_URL}" -X -q -v ON_ERROR_STOP=1 -f "$f" >> "$RUN/batdongsan-retombstone.log" 2>&1 \
        || { fail batdongsan "owed tombstones could not be applied ($(basename "$f"))"; return; }
      echo "  [batdongsan] owed tombstones applied from $(basename "$f")"
    done
  fi
  if [ -n "$APPLY" ]; then
    npx tsx scripts/attach-batdongsan-photos.ts --src "$BDS/all_rentals.json" --images "$BDS/images" --apply > "$RUN/batdongsan-photos.log" 2>&1 || { fail batdongsan photos; return; }
    # Rows still without a photo are hidden (never --restore: it republishes photo-bearing hidden rows).
    npx tsx scripts/hide-imageless-imports.ts --apply > "$RUN/batdongsan-imageless.log" 2>&1 || { fail batdongsan imageless; return; }
  fi
  if [ "$rc" -eq 3 ] || [ "$rc" -eq 5 ] || [ ! -f "$FRESH" ]; then fail batdongsan "coverage not proven — imported, expiry skipped"; return; fi
  expire batdongsan "$S" "$FRESH" || { fail batdongsan expire; return; }
  summary batdongsan
}

seller_of() {
  case "$1" in
    nhatot) echo nhatot-import-seller-0001 ;; muaban) echo muaban-net-import-seller-0001 ;;
    honeycomb) echo honeycomb-import-seller-0001 ;; rever) echo cmub0wead0000zrq418bqq27m ;;
    batdongsan) echo bds-vn-import-seller-0001 ;; *) return 1 ;;
  esac
}
# The LaunchAgent wraps this in `caffeinate -i`: a sleeping Mac would stall a multi-hour run mid-crawl.
for src in $SOURCES; do
  seller="$(seller_of "$src")" || { echo "unknown source $src"; FAILED+=("$src"); continue; }
  echo "── $(date '+%T') $src"
  "run_$src"
  backstop "$src" "$seller"
done

echo "── $(date '+%T') classify"
npx tsx scripts/classify-apartment-rentals.ts ${JOURNAL[@]+"${JOURNAL[@]}"} $APPLY > "$RUN/classify.log" 2>&1 || { echo "  ✗ classify FAILED"; FAILED+=(classify); }
tail -3 "$RUN/classify.log" | sed 's/^/  /'

if [ "${#FAILED[@]}" -gt 0 ]; then
  msg="apartments-weekly: FAILED ${FAILED[*]} — $RUN"
  echo "── $msg"
  notify "${FAILED[*]}"
  exit 1
fi
echo "── $(date '+%F %T') done"
