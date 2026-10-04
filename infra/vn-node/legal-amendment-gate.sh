#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · LEGAL-AMENDMENT DATE GATE — refuses to PUBLISH a legal amendment on a day other than
# the publication date its texts print. Called by eno-deploy.sh (step 2b), after the pull.
#
#   bash legal-amendment-gate.sh <repo-dir> <deployed-sha>
#
# ⛔ WHY (2026-10-01 review). src/lib/compliance/legal-amendment.ts types two dates: `published`,
# printed on /terms, /regulations (META + Article 17), /returns, /prohibited and /privacy (not
# /legal/ranking since 2026-10-04 — it has its own RANKING_DISCLOSURE_UPDATED, which this gate does not
# read), and `inForce`, which is ALSO the runtime switch for the Terms version onboarding stamps
# and for the site-wide notice. Deploys happen only on the owner's word, so the commit that carries
# an amendment can sit unshipped for days. Deployed on any later day it:
#   · prints a publication date that is false (the text went live later than it says);
#   · leaves fewer than the 5 clear days' notice Quy chế Article 15 promises (from 02/10 for a
#     07/10 in-force date);
#   · from the in-force date on, shows NO notice at all and binds the new version at once.
# Nothing else fails closed: legal-amendment.test.ts can only check the gap between two typed dates.
#
# ⚠️ TWO RECORDS SINCE 2026-10-05, EACH HELD TO THE SAME RULES, IN TURN — the module says why:
#   · LEGAL_AMENDMENT — the Terms (and /returns, /prohibited, /privacy; the October 2026 amendment);
#   · REGULATIONS_AMENDMENT — the Quy chế's own amendments (version 3 on: /regulations' META and its
#     newest Article 17 entry; /legal/ranking's RANKING_DISCLOSURE_UPDATED is tied to its `published`
#     while version 3 is current, so this gate holds that page's date too).
# Both must be readable (an object literal `export const <NAME>… = {` … `}`); a deploy passes only when
# every record passes. legal-amendment-gate.test.ts holds the list below equal to the records the module
# exports, so a third record cannot ship ungated.
#
# THE RULE, PER RECORD. If the DEPLOYED commit (/opt/eno/last-deployed-sha) already carries the same two
# dates and flag, that amendment is already live and this deploy is a routine one for it. Otherwise this
# deploy PUBLISHES it, and that is allowed only when today in Vietnam IS `published` (and `inForce` is at
# least 6 calendar days later — the day of publication is not counted, Civil Code 2015 Art 147–148).
# Anything else refuses, with the fix: re-date both, commit, push, re-run. A deployed commit without the
# record at all (before it existed) counts as "not yet published".
#
# LEGAL_AMENDMENT_ACK=<published> overrides — ONLY for an amendment that really did go live on
# <published> by some other path, or one the owner and counsel have decided to publish anyway.
# Scoped to the date, like SCHEMA_OK is scoped to the commit, so a lingering export cannot wave
# through the NEXT amendment.
#
# ⛔ AN IMMEDIATE AMENDMENT (`immediate: true` in the module — owner, 2026-10-01: "just change now we dont
# have users so its safe to implement just new terms no need for announcement"; owner, 2026-10-05, for
# the Quy chế's version 3: "apply best recommended") is in force on its publication day: no notice
# window, nothing announced. It must have inForce == published, and it publishes ONLY when today in
# Vietnam IS that day AND the deploy carries LEGAL_AMENDMENT_IMMEDIATE=<published> — the owner's waiver
# of the notice, acknowledged for that date and no other (one ack covers every immediate record
# published that day — they carry the same date by construction). No other override applies to it
# (LEGAL_AMENDMENT_ACK does not): a later day means re-dating both, which keeps the printed date true.
# Once deployed, later deploys pass as routine like any other amendment.
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

# The lines of `export const <NAME> … = {` through its closing `}` (`}` or `} as const`), and nothing
# else: flag() and field() read ONLY these, so another object in the file — a fixture, an example, the
# OTHER record — cannot set the dates or the flag the gate acts on (2026-10-01 review).
# No such object → nothing → the dates are unreadable → refuse (or, for the deployed commit, "new").
obj(){
  awk -v name="$1" '$0 ~ ("^export const " name "[ :=]") { on = 1 } on { print } on && /^}/ { exit }' <<<"$2"
}

# `true` if the text sets `immediate: true` on a line of its own (the module's field), else nothing.
flag(){
  awk 'match($0, "^[ \t]*immediate: true([ \t,]|$)") { print "true"; exit }' <<<"$1"
}

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

SOURCE=$(cat "$REPO/$F" 2>/dev/null) || { bad "cannot read $F — refusing"; exit 1; }
DEPLOYED=""
[ -n "$LAST" ] && DEPLOYED=$(git -C "$REPO" show "$LAST:$F" 2>/dev/null)
TODAY=${ENO_GATE_TODAY:-$(TZ=UTC-7 date +%Y-%m-%d)}

