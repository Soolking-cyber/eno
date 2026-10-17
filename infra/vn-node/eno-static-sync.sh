#!/usr/bin/env bash
# eno-static-sync.sh — keep every recent build's /_next/static on disk, where nginx serves it.
#
# ⛔ WHY THIS EXISTS (speed plan item 2, 2026-10-16). Every deploy used to purge BOTH Cloudflare zones
# with purge_everything, because HTML that outlives a deploy — the browser's max-age=300, the Worker's
# stale window, a native WebView left open — references /_next/static chunks the NEW container does not
# have, and a page whose chunks 404 never hydrates. That purge also threw away every content-hashed
# chunk, font and /_next/image variant several times a day (static miss ratio 70–94% after a deploy,
# human image edge-hit 48%, measured 2026-10-15). With every recent build's files on disk, old HTML keeps
# hydrating, so a deploy only has to refresh HTML (Cache-Tag purge, eno-deploy.sh step 8).
# nginx serves this tree first and falls back to the SAME edition's app for anything missing
# (nginx/static-<edition>.conf), so an empty or half-written tree degrades to exactly the old behaviour.
#
#   eno-static-sync.sh ingest <marketplace|services> <image-or-container>  copy a build in; prints its BUILD_ID
#   eno-static-sync.sh prune  <marketplace|services> [BUILD_ID ...]        delete files no retained build uses
#   eno-static-sync.sh drop   <marketplace|services> <BUILD_ID>            delete ONE build's own files (a build
#                                                                         refused after the swap must not stay servable)
#   eno-static-sync.sh status <marketplace|services>
#
# Tree:   $ENO_STATIC_ROOT/<edition>/_next/static/…   (same layout as .next/static; root:root, 0755/0644)
# Ledger: $ENO_STATIC_LEDGER/<edition>/<BUILD_ID>.list — every relative path that build ships, one per
#         line. Its mtime is the build's LAST ingest, which is what retention counts from.
#
# ⛔ PRUNE BY LEDGER, NEVER BY FILE MTIME. A chunk that ships unchanged in ten builds keeps the mtime of the
# build that first wrote it; deleting by file age would remove a file the LIVE build still needs.
# ⛔ NEVER `rsync --delete` INTO THE TREE. Old builds' files are the whole point.
# ⛔ NAMES ARE CONTENT HASHES (80/80 same-name files byte-identical across builds, measured 2026-10-16; 0 of 1,038
# in the first seed). A same-name file with DIFFERENT bytes means that assumption broke, and either choice is wrong:
# keeping the old bytes breaks the new build, overwriting them breaks every retained old page — and a later `drop`
# of the new build would leave its bytes behind (codex, gate review). So ingest REFUSES, which fails the deploy
# before the swap with nothing changed. ENO_STATIC_ALLOW_COLLISION=1 overwrites deliberately, once you know why.
set -euo pipefail

cmd=${1:-}
ed=${2:-}
case "$cmd" in ingest|prune|drop|status|backfill) ;; *) echo "usage: $0 ingest|prune|drop|status|backfill <marketplace|services> [...]" >&2; exit 2;; esac
[[ $ed =~ ^(marketplace|services)$ ]] || { echo "eno-static-sync: edition must be marketplace or services" >&2; exit 2; }
shift 2

ROOT=${ENO_STATIC_ROOT:-/var/www/eno-static}
LEDGER=${ENO_STATIC_LEDGER:-/var/lib/eno-static}
RETAIN_DAYS=${ENO_STATIC_RETAIN_DAYS:-30}   # open tabs and native WebViews have no upper bound; 30 d is generous
KEEP_BUILDS=${ENO_STATIC_KEEP_BUILDS:-10}   # …and the 10 newest builds whatever their age
# Parallel brotli -q11 workers (ingest's delta + backfill). ⛔ VALIDATED positive int: `xargs -P 0` is
# UNLIMITED — it would uncap q11 across every core on the box that serves BOTH prod containers during a deploy
# — so 0 / blank / non-digit falls back to 3 (conservative; the box has 16 cores but carries live traffic).
BROTLI_JOBS=${ENO_BROTLI_JOBS:-3}
case $BROTLI_JOBS in ''|*[!0-9]*|0) BROTLI_JOBS=3;; esac
# …and never MORE than cores. The length test is FIRST and short-circuits the arithmetic `-gt`, so a value too
# long to be a real job count (≥100 digits, or anything that would overflow a shell integer compare) is capped
# without ever running `-gt` on it. `xargs -P 0` is UNLIMITED and a huge -P spawns a q11 storm on the box that
# serves both prod containers during a deploy.
_bjmax=$(nproc 2>/dev/null || echo 4)
if [ "${#BROTLI_JOBS}" -gt 2 ] || [ "$BROTLI_JOBS" -gt "$_bjmax" ]; then BROTLI_JOBS=$_bjmax; fi
LOCK=${ENO_STATIC_LOCK:-/var/lock/eno-static-$ed.lock}
dst=$ROOT/$ed/_next/static
led=$LEDGER/$ed

