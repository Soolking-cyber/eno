#!/usr/bin/env bash
# Teacher job DMs — the box half, run ONCE on the box after the deploy that ships src/lib/teachers/job-dms
# (owner, 2026-10-20: "matching algorythm with laya in the box … all in the box all on auto").
#
#   bash /opt/eno/app/infra/vn-node/job-dms/install.sh
#
# What it does, in order, stopping at the first failure — and saying, on the way out, what it left (codex, gate 6c):
#   1. checks the deploy is live (last-deployed-sha = this checkout), the four tables' exact shape (the file the DDL
#      script checks itself with: scripts/teacher-job-dms-shape.sql) and the send mode — changes nothing;
#   2. builds and starts the Laya container (laya-server/README.md: baked model, no published port, 3 CPUs / 4 GB) and
#      asks it one real question from the app container — inference under the container's own limits, not only a
#      loaded model (opus, gate 6c);
#   3. reads one dry run of the job-DM route (counts only: nothing stored, nothing sent);
#   4. installs the two POLICY timers (teacher-job-dms, job-dms-invite) — written, NOT enabled by the installer;
#   5. enables ONLY the run timer. The send mode is the kv key `job-dms:mode`, which starts as 'shadow': every run reads
#      posts and records what it WOULD send — to teachers who switched job messages ON, and only them (/privacy) — and
#      sends NOTHING until the owner sets it to 'live'.
# Nothing this script starts before step 5 acts on its own: Laya answers only the app, which asks it only from a run.
# A RE-RUN leaves the INVITE timer as it finds it (step 5 checks that it did) and enables the RUN timer again — step 5's
# job; to keep it off after a re-run, disable it then (opus, gate 6f). Meanwhile an enabled run timer keeps firing in
# shadow mode, harmlessly (one run at a time — step 3 waits one out; Laya is record-only).
# The invite timer (a one-time bell to every live teacher) is NOT enabled here. Going live is two owner steps, in order:
#   a. enable the invite — teachers switch job messages on, and the shadow run starts recording what it would send them;
#   b. after the shadow messages are graded, set the mode to 'live'.
#
# Undo (nothing here touches the app containers, Postgres or any other service):
#   systemctl disable --now eno-cron-teacher-job-dms.timer eno-cron-job-dms-invite.timer
#   docker compose -f /opt/eno/app/infra/vn-node/jobs.compose.yml down
set -euo pipefail

APP=/opt/eno/app
cd "$APP"
say() { printf '\n== %s\n' "$*"; }

# On a failure: the step, and what is in place now. Nothing is undone automatically — every step is safe to repeat, and
# a half-done step is safer left to be read than rolled back blind.
STEP=1
PREV_LAYA=no
on_exit() {
  local rc=$?
  [ "$rc" = 0 ] && return
  echo
  echo "FAILED in step $STEP/5 (exit $rc) — nothing after it ran."
  if [ "$STEP" -lt 2 ]; then echo "  Nothing was changed."; fi
  if [ "$STEP" -ge 2 ]; then
    echo "  eno-laya: $(docker inspect eno-laya --format '{{.State.Status}}/{{.State.Health.Status}}' 2>/dev/null || echo absent) — harmless until the run timer is on."
    echo "    remove it:  docker compose -f $APP/infra/vn-node/jobs.compose.yml down"
    if [ "$PREV_LAYA" = yes ]; then echo "    or put the previous image back:  docker tag eno-laya:prev eno-laya:local && docker compose -f $APP/infra/vn-node/jobs.compose.yml up -d --force-recreate"; fi
  fi
  # Read from systemd, never assumed — a step-5 failure can leave the run timer enabled (codex + opus, gate 6d).
  if [ "$STEP" -ge 4 ]; then for u in eno-cron-teacher-job-dms.timer eno-cron-job-dms-invite.timer; do
    echo "  $u: $(systemctl is-enabled "$u" 2>/dev/null || true) / $(systemctl is-active "$u" 2>/dev/null || true)"; done
    echo "    switch off:  systemctl disable --now eno-cron-teacher-job-dms.timer eno-cron-job-dms-invite.timer"; fi
  echo "Fix the cause and re-run this script."
}
trap on_exit EXIT

