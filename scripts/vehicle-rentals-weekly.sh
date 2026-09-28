#!/usr/bin/env bash
# Weekly HCMC vehicle-rental refresh for eno.vn (owner, 2026-09-28: "yes to a weekly re-scrape + retire").
#   1. re-scrape: Mioto (HCMC query points only), BonbonCar (HCMC only), the five HCMC bike shops
#   2. gone list: positive signals only, 80% count guard (scripts/vehicle-rentals-gone.py)
#   3. import-vehicle-rentals.ts --stage photos, then --stage import --gone <list>
#   4. snapshot this week's datasets as next week's baseline — ONLY after a successful --apply
#
# DRY BY DEFAULT: scrapes and computes everything, prints what the importer WOULD do, writes nothing
# to the database or storage. `--apply` (what the launchd job passes) uploads and writes.
#
# Run by ~/Library/LaunchAgents/vn.eno.vehicle-rentals-weekly.plist (scripts/vn.eno.vehicle-rentals-weekly.plist).
# Log + journals: ~/eno-import-journals/vehicles/<date>/.
#
# Env (all optional):
#   ENO_REPO          eno.vn checkout whose scripts run (default ~/eno.vn — it must hold the DEPLOYED code)
#   VEH_ENV_FILE      env file to source for DB + storage (default $ENO_REPO/.env; "none" = use the
#                     caller's environment, e.g. a scratch DATABASE_URL for a dry proof)
#   VEH_SKIP_SCRAPE=1 reuse the datasets already on disk (proof runs; never in the weekly job)
#   MIOTO_DIR / BONBON_DIR / BIKES_DIR   dataset roots (defaults ~/mioto_rentals_vn …)
#
# ⚠️ `set -e` does NOT stop this shell on a failed step in every context, so every step that matters
# ends in `|| exit 1` (see the zsh/bash note in memory: set -e is a no-op here).
set -uo pipefail
APPLY=""; [ "${1:-}" = "--apply" ] && APPLY="--apply"
ENO="${ENO_REPO:-$HOME/eno.vn}"
MIOTO="${MIOTO_DIR:-$HOME/mioto_rentals_vn}"
BONBON="${BONBON_DIR:-$HOME/bonboncar_rentals_vn}"
BIKES="${BIKES_DIR:-$HOME/motorbike_rentals_vn}"
JROOT="${VEH_JOURNAL:-$HOME/eno-import-journals/vehicles}"
DAY="$(date +%F)"
STAMP="$(date +%F-%H%M%S)"   # unique per run: a dry run and an --apply on one day must not collide
RUN="$JROOT/$STAMP"
BASE="$JROOT/latest"            # last successfully APPLIED week's datasets (the retire baseline)
KEY="${ENO_BOX_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}"
SHOPS="janmotorbike theextramile dungmotorbikes tuanmotorbike rentabikevn"
PY=/usr/bin/python3             # the python.org 3.13 here lacks CA certs; the system one works
mkdir -p "$RUN" || exit 1
echo "── $(date '+%F %T') vehicle-rentals-weekly ${APPLY:-(dry run)}"

