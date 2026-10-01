#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · LEGAL-AMENDMENT DATE GATE — refuses to PUBLISH a legal amendment on a day other than
# the publication date its texts print. Called by eno-deploy.sh (step 2b), after the pull.
#
#   bash legal-amendment-gate.sh <repo-dir> <deployed-sha>
#
# ⛔ WHY (2026-10-01 review). src/lib/compliance/legal-amendment.ts types two dates: `published`,
# printed on /terms, /regulations (META + Article 17), /returns, /prohibited, /legal/ranking and
# /privacy, and `inForce`, which is ALSO the runtime switch for the Terms version onboarding stamps
# and for the site-wide notice. Deploys happen only on the owner's word, so the commit that carries
# an amendment can sit unshipped for days. Deployed on any later day it:
#   · prints a publication date that is false (the text went live later than it says);
#   · leaves fewer than the 5 clear days' notice Quy chế Article 15 promises (from 02/10 for a
#     07/10 in-force date);
#   · from the in-force date on, shows NO notice at all and binds the new version at once.
# Nothing else fails closed: legal-amendment.test.ts can only check the gap between two typed dates.
#
# THE RULE. If the DEPLOYED commit (/opt/eno/last-deployed-sha) already carries the same two dates,
# the amendment is already live and this deploy is a routine one: pass. Otherwise this deploy
# PUBLISHES it, and that is allowed only when today in Vietnam IS `published` (and `inForce` is at
# least 6 calendar days later — the day of publication is not counted, Civil Code 2015 Art 147–148).
# Anything else refuses, with the fix: re-date both, commit, push, re-run.
#
# LEGAL_AMENDMENT_ACK=<published> overrides — ONLY for an amendment that really did go live on
# <published> by some other path, or one the owner and counsel have decided to publish anyway.
# Scoped to the date, like SCHEMA_OK is scoped to the commit, so a lingering export cannot wave
# through the NEXT amendment.
#
# ⚠️ PORTABLE ON PURPOSE (GNU on the box, BSD on a Mac for the tests): no `date -d`, no tz
# database — Vietnam is UTC+7 with no DST, so the POSIX TZ string "UTC-7" (sign inverted by POSIX)
# is exact — and day arithmetic is done by hand (days-from-civil).
# ENO_GATE_TODAY=YYYY-MM-DD replaces the clock; it exists for src/lib/legal-amendment-gate.test.ts.
set -uo pipefail

REPO=${1:?usage: legal-amendment-gate.sh <repo-dir> <deployed-sha>}
LAST=${2:-}
F=src/lib/compliance/legal-amendment.ts

ok(){   printf '  \033[32m[ok]\033[0m %s\n' "$*"; }
bad(){  printf '  \033[31m[XX]\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m[!!]\033[0m %s\n' "$*"; }

# The ISO date typed after `<key>: '` — the first such line in the given text, or nothing.
field(){
  awk -v k="$2" -v q="'" '
    match($0, "^[ \t]*" k ": " q "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]" q) {
      s = substr($0, RSTART, RLENGTH); print substr(s, length(s) - 10, 10); exit
    }' <<<"$1"
}

# Days since a fixed epoch for an ISO date (Fliegel–Van Flandern), so two dates subtract exactly.
daynum(){
  local y=$((10#${1:0:4})) m=$((10#${1:5:2})) d=$((10#${1:8:2})) a
  a=$(( (14 - m) / 12 )); y=$(( y + 4800 - a )); m=$(( m + 12 * a - 3 ))
  echo $(( d + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045 ))
}

SRC=$(cat "$REPO/$F" 2>/dev/null) || { bad "cannot read $F — refusing"; exit 1; }
PUB=$(field "$SRC" published)
INF=$(field "$SRC" inForce)
if [ -z "$PUB" ] || [ -z "$INF" ]; then
  bad "cannot read LEGAL_AMENDMENT.published / .inForce from $F — refusing"; exit 1
fi
TODAY=${ENO_GATE_TODAY:-$(TZ=UTC-7 date +%Y-%m-%d)}
GAP=$(( $(daynum "$INF") - $(daynum "$PUB") ))
if [ "$GAP" -lt 6 ]; then
  bad "$F: in force $INF is only $GAP day(s) after publication $PUB — the texts promise 5 clear days,"
  bad "so in force must be at least published + 6. Fix the dates; nothing to override."
  exit 1
fi

PREV=""
[ -n "$LAST" ] && PREV=$(git -C "$REPO" show "$LAST:$F" 2>/dev/null)
PREV_PUB=$(field "$PREV" published)
PREV_INF=$(field "$PREV" inForce)
if [ -n "$PREV_PUB" ] && [ "$PREV_PUB" = "$PUB" ] && [ "$PREV_INF" = "$INF" ]; then
  ok "legal amendment published $PUB (in force $INF) is already live — dates unchanged since the deployed commit"
  exit 0
fi

if [ "$TODAY" = "$PUB" ]; then
  ok "this deploy publishes the legal amendment today ($TODAY); in force $INF, $GAP days later"
  exit 0
fi
if [ "${LEGAL_AMENDMENT_ACK:-}" = "$PUB" ]; then
  warn "this deploy publishes the legal amendment dated $PUB, but today in Vietnam is $TODAY —"
  warn "proceeding on LEGAL_AMENDMENT_ACK=$PUB. The pages will say it was published on $PUB."
  exit 0
fi

bad "this deploy PUBLISHES the legal amendment typed in $F —"
bad "  published $PUB, in force $INF — but today in Vietnam is $TODAY."
if [ "$(daynum "$TODAY")" -ge "$(daynum "$INF")" ]; then
  bad "  It is already the in-force date: NO notice would ever show, and the new Terms would bind at once."
elif [ "$(daynum "$TODAY")" -gt "$(daynum "$PUB")" ]; then
  bad "  /terms, /regulations, /returns, /prohibited and /privacy would print a false publication date,"
  bad "  and only $(( $(daynum "$INF") - $(daynum "$TODAY") - 1 )) clear day(s) of notice would remain of the 5 promised."
else
  bad "  The pages would print a publication date that has not happened yet."
fi
bad "Fix: set published: '$TODAY' and inForce: at least '+6 days' in $F, commit, push, re-run."
bad "Only if the amendment really went live on $PUB (or the owner and counsel decided otherwise):"
bad "  LEGAL_AMENDMENT_ACK=$PUB bash eno-deploy.sh"
exit 1
