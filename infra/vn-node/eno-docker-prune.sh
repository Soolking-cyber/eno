#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · reclaim the disk Docker keeps after every deploy
#
# ⛔ WHY THIS EXISTS. Measured 2026-09-09: 120G disk at 89% full, ~79GB of images for
# 13 running containers, 69GB of it reclaimable. Every deploy builds two editions and
# leaves the previous layers behind, so the box fills at a steady rate nobody watches.
# Postgres and Docker both fail badly and confusingly when a disk fills, and the failure
# lands on whoever is deploying at the time rather than whoever let it fill.
#
# ⚠️ AND THE SPACE REALLY IS IN THE DANGLING LAYERS — a reviewer argued the opposite,
# that `docker system df`'s "reclaimable" is mostly tagged-but-unused images which
# `image prune` (no `-a`) will not touch, so this script would reclaim nothing and then
# alarm. Counted instead of argued: **20 tagged images, 194 dangling**. Six of the
# twenty are the eno-* tags protected below. The untagged layers are the bulk.
#
# ⛔ DANGLING ONLY. NEVER `docker system prune -a`, and never `--filter until=`.
# `-a` removes every image not used by a RUNNING container, which takes:
#   · eno-vn:prev / eno-forum:prev — the rollback eno-deploy.sh pins BEFORE it swaps.
#     Deleting those turns a failed deploy from "roll back" into "rebuild under
#     pressure", which is the worst moment to discover it.
#   · eno-*:verified-<sha> — the last artefact proven against the edition boundary.
# This script removes untagged layers only, which is where the 69GB actually is.
#
# ⛔ AND IT REFUSES TO RUN DURING A BUILD OR DEPLOY. A `docker build` in flight owns
# intermediate layers that are untagged by definition; pruning underneath it can
# delete a stage the build is about to reference. eno-deploy.sh takes ~20 minutes for
# two editions, and this timer fires nightly — they WILL overlap eventually.
#
# ⚠️ THE BUILD CACHE IS PRUNED BY AGE, NOT EMPTIED. Dropping it entirely makes the
# next deploy recompile from scratch (measured: npm install alone runs minutes on 4
# shared cores). 7 days keeps the layers a routine deploy reuses and drops the rest.
# Its size swings with what is building — 15.7GB idle, 11.2GB mid-build on the same
# afternoon — so treat any figure here as a snapshot, never a target.
#
# ⛔ COMMITTING THIS CHANGES NOTHING ON THE BOX — a reviewer was right to say so, and the
# same gap once left eno-backup's off-box copy silently doing nothing for months. All three
# files must be installed, and the units enabled, by hand:
#
#   install -m 755 /opt/eno/app/infra/vn-node/eno-docker-prune.sh /opt/eno/bin/eno-docker-prune.sh
#   install -m 644 /opt/eno/app/infra/vn-node/eno-docker-prune.service /etc/systemd/system/
#   install -m 644 /opt/eno/app/infra/vn-node/eno-docker-prune.timer   /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now eno-docker-prune.timer
#   systemctl list-timers eno-docker-prune.timer      # prove it is scheduled
#
# ⚠️ AND RE-INSTALL AFTER EDITING. /opt/eno/bin/ is a COPY, not a symlink, so a change here
# does not reach the box until that first line is run again — the same trap eno-build.sh
# documents for itself.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# ⛔ THE INTERLOCK. `pgrep -f` on the deploy script name and on `docker build`; either
# means hands off. Exit 0, not a failure — a skipped prune is routine, and marking the
# unit failed for it would train whoever reads `systemctl --failed` to ignore this unit.
if pgrep -f 'eno-deploy\.sh' >/dev/null 2>&1; then
  log "deploy in progress — skipping (a prune under a build can delete a stage it still needs)"
  exit 0
fi
# ⛔ NO `pgrep -f buildkit` HERE, THOUGH AN EARLIER VERSION HAD ONE. A reviewer pointed out
# it can match long-lived BuildKit/buildx daemon processes, which would make this script
# skip EVERY night and look exactly like success — a permanent silent no-op is the worst
# outcome available to a maintenance job. Checked on the box mid-build: the only match was
# a `runc … /var/lib/docker/buildkit/executor/…` that exists only while building, so on THIS
# host it would probably have been fine — but "probably fine, fails silently forever if not"
# is not a trade worth taking for a check that `docker build` already covers.
#
# ⚠️ `docker build` is the pattern that matters and cannot self-match: this script's own
# command line is /opt/eno/bin/eno-docker-prune.sh, which does not contain that string.
if pgrep -f 'docker build' >/dev/null 2>&1; then
  log "docker build in progress — skipping"
  exit 0
fi

# ⚠️ THE DAEMON MUST ACTUALLY ANSWER. With Persistent=true a missed run fires at BOOT, where
# docker.service may be up but not yet responsive — and under `set -e` the first docker call
# would abort the script, marking the unit failed for a condition that resolves itself in
# seconds. Ask once, quietly, and treat "not ready" as a skip rather than a failure.
if ! docker info >/dev/null 2>&1; then
  log "docker not responding yet (likely a boot-time catch-up run) — skipping"
  exit 0
fi

BEFORE=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
log "before: ${BEFORE}G free"

# ⚠️ REPORT WHAT IS BEING PROTECTED, so the log answers "did it eat my rollback?"
# without anyone having to reason about the flags.
log "keeping tagged images:"
docker images --format '  {{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E '^  eno-' || true

# Untagged, unreferenced layers. Docker will not remove an image a container uses,
# running or stopped, so this cannot strand a serving container.
log "pruning dangling images…"
docker image prune -f 2>&1 | tail -2

# Build cache older than a week — see the note above on why not all of it.
log "pruning build cache older than 168h…"
docker builder prune -f --filter 'until=168h' 2>&1 | tail -2

AFTER=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
log "after: ${AFTER}G free (reclaimed $((AFTER - BEFORE))G)"

# ⚠️ A FLOOR THAT IS LOUD RATHER THAN SILENT. If the disk is still nearly full after a
# prune, the problem is not deploy litter — it is storage or Postgres growth, and it
# needs a person. Non-zero so `systemctl --failed` shows it.
if [ "$AFTER" -lt 15 ]; then
  log "⛔ only ${AFTER}G free AFTER pruning — this is no longer deploy litter. Check /opt/eno/supabase/volumes/storage and the database."
  exit 1
fi