say "1/5 preconditions"
HEAD_SHA=$(git rev-parse HEAD)
LIVE_SHA=$(cat /opt/eno/last-deployed-sha 2>/dev/null || true)
[ "$HEAD_SHA" = "$LIVE_SHA" ] || { echo "STOP: /opt/eno/app is at $HEAD_SHA but the live deploy is ${LIVE_SHA:-unknown} — deploy first."; exit 3; }
[ -f src/lib/teachers/job-dms/run.ts ] || { echo "STOP: this checkout has no job-DM code."; exit 3; }
# The four tables EXACTLY as scripts/teacher-job-dms-ddl.mjs makes them — every column's type, NOT NULL and default,
# every constraint's definition, every index's columns, RLS on and no policy — checked by the SAME file the DDL script
# checks itself with (CREATE TABLE IF NOT EXISTS never repairs a table of another shape — codex + opus, gates 3a–6f).
# One line per difference; none = the database matches.
SHAPE=$(docker exec -i supabase-db psql -U postgres -At -v ON_ERROR_STOP=1 < scripts/teacher-job-dms-shape.sql)
[ -z "$SHAPE" ] || { echo "STOP: the job-DM tables are not as scripts/teacher-job-dms-ddl.mjs makes them:"; printf '%s\n' "$SHAPE" | sed 's/^/  /'
  echo "  (run the DDL script on production: it creates what is missing, and refuses a table of another shape)"; exit 3; }
# The send mode: this script enables the run timer, so it must find the mode shadow (or unset, which reads as shadow) —
# a 'live' left by an earlier install or a restored database would make the next run SEND (codex, gate 3a).
MODE=$(docker exec supabase-db psql -U postgres -At -c "select coalesce(kv_get('job-dms:mode')::text, 'unset')" </dev/null)
case "$MODE" in unset|'"shadow"') ;; *) echo "STOP: job-dms:mode is $MODE — this install starts in shadow only. Set it back first:"
  echo "  docker exec supabase-db psql -U postgres -c \"select kv_set('job-dms:mode', '\\\"shadow\\\"'::jsonb, null, false)\""; exit 3 ;; esac
INVITE_BEFORE=$(systemctl is-enabled eno-cron-job-dms-invite.timer 2>/dev/null || true)
INVITE_RUNNING_BEFORE=$(systemctl is-active eno-cron-job-dms-invite.timer 2>/dev/null || true)
echo "ok  deploy $HEAD_SHA live, the 4 tables exactly as the DDL makes them, mode ${MODE}"
echo "    run timer: $(systemctl is-enabled eno-cron-teacher-job-dms.timer 2>/dev/null || true) · invite timer: ${INVITE_BEFORE:-absent} (left as it is)"

STEP=2
say "2/5 Laya"
# The rollback image is the last one that ran HEALTHY: a failed install's container never overwrites it, so "fix and
# re-run" keeps the way back (codex + opus, gate 6e).
RUNNING=$(docker inspect eno-laya --format '{{.Image}}' 2>/dev/null || true)
if [ -n "$RUNNING" ] && [ "$(docker inspect eno-laya --format '{{.State.Health.Status}}' 2>/dev/null || true)" = healthy ]; then
  docker tag "$RUNNING" eno-laya:prev