# ── 1. scrape ───────────────────────────────────────────────────────────────────────────────────
if [ "${VEH_SKIP_SCRAPE:-}" != "1" ]; then
  # Mioto: last week's search/detail checkpoints move aside so this week asks again (both are
  # resumable and would otherwise skip every car already fetched). Photos stay — the downloader
  # skips files it already has.
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
  ) || { echo "mioto scrape FAILED — see $RUN/mioto-*.log"; exit 1; }
  # BonbonCar: detail pages are cached per SKU; move the cache aside so prices are re-read.
  ( cd "$BONBON" || exit 1
    if [ -d raw/detail ]; then mv raw/detail "raw/detail.prev-$STAMP" || exit 1; fi
    export BONBON_CITIES="Hồ Chí Minh"
    $PY scraper.py > "$RUN/bonbon-scrape.log" 2>&1 || exit 1
    $PY download_images.py > "$RUN/bonbon-images.log" 2>&1 || exit 1
    $PY scraper.py --reuse-index > "$RUN/bonbon-build.log" 2>&1 || exit 1
  ) || { echo "bonboncar scrape FAILED — see $RUN/bonbon-*.log"; exit 1; }
  # Shops: each scraper keeps a bike's downloaded photos when its photo list is unchanged.
  ( cd "$BIKES" || exit 1
    for s in $SHOPS; do .venv/bin/python -m "scrapers.$s" >> "$RUN/bikes-scrape.log" 2>&1 || exit 1; done
    .venv/bin/python download_images.py $SHOPS > "$RUN/bikes-images.log" 2>&1 || exit 1
    .venv/bin/python build_dataset.py > "$RUN/bikes-build.log" 2>&1 || exit 1
  ) || { echo "bike scrape FAILED — see $RUN/bikes-*.log"; exit 1; }
  echo "  scrape ok"
else
  echo "  scrape SKIPPED (VEH_SKIP_SCRAPE=1) — datasets on disk as-is"
fi

# ── 2. gone list ────────────────────────────────────────────────────────────────────────────────
GONE="$RUN/gone.txt"
$PY "$ENO/scripts/vehicle-rentals-gone.py" --prev "$BASE" --mioto "$MIOTO" --bonbon "$BONBON" --bikes "$BIKES" \
  --out "$GONE" --next-baseline "$RUN/next-baseline" | tee "$RUN/gone.log" || exit 1

# ── 3. photos + import ──────────────────────────────────────────────────────────────────────────
cd "$ENO" || exit 1
ENVF="${VEH_ENV_FILE:-$ENO/.env}"
if [ "$ENVF" != "none" ]; then
  # eno.vn's database is reached only through the SSH tunnel on :5433 (as jobs-daily.sh does).
  if ! nc -z 127.0.0.1 5433 2>/dev/null; then
    ssh -o IdentitiesOnly=yes -i "$KEY" -p 24700 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
        -o ConnectTimeout=15 -fN -L 5433:127.0.0.1:5433 root@162.4.176.233 || exit 1
    sleep 3
  fi
  set -a; . "$ENVF" || exit 1; set +a
fi
SRC=(--mioto "$MIOTO" --bonbon "$BONBON" --bikes "$BIKES" --manifest "$JROOT/photos-manifest.jsonl")
npx tsx scripts/import-vehicle-rentals.ts --stage photos "${SRC[@]}" $APPLY > "$RUN/photos.log" 2>&1 \
  || { echo "photos stage FAILED"; tail -5 "$RUN/photos.log"; exit 1; }
grep -E "staged|dropped|rows needing|^\{|mode" "$RUN/photos.log" | sed 's/^/  /'
npx tsx scripts/import-vehicle-rentals.ts --stage import "${SRC[@]}" --gone "$GONE" $APPLY > "$RUN/import.log" 2>&1 \
  || { echo "import stage FAILED"; tail -5 "$RUN/import.log"; exit 1; }
grep -E "hosted \+ ready|created|mode|DRY RUN" "$RUN/import.log" | sed 's/^/  /'

# ── 4. baseline for next week — only once this week's state is actually in the database ────────
# The gone helper built it: this week's rows plus every absent row that was NOT confirmed gone (asked
# again next week), and last week's baseline untouched for a source the 80% guard skipped.
if [ -n "$APPLY" ]; then
  mkdir -p "$BASE" || exit 1
  for f in mioto.json bonbon.json bikes.json; do
    [ -f "$RUN/next-baseline/$f" ] && { cp "$RUN/next-baseline/$f" "$BASE/$f" || exit 1; }
  done
  echo "  baseline updated → $BASE"
fi
echo "── $(date '+%F %T') done"
