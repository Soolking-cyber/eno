#!/usr/bin/env bash
# ⛔ THE CANONICAL COPY OF THIS FILE IS THE REPO, AND IT WAS NOT UNTIL 2026-08-22.
# It lived only at /opt/eno/bin/eno-build.sh — no version control, no review, no way
# to tell whether the box's copy still matched anything. eno-deploy.sh calls it, so a
# deploy depended on a file nobody could diff. Deploy from the repo copy:
#   install -m 755 /opt/eno/app/infra/vn-node/eno-build.sh /opt/eno/bin/eno-build.sh
# Build one edition's image. This WAS "exactly as Cloud Build does"; Cloud Build was
# removed 2026-08-22, so this script is now the definition rather than a mirror of one.
# scripts/preview.mjs must be kept in step with the MARKETPLACE_HOSTS_SERVICES line below.
#   eno-build.sh marketplace | services
#
# ⛔ THE EDITION FLAG IS THE LICENSING BOUNDARY, NOT A FEATURE TOGGLE. It picks
# next.config.ts's pageExtensions, so services-only routes either EXIST in the
# bundle or do not. eno.vn is a licensed sàn TMĐT and may not serve visa,
# itinerary or PayPal surfaces at all — a marketplace build with the wrong flag is
# a compliance failure, not a cosmetic one. And it cannot be fixed by an env var
# afterwards: the routes are decided at COMPILE time.
set -euo pipefail
ED="${1:?marketplace|services}"
case "$ED" in
  marketplace) ENVF=/opt/eno/secrets/eno-vn.env;    TAG=eno-vn:local ;;
  services)    ENVF=/opt/eno/secrets/eno-forum.env; TAG=eno-forum:local ;;
  *) echo "unknown edition: $ED"; exit 1 ;;
esac
cd /opt/eno/app
B=$(mktemp); trap 'rm -f "$B"' EXIT
cp "$ENVF" "$B"
printf '\nNEXT_PUBLIC_ENO_EDITION=%s\n' "$ED" >> "$B"
# Only the marketplace carries this, and only it should: it admits eno.vn to the
# partner-run visa CHAT, never to payments or eno's own e-visa marketing (those
# use the stricter .forum.svc. infix no marketplace build lists).
[ "$ED" = "marketplace" ] && printf 'MARKETPLACE_HOSTS_SERVICES=true\n' >> "$B"

# ⛔ THE BUILD NEEDS A DATABASE, AND NOT THE ONE THE RUNTIME USES. `next build`
# prerenders 64 static pages and several of them QUERY POSTGRES — src/app/brands
# calls db.brand.findMany() at build time. The runtime address `db:5432` is a
# docker-compose hostname that does not resolve inside `docker build`, so every
# prerender failed P1001 DatabaseNotReachable. The Dockerfile runs `npm run build;`
# with a SEMICOLON, so that failure did not fail the layer: it surfaced three
# layers later as ".next/standalone: not found", which points nowhere near the cause.
# Cloud Build never hits this because its DATABASE_URL is Supabase, publicly
# reachable. Here: loopback + --network=host.
PGPW=$(grep '^POSTGRES_PASSWORD=' /opt/eno/supabase/.env | cut -d= -f2-)
# ⛔ NEVER INTERPOLATE A PASSWORD INTO A sed REPLACEMENT. All three reviewers flagged this
# independently. `&` in a sed replacement expands to the WHOLE MATCH, and `|` is the
# delimiter here — so a password containing either silently produces a corrupt
# DATABASE_URL. It then fails as a build-time prerender P1001, which the Dockerfile's
# `npm run build;` SEMICOLON turns into ".next/standalone: not found" three layers later,
# pointing nowhere near the password. It works today only because this particular
# password happens to be benign; rotate it and the build breaks inexplicably.
# python does the URL-encoding and the file edit without a substitution language in between.
PGPW="$PGPW" python3 - "$B" <<'PYEOF'
import os, sys, urllib.parse
pw = urllib.parse.quote(os.environ["PGPW"], safe="")
url = f"postgresql://postgres:{pw}@127.0.0.1:5433/postgres"
path = sys.argv[1]
out = []
for line in open(path):
    k = line.split("=", 1)[0]
    out.append(f"{k}={url}\n" if k in ("DATABASE_URL", "DIRECT_URL") else line)
open(path, "w").writelines(out)
PYEOF
echo "building $TAG (edition=$ED, $(grep -c '=' "$B") build vars)"
# ⛔ KEEP THE WHOLE LOG. `| tail -20` threw away the only copy of the actual
# failure: the Dockerfile runs `npm run build;` with a SEMICOLON, so a failed
# Next build does not fail the layer — it just leaves .next/standalone missing and
# the error scrolls past 300 lines earlier. --progress=plain because BuildKit's
# default TTY renderer collapses exactly the output we need.
# ⚠️ --no-cache ON THE BUILD STEP. The `npm run build` layer FAILED once and
# BuildKit cached the failure: every retry replayed the broken layer in seconds and
# reported the identical error, which reads exactly like "the fix did not work".
# The source had not changed, so nothing invalidated it.
# ⛔ `|| true` USED TO BE ON THIS LINE AND IT LIED ABOUT EVERY FAILURE. On 2026-08-22
# the marketplace `npm ci` died (sharp could not fetch libvips from GitHub), and this
# script exited 0 and printed "built: eno-vn:local 642MB" — the size of the EIGHT HOUR
# OLD image it had not replaced. A deploy driven by that output ships stale code while
# reporting success, which is worse than failing: nobody goes looking.
PRE=$(docker images --no-trunc --format '{{.ID}}' "$TAG" 2>/dev/null | head -1)
set +e
DOCKER_BUILDKIT=1 docker build --progress=plain --no-cache --network=host --secret id=buildenv,src="$B" -t "$TAG" . > "/opt/eno/build-$ED.log" 2>&1
RC=$?
set -e
tail -20 "/opt/eno/build-$ED.log"
if [ "$RC" -ne 0 ]; then
  echo "⛔ BUILD FAILED (rc=$RC) — $TAG WAS NOT REBUILT. Full log: /opt/eno/build-$ED.log"
  exit "$RC"
fi
# ⚠️ AND A ZERO EXIT IS STILL NOT PROOF. The Dockerfile runs `npm run build;` with a
# SEMICOLON (see above), so a failed Next build can leave the layer green. The image ID
# CHANGING is the only evidence the tag now points at something new.
POST=$(docker images --no-trunc --format '{{.ID}}' "$TAG" 2>/dev/null | head -1)
if [ -n "$PRE" ] && [ "$PRE" = "$POST" ]; then
  echo "⛔ $TAG STILL POINTS AT THE SAME IMAGE ID after a 'successful' build — treating as FAILURE."
  exit 1
fi
echo "built: $TAG  id=${POST:0:19}  created=$(docker inspect -f '{{.Created}}' "$TAG")"