log() { printf 'eno-static-sync[%s]: %s\n' "$ed" "$*" >&2; }

mkdir -p "$dst" "$led"
chmod 755 "$ROOT" "$ROOT/$ed" "$ROOT/$ed/_next" "$dst"
exec 8>"$LOCK"
flock -w 300 8 || { log "lock busy for 300 s ($LOCK)"; exit 1; }

st=""
cid=""
made=0
cleanup() {
  [ -n "$st" ] && rm -rf "$st"
  if [ "$made" = 1 ] && [ -n "$cid" ]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT   # EXIT, not RETURN: under `set -e` a failed docker cp/gzip/rsync exits and RETURN never fires

ingest() {
  local src=${1:?image or container} bid f new=0 coll=0
  st=$(mktemp -d /var/tmp/eno-static.XXXXXX)
  # A name that is a container (running or not) is read in place; anything else is an image to instantiate.
  if docker container inspect "$src" >/dev/null 2>&1; then
    cid=$src
  else
    docker image inspect "$src" >/dev/null 2>&1 || { log "no such image or container: $src"; return 1; }
    cid=$(docker create "$src")
    made=1
  fi
  docker cp "$cid:/app/.next/BUILD_ID" "$st/BID" >/dev/null
  bid=$(tr -d '\r\n' < "$st/BID")
  [[ $bid =~ ^[A-Za-z0-9_-]{8,64}$ ]] || { log "bad BUILD_ID '$bid' in $src"; return 1; }
  mkdir -p "$st/s"
  docker cp "$cid:/app/.next/static/." "$st/s/" >/dev/null
  [ -f "$st/s/$bid/_buildManifest.js" ] || { log "$src has no $bid/_buildManifest.js — not a build this script understands"; return 1; }
  [ -z "$(find "$st/s" -type l -print -quit)" ] || { log "$src ships a symlink under .next/static — refused"; return 1; }
  (cd "$st/s" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) > "$st/list"

  # Precompress only what is not on disk yet. gzip -9 (~0.5 s over a whole build) is done inline; brotli -q11
  # is CPU-heavy, so the compressible paths are COLLECTED into $st/tobr and compressed in PARALLEL after the
  # collision check — and only the DELTA, because content-hashed names mean a file already on disk is skipped
  # above (a first full build is ~1 k files; a routine deploy, a handful). touch -r keeps each sibling's mtime
  # equal to the original, which the gzip_static / brotli_static docs recommend (speed plan item 2 brotli-11).
  : > "$st/collisions"; : > "$st/tobr"
  while IFS= read -r f; do
    if [ -e "$dst/$f" ]; then
      cmp -s "$st/s/$f" "$dst/$f" && continue
      coll=$((coll + 1)); printf '%s\n' "$f" >> "$st/collisions"
      log "COLLISION $f differs from the copy on disk"
    fi
    new=$((new + 1))
    case $f in
      *.js|*.mjs|*.css|*.svg|*.ico|*.json|*.txt|*.map|*.html)
        gzip -9 -n -k -f "$st/s/$f"; touch -r "$st/s/$f" "$st/s/$f.gz";;
    esac
    # brotli q11 only the worth-it types — .map is EXCLUDED (multi-MB source maps, rarely fetched, the
    # costliest to q11); .ico/.txt are too small to matter. These ride $st/tobr for the parallel pass below.
    case $f in
      *.js|*.mjs|*.css|*.svg|*.json) printf '%s\n' "$f" >> "$st/tobr";;
    esac
  done < "$st/list"

  if [ "$coll" -gt 0 ] && [ "${ENO_STATIC_ALLOW_COLLISION:-0}" != 1 ]; then
    log "refusing: $coll same-name file(s) with different bytes (listed above). Names are supposed to be content"
    log "hashes; find out why before re-running with ENO_STATIC_ALLOW_COLLISION=1, which overwrites them."
    return 1
  fi
  # Brotli -q11 siblings for the new/changed compressible files, in PARALLEL across cores (q11 is slow), only
  # the delta collected above. Guarded: no `brotli` on the box → skip with a warning, NEVER fail the deploy
  # (nginx still serves .gz; brotli_static just finds no .br until this runs). New files' .br ride the rsync
  # below; collisions' .br are installed in the collision loop.
  if [ -s "$st/tobr" ]; then
    if command -v brotli >/dev/null 2>&1; then
      # q11 is CPU/memory-heavy and this box runs BOTH prod containers during a deploy, so CAP the jobs and
      # `nice` them (ENO_BROTLI_JOBS overrides; default 3, not one-per-core). Each worker writes to a .part and
      # RENAMES on success, so a kill/OOM at q11 never leaves a half-written .br to be served; a file that fails
      # simply gets no .br (nginx serves its .gz). Compression NEVER fails the deploy — brotli_static is an
      # optimisation, not a gate (the worker exits 0 on its own failure; the outer `|| log` catches an xargs/nice
      # fault). Only the DELTA runs here; a first full pass is the separate `backfill` command.
      ( cd "$st/s" && nice -n 19 xargs -r -P "$BROTLI_JOBS" -I{} sh -c \
          'brotli -q 11 -c -- "$1" > "$1.br.part" && mv -f "$1.br.part" "$1.br" && touch -r "$1" "$1.br" || { rm -f "$1.br.part"; exit 0; }' \
          _ {} < "$st/tobr" ) || log "brotli: an xargs/nice fault occurred — some files ship gzip-only (deploy continues)"
      log "brotli: submitted $(wc -l < "$st/tobr" | tr -d ' ') new file(s) to q11 (jobs=$BROTLI_JOBS, niced); any that failed ship gzip-only"
    else
      log "brotli NOT installed — .br siblings skipped (gzip .gz still written; install brotli to enable brotli_static)"
    fi
  fi
  chown -R root:root "$st/s"
  chmod -R u=rwX,go=rX "$st/s"
  # New names: rsync writes a temp file and renames it, so nginx never sees half a file.
  rsync -a --ignore-existing --no-links "$st/s/" "$dst/"
  # Collisions: replace the original AND its .gz (a stale .gz beside new bytes would serve the old content).
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    install -m 0644 -o root -g root "$st/s/$f" "$dst/$f"
    if [ -e "$st/s/$f.gz" ]; then install -m 0644 -o root -g root "$st/s/$f.gz" "$dst/$f.gz"; else rm -f "$dst/$f.gz"; fi
    if [ -e "$st/s/$f.br" ]; then install -m 0644 -o root -g root "$st/s/$f.br" "$dst/$f.br"; else rm -f "$dst/$f.br"; fi
  done < "$st/collisions"

  install -m 0644 "$st/list" "$led/$bid.list"   # (re)written on every ingest: its mtime is "last seen"
  runuser -u www-data -- test -r "$dst/$bid/_buildManifest.js" || { log "www-data cannot read $dst/$bid/_buildManifest.js"; return 1; }
  log "ingested $bid from $src: $(wc -l < "$st/list" | tr -d ' ') files, $new written, $coll collisions"
  printf '%s\n' "$bid"
}

