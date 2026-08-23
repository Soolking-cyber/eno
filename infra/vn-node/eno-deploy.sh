#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# eno · THE deploy. Since 2026-08-22 this is the only path from git to users.
#
#   bash eno-deploy.sh              · pull, build both, verify, swap, health-check
#   bash eno-deploy.sh --no-pull    · rebuild what is already checked out
#   bash eno-deploy.sh --rollback   · put the previously-SERVING images back, now
#
# ⛔ A PUSH IS NO LONGER A DEPLOY. Cloud Build was removed on 2026-08-22 (owner:
# "remove cloud build entirely we preview locally and deploy on box from now on").
# Nothing ships until this runs ON THE BOX.
#
# ⚠️ WHY EVERY STEP HERE LOOKS PARANOID: production drifted FOURTEEN COMMITS behind,
# including seven security fixes, because eno-build.sh ended its docker build with
# `|| true` and printed the size of the image it had NOT replaced. Each check below
# replaced a cheaper one that had already failed in production at least once.
set -uo pipefail

APP=/opt/eno/app
# ⛔ RUN FROM A COPY, BECAUSE STEP 1 REWRITES THIS FILE. agy's catch, and it is a genuine
# corruption bug rather than a style point: bash reads a script INCREMENTALLY, by byte
# offset. `git merge --ff-only` below replaces eno-deploy.sh on disk mid-execution, so
# bash resumes at an offset that now lands in the middle of a different line. The symptom
# is not a clean failure — it is arbitrary fragments of shell executing during a deploy.
if [ "${ENO_DEPLOY_REEXEC:-}" != "1" ]; then
  ENO_DEPLOY_SELF=$(mktemp /tmp/eno-deploy.XXXXXX.sh) || exit 1
  cat "$0" > "$ENO_DEPLOY_SELF" && chmod +x "$ENO_DEPLOY_SELF" || exit 1
  # ⚠️ ABSOLUTE, BECAUSE STEP 1 `cd`s. `$0` is whatever was typed — `bash app/infra/…`
  # from /opt/eno resolves fine now and not at all after the cd, so the self-update check
  # below would abort the deploy mid-run with "No such file or directory".
  ENO_DEPLOY_ORIGIN=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
  export ENO_DEPLOY_REEXEC=1 ENO_DEPLOY_SELF ENO_DEPLOY_ORIGIN
  # ⚠️ NO `trap … EXIT` HERE. Traps do not survive `exec` — the handler is discarded with
  # the process image, so a trap set on this side never runs and every deploy would leak
  # an executable script into /tmp. The CHILD cleans up instead; that is why the path is
  # exported rather than kept local.
  exec "$ENO_DEPLOY_SELF" "$@"
fi
trap 'rm -f "${ENO_DEPLOY_SELF:-}"' EXIT
COMPOSE=$APP/infra/vn-node/apps.compose.yml
LOCK=/var/lock/eno-deploy.lock
PULL=1; ROLLBACK=0; SKIP_PURGE=0; EXPECT=""
for a in "$@"; do case "$a" in
  --no-pull) PULL=0;; --rollback) ROLLBACK=1;; --skip-purge) SKIP_PURGE=1;;
  --expect=*) EXPECT="${a#--expect=}";;