fi
if docker image inspect eno-laya:prev >/dev/null 2>&1; then PREV_LAYA=yes; fi
DOCKER_BUILDKIT=1 docker build --progress=plain --label "vn.eno.git-sha=$HEAD_SHA" -t eno-laya:local infra/vn-node/laya-server </dev/null
docker compose -f infra/vn-node/jobs.compose.yml up -d --force-recreate </dev/null
for _ in $(seq 1 72); do   # the model loads in 1–3 minutes; give it 6
  st=$(docker inspect eno-laya --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  [ "$st" = healthy ] && break
  sleep 5
done
[ "$st" = healthy ] || { echo "STOP: eno-laya is '$st' after 6 minutes — docker logs eno-laya"; exit 4; }
# From inside the app container (it is the engine's one caller, on the same network) — no third-party image pulled onto
# the internal network for a check (codex, gate 6a). /healthz first, then ONE real prediction: the image build proved the
# weights load, not that inference works read-only, with a 64 MB noexec /tmp, inside 4 GB (opus, gate 6c).
docker exec eno-vn-app node -e "fetch('http://eno-laya:8790/healthz').then(async (r) => { console.log(r.status, await r.text()); if (!r.ok) process.exit(1) }).catch((e) => { console.error(e.message); process.exit(1) })" </dev/null
docker exec eno-vn-app node -e "
const body = { states: [{ post: 'English teacher needed in District 7, Saturday mornings, 400k per hour.' }],
  questions: { kind: { type: 'choice', instructions: 'What is this post?', criteria: { hiring: 'a school hiring a teacher', other: 'anything else' } } } }
fetch('http://eno-laya:8790/v1/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) })
  .then(async (r) => { const j = await r.json().catch(() => null)
    if (r.status !== 200 || !Array.isArray(j?.results) || j.results.length !== 1 || !j.results[0].answers?.kind) { console.error('predict FAILED', r.status, JSON.stringify(j).slice(0, 200)); process.exit(1) }
    console.log('ok  one prediction in', j.ms, 'ms') })
  .catch((e) => { console.error('predict FAILED', e.message); process.exit(1) })" </dev/null

STEP=3
say "3/5 dry run (counts only)"
# The secret goes to curl on its stdin as a header line (`-H @-`), never in an argument another process could read
# (codex, 6a) — verbatim: no config quoting to escape for, so nothing depends on the bash version (opus, 6c + 6d).
# The route answers 500 for a run that did not do its job; "busy" is a scheduled run (an earlier install's timer) holding
# the one-run lock for at most its 12 minutes — waited out, not a failure (opus, gate 6f).
for attempt in $(seq 1 14); do
  rc=0
  OUT=$(docker exec eno-vn-app printenv CRON_SECRET </dev/null | { IFS= read -r SECRET; printf 'Authorization: Bearer %s\n' "$SECRET"; } \
    | curl -sS --fail-with-body --max-time 900 -H 'Host: eno.vn' -H @- 'http://127.0.0.1:3001/api/cron/teacher-job-dms?dryRun=1') || rc=$?
  printf '%s\n' "$OUT"
  case "$rc:$OUT" in
    0:*'"ok":true'*) break ;;
    *'"stop":"busy"'*) [ "$attempt" -lt 14 ] || { echo "STOP: the run lock was still held after 13 minutes."; exit 1; }
      echo "  a scheduled run holds the run lock — again in a minute"; sleep 60 ;;
    *) echo "STOP: the dry run did not answer ok."; exit 1 ;;
  esac
done

STEP=4
say "4/5 timers (installed, not enabled)"
ENO_CRON_ONLY=teacher-job-dms bash infra/vn-node/cron/install-cron-timers.sh </dev/null
ENO_CRON_ONLY=job-dms-invite bash infra/vn-node/cron/install-cron-timers.sh </dev/null

STEP=5
say "5/5 enable the run timer (shadow mode: records, never sends)"
# The invite as step 1 found it — checked HERE, not trusted to the cron installer: it is the owner's step a, never this
# script's (opus, gates 6c–6f; install-cron-timers.sh installs a POLICY job disabled).
# Enabled OR started — a timer can run without being enabled (opus, gate 6g).
if { [ "$(systemctl is-enabled eno-cron-job-dms-invite.timer 2>/dev/null || true)" = enabled ] && [ "$INVITE_BEFORE" != enabled ]; } \
  || { [ "$(systemctl is-active eno-cron-job-dms-invite.timer 2>/dev/null || true)" = active ] && [ "$INVITE_RUNNING_BEFORE" != active ]; }; then
  systemctl disable --now eno-cron-job-dms-invite.timer
  echo "STOP: the invite timer came on during this install — switched off again."; exit 5
fi
# The mode once more, right before the timer that acts on it — step 1 read it minutes ago (opus, gate 6f).
MODE=$(docker exec supabase-db psql -U postgres -At -c "select coalesce(kv_get('job-dms:mode')::text, 'unset')" </dev/null)
case "$MODE" in unset|'"shadow"') ;; *) echo "STOP: job-dms:mode became $MODE during this install — the run timer was NOT enabled."; exit 3 ;; esac
systemctl enable --now eno-cron-teacher-job-dms.timer
systemctl list-timers --no-pager 'eno-cron-teacher-job-dms*' || true
echo
echo "done. Going live = two owner steps, in this order:"
echo "  a. the invite (teachers switch job messages on; shadow rows start):  systemctl enable --now eno-cron-job-dms-invite.timer"
echo "  b. after the shadow messages are graded, send for real:"
echo "     docker exec supabase-db psql -U postgres -c \"select kv_set('job-dms:mode', '\\\"live\\\"'::jsonb, null, false)\""
