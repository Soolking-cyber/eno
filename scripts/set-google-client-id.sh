#!/usr/bin/env bash
# ── NEXT_PUBLIC_GOOGLE_CLIENT_ID → both env secrets ─────────────────────────────────────────────
#
# Turns on the branded Google sign-in. src/lib/google-identity.ts does the Google half against OUR
# OWN OAuth client via Google Identity Services, so the consent screen stops reading
# "to continue to xihiryllwmjoouipkyhw.supabase.co". Everything is already built and gated on this
# one variable being present AT BUILD TIME.
#
# ⚠️ THIS VALUE IS NOT A SECRET. A NEXT_PUBLIC_* OAuth client id is inlined into the browser bundle
# by design — it is an identifier, not a credential. It lives in the env secrets only because that
# is where this repo keeps build-time configuration.
#
# ⚠️ BUILD TIME, NOT RUNTIME. cloudbuild.yaml:22 and cloudbuild.services.yaml:60 pull the secret as
# `BUILDENV` and write it to /workspace/buildenv.env before `next build`. Setting it in the Cloud Run
# runtime env would do NOTHING: the value is baked into the JS, and next.config.ts:661 reads the same
# variable at build time to widen the CSP for accounts.google.com. So this needs a REDEPLOY, not a
# service restart — the opposite of IDENTITY_HASH_PEPPER.
#
# ⛔ THE CLIENT ID IS THE ONE SUPABASE ALREADY USES, VERIFIED BY MEASUREMENT, not from a doc:
#     curl -s -o /dev/null -w '%{redirect_url}' \
#       'https://xihiryllwmjoouipkyhw.supabase.co/auth/v1/authorize?provider=google'
#   returns a redirect to accounts.google.com carrying this client_id. That matters because
#   `signInWithIdToken` verifies the token's `aud` against the client ids configured on Supabase's
#   Google provider — reusing the live one means NO Supabase dashboard change is needed. A brand new
#   client would have to be added there first, and forgetting that is a silent sign-in failure.
#
# ⚠️ AND IT IS IN THE PROJECT YOU MIGHT NOT EXPECT. TWO GCP projects display as "eno-vn"; this client
#   belongs to speedy-victory-500106-h8 (number 71068369681), which is the project-number prefix of
#   the id itself. Read the NUMBER, never the display name.
set -euo pipefail
umask 077
PROJECT=speedy-victory-500106-h8
CLIENT_ID='71068369681-8g980qg93sgp67nm5kvsam3pvt54afiu.apps.googleusercontent.com'
KEY=NEXT_PUBLIC_GOOGLE_CLIENT_ID

# The prefix must be this project's number, or we are pointing the browser at a client that lives
# somewhere nobody is maintaining.
case "$CLIENT_ID" in
  71068369681-*) ;;
  *) echo "✗ client id is not from project 71068369681 — refusing"; exit 1 ;;
esac

for SECRET in eno-root-env eno-services-env; do
  D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
  gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT" > "$D/env"
  BEFORE=$(wc -l < "$D/env")
  # A truncated read would otherwise be written back as the new version, deleting every other
  # variable in the store. Same guard as set-identity-pepper.sh, for the same reason.
  [ "$BEFORE" -lt 20 ] && { echo "✗ $SECRET looks truncated ($BEFORE lines) — ABORT"; exit 1; }

  if grep -q "^${KEY}=${CLIENT_ID}$" "$D/env"; then
    echo "  $SECRET: already set to this client id — skipping"
    rm -rf "$D"; trap - EXIT; continue
  fi

  grep -v "^${KEY}=" "$D/env" > "$D/new"
  echo "${KEY}=${CLIENT_ID}" >> "$D/new"
  AFTER=$(wc -l < "$D/new")
  echo "  $SECRET: $BEFORE → $AFTER lines"
  gcloud secrets versions add "$SECRET" --data-file="$D/new" --project="$PROJECT" >/dev/null
  rm -rf "$D"; trap - EXIT
done

echo "✓ ${KEY} stored in both stores"
echo "⚠️ NOT LIVE UNTIL A REBUILD — it is inlined by next build, not read at container start."
echo "⚠️ Console work still required on the client itself: add Authorized JavaScript ORIGINS"
echo "   (GIS uses origins, not redirect URIs) and set the consent screen App name + logo."
