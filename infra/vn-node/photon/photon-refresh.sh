#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · eno-photon: build this week's Vietnam search index and switch to it
#
# GraphHopper publishes Photon dumps of OpenStreetMap's Vietnam extract weekly (the URL below). This downloads the newest,
# checks its md5, imports it into a NEW directory with the pinned photon.jar while the running server keeps answering, then
# switches the server to it. Run by eno-photon-refresh.timer weekly; install.sh runs it once.
#
# ⛔ NO DIRECTORY IS EVER RENAMED OR DELETED UNDER A SERVER THAT MAY BE USING IT (commit gate, codex — three rounds of
# rename-in-place edge cases: a stop that failed, a rollback stop that failed, a run killed between two renames). Each
# import is its own `data-<stamp>`; `data` is a symlink to the one being served (Docker resolves it when the container
# starts). Switching = stop → repoint the symlink in one rename → start → probe. A failure points it back. Only directories
# the symlink does not point to are ever removed, and only after the server answers on the new one — so a run killed at
# any step leaves `data` pointing at a complete index.
set -euo pipefail

DIR=${PHOTON_DIR:-/opt/eno/photon}
DUMP_URL=https://download1.graphhopper.com/public/asia/vietnam/photon-dump-vietnam-1.0-latest.jsonl.zst
IMAGE=eclipse-temurin:21-jre-noble
COMPOSE=/opt/eno/app/infra/vn-node/photon/photon.compose.yml
log() { echo "$(date -u +%FT%TZ) $*"; }

# A deploy builds two editions and wants the memory: never START an import under one (eno-docker-prune.sh does the same).
# A deploy that starts during an import shares the box with it — ~3 GB on a 23 GB box, measured 8 GB free on 2026-11-12.
if pgrep -f '^bash /tmp/[e]no-deploy' >/dev/null; then log "deploy in flight — skipped"; exit 0; fi
[ -f "$DIR/photon.jar" ] || { log "no $DIR/photon.jar — run install.sh first"; exit 1; }

# ⛔ ONE REFRESH AT A TIME (commit gate, codex): a second run (the timer during a manual install) must not race the first.
exec 9>"$DIR/.refresh.lock"
flock -n 9 || { log "another refresh is running — skipped"; exit 0; }

cd "$DIR"
running() { [ "$(docker inspect -f '{{.State.Running}}' eno-photon 2>/dev/null)" = "true" ]; }
point() { ln -sfn "$1" data.next && mv -T data.next data; }   # one rename: `data` is always a whole index or absent
# Asked from where the app asks: the eno-vn container, by name, over supabase_default.
# Bounded: a server that takes the connection and never answers fails the probe, it does not hang the run (commit gate, codex).
probe() { timeout 15 docker exec eno-vn-app node -e "fetch('http://eno-photon:2322/api?q=ben%20thanh&limit=1',{signal:AbortSignal.timeout(8000)}).then(r=>r.json()).then(j=>process.exit(j.features&&j.features.length?0:1)).catch(()=>process.exit(1))" 2>/dev/null; }
# ⛔ "Answers" means answers FROM $1: the old and new index both find Ben Thanh, so the probe alone cannot tell which one is
# mounted (commit gate, opus). Each index carries its own name in `.index-id`, read through the running container's mount.
serving() { [ "$(timeout 15 docker exec eno-photon cat /photon/data/.index-id 2>/dev/null)" = "$1" ]; }
answers() { for _ in $(seq 1 30); do serving "$1" && probe && return 0; sleep 5; done; return 1; }
# A plain `data` directory (Docker makes an empty one if the container is started before any index exists): an empty one
# goes. One that holds files is never renamed or touched here — a person looks (commit gate, codex + opus).
if [ -d data ] && [ ! -L data ] && ! rmdir data 2>/dev/null; then log "data is a plain directory with files in it — not touching it; see README"; exit 1; fi
CUR=$(readlink data 2>/dev/null || true)

log "downloading the Vietnam dump"
curl -fsSL --max-time 900 -o dump.jsonl.zst.part "$DUMP_URL"
want=$(curl -fsSL --max-time 60 "$DUMP_URL.md5" | awk '{print $1}')
got=$(md5sum dump.jsonl.zst.part | awk '{print $1}')
[ -n "$want" ] && [ "$want" = "$got" ] || { log "md5 mismatch ($got vs $want)"; rm -f dump.jsonl.zst.part; exit 1; }
mv dump.jsonl.zst.part dump.jsonl.zst

NEW="data-$(date -u +%Y%m%d%H%M%S)"
log "importing into $NEW"
# A run killed mid-import can leave its container behind (killing the client does not stop it): under the lock, it is ours.
docker rm -f eno-photon-import >/dev/null 2>&1 || true
mkdir "$NEW"
if ! zstd -dc dump.jsonl.zst | docker run --rm -i --name eno-photon-import -m 3g -e JAVA_TOOL_OPTIONS=-Xmx2g \
  -v "$DIR/photon.jar:/photon/photon.jar:ro" -v "$DIR/$NEW:/photon/data" "$IMAGE" \
  java -jar /photon/photon.jar import -import-file - -data-dir /photon/data -languages en; then
  log "import failed — still serving ${CUR:-nothing}"; rm -rf "$NEW"; exit 1
fi
echo "$NEW" > "$NEW/.index-id"

set +e
log "switching from ${CUR:-nothing} to $NEW"
# Killed (systemd stop, Ctrl-C) between the stop and the end: start whatever `data` points at, so a stop is never left
# behind (commit gate, codex). A reboot in that minute: `restart: always` (photon.compose.yml) starts it with the daemon.
trap 'running || docker compose -f "$COMPOSE" up -d eno-photon >/dev/null 2>&1' EXIT
if running; then docker compose -f "$COMPOSE" stop eno-photon >/dev/null 2>&1; fi
if running; then log "eno-photon did not stop — still serving $CUR; $NEW left unused"; exit 1; fi
# --force-recreate: a new container mounts `data` afresh, through the symlink as it now points.
point "$NEW" && docker compose -f "$COMPOSE" up -d --force-recreate eno-photon && answers "$NEW"
if [ $? -eq 0 ]; then
  log "eno-photon answers on $NEW"
  for d in data-*; do [ "$d" != "$NEW" ] && [ -d "$d" ] && rm -rf "$d"; done
  exit 0
fi
log "eno-photon does not answer on $NEW"
docker compose -f "$COMPOSE" stop eno-photon >/dev/null 2>&1
if running; then log "eno-photon did not stop — left on $NEW, nothing removed"; exit 1; fi
if [ -n "$CUR" ] && [ -d "$CUR" ]; then
  point "$CUR" && docker compose -f "$COMPOSE" up -d --force-recreate eno-photon && answers "$CUR" && log "back on $CUR"
  # ⛔ Removed only once `data` no longer points at it (commit gate, codex): a repoint that failed leaves it the index.
  [ "$(readlink data)" = "$CUR" ] && rm -rf "$NEW"
fi
exit 1
