# shellcheck shell=bash
# The vehicle refresh's shell helpers, SOURCED by scripts/vehicle-rentals-weekly.sh — split out so they are tested
# (src/lib/vehicle-job-shell.test.ts runs them under the local bash). bash 3.2-safe (macOS /bin/bash): no arrays
# here, no `declare -A`, no `${x,,}`. Every function returns a status or prints; none exits and none notifies — the
# caller decides what a failure means. The caller sets LOCKDIR before take_lock.

# Modified within the last $2 minutes?
recent() { [ -n "$(find "$1" -maxdepth 0 -mmin "-$2" 2>/dev/null)" ]; }

# A process's start time ("Tue Oct 13 09:05:11 2026") — with the pid, the lock holder's identity. ⛔ In ONE fixed
# locale and zone: ps prints lstart in the caller's, and launchd's environment is not a terminal's (gate review: a hand
# run under another TZ would have read the live holder as "started at another time" and broken its lock).
proc_start() { LC_ALL=C TZ=UTC ps -p "$1" -o lstart= 2>/dev/null | sed 's/^ *//; s/ *$//'; }

# ⛔ IS THE LOCK'S HOLDER THE RUN THAT TOOK IT? `kill -0` alone is not enough (review 2026-10-13): after a crash
# (SIGKILL, a panic — the EXIT trap never ran) and a reboot, the stale pid can belong to ANY process, and every daily
# run would back off from a lock nobody holds until someone deleted it by hand. So the pid must be alive AND have the
# start time the lock recorded — not "a command line naming this script", which a run started another way (bash < the
# script) would not carry (gate review). A lock without a recorded start falls back to the command line.
holder_alive() {
  [ -n "$1" ] || return 1
  kill -0 "$1" 2>/dev/null || return 1
  local want
  want="$(cat "$LOCKDIR/start" 2>/dev/null)"
  if [ -n "$want" ]; then [ "$(proc_start "$1")" = "$want" ]; return; fi
  ps -p "$1" -o command= 2>/dev/null | grep -q 'vehicle-rentals-weekly\.sh'
}

LOCK_WHY=""   # why take_lock backed off: alive | young | breaking | lost | pid-unwritable
# A lock whose pid could not be written would be nobody's (the EXIT trap would not remove it, a later starter
# would break it while this run goes on): give it back and stop.
own_lock() {
  echo $$ > "$LOCKDIR/pid" 2>/dev/null && proc_start $$ > "$LOCKDIR/start" 2>/dev/null && return 0
  rm -rf "$LOCKDIR"; LOCK_WHY=pid-unwritable; return 1
}

# ⛔ ONE RUN AT A TIME, whoever starts it (launchd or a hand run): two would both move the Mioto checkpoints aside,
# re-scrape and apply the same stages. mkdir is atomic; a lock whose holder is not a live refresh is cleared — UNDER
# A SECOND mkdir ($LOCKDIR.break), so two starters that both saw the same dead holder cannot both clear it and both
# run. Inside the break the pid is read again: only the lock of the holder seen before is removed. A lock just
# created, whose pid is not yet written, is left alone for a minute.
take_lock() {
  mkdir "$LOCKDIR" 2>/dev/null && { own_lock; return $?; }
  local holder ok=1
  holder="$(cat "$LOCKDIR/pid" 2>/dev/null)"
  if holder_alive "$holder"; then LOCK_WHY=alive; return 1; fi
  if [ -z "$holder" ] && recent "$LOCKDIR" 1; then LOCK_WHY=young; return 1; fi
  LOCK_WHY=breaking
  if ! mkdir "$LOCKDIR.break" 2>/dev/null; then
    # A breaker killed mid-break (it takes milliseconds) leaves this behind: cleared after 10 minutes.
    recent "$LOCKDIR.break" 10 || rmdir "$LOCKDIR.break" 2>/dev/null
    return 1
  fi
  if [ "$(cat "$LOCKDIR/pid" 2>/dev/null)" = "$holder" ]; then
    echo "── $(date '+%F %T') clearing a lock left by pid ${holder:-?}, which is not a running vehicle refresh"
    rm -rf "$LOCKDIR"
  fi
  LOCK_WHY=lost
  mkdir "$LOCKDIR" 2>/dev/null && own_lock && ok=0
  rmdir "$LOCKDIR.break" 2>/dev/null
  return $ok
}

# Which of this run's problems ($1: words, e.g. "scrape:bikes mioto") were NOT problems on the last run ($2: the file
# holding last run's, one per line)? Prints those NEW ones space-separated — nothing when every problem is a repeat —
# then rewrites $2 with this run's. A problem seen two runs in a row is a lasting fault or a real change, and a daily
# multi-hour re-scrape fixes neither: the caller stamps success (still alerting) only when EVERY problem is a repeat —
# one new problem still earns its next-day retry (gate review: a repeat of A stamped away B's first retry).
problems_new() {
  local now new
  # shellcheck disable=SC2086
  now="$(printf '%s\n' $1 | sed '/^$/d' | sort -u)"
  if [ -z "$now" ]; then rm -f "$2"; return 0; fi
  if [ -s "$2" ]; then new="$(printf '%s\n' "$now" | grep -Fxv -f "$2" | tr '\n' ' ')"; else new="$(printf '%s\n' "$now" | tr '\n' ' ')"; fi
  printf '%s\n' "$now" > "$2" || true
  printf '%s' "$new"
}

# The sources named in an import log's `STATUS STEP REFUSED for: a: why | b: why` line, one per line.
refused_sources() {
  grep -m1 '^STATUS STEP REFUSED for: ' "$1" 2>/dev/null | sed 's/^STATUS STEP REFUSED for: //' | tr '|' '\n' | sed 's/^ *//; s/:.*//' | sed '/^$/d' | sort -u
}

# The sources whose CREATIONS the import held this run ("<source>: would create …" in its REFUSED line) — a spike
# of new rows nobody vouched for — one per line.
creation_refused_sources() {
  grep -m1 '^STATUS STEP REFUSED for: ' "$1" 2>/dev/null | sed 's/^STATUS STEP REFUSED for: //' | tr '|' '\n' | sed 's/^ *//' \
    | grep -E '^[A-Za-z0-9_-]+: would create ' | sed 's/:.*//' | sort -u
}

# Did the import stage die on the DATABASE (a dropped tunnel, a dead socket) rather than on its own logic? Only then
# is one retry worth it: the scrape on disk is reused, every write is conditional, and the run history counts a
# second record of the same scrape once.
is_conn_error() {
  grep -Eq "ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENOTCONN|Connection terminated|connection timeout|timeout exceeded when trying to connect|Can't reach database server|server closed the connection|terminating connection|Client has encountered a connection error|cached translations unreadable" "$1" 2>/dev/null
}
