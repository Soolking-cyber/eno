#!/usr/bin/env bash
#
# eno · hold the Next image-optimizer caches under a ceiling
#
# ⛔ THIS EXISTS BECAUSE apps.compose.yml MADE THOSE CACHES PERMANENT. Before 2026-09-14 they
# lived in the container layer and every deploy wiped them — slow, but self-limiting. Persisting
# them fixed the slowness and removed the limit, so the growth curve is now ours to bound:
# 496,377 listing rasters x 6 requested widths at the measured ~52KB per entry is ~156GB, against
# a 120GB disk with 22GB free. Without this timer the volume fills the box.
#
# Layout, measured on the box: <volume>/<cache-key>/<one file>. 3,812 key directories, 3,812
# files at depth 2, nothing deeper. A key directory is the unit of eviction — dropping the file
# but keeping the directory leaves a key that is neither a hit nor absent.
set -euo pipefail

CAP_MB="${ENO_IMAGE_CACHE_CAP_MB:-4096}"    # per edition. 22GB free today; raise on the 150GB box.
# ⛔ AN AGE CEILING, AND IT IS A TAKEDOWN CONTROL, NOT HOUSEKEEPING. Before this volume existed,
# every deploy wiped the optimizer cache, and that wipe was incidentally the ONLY thing that ever
# stopped the origin serving an encoded copy of a photo whose source had been deleted. Persisting
# the cache removes it. Measured 2026-09-14: the source objects send `cache-control:
# max-age=31536000` and Next takes the LARGER of upstream max-age and minimumCacheTTL, so an entry
# would otherwise live a YEAR — lowering images.minimumCacheTTL cannot shorten it. So after a
# moderation takedown deletes the object, `/_next/image?url=…` keeps returning 200 from disk.
# Evicting on age bounds that to this many days regardless of how much room is left.
# ⚠️ THE COST IS SMALL AND WAS CHECKED: ~3,800 live entries re-encoded at most once a week is
# ~32 min of CPU spread over a week, and any single user pays one 505ms cold encode. That is the
# right trade against serving withdrawn photographs.
# ⚠️ THIS IS A BOUND, NOT A PURGE. A real takedown still needs the entry dropped immediately; see
# infra/vn-node/image-serving.md. Do not let this number be an excuse not to build that.
MAX_AGE_DAYS="${ENO_IMAGE_CACHE_MAX_AGE_DAYS:-7}"
CAP_KB=$(( CAP_MB * 1024 ))
LOW_KB=$(( CAP_KB * 80 / 100 ))             # prune to 80% so this is not re-triggered hourly.
MOUNT=/app/.next/cache/images

log() { echo "[image-cache-prune] $*"; }

# ⛔ THE SAME INTERLOCK eno-docker-prune.sh USES. A deploy recreates both containers; pruning
# mid-swap races the newly started server as it warms. Skipping is free — the next run catches it.
if pgrep -f 'eno-deploy\.sh' >/dev/null 2>&1; then
  log "deploy in progress — skipping"; exit 0
fi

# ⚠️ A DEAD DAEMON MUST NOT LOOK LIKE A CLEAN RUN. `Wants=docker.service` lets this start even
# when docker failed, and the first version treated every `docker inspect` error alike — so with
# the socket unavailable both editions were "skipped", the script exited 0, and systemd recorded
# success while neither volume had been looked at. Probe the daemon once, up front, and fail.
if ! docker info >/dev/null 2>&1; then
  log "⛔ docker is not answering — cannot check either cache"; exit 1
fi

# ⚠️ NUMERIC OR NOTHING. `du` exits non-zero when a file vanishes mid-walk, which the running
# optimizer does constantly, and under `set -e`/`pipefail` that killed the whole script — taking
# the second edition with it. Every size goes through here: failures and any non-numeric output
# become empty, and the caller decides, rather than the script dying mid-prune.
# ⚠️ A FAILED PIPELINE'S OUTPUT IS DISCARDED, NOT PARSED. `du -sk` can print a partial total AND
# exit non-zero when files vanish mid-walk; keeping that number means an under-measure that either
# skips a needed prune or reports success below a cap the cache is still above. Status first.
kb() { local v st
       v=$(du -sk "$1" 2>/dev/null | cut -f1 | head -1); st=$?
       [ "$st" -eq 0 ] || { echo ""; return 0; }
       case "$v" in (''|*[!0-9]*) echo "" ;; (*) echo "$v" ;; esac; }