esac; done
say(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok(){  printf '  \033[32m[ok]\033[0m %s\n' "$*"; }
bad(){ printf '  \033[31m[XX]\033[0m %s\n' "$*"; }

# ⛔ ONE DEPLOY AT A TIME. Two concurrent runs share the :local and :prev tags and a
# single checkout: they can build from a moving tree, overwrite each other's rollback
# images, and leave the two editions on DIFFERENT commits — which for this repo means
# the licensed marketplace and the services edition disagreeing about the boundary.
exec 9>"$LOCK" || { bad "cannot open $LOCK"; exit 1; }
flock -n 9 || { bad "another deploy is running (holding $LOCK) — refusing"; exit 1; }

# ⛔ THROUGH CLOUDFLARE, NOT LOOPBACK. Since Authenticated Origin Pulls was enforced the
# origin answers 400 to anything without our client certificate, so a loopback curl is
# now guaranteed to fail and proves nothing. The edge is the only honest vantage point,
# and it exercises nginx routing too.
probe(){
  local fail=0 got
  check(){ got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$1?d=$RANDOM$$")
           if [ "$got" = "$2" ]; then printf '  %-38s %s\n' "$1" "$got"
           else printf '  %-38s %s (want %s) ⛔\n' "$1" "$got" "$2"; fail=1; fi; }
  check https://eno.vn/             200
  check https://eno.forum/          200
  check https://www.eno.forum/      200
  # ⛔ THE LICENSING CHECK. eno.vn is a licensed sàn TMĐT and may not serve these at
  # all. A 200 here is a compliance failure, not a bug.
  check https://eno.vn/visa         404
  check https://eno.vn/itinerary    404
  check https://eno.forum/itinerary 200
  return $fail
}

# ⚠️ PIN FROM THE RUNNING CONTAINER, NOT FROM THE :local TAG. Tagging whatever :local
# currently points at looks equivalent and is not: if a previous run built a new image
# and then failed before serving it, :local is an image that has NEVER served, and
# pinning that as :prev destroys the last known-good rollback. The image the container
# is actually running is the only thing known to work.
pin_prev(){
  local c t id
  # ⛔ codex's catch: if the previous run swapped but failed before verifying, the RUNNING
  # containers are an unverified build. Pinning those as :prev destroys the last known-good
  # rollback and replaces it with something that never passed a probe.
  if [ -f /opt/eno/deploy-incomplete ]; then
    bad "the last deploy did not complete (see /opt/eno/deploy-incomplete)."
    bad "The running containers are UNVERIFIED, so pinning them as :prev would destroy the"
    bad "only good rollback. Resolve that deploy first, then remove the marker."
    exit 1
  fi
  for pair in eno-vn-app:eno-vn eno-forum-app:eno-forum; do
    c=${pair%%:*}; t=${pair##*:}
    id=$(docker inspect -f '{{.Image}}' "$c" 2>/dev/null)
    if [ -n "$id" ] && docker tag "$id" "$t:prev" 2>/dev/null; then
       ok "$t:prev = the image $c is serving"
    elif [ -n "$id" ]; then
      # ⛔ THE RUNNING IMAGE CAN BE GONE WHILE THE CONTAINER STILL RUNS, and it happened on
      # the very first real deploy (2026-08-22). Docker keeps a started container alive from
      # layers already unpacked, but once the image is untagged and garbage-collected the
      # content is gone: `docker tag` says "No such image" and even `docker commit` fails
      # with "content digest not found". The code serving production is then UNREPRODUCIBLE
      # — and, worse, if that container ever stops it cannot start again.
      # There is no local rollback to construct in that state, so do not pretend: say so,
      # and require the operator to name the fallback they are relying on instead.
      bad "$c is running an image that NO LONGER EXISTS ($(printf '%s' "$id" | cut -c8-19))."
      bad "It cannot be tagged or committed — the running code is unreproducible, and this"
      bad "container could not be restarted if it stopped. No local rollback is possible."
      # ⛔ THE CLOUD RUN ESCAPE HATCH IS GONE. This branch used to accept
      # ENO_ROLLBACK_IS_CLOUDRUN=1, on the grounds that a DNS flip to the Cloud Run
      # services was a real way back. The owner DELETED those services on 2026-08-23
      # (verified: `gcloud run services list` is empty; the load balancer forwarding
      # rules survive on 8.232.86.0 but now point at NO BACKEND, so flipping DNS back
      # would serve errors, not the old app). Leaving the flag would be worse than not
      # having one: it names a recovery route that no longer exists, and the person
      # reading it is by definition already in trouble.
      #
      # There is no automatic way through this state any more. Build a rollback first:
      #   git -C /opt/eno/app worktree add /tmp/rb <last-good-sha>
      #   … build that tree and tag it $t:prev …
      # or accept the risk deliberately and consciously with ENO_NO_ROLLBACK=1.
      if [ "${ENO_NO_ROLLBACK:-}" = "1" ]; then
        bad "ENO_NO_ROLLBACK=1 — proceeding with NO WAY BACK. If this deploy is bad, the"
        bad "only recovery is building a previous commit from source, which takes ~20min"
        bad "per edition while the site stays broken."
        docker tag "$t:local" "$t:prev" 2>/dev/null || true
      else
        bad "Cloud Run was deleted 2026-08-23, so there is no DNS-flip fallback either."
        bad "Build a rollback image from the last good commit, or set ENO_NO_ROLLBACK=1"
        bad "to proceed knowing a bad deploy cannot be undone quickly."
        exit 1
      fi
    else bad "$c is not running — no rollback pinned for $t"; exit 1; fi
  done
  # The schema gate's base commit has to roll back with the images, or it describes a
  # build that is no longer running.
  cp -f /opt/eno/last-deployed-sha /opt/eno/last-deployed-sha.prev 2>/dev/null || true
}

# Put :local back to the last known-good so that a reboot, or compose's
# restart:unless-stopped, cannot bring up an image we just refused.
untag_bad(){
  local t
  for t in eno-vn eno-forum; do
    docker image inspect "$t:prev" >/dev/null 2>&1 && docker tag "$t:prev" "$t:local"
  done
  bad ":local restored to :prev so nothing can start the rejected image"
}

# ⛔ THE BOX PURGES ITSELF NOW. Until 2026-08-23 every deploy ran --skip-purge because the
# token lived only on a laptop, so the cache was emptied by hand afterwards. That worked
# only while one person was driving: the script's warning is a line of red text in a long
# log, and the failure it describes — visitors served the pre-deploy page for six hours —
# looks exactly like a deploy that did not happen. Automating it removes the step that was
# most likely to be skipped by whoever deploys next.
#
# ⚠️ FILE, NOT ENVIRONMENT, BY DEFAULT. An exported CF_TOKEN still wins so a one-off deploy
# can override it, but the normal path reads a root-owned 0600 file the app containers
# never see. Install it with infra/vn-node/install-cf-token.sh, which takes the token on
# stdin and refuses to store one that cannot actually purge both zones.
CF_TOKEN_FILE=/opt/eno/secrets/cf-token
if [ -z "${CF_TOKEN:-}" ] && [ -r "$CF_TOKEN_FILE" ]; then
  CF_TOKEN=$(tr -d '\r\n' < "$CF_TOKEN_FILE")
  export CF_TOKEN
fi

purge_edge(){
  local z out fail=0
  [ -n "${CF_TOKEN:-}" ] || { bad "CF_TOKEN unset"; return 1; }
  for z in 55e558b62f68a44f8177d7d98cb5369e cc81e3ff1d792c0aa5384e8feab21efa; do
    out=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$z/purge_cache" \
      -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
      --data '{"purge_everything":true}' 2>&1)
    if printf '%s' "$out" | grep -q '"success":[[:space:]]*true'; then ok "purged $z"
    else bad "purge rejected for $z: $(printf '%s' "$out" | head -c 200)"; fail=1; fi
  done
  return $fail
}

restore(){
  bad "rolling back to the previously-serving images"
  # ⛔ BOTH OR NEITHER. Rolling back only one edition leaves the marketplace and the
  # services build on DIFFERENT commits — and the boundary between them is exactly what
  # differs between commits. A half rollback that reports success is worse than none.
  local t
  for t in eno-vn eno-forum; do
    docker image inspect "$t:prev" >/dev/null 2>&1 || { bad "$t:prev MISSING — refusing a partial rollback"; return 1; }
  done
  for t in eno-vn eno-forum; do docker tag "$t:prev" "$t:local"; done
  for svc in eno-vn eno-forum; do
    docker compose -f "$COMPOSE" up -d --force-recreate "$svc" || { bad "compose failed during rollback"; return 1; }
  done
  sleep 10
  # ⚠️ RETURN THE PROBE'S STATUS. This used to end `probe && ok … || bad …`, and the
  # `bad` branch is a printf, which succeeds — so `--rollback` exited 0 while the site
  # was down, and anything scripting it saw success.
  # ⛔ PURGE ON ROLLBACK, OR THE ROLLBACK IS COSMETIC. The bad build served the edge for
  # the swap + 12s sleep + probe, so `/` is now cached from it for up to six hours. Putting
  # the old containers back does nothing about that, and probe() structurally cannot see it
  # — every check appends ?d=$RANDOM, which bypasses the cache rule by design. Without this
  # the script prints "rolled back and serving" while visitors keep the broken page.
  local purged=1
  if [ "$SKIP_PURGE" = 1 ]; then bad "--skip-purge: the rejected build may stay CACHED for 6h"; purged=0
  elif ! purge_edge; then bad "ROLLBACK PURGE FAILED — visitors may still see the bad build"; purged=0; fi
  if probe; then
    # ⛔ CLEAR THE MARKER AND RESYNC THE SHA. Both were missing for one revision and both
    # deadlock the next run: pin_prev refuses while deploy-incomplete exists, and the
    # schema gate would diff against the commit we just rolled BACK from, so a real
    # migration reads as already-applied. A rollback that blocks all future deploys is
    # not a recovery path.
    [ -f /opt/eno/last-deployed-sha.prev ] && mv -f /opt/eno/last-deployed-sha.prev /opt/eno/last-deployed-sha
    # ⛔ ONLY A PURGED ROLLBACK IS A FINISHED ROLLBACK. probe() cannot see this: every check
    # appends ?d=$RANDOM and bypasses the cache rule by design, so it passes on the restored
    # origin while visitors keep the rejected build. Returning 0 here told automation the
    # site was fine when it was not.
    if [ "$purged" = 1 ]; then rm -f /opt/eno/deploy-incomplete; ok "rolled back and serving"; return 0
    else bad "origin restored but the EDGE WAS NOT PURGED — purge by hand, then remove"
         bad "/opt/eno/deploy-incomplete once you have confirmed the site."; return 1; fi
  else bad "ROLLBACK DID NOT RESTORE SERVICE — look now"; return 1; fi
}

# ⛔ THE GATE COVERS ROLLBACK TOO. It used to sit BELOW the rollback branch, so
# `--rollback` from a laptop with no CF_TOKEN printed "rolled back and serving" and exited
# 0 while visitors kept the rejected build from the edge for six hours — the precise
# fail-open the deploy path had just been hardened against, left in the recovery path.
# ⛔ REFUSE AT THE START, NOT AFTER THE SWAP. The purge used to be best-effort at the end:
# no CF_TOKEN meant a printed warning and `exit 0` — a "successful" deploy that visitors
# could not see for six hours, which is the exact failure this file was written to prevent.
# Checking here means the deploy either can finish properly or does not begin.
if [ "$SKIP_PURGE" != 1 ] && [ -z "${CF_TOKEN:-}" ]; then
  bad "No CF_TOKEN in the environment and no readable $CF_TOKEN_FILE, so the cache could not be"
  bad "purged and the deploy would be invisible to visitors for up to six hours."
  bad "Install the token once and this never comes up again:"
  bad "  pbpaste | bash infra/vn-node/install-cf-token.sh"
  bad "It takes the token on STDIN — never in an ssh command string, where it would show in ps"
  bad "and land in root's history — and refuses to store one that cannot purge both zones."
  bad "Or accept the consequence deliberately with --skip-purge and purge by hand afterwards."
  exit 1
fi

if [ "$ROLLBACK" = 1 ]; then restore; exit $?; fi

say "1. source"
cd "$APP" || { bad "no $APP"; exit 1; }
if [ -n "$(git status --porcelain)" ]; then bad "checkout is DIRTY — refusing"; git status --short | head; exit 1; fi
if [ "$PULL" = 1 ]; then
  git fetch origin --quiet || { bad "fetch failed"; exit 1; }
  git merge --ff-only origin/main || { bad "not a fast-forward — resolve by hand"; exit 1; }
fi
# ⚠️ codex's catch: without this the box builds whatever origin/main happens to hold WHEN
# IT RUNS, which is not necessarily the commit that passed review minutes earlier.
if [ -n "$EXPECT" ] && [ "$(git rev-parse HEAD)" != "$(git rev-parse "$EXPECT" 2>/dev/null)" ]; then
  bad "HEAD is $(git rev-parse --short HEAD) but --expect=$EXPECT was requested — refusing."
  exit 1
fi
# ⚠️ THE SNAPSHOT IN /tmp WAS TAKEN BEFORE THE PULL. If this commit changes eno-deploy.sh,
# everything below is the OLD logic — so a fix to the deploy script would not take effect
# on the deploy that delivers it, which is the worst possible moment to be running stale
# code. Compare and hand over once.
if [ "${ENO_DEPLOY_RELOADED:-}" != "1" ] && \
   ! cmp -s "$ENO_DEPLOY_ORIGIN" "$ENO_DEPLOY_SELF"; then
  ok "eno-deploy.sh changed in this pull — re-running the new version"
  # ⛔ A NEW FILE, NOT AN OVERWRITE. Writing over $ENO_DEPLOY_SELF is writing over the file
  # THIS process is still reading by byte offset — the identical corruption the re-exec at
  # the top exists to prevent, reintroduced in the path that handles updates to this very
  # script. Fresh temp file, hand over, let the trap clean the old one up.
  NEXT=$(mktemp /tmp/eno-deploy.XXXXXX.sh) || exit 1
  cat "$ENO_DEPLOY_ORIGIN" > "$NEXT" && chmod +x "$NEXT" || exit 1
  export ENO_DEPLOY_RELOADED=1
  OLD=$ENO_DEPLOY_SELF; export ENO_DEPLOY_SELF="$NEXT"
  rm -f "$OLD"        # the EXIT trap will not run across exec, so clean up here
  exec "$NEXT" "$@"
fi
ok "at $(git log --oneline -1)"

say "2. schema"
# ⛔ CLAUDE.md: MIGRATE BEFORE DEPLOYING. Prisma selects every scalar column, so a commit
# that adds one makes every unscoped query throw 42703 against the old database — while
# `/` is prerendered and probes green, so the deploy reports success with the app broken
# for signed-in users. ⛔ NEVER "fix" that by running `prisma db push` or `npm run
# db:setup`: both DESTROY DATA on this project. Detect, report, and stop.
#
# ⚠️ THIS COMPARED `HEAD@{1}` FOR ONE REVISION AND ALL THREE REVIEWERS CAUGHT THE SAME
# DEADLOCK. The reflog does not move when you re-run after applying the migration — the
# merge is a no-op — so `HEAD@{1}` still names the pre-pull commit, prisma/ still reads as
# changed, and the script refuses FOREVER. Any schema-touching commit became undeployable.
# The honest question is "has prisma/ changed since the commit that is actually DEPLOYED",
# which needs state that survives a re-run, not a reflog window.
STATE=/opt/eno/last-deployed-sha
LAST=$(cat "$STATE" 2>/dev/null || echo "")
if [ -z "$LAST" ]; then
  bad "no $STATE — cannot tell whether prisma/ changed since the running build."
  bad "Record the commit the RUNNING CONTAINERS were built from — NOT HEAD, which you have"
  bad "just pulled. Naming HEAD here makes a real pending migration compare clean and skips"
  bad "the gate entirely on the one run where it mattered:"
  bad "  git rev-parse <the-deployed-commit> > $STATE"
  exit 1
fi
if git diff --quiet "$LAST" HEAD -- prisma/ 2>/dev/null; then
  ok "no schema change since the deployed commit ($(git rev-parse --short "$LAST"))"
elif [ "${SCHEMA_OK:-}" = "$(git rev-parse HEAD)" ]; then
  # ⚠️ SCOPED TO THIS COMMIT, not a bare "1". An exported SCHEMA_OK=1 lingering in a shell
  # would wave through every future schema change without anyone confirming a migration —
  # a bypass that silently outlives the one deploy it was meant for.
  ok "prisma/ changed since $(git rev-parse --short "$LAST") — SCHEMA_OK matches HEAD, proceeding"
else
  bad "prisma/ CHANGED since the deployed commit — apply the migration FIRST, then re-run"
  bad "with SCHEMA_OK=$(git rev-parse HEAD) to confirm you have applied it for THIS commit."
  bad "⛔ do NOT run 'prisma db push' or 'npm run db:setup' — they destroy data here."
  git diff --stat "$LAST" HEAD -- prisma/ 2>/dev/null | sed 's/^/      /'
  exit 1
fi

say "3. pin the rollback"
pin_prev
# ⛔ opus's catch: pin_prev only LOGGED when a container was missing. The script then
# built, swapped, and — if the probe failed — hit "NO :prev IMAGES EXIST" with the site
# already down. Refuse to start a deploy that has no way back.
for t in eno-vn eno-forum; do
  docker image inspect "$t:prev" >/dev/null 2>&1 || {
    bad "no $t:prev — this deploy would have NO ROLLBACK. Start the container first,"
    bad "or tag a known-good image as $t:prev deliberately."; exit 1; }
done

say "4. install the build helper FROM THE REPO"
# ⛔ ALL THREE REVIEWERS CAUGHT THIS. eno-build.sh was committed to the repo in the
# same change — and the deploy still executed /opt/eno/bin/eno-build.sh, which nothing
# updated. A committed file that nothing reads is WORSE than an uncommitted one: it
# looks managed, so nobody checks the copy that actually runs. Sync it, every deploy.
if ! install -m 755 "$APP/infra/vn-node/eno-build.sh" /opt/eno/bin/eno-build.sh; then
  bad "could not install eno-build.sh from the repo — refusing to build with an unknown helper"; exit 1
fi
ok "eno-build.sh synced from $(git log --oneline -1 -- infra/vn-node/eno-build.sh | cut -c1-40)"

say "5. build (sequential — 4 cores shared with the containers still serving)"
# ⚠️ The install scripts pull ~85MB from GitHub (libvips + a 78MB ffmpeg binary) and
# that download has failed transiently twice in one evening. eno-build.sh now fails
# loudly and asserts the image ID changed, so a failure here is real — but retry once
# before investigating.
for ed in marketplace services; do
  if ! /opt/eno/bin/eno-build.sh "$ed"; then
    bad "$ed build FAILED — nothing swapped, users unaffected"; untag_bad; exit 1
  fi
done
ok "both images built"

say "6. edition boundary, read from the ARTIFACT"
# ⛔ SOURCE LINTS DO NOT PROVE THIS. `npm run lint` runs edition-lint.mjs over the
# SOURCE, and an edition leak has passed tsc, lint and 1800 tests here before. The
# route manifest inside the built image is the only thing that says what the
# marketplace bundle can actually serve.
# ⛔ AND IT MUST FAIL CLOSED. The first version piped the manifest straight into grep:
# if docker failed, the path moved, or the file was absent, the grep found nothing,
# the script printed "no visa/itinerary routes" and DEPLOYED. The one check whose
# failure is a legal problem could not tell "clean" from "did not run". So read the
# manifest first, prove it is non-empty and really is the manifest, and only then judge.
MANIFEST=$(docker run --rm --entrypoint sh eno-vn:local -c \
  'cat .next/server/app-paths-manifest.json 2>/dev/null' 2>/dev/null)
if [ -z "$MANIFEST" ] || ! printf '%s' "$MANIFEST" | grep -q '"/'; then
  bad "COULD NOT READ the route manifest from eno-vn:local — refusing to deploy unverified."
  bad "(empty or unrecognisable output; this is NOT evidence of a clean bundle)"
  untag_bad; exit 1
fi
ROUTES=$(printf '%s' "$MANIFEST" | grep -oE '"/[^"]*"' | sort -u)
ok "manifest read: $(printf '%s\n' "$ROUTES" | wc -l | tr -d ' ') routes"
# ⚠️ WHAT IS AND IS NOT A LEAK HERE — measured 2026-08-22, because the naive reading is
# wrong. The marketplace bundle LEGITIMATELY contains ~45 visa/trip entries
# (/api/visa/applications/*, /dashboard/visa, /admin/visas): MARKETPLACE_HOSTS_SERVICES
# compiles the `.svc.` tier in so eno.vn can host the PARTNER's visa chat. Banning
# "anything matching visa" would fail every clean build.
# The actual boundary is the `.forum.svc.` tier: eno's OWN e-visa storefront, the
# top-level marketing pages, and anything touching PayPal. Those must never compile in.
# ⚠️ `(/|")` NOT `/page"`. A narrower version of this line shipped for one revision and
# agy caught it: `"/(visa|itinerary)/page"` matches /visa/page and MISSES /visa/apply/page
# and /itinerary/[id]/page. Anchoring on the FIRST path segment catches every top-level
# services page while still permitting /api/visa/*, /dashboard/visa and /admin/visas,
# which the marketplace legitimately compiles. Verified against real manifest entries.
LEAK=$(printf '%s\n' "$ROUTES" | grep -Ei '"/(visa|itinerary)(/|")|paypal')
if [ -n "$LEAK" ]; then
  bad "MARKETPLACE IMAGE CONTAINS FORBIDDEN SURFACES — refusing to deploy:"
  printf '%s\n' "$LEAK" | sed 's/^/      /'
  untag_bad; exit 1
fi
ok "marketplace: no top-level /visa or /itinerary page, no PayPal surface"

# ⛔ opus's catch: the swap starts BOTH containers and only one image was ever inspected.
# A services build that picked up the wrong env file ships a marketplace bundle onto
# eno.forum — caught only later by the /itinerary probe, after it is serving. Assert the
# forum image POSITIVELY carries what only it may carry.
FMAN=$(docker run --rm --entrypoint sh eno-forum:local -c \
  'cat .next/server/app-paths-manifest.json 2>/dev/null' 2>/dev/null)
if ! printf '%s' "$FMAN" | grep -q '"/itinerary/page"'; then
  bad "eno-forum:local does NOT contain /itinerary/page — it is not the services edition."
  bad "(built with the wrong env file, or the manifest could not be read)"
  untag_bad; exit 1
fi
ok "forum: services edition confirmed (/itinerary/page present)"

say "7. swap"
# ⛔ ONE EDITION AT A TIME. `up -d --force-recreate` on both recreates eno-vn and
# eno-forum simultaneously, so every deploy took BOTH domains down together for the
# restart plus the settle wait — worse than the Cloud Run revision switch this replaces,
# and worse again on rollback. Staggering keeps one edition serving throughout.
# ⛔ MARK BEFORE TOUCHING ANYTHING. codex's catch: this marker used to be written after
# both containers were swapped. An ssh drop or a kill mid-swap left new, unverified images
# running with NO marker — and the next run's pin_prev would then tag those as :prev,
# overwriting the only good rollback. Written first, removed only on success.
touch /opt/eno/deploy-incomplete
for svc in eno-vn eno-forum; do
  # ⛔ ADOPTING A HAND-CREATED CONTAINER IS A ONE-WAY DOOR, SO IT IS EXPLICIT.
  # Both app containers were started by hand with `docker run --name …` and carry no
  # com.docker.compose.project label. Compose will not adopt a container it did not
  # create: it tries to CREATE one with the same name and fails with a name conflict —
  # which is exactly how the first real deploy stopped (2026-08-22), harmlessly, having
  # changed nothing. The only way forward is to remove the old container first.
  # ⚠️ Irreversible WHEN THE OLD IMAGE IS ALSO GONE, which is the same state pin_prev
  # reports: once removed, that container cannot be recreated from anything on this box.
  # The replacement is the freshly built and boundary-checked image, and the fallback is
  # the DNS flip to Cloud Run — but there is no undo in between, so it is opt-in.
  cname=$(docker inspect -f '{{.Name}}' "${svc}-app" 2>/dev/null | sed 's|^/||')
  if [ -n "$cname" ] && [ -z "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$cname" 2>/dev/null)" ]; then
    if [ "${ENO_ADOPT:-}" = "1" ]; then
      bad "$cname was created by hand, not by compose — removing it so compose can own it."
      bad "⛔ ONE-WAY: its image is gone, so this container cannot be recreated. Fallback is DNS→Cloud Run."
      docker rm -f "$cname" >/dev/null || { bad "could not remove $cname"; exit 1; }
    else
      bad "$cname is not compose-managed, so compose cannot replace it (name conflict)."
      bad "Re-run with ENO_ADOPT=1 to remove and re-create it under compose. Read the note above first."
      exit 1
    fi
  fi
  docker compose -f "$COMPOSE" up -d --force-recreate "$svc" || { restore; exit 1; }
  # ⚠️ Next standalone needs a moment before it answers. Probing too early reports a
  # failure that would have passed, and the reflex then is to roll back a good deploy.
  # ⛔ ASSERT, DO NOT FALL THROUGH. Without the `ready` flag this loop simply ENDED after
  # 30 failures and printed "$svc up" — then the script purged the edge cache while the
  # origin was dead, which converts a contained bad deploy into every visitor hitting a
  # 502 with no cached page left to serve them.
  ready=0
  for _ in $(seq 1 30); do
    if docker compose -f "$COMPOSE" exec -T "$svc" node -e \
      'require("net").connect(8080,"127.0.0.1").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))' \
      >/dev/null 2>&1; then ready=1; break; fi
    sleep 2
  done
  if [ "$ready" != 1 ]; then
    bad "$svc never started listening after 60s — rolling back before touching the cache"
    docker compose -f "$COMPOSE" logs --tail=30 "$svc" 2>&1 | sed 's/^/      /'
    restore; exit 1
  fi
  ok "$svc up"
done

say "8. purge Cloudflare — BEFORE verifying, not after"
# ⛔ ORDER MATTERS AND IT WAS WRONG. All three reviewers caught it: this ran AFTER the
# health probe, so the probe could be answered from cache by the PRE-DEPLOY build and
# pass — including the licensing 404s, which are just as cacheable as anything else.
# Purge first, then verify, so what the probe sees is what visitors get.
# ⛔ A DEPLOY IS NOT LIVE UNTIL THIS RUNS. `/` carries a Cache Rule at s-maxage=21600,
# so without a purge real visitors keep the pre-deploy HTML for up to SIX HOURS — and
# your own curl reads that same stale page, which is how a good deploy gets diagnosed
# as broken. purge_everything only: purge-by-file returns success:true and silently
# does nothing to cached HTML, because the vary:normalize key includes the encoding.
if [ "$SKIP_PURGE" = 1 ]; then
  bad "--skip-purge: CACHE NOT PURGED. Visitors may see the old page for up to 6 hours."
  bad "Purge by hand now, from the machine that holds the token."
elif ! purge_edge; then
  # ⛔ FATAL, NOT ADVISORY. This was `curl … && ok || bad`, which prints and continues —
  # so a revoked or rate-limited token produced a deploy that exited 0 while every visitor
  # kept the old page. And `curl --fail` is not enough on its own: Cloudflare answers
  # HTTP 200 with {"success": false} for a rejected purge, so the status line alone says
  # nothing. Read the field Cloudflare actually sets.
  bad "PURGE FAILED — the new code is running but visitors are still being served the old"
  bad "page from the edge. Fix the token and purge before calling this deployed."
  bad "/opt/eno/deploy-incomplete left in place so the next run cannot pin these unverified"
  bad "images as the rollback. Remove it once you have purged and checked the site."
  exit 1
fi

say "9. verify through the edge"
if ! probe; then restore; exit 1; fi
ok "serving $(git log --oneline -1)"

# ⛔ THE MARKER COMES OFF LAST, AFTER THE PROBE PASSED. It used to be cleared right after
# the purge — so a probe failure, or an ssh drop in between, left unverified containers
# running with no marker, and the NEXT deploy would pin those as :prev and destroy the only
# good rollback. Nothing here runs unless step 9 actually succeeded.
# The schema gate is only as good as this line: it is what "the deployed commit" means on
# the next run.
git rev-parse HEAD > /opt/eno/last-deployed-sha && ok "recorded deployed sha"
rm -f /opt/eno/deploy-incomplete

say "10. state"
docker ps --format '  {{.Names}}\t{{.Image}}\t{{.Status}}' | grep -E 'eno-(vn|forum)-app'