# check <NAME> <label> <pages> <what binds> <retract hint: 1 or ''>
# 0 when this deploy may carry the record's dates; 1, after saying why and how to fix it, when not.
check(){
  local name=$1 label=$2 pages=$3 binds=$4 retract=$5
  local where=$F src prev pub inf imm gap prev_pub prev_inf prev_imm
  [ "$name" = LEGAL_AMENDMENT ] || where="$F ($name)"

  src=$(obj "$name" "$SOURCE")
  pub=$(field "$src" published)
  inf=$(field "$src" inForce)
  if [ -z "$pub" ] || [ -z "$inf" ]; then
    bad "cannot read $name.published / .inForce from $F — refusing"; return 1
  fi
  imm=$(flag "$src")
  gap=$(( $(daynum "$inf") - $(daynum "$pub") ))
  if [ -n "$imm" ]; then
    if [ "$gap" -ne 0 ]; then
      bad "$where: immediate: true, but in force $inf is not the publication date $pub. An immediate amendment"
      bad "takes effect the day it is published: set inForce: '$pub' — or drop immediate and give ≥6 days."
      return 1
    fi
  elif [ "$gap" -lt 6 ]; then
    bad "$where: in force $inf is only $gap day(s) after publication $pub — the texts promise 5 clear days,"
    bad "so in force must be at least published + 6. Fix the dates; only the owner can waive the notice,"
    bad "for one amendment, by immediate: true with inForce == published."
    return 1
  fi

  prev=$(obj "$name" "$DEPLOYED")
  prev_pub=$(field "$prev" published)
  prev_inf=$(field "$prev" inForce)
  prev_imm=$(flag "$prev")
  if [ -n "$prev_pub" ] && [ "$prev_pub" = "$pub" ] && [ "$prev_inf" = "$inf" ] && [ "$prev_imm" = "$imm" ]; then
    ok "$label published $pub (in force $inf${imm:+, immediate}) is already live — unchanged since the deployed commit"
    return 0
  fi

  if [ -n "$imm" ]; then
    if [ "$TODAY" != "$pub" ]; then
      bad "this deploy PUBLISHES an IMMEDIATE $label typed in $where —"
      bad "  published and in force $pub — but today in Vietnam is $TODAY. The pages would print a false date."
      bad "Fix: set published: '$TODAY' and inForce: '$TODAY' in $where, commit, push, then re-run with"
      bad "  LEGAL_AMENDMENT_IMMEDIATE=$TODAY bash eno-deploy.sh"
      [ -n "$retract" ] && bad "(Bell notices already sent under $pub keep that date: scripts/notify-legal-amendment.ts --retract --published=$pub)"
      return 1
    fi
    if [ "${LEGAL_AMENDMENT_IMMEDIATE:-}" != "$pub" ]; then
      bad "this deploy PUBLISHES an IMMEDIATE $label: published AND in force $pub, with NO notice window"
      bad "  and no announcement — $binds from today. That waives the 5 days' notice the texts promise,"
      bad "  which is the owner's decision alone. If the owner made it for THIS amendment, re-run with:"
      bad "  LEGAL_AMENDMENT_IMMEDIATE=$pub bash eno-deploy.sh"
      return 1
    fi
    warn "this deploy publishes an IMMEDIATE $label: published and in force $pub (today), no notice"
    warn "window — proceeding on LEGAL_AMENDMENT_IMMEDIATE=$pub."
    return 0
  fi

  if [ "$TODAY" = "$pub" ]; then
    ok "this deploy publishes the $label today ($TODAY); in force $inf, $gap days later"
    return 0
  fi
  if [ "${LEGAL_AMENDMENT_ACK:-}" = "$pub" ]; then
    warn "this deploy publishes the $label dated $pub, but today in Vietnam is $TODAY —"
    warn "proceeding on LEGAL_AMENDMENT_ACK=$pub. The pages will say it was published on $pub."
    return 0
  fi

  bad "this deploy PUBLISHES the $label typed in $where —"
  bad "  published $pub, in force $inf — but today in Vietnam is $TODAY."
  if [ "$(daynum "$TODAY")" -ge "$(daynum "$inf")" ]; then
    bad "  It is already the in-force date: NO notice would ever show, and $binds at once."
  elif [ "$(daynum "$TODAY")" -gt "$(daynum "$pub")" ]; then
    bad "  $pages would print a false publication date,"
    bad "  and only $(( $(daynum "$inf") - $(daynum "$TODAY") - 1 )) clear day(s) of notice would remain of the 5 promised."
  else
    bad "  The pages would print a publication date that has not happened yet."
  fi
  bad "Fix: set published: '$TODAY' and inForce: at least '+6 days' in $where, commit, push, re-run."
  bad "Only if the amendment really went live on $pub (or the owner and counsel decided otherwise):"
  bad "  LEGAL_AMENDMENT_ACK=$pub bash eno-deploy.sh"
  return 1
}

# ⛔ THE RECORDS — one `check` line each; legal-amendment-gate.test.ts holds this list equal to the
# LegalAmendment consts the module exports.
check LEGAL_AMENDMENT 'legal amendment' '/terms, /regulations, /returns, /prohibited and /privacy' 'the new Terms would bind' 1 || exit 1
check REGULATIONS_AMENDMENT 'Quy chế amendment (REGULATIONS_AMENDMENT)' '/regulations and /legal/ranking' 'the new Quy chế would bind' '' || exit 1
exit 0
