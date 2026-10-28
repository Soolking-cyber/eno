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
# ⛔ THE BUILD CACHE IS CAPPED BY SIZE, NOT BY AGE (2026-10-27). It used to keep 7 days, on the
# theory that the next deploy reuses those layers. It cannot: eno-build.sh builds with
# --no-cache, so no app build reads the cache, and each one still writes ~10 GB to it (both
# editions). Measured on the box: the 7-day rule reclaimed 0B on 10-25, 10-26 and 10-27 while the
# cache reached 48.8 GB, 44 GB of it written by one day's four deploys. `--reserved-space` keeps
# the most recently used ENO_BUILD_CACHE_KEEP (12GB) and drops the rest; the owner's first run by
# hand (this exact command, no `-a`) freed 32 GB. A cache record a running build uses is never pruned.
# ⚠️ THE COST, ACCEPTED (opus, gate): right after a deploy the newest 12GB is mostly that deploy's own
# unread records, so the rare hand-run builds that DO use the cache (eno-laya, eno-mt,
# eno-classroom-speech; their READMEs) rebuild from scratch next time — minutes each — against a
# disk four deploys can fill in a day. No filter tells app-build records from theirs.
# ⚠️ AND IT RUNS AFTER EVERY DEPLOY TOO (eno-deploy.sh step 14), not only nightly: four deploys
# in one day wrote more than the disk had free that morning.
#
# ⛔ COMMITTING THIS CHANGES NOTHING ON THE BOX BY ITSELF — a reviewer was right to say so, and
# the same gap once left eno-backup's off-box copy silently doing nothing for months. eno-deploy.sh
# step 14 now refreshes /opt/eno/bin/eno-docker-prune.sh from each deployed commit; the units are
# installed, and the timer enabled, by hand, once:
#
#   install -m 755 /opt/eno/app/infra/vn-node/eno-docker-prune.sh /opt/eno/bin/eno-docker-prune.sh
#   install -m 644 /opt/eno/app/infra/vn-node/eno-docker-prune.service /etc/systemd/system/
#   install -m 644 /opt/eno/app/infra/vn-node/eno-docker-prune.timer   /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now eno-docker-prune.timer
#   systemctl list-timers eno-docker-prune.timer      # prove it is scheduled
#
# ⚠️ /opt/eno/bin/ is a COPY, not a symlink — the same trap eno-build.sh documents for itself —
# so a change here reaches the nightly timer at the next deploy (step 14), not at the push.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

KEEP="${ENO_BUILD_CACHE_KEEP:-12GB}"
[[ "$KEEP" =~ ^[0-9]+(MB|GB)$ ]] || { log "ENO_BUILD_CACHE_KEEP=$KEEP is not like 12GB — refusing"; exit 2; }

