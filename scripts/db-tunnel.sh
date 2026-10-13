#!/usr/bin/env bash
# The SSH tunnel that DATABASE_URL/DIRECT_URL need, supervised so a drop does not fail a build.
#
# ⛔ WHY THIS EXISTS: `npm run preview:vn` prerenders ~259 pages with 15 parallel workers, each
# holding a Prisma pool, so a build is a sustained burst of connections over one ssh process. A
# bare `ssh -fN -L` has now died mid-build twice, and the symptom is NOT "tunnel down" — it is
# `Error occurred prerendering page "/en/post"` with `Can't reach database server at 127.0.0.1:5433`
# buried 200 lines up, which reads exactly like a code defect in whatever page happened to be
# building when the socket dropped. The page named in the error is arbitrary.
#
# ⚠️ A DEAD TUNNEL FAILS THE BUILD, NOT THE TESTS. tsc, lint and vitest all pass with no tunnel at
# all, so a green gate proves nothing about this. Check `db-tunnel.sh status` before believing a
# build failure is yours.
#
# ⚠️ IT MUST OUTLIVE THE SHELL THAT STARTS IT. `ssh -f` forks but stays in the caller's process
# group, so any harness that kills the group when a command returns takes the tunnel with it.
# ⛔ `setsid` DOES NOT EXIST ON macOS — it is util-linux. Reaching for it here cost a debugging
# round: the supervisor died instantly with "command not found", the error went to /dev/null, and
# the symptom was an EMPTY log plus "tunnel FAILED to come up", which looks like an ssh problem and
# is not. The detach is done with python3's os.setsid() instead, which is present on both.
#
# ⛔ SOURCE `.env` FOR THE BUILD, NEVER FOR THE TESTS. The build needs DATABASE_URL, so the habit is
# `set -a; . ./.env; set +a` — but carrying that into `npm run verify:local` turns 5 tests RED that
# are green otherwise (2026-09-22): `src/app/md/agent-discovery.test.ts` reads the edition and
# starts asserting the forum's documents against eno.vn's, and `src/lib/api/oauth.test.ts` picks up
# the real OAUTH_ISSUER and takes the other branch of its cutoff check. Both read as a regression in
# code you did not touch. The gate is meant to run with a clean environment; only the build gets .env.
#
# Usage:  scripts/db-tunnel.sh start | status | stop | wait
set -uo pipefail

PORT=5433
HOST=162.4.176.233
SSH_PORT=24700
KEY=${ENO_BOX_KEY:-$HOME/.ssh/CS-Linux-20260920135129228.pem}
LOG=/tmp/eno-db-tunnel.log
PIDFILE=/tmp/eno-db-tunnel.pid
STARTLOCK=/tmp/eno-db-tunnel.start.lock
START_WAIT_S=60        # a second starter waits this long for the first one's tunnel
SUPERVISOR_WAIT_S=45   # …and for a running supervisor to reconnect
UP_WAIT_S=30           # a new supervisor's first connection
# ⚠️ ONE TEST SWITCH, FOR src/lib/db-tunnel.test.ts ONLY: with NODE_ENV=test AND ENO_TUNNEL_SANDBOX=<an existing dir>,
# the lock, pid and log files live in THAT dir under fixed names (start.lock is the one path `start` may delete) and
# ENO_TUNNEL_*_WAIT_S (whole seconds ≥ 1) may shorten the waits — so the test never touches, or waits on, this machine's
# real tunnel. Without both, nothing here can be redirected or shortened from the environment.
seconds() { case "$1" in ''|*[!0-9]*|0|0*) echo "$2" ;; *) echo "$1" ;; esac; }
if [ "${NODE_ENV:-}" = test ] && [ -n "${ENO_TUNNEL_SANDBOX:-}" ] && [ -d "$ENO_TUNNEL_SANDBOX" ]; then
  LOG="$ENO_TUNNEL_SANDBOX/tunnel.log"; PIDFILE="$ENO_TUNNEL_SANDBOX/tunnel.pid"; STARTLOCK="$ENO_TUNNEL_SANDBOX/start.lock"
  START_WAIT_S=$(seconds "${ENO_TUNNEL_START_WAIT_S:-}" "$START_WAIT_S")
  SUPERVISOR_WAIT_S=$(seconds "${ENO_TUNNEL_SUPERVISOR_WAIT_S:-}" "$SUPERVISOR_WAIT_S")
  UP_WAIT_S=$(seconds "${ENO_TUNNEL_UP_WAIT_S:-}" "$UP_WAIT_S")
fi

up() { nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; }