rc=0
for ctr in eno-vn-app eno-forum-app; do
  docker inspect "$ctr" >/dev/null 2>&1 || { log "$ctr: no such container — skipping"; continue; }

  # ⛔ THE SOURCE IS READ OFF THE CONTAINER, NOT GUESSED FROM A VOLUME NAME. Compose prefixes
  # named volumes with the project, so this box's are `vn-node_eno-vn-image-cache`, not the bare
  # key in apps.compose.yml. Three reviewers independently caught the first version inspecting
  # the bare name: `docker volume inspect` fails, the script logs a reassuring skip, exits 0, and
  # the volume grows to the disk limit with nothing ever reporting a problem. Asking the running
  # container where its mount actually is cannot drift from whatever compose decided to call it.
  # ⚠️ `|| true` IS LOAD-BEARING: a bare command substitution under `set -e` exits the whole
  # script if docker hiccups here, so eno-forum would never be pruned that hour — the exact
  # failure kb() exists to prevent, left at this one call site until a reviewer spotted it.
  dir=$(docker inspect "$ctr" --format \
    "{{range .Mounts}}{{if eq .Destination \"$MOUNT\"}}{{.Source}}{{end}}{{end}}" 2>/dev/null) || true

  if [ -z "$dir" ]; then
    # Not a disk risk: no mount means the cache is still container-local and dies with the
    # container, i.e. the pre-2026-09-14 behaviour. Loud, because it also means slow.
    log "$ctr: no volume at $MOUNT — cache is ephemeral (deploy the compose change); nothing to prune"
    continue
  fi
  case "$dir" in
    /var/lib/docker/volumes/*) : ;;
    *) log "⛔ $ctr: mount source $dir is not a docker volume — refusing to delete"; rc=1; continue ;;
  esac
  [ -d "$dir" ] || { log "⛔ $ctr: $dir does not exist"; rc=1; continue; }

  # ⚠️ KILOBYTES, NOT MEGABYTES, AND THAT WAS A REAL BUG. `du -s --block-size=1M` rounds EVERY
  # entry up to a whole megabyte: measured, a 52KB key directory reports 1. The first version
  # subtracted that from its running total, so it credited itself ~20x the space it actually
  # reclaimed, stopped while still far above the cap, and logged success. -sk reports 52.
  # AGE CEILING FIRST, and unconditionally — it runs whether or not the volume is over its size
  # cap, because its job is bounding how long a withdrawn raster can be served, not saving disk.
  # ⚠️ MINUTES, NOT `-mtime`. GNU `-mtime +7` truncates to whole days, so it means "at least EIGHT
  # days old" — the unit file and the docs would have promised a seven-day takedown window that the
  # implementation could not keep. `-mmin` is exact.
  # ⚠️ `|| true` ON THE PIPELINE: `find` exits non-zero when a directory vanishes under it, which
  # the running optimizer does constantly, and `pipefail` would turn that into the whole script
  # dying here — skipping the size cap and the second edition entirely.
  age_min=$(( MAX_AGE_DAYS * 1440 ))
  aged=$(find "$dir" -mindepth 1 -maxdepth 1 -type d -mmin "+$age_min" 2>/dev/null | wc -l | tr -d ' ') || true
  case "$aged" in (''|*[!0-9]*) aged=0 ;; esac
  if [ "$aged" -gt 0 ]; then
    find "$dir" -mindepth 1 -maxdepth 1 -type d -mmin "+$age_min" -exec rm -rf -- {} + 2>/dev/null || true
    # ⚠️ RE-COUNT, DO NOT REPORT THE COUNT WE INTENDED TO DELETE. `rm -rf` errors are suppressed
    # here (a vanishing directory is normal), so logging `$aged` would announce a takedown bound
    # that may not have been enforced — the same lie the size re-measure below exists to prevent.
    # This one matters more: it is the line an operator would trust that withdrawn photos are gone.
    left=$(find "$dir" -mindepth 1 -maxdepth 1 -type d -mmin "+$age_min" 2>/dev/null | wc -l | tr -d ' ') || true
    case "$left" in (''|*[!0-9]*) left=0 ;; esac
    log "$ctr: evicted $(( aged - left )) of $aged entries older than ${MAX_AGE_DAYS}d (takedown bound)"
    if [ "$left" -gt 0 ]; then
      log "⛔ $ctr: $left aged entries could NOT be removed — withdrawn rasters may still be served"
      rc=1
    fi
  fi

  size=$(kb "$dir")
  if [ -z "$size" ]; then log "⛔ $ctr: could not measure $dir"; rc=1; continue; fi
  if [ "$size" -le "$CAP_KB" ]; then
    log "$ctr: $((size/1024))MB / ${CAP_MB}MB — under cap"; continue
  fi

  log "$ctr: $((size/1024))MB / ${CAP_MB}MB — pruning to $((LOW_KB/1024))MB, least-recently-read first"
  removed=0
  # ⚠️ THE KEY DIRECTORY'S OWN atime IS NOT AN ACCESS RECORD. Measured on this box: reading
  # <key>/<file> moved the FILE's atime and left the DIRECTORY's atime untouched. Sorting
  # directories by their own atime therefore evicts by CREATION order — the oldest photos, which
  # on a marketplace are exactly the listings people still browse. So each key is scored by the
  # newest atime among its files, and the oldest of those scores is evicted first.
  # ⚠️ `/` is mounted relatime, so atime advances at most once a day. Coarse, but it is real read
  # information; mtime would be creation time again.
  while IFS= read -r entry; do
    [ "${size:-0}" -le "$LOW_KB" ] && break
    [ -n "$entry" ] && [ -d "$entry" ] || continue
    esz=$(kb "$entry"); [ -n "$esz" ] || esz=0
    rm -rf -- "$entry" && removed=$((removed+1)) && size=$(( size - esz ))
  done < <(find "$dir" -mindepth 2 -maxdepth 2 -type f -printf '%A@ %h\n' 2>/dev/null \
             | awk '{ if ($1 > m[$2]) m[$2] = $1 } END { for (d in m) printf "%.0f %s\n", m[d], d }' \
             | sort -n | cut -d' ' -f2-)

  # Key directories that hold no file at all are invisible to the scorer above; they accumulate,
  # and an empty key is never a hit.
  # ⚠️ `-mmin +60` IS A RACE GUARD, NOT TIDINESS. Next creates the key directory and then writes
  # the encoded raster into it; a cold AVIF encode measured ~505ms on this box, so an unqualified
  # `-empty -delete` can remove the directory between those two steps and the write fails ENOENT.
  # An hour is far outside any encode, and a genuinely empty key costs nothing until then.
  find "$dir" -mindepth 1 -maxdepth 1 -type d -empty -mmin +60 -delete 2>/dev/null || true

  # ⚠️ RE-MEASURE RATHER THAN TRUST THE RUNNING TOTAL. The accounting bug above was invisible
  # precisely because the script reported its own arithmetic instead of the disk's answer.
  # ⚠️ IF THE RE-MEASURE FAILS, SAY SO — DO NOT PRINT THE ESTIMATE AND LABEL IT "measured".
  # Substituting the running total here would reproduce exactly the bug this re-measure exists to
  # catch: the script reporting its own arithmetic as though it were the disk's answer.
  actual=$(kb "$dir")
  if [ -z "$actual" ]; then
    log "⛔ $ctr: removed $removed entries but could NOT re-measure $dir — size unverified"
    rc=1; continue
  fi
  log "$ctr: removed $removed entries — now $((actual/1024))MB (measured)"
  if [ "$actual" -gt "$CAP_KB" ]; then
    log "⛔ $ctr: still $((actual/1024))MB after pruning, above the ${CAP_MB}MB cap — needs a person"
    rc=1
  fi
done

exit $rc