# ⛔ THE INTERLOCK IS THE DEPLOY'S OWN LOCK (eno-deploy.sh's LOCK=, held from its first step to its
# tenth). Exit 0, not a failure — a skipped prune is routine, and marking the unit failed for it
# would train whoever reads `systemctl --failed` to ignore this unit.
# ⚠️ IT WAS `pgrep -f 'eno-deploy\.sh'`, WHICH NEVER SAW A DEPLOY: eno-deploy.sh re-execs itself
# from /tmp/eno-deploy.XXXXXX.sh, so the running deploy's command line does not contain that
# string, while an idle `bash -c '… eno-deploy.sh …'` wrapper did.
# ⚠️ TESTED, THEN RELEASED AT ONCE — NOT HELD FOR THE PRUNE. eno-deploy.sh REFUSES to start while
# anyone holds it, so holding it here would turn a deploy started in the prune's minutes into
# "another deploy is running" with nothing deploying (opus, gate). A deploy that starts mid-prune is
# safe: a cache record a running build uses is never pruned, the app builds read no cache
# (--no-cache), and only untagged images go — :local and :prev keep their tags throughout a deploy.
# ⚠️ ONE PRUNE AT A TIME, ON ITS OWN LOCK, held for the run: the nightly timer and a deploy's step 14 can
# meet, and the daemon answers a second concurrent prune with "a prune operation is already running" —
# a failed run for nothing (opus, gate). The second one skips, exit 0.
# A lock that cannot be OPENED does not fix itself, so it is a failed run, not a routine skip (codex + opus, gate).
exec 7>>"${ENO_PRUNE_LOCK:-/var/lock/eno-docker-prune.lock}" || { log "⛔ cannot open the prune lock"; exit 1; }
flock -n 7 || { log "another prune is running — skipping"; exit 0; }
LOCK="${ENO_DEPLOY_LOCK:-/var/lock/eno-deploy.lock}"
FLOOR_G=15   # below this many GB free the disk needs a person (the floor at the end)
exec 8>>"$LOCK" || { log "⛔ cannot open $LOCK"; exit 1; }
if ! flock -n 8; then
  # ⛔ A SKIP IS ROUTINE — UNLESS THE DISK IS ALREADY LOW. The holder may be a deploy, apply-apple-signin.sh (it
  # takes the same lock), or a process that inherited it and would make every run skip; guessing which from
  # process names failed both ways (opus, gate). So the alarm is on the harm: a skipped prune on a nearly full
  # disk fails loudly, with the holders' pids.
  FREE=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
  HOLDERS=$(fuser "$LOCK" 2>/dev/null | xargs || true)
  if [ "${FREE:-0}" -lt "$FLOOR_G" ]; then
    log "⛔ only ${FREE}G free and the prune is skipping: $LOCK is held (pids $HOLDERS) — if no deploy is running, find the holder with fuser -v $LOCK"
    exit 1
  fi
  log "deploy lock held ($LOCK, pids $HOLDERS) — skipping (a prune under a build can delete a stage it still needs)"
  exit 0
fi
exec 8>&-
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
# ⚠️ EVERY docker CALL IS TIMED, the four adding up to under the 900 s eno-deploy.sh step 14 allows
# (codex + opus, gate): a daemon that stops answering ends this run instead of outliving the deploy.
if ! timeout 30 docker info >/dev/null 2>&1; then
  log "docker not responding yet (likely a boot-time catch-up run) — skipping"
  exit 0
fi

BEFORE=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
log "before: ${BEFORE}G free"

# ⚠️ REPORT WHAT IS BEING PROTECTED, so the log answers "did it eat my rollback?"
# without anyone having to reason about the flags.
log "keeping tagged images:"
timeout 60 docker images --format '  {{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E '^  eno-' || true

# Untagged, unreferenced layers. Docker will not remove an image a container uses,
# running or stopped, so this cannot strand a serving container.
# ⚠️ A FAILED PRUNE IS A FAILED RUN (exit 1 at the end), never one quiet log line: an unknown flag
# on another Docker would otherwise reclaim 0B forever and look like success (opus, gate).
# `--reserved-space` measured on the box's Docker 29.8.1, 2026-10-27.
FAILED=0
log "pruning dangling images…"
timeout 300 docker image prune -f 2>&1 | tail -2 || { log "⛔ image prune failed or timed out"; FAILED=1; }

# Build cache down to the newest ${KEEP} — see the note above on why not by age.
log "pruning build cache down to the newest ${KEEP}…"
timeout 300 docker builder prune -f --reserved-space "$KEEP" 2>&1 | tail -2 || { log "⛔ build-cache prune failed or timed out"; FAILED=1; }

AFTER=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
log "after: ${AFTER}G free (reclaimed $((AFTER - BEFORE))G)"

# ⚠️ A FLOOR THAT IS LOUD RATHER THAN SILENT. If the disk is still nearly full after a
# prune, the problem is not deploy litter — it is storage or Postgres growth, and it
# needs a person. Non-zero so `systemctl --failed` shows it.
if [ "$AFTER" -lt "$FLOOR_G" ]; then
  log "⛔ only ${AFTER}G free AFTER pruning — this is no longer deploy litter. Check /opt/eno/supabase/volumes/storage and the database."
  exit 1
fi
exit "$FAILED"