case "${1:-status}" in
  start)
    if up; then echo "  tunnel already up on :$PORT"; exit 0; fi
    # ⛔ ONE STARTER AT A TIME: two scheduled jobs a waking Mac fires together (the 05:30 sweep and the 06:00 refresh)
    # would both see no supervisor and both fork one. mkdir is atomic; the loser waits for the winner's tunnel. A lock
    # left by a starter that died is cleared after two minutes.
    if ! mkdir "$STARTLOCK" 2>/dev/null; then
      for _ in $(seq 1 "$START_WAIT_S"); do up && { echo "  tunnel up on :$PORT (another caller started it)"; exit 0; }; [ -d "$STARTLOCK" ] || break; sleep 1; done
      [ -n "$(find "$STARTLOCK" -maxdepth 0 -mmin +2 2>/dev/null)" ] && rm -rf "$STARTLOCK"
      mkdir "$STARTLOCK" 2>/dev/null || { echo "  another caller is starting the tunnel and :$PORT is still down" >&2; exit 1; }
    fi
    trap 'rm -rf "$STARTLOCK"' EXIT
    # ⛔ A SUPERVISOR ALREADY RUNNING IS MID-RECONNECT (a dropped connection, a Mac waking from sleep): WAIT for it,
    # never start a second one. Two supervisors fight over :$PORT (ExitOnForwardFailure makes the loser redial every
    # 2 s for ever). The scheduled jobs call `start` before every database step (scripts/apartments-weekly.sh), so
    # this is the common path after a lid-close, not a corner case.
    if pgrep -f 'eno-db-tunnel-supervisor' >/dev/null 2>&1; then
      for _ in $(seq 1 "$SUPERVISOR_WAIT_S"); do up && { echo "  tunnel back up on :$PORT (the running supervisor reconnected)"; exit 0; }; sleep 1; done
      # Still down after 45 s: that supervisor is wedged (a key or host it was started with no longer works) — replace
      # it with one started from THIS environment's key, rather than fail every step behind it for ever.
      echo "  a supervisor is running but :$PORT has not come back in $SUPERVISOR_WAIT_S s — replacing it" >&2
      "$0" stop >/dev/null 2>&1
    fi
    [ -r "$KEY" ] || { echo "  key not readable: $KEY" >&2; echo "  (on macOS an empty ls/find under ~/Desktop is NOT proof of absence — try mdfind -name CS-Linux)" >&2; exit 1; }
    # The supervisor loop is the point: `ssh -N` returns whenever the connection drops, and a
    # build must not notice. ServerAlive* makes a half-open socket fail fast enough to restart.
    # ⚠️ THE MARKER IS NOT COSMETIC. `pkill -f 'ssh .*-L 5433...'` also matches the SUPERVISOR's own
    # command line, because the loop's source contains that ssh invocation verbatim — killing the
    # child that way silently kills its restarter too, and the tunnel never comes back. `stop`
    # targets this marker instead so the two are distinguishable.
    SUPERVISOR="
      # eno-db-tunnel-supervisor
      while true; do
        ssh -i '$KEY' -p $SSH_PORT -N \
            -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
            -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
            -L $PORT:127.0.0.1:$PORT root@$HOST >> '$LOG' 2>&1
        rc=\$?   # ⚠️ CAPTURE FIRST: the \$(date) below runs its own command and resets \$? to 0,
                #    so reading \$? inside the echo logs a successful exit every single time.
        echo \"[\$(date -u +%H:%M:%S)] tunnel exited (\$rc), restarting\" >> '$LOG'
        sleep 2
      done
    "
    SUPERVISOR="$SUPERVISOR" LOG="$LOG" python3 - "$PIDFILE" <<'PY'
import os, sys
pidfile = sys.argv[1]
pid = os.fork()
if pid:                       # parent: record the session leader and return immediately
    open(pidfile, "w").write(str(pid))
    os._exit(0)
os.setsid()                   # new session, so a process-group kill upstream cannot reach us
fd = os.open(os.environ["LOG"], os.O_WRONLY | os.O_CREAT | os.O_APPEND)
os.dup2(fd, 1); os.dup2(fd, 2)
os.dup2(os.open(os.devnull, os.O_RDONLY), 0)
os.execvp("bash", ["bash", "-c", os.environ["SUPERVISOR"]])
PY
    for _ in $(seq 1 "$UP_WAIT_S"); do up && break; sleep 1; done
    if up; then
      echo "  tunnel up on :$PORT (supervisor $(cat "$PIDFILE"), log $LOG)"
    else
      # ⛔ A FAILED START MUST NOT LEAVE THE SUPERVISOR DIALLING. It retries every 2s forever, so
      # a bad key or a firewalled port would spin an invisible process and a growing log until
      # the machine is rebooted — and the next `status` would say DOWN with no hint why.
      echo "  tunnel FAILED to come up; stopping the supervisor. Last lines of $LOG:" >&2
      tail -5 "$LOG" 2>/dev/null | sed 's/^/    /' >&2
      "$0" stop >/dev/null 2>&1
      exit 1
    fi
    ;;
  status)
    up && echo "  tunnel UP on :$PORT" || { echo "  tunnel DOWN"; exit 1; }
    [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && echo "  supervisor alive ($(cat "$PIDFILE"))" || echo "  ⚠️ no supervisor — a drop will NOT be repaired"
    ;;
  wait)
    for _ in $(seq 1 60); do up && { echo "  tunnel up"; exit 0; }; sleep 1; done
    echo "  timed out waiting for :$PORT" >&2; exit 1
    ;;
  stop)
    # Supervisor first (by its marker), THEN the ssh child — the other order just makes the
    # supervisor dial a fresh tunnel a second later.
    pkill -f 'eno-db-tunnel-supervisor' 2>/dev/null
    [ -f "$PIDFILE" ] && kill -- -"$(cat "$PIDFILE")" 2>/dev/null
    [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null
    pkill -f "ssh .*-L $PORT:127.0.0.1:$PORT" 2>/dev/null
    rm -f "$PIDFILE"
    up && echo "  ⚠️ still listening on :$PORT" || echo "  tunnel stopped"
    ;;
  *) echo "usage: $0 start|status|stop|wait" >&2; exit 2 ;;
esac