prune() {
  local kept lists all orphans gone b n_lists
  st=$(mktemp -d /var/tmp/eno-static.XXXXXX)
  lists=$st/lists; kept=$st/kept; all=$st/all
  # Retained builds: the KEEP_BUILDS most recently ingested, everything ingested within RETAIN_DAYS, and any
  # BUILD_ID named on the command line (the deploy passes the live and the previous build).
  ls -1t "$led"/*.list 2>/dev/null | head -n "$KEEP_BUILDS" > "$lists" || true
  find "$led" -maxdepth 1 -name '*.list' -mtime -"$RETAIN_DAYS" >> "$lists"
  for b in "$@"; do
    [ -f "$led/$b.list" ] || { log "prune refused: no ledger for kept build $b"; return 1; }
    printf '%s\n' "$led/$b.list" >> "$lists"
  done
  sort -u -o "$lists" "$lists"
  n_lists=$(wc -l < "$lists" | tr -d ' ')
  [ "$n_lists" -gt 0 ] || { log "prune refused: no ledger to keep"; return 1; }
  # shellcheck disable=SC2046
  xargs cat < "$lists" | LC_ALL=C sort -u > "$kept"
  [ -s "$kept" ] || { log "prune refused: the retained ledgers list no files"; return 1; }

  (cd "$dst" && find . -type f ! -name '*.gz' ! -name '*.br' | sed 's|^\./||' | LC_ALL=C sort) > "$all"
  LC_ALL=C comm -23 "$all" "$kept" > "$st/gone"
  gone=$(wc -l < "$st/gone" | tr -d ' ')
  if [ "${ENO_STATIC_DRY_RUN:-0}" = 1 ]; then
    log "dry run: would delete $gone files, keeping $(wc -l < "$kept" | tr -d ' ') from $n_lists builds"
    head -20 "$st/gone" >&2
    return 0
  fi
  while IFS= read -r f; do rm -f "$dst/$f" "$dst/$f.gz" "$dst/$f.br"; done < "$st/gone"
  # Siblings whose original is gone (a hand-deleted file) are never servable on their own.
  find "$dst" -type f \( -name '*.gz' -o -name '*.br' \) | while IFS= read -r f; do [ -e "${f%.*}" ] || rm -f "$f"; done
  # .br.part is a brotli write-then-rename temp; a stale one means a worker was SIGKILL/OOM-killed mid-write. It
  # is never served (nginx brotli_static opens .br, not .part), so sweep them here — runs every deploy.
  find "$dst" -name '*.br.part' -delete 2>/dev/null || true
  find "$dst" -mindepth 1 -type d -empty -delete
  # Ledgers of builds no longer retained.
  orphans=0
  for b in "$led"/*.list; do
    [ -e "$b" ] || continue
    grep -qxF "$b" "$lists" || { rm -f "$b"; orphans=$((orphans + 1)); }
  done
  log "pruned $gone files and $orphans ledgers; kept $n_lists builds"
}

drop() {
  # Files ONLY this build ships — anything another ledger also lists stays, or the live build would 404.
  local bid=${1:?BUILD_ID} others gone
  [[ $bid =~ ^[A-Za-z0-9_-]{8,64}$ ]] || { log "drop: bad BUILD_ID '$bid'"; return 1; }
  [ -f "$led/$bid.list" ] || { log "drop: no ledger for $bid — nothing to do"; return 0; }
  st=$(mktemp -d /var/tmp/eno-static.XXXXXX)
  others=$st/others
  find "$led" -maxdepth 1 -name '*.list' ! -name "$bid.list" -print0 | xargs -0 -r cat | LC_ALL=C sort -u > "$others"
  LC_ALL=C sort -u "$led/$bid.list" | LC_ALL=C comm -23 - "$others" > "$st/gone"
  gone=$(wc -l < "$st/gone" | tr -d ' ')
  while IFS= read -r f; do rm -f "$dst/$f" "$dst/$f.gz" "$dst/$f.br"; done < "$st/gone"
  rm -f "$led/$bid.list"
  find "$dst" -mindepth 1 -type d -empty -delete
  log "dropped build $bid: $gone files only it shipped"
}

backfill() {
  # One-time, AFTER brotli is installed: write a .br for every on-disk compressible file that lacks one.
  # ⛔ WHY IT IS NEEDED (reviewer codex+opus): ingest keeps NEW builds covered, but a chunk that shipped
  # unchanged BEFORE brotli existed keeps its content-hashed name and is skipped by ingest's `cmp && continue`
  # forever — so enabling brotli_static without this would serve those (often the big, stable framework)
  # chunks as gzip indefinitely. Same guards as ingest: capped + niced, temp-then-rename, never a partial .br.
  # ⚠️ Holds the per-edition flock (top of this script), so DON'T run it in a deploy window — a first full pass
  # over every retained build at q11 can take minutes and would make a concurrent deploy's flock (300 s) time out.
  command -v brotli >/dev/null 2>&1 || { log "backfill: brotli not installed on this box"; return 1; }
  local n
  n=$(find "$dst" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.css' -o -name '*.svg' -o -name '*.json' \) \
        | while IFS= read -r f; do [ -e "$f.br" ] || printf '%s\n' "$f"; done \
        | nice -n 19 xargs -r -P "$BROTLI_JOBS" -I{} sh -c \
            'brotli -q 11 -c -- "$1" > "$1.br.part" && mv -f "$1.br.part" "$1.br" && touch -r "$1" "$1.br" && chown root:root "$1.br" && chmod 0644 "$1.br" && echo done || { rm -f "$1.br.part"; }' \
            _ {} | grep -c done || true)
  log "backfill: wrote $n .br sibling(s) for existing files that lacked them"
}

status() {
  local n f s
  n=$(find "$led" -maxdepth 1 -name '*.list' | wc -l | tr -d ' ')
  f=$(find "$dst" -type f ! -name '*.gz' ! -name '*.br' | wc -l | tr -d ' ')
  s=$(du -sh "$ROOT/$ed" 2>/dev/null | cut -f1)
  echo "$ed: $n builds in the ledger, $f files on disk ($s)"
  ls -1t "$led"/*.list 2>/dev/null | head -5 | while IFS= read -r l; do
    printf '  %s  %s\n' "$(date -r "$l" '+%F %T')" "$(basename "$l" .list)"
  done
}

"$cmd" "$@"
