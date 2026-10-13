# shellcheck shell=bash
# THE 66-HOUR SUCCESS GATE of scripts/apartments-weekly.sh — sourced by it and by its unit test
# (src/lib/apartments-gate.test.ts). Functions only: sourcing this file runs nothing.
#
# Owner, 2026-10-13: refresh the imported property rentals "every 3 days". launchd has no "every N days", so the job
# is started DAILY (06:00) and each source runs only when its last SUCCESS is at least GATE_HOURS old:
#   · the stamp is written ONLY after that source's whole refresh succeeded — a failed or missed run therefore
#     retries the next day, and a run the Mac slept through fires on wake (launchd runs a missed calendar job then);
#   · it holds the run's START (epoch seconds), not its end: a refresh that ends at 13:00 still makes the source due
#     again three mornings later (72 h after a 06:00 start ≥ 66 h), where an end stamp would slip it to day four;
#   · 66 h, not 72 h: six hours of slack for a run that started late (asleep at 06:00, fired at 11:00 on wake).
# ⚠️ bash 3.2 (macOS /bin/bash) and GNU bash alike: no associative arrays, BSD and GNU date both handled.

GATE_HOURS="${GATE_HOURS:-66}"

# stamp_read <file> — prints the epoch seconds a success stamp holds; fails (prints nothing) when the file is absent,
# empty or malformed. Only the first field counts: "<epoch> <ISO>" is written so a person can read it.
stamp_read() {
  local f="$1" first
  [ -f "$f" ] || return 1
  first="$(head -n 1 "$f" 2>/dev/null | awk '{ print $1 }')"
  case "$first" in ''|*[!0-9]*) return 1 ;; esac
  # 9–11 digits: 2001…5138 — anything else is not a time this job wrote.
  [ "${#first}" -ge 9 ] && [ "${#first}" -le 11 ] || return 1
  printf '%s\n' "$first"
}

# source_due <stamp file> <now, epoch s> [gate hours] — exit 0 when the source is due: never succeeded, an unreadable
# stamp, a stamp in the future (the clock moved back — never trusted to hold a source off), or one GATE_HOURS old or
# more. Exit 1 when it succeeded less than GATE_HOURS ago.
source_due() {
  local f="$1" now="$2" hours="${3:-$GATE_HOURS}" at
  case "$now" in ''|*[!0-9]*) return 0 ;; esac
  case "$hours" in ''|*[!0-9]*) return 0 ;; esac
  at="$(stamp_read "$f")" || return 0
  # ⚠️ 10#: a leading zero ("08", "0999999999") is octal to bash arithmetic, and "08" is an error, not 8.
  [ $(( 10#$at )) -le $(( 10#$now )) ] || return 0
  [ $(( 10#$now - 10#$at )) -ge $(( 10#$hours * 3600 )) ]
}

# epoch_iso <epoch s> — ISO-8601 UTC ("2026-10-13T06:00:00Z"), BSD date first (macOS), then GNU date.
epoch_iso() {
  date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null
}

# stamp_write <file> <epoch s> — atomically (temp file in the same directory, then mv): a crash leaves the old stamp or
# the new one, never half of one. Called only after a success.
stamp_write() {
  local f="$1" at="$2" tmp
  case "$at" in ''|*[!0-9]*) return 1 ;; esac
  tmp="$f.tmp.$$"
  printf '%s %s\n' "$at" "$(epoch_iso "$at")" > "$tmp" && mv -f "$tmp" "$f"
}
