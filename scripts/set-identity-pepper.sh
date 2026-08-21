#!/usr/bin/env bash
# Mint IDENTITY_HASH_PEPPER and store it in BOTH secret stores.
#
# ⛔ THE SAME VALUE IN BOTH, AND THAT IS NOT OPTIONAL. subject-hash keys the digest with it, so two
# different peppers would make the same passport hash differently on eno.vn and eno.forum — and the
# "same human, second account" check silently stops working across editions.
#
# ⚠️ SIDE EFFECT: src/lib/auth/handoff.ts:133 keys the native sign-in pairing code with
# `IDENTITY_HASH_PEPPER || SUPABASE_SECRET_KEY`. Setting this SWITCHES that key, so any handoff
# code in flight at deploy time stops verifying. Pairing codes are short-lived and the user simply
# retries, but do not run this during a launch demo.
#
# ⛔ ROTATING IT LATER IS NOT FREE: every stored subjectHash was computed with the old key, so the
# duplicate-identity check would compare new digests against old ones and match nothing. Treat this
# as write-once unless you are prepared to re-hash the table.
set -euo pipefail
umask 077
PROJECT=speedy-victory-500106-h8

# ⛔ BOTH STORES ARE CHECKED, NOT JUST ROOT, AND THE ASYMMETRY WAS A REAL BUG. Three external
# reviewers found the same thing independently: checking only eno-root-env meant that if SERVICES
# already held a pepper and root did not, this script would mint a new one and OVERWRITE the
# services value — silently invalidating every subjectHash computed under it, which is exactly the
# irreversible outcome the note above exists to prevent.
#
# ⚠️ AND A HALF-APPLIED STATE MUST BE REPAIRABLE. The two writes are sequential and cannot be made
# atomic across two secrets, so a crash between them used to leave root peppered, services not, and
# every re-run refusing ("already set") — the invariant permanently broken with no way out. Now the
# script detects that state and COPIES the existing value across instead of minting a new one.
EXISTING=""
SPLIT=0
for SECRET in eno-root-env eno-services-env; do
  V=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT" 2>/dev/null \
        | grep '^IDENTITY_HASH_PEPPER=' | head -1 | cut -d= -f2- || true)
  if [ -n "$V" ]; then
    if [ -n "$EXISTING" ] && [ "$V" != "$EXISTING" ]; then
      echo "✗ THE TWO STORES HOLD DIFFERENT PEPPERS. Neither can be chosen automatically — picking"
      echo "  one invalidates every subjectHash written under the other. Resolve by hand."
      exit 1
    fi
    EXISTING="$V"
  else
    SPLIT=1
  fi
done

if [ -n "$EXISTING" ] && [ "$SPLIT" -eq 0 ]; then
  echo "✓ IDENTITY_HASH_PEPPER already set in BOTH stores and identical — nothing to do."
  exit 0
fi

if [ -n "$EXISTING" ]; then
  echo "→ one store already has a pepper; COPYING it across rather than minting (repairing a"
  echo "  half-applied run — a new value would orphan every hash written under the old one)"
  PEPPER="$EXISTING"
else
  PEPPER=$(openssl rand -base64 32)
  echo "→ minted a 32-byte pepper (${#PEPPER} chars base64)"
fi

for SECRET in eno-root-env eno-services-env; do
  D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
  gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT" > "$D/env"
  BEFORE=$(wc -l < "$D/env")
  [ "$BEFORE" -lt 20 ] && { echo "✗ $SECRET looks truncated ($BEFORE lines) — ABORT"; exit 1; }
  grep -v '^IDENTITY_HASH_PEPPER=' "$D/env" > "$D/new"
  echo "IDENTITY_HASH_PEPPER=$PEPPER" >> "$D/new"
  echo "  $SECRET: $BEFORE → $(wc -l < "$D/new") lines"
  gcloud secrets versions add "$SECRET" --data-file="$D/new" --project="$PROJECT" >/dev/null
  rm -rf "$D"; trap - EXIT
done
echo "✓ IDENTITY_HASH_PEPPER stored in both stores, identical"
echo "⚠️ Not live until the services restart — Cloud Run reads env at container start."
