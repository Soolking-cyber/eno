---
name: ship
description: Ship the current work to production — typecheck, design-lint, build, local guest e2e, commit, push, wait for the deploys (Cloud Build→Cloud Run), then re-run the guest suite against prod. Aborts on the first failure.
disable-model-invocation: true
model: opus
effort: medium
---

# /ship — the eno.vn release ritual

Run these in order. **Stop at the first failure** and report it — never push through a red gate, and never "fix forward" twice in a row on prod (if a push breaks prod, revert to the last known-good commit and pause).

Work from `/Users/mk1e3/eno.vn`. Use absolute paths for anything that starts a server.

## 0. Pick up the Codex handoff

Before running gates, and again immediately before staging, run:

```bash
git status --short -- apps/forum
git diff -- apps/forum
```

Any pending `apps/forum/**` files are a Codex handoff. Read the current conversation
for the exact files and validation Codex reported. If those forum gates are green,
include the handoff files in the commit. If readiness is unclear, rerun the relevant
checks from `apps/forum` or stop and report the exact pending files. **Never push a
commit while silently leaving validated Codex changes under `apps/forum/**` unstaged.**

## 1. Gates (fast, local)

```bash
npx tsc --noEmit
node scripts/design-lint.mjs
```

`tsc` must be silent; design-lint must print `design-lint: clean`. If design-lint fails, fix the violation — do NOT add a `design-lint-allow` comment unless the line is genuinely third-party (a brand hex, a Leaflet CSS-in-JS color).

## 2. Build

```bash
NEXT_PUBLIC_ENO_EDITION=marketplace NEXT_PUBLIC_APP_URL=https://eno.vn npm run build
```

⚠️ **A BARE `npm run build` BUILDS THE *SERVICES* EDITION, AND IT LOOKS FINE.** `src/lib/edition.ts`
reads `EDITION = process.env.NEXT_PUBLIC_ENO_EDITION === 'marketplace' ? 'marketplace' : 'services'`
— so with the variable unset it silently defaults to **services**, i.e. eno.forum. Cost on
2026-08-13: the artifact served locally had `/visa` and `/itinerary` live, the dashboard rail wore
eno.forum's "eno" wordmark instead of "eno.vn" (reported as a bug that did not exist), and the guest
suite's visa + trip specs passed for the wrong reason. Nothing errors; the edition is simply wrong.
`npm run preview:vn` sets both variables itself, which is why the difference is invisible until you
call `npm run build` directly — as this step used to.
⚠️ `NEXT_PUBLIC_APP_URL` must be the PRODUCTION url even locally: next.config.ts refuses to build a
marketplace edition pointed at localhost.

This re-runs design-lint, `prisma generate`, and `next build`. A build failure that mentions a missing table is almost never a code bug — check `DATABASE_URL` in the deployed env (it has been clobbered by another project before; see `scripts/db-identity.mjs`).

## 3. Local guest e2e against the built app

Start the standalone server and run the guest suite against it:

```bash
rm -f /tmp/preview.log
node scripts/preview.mjs vn > /tmp/preview.log 2>&1 &
PREV=$!
# ⛔ BOUNDED, AND IT WATCHES THE PROCESS — not just the log. A build failure, a red design-lint
# or free-port's own abort never write the marker, so `until grep …` alone spins forever and a
# RED gate goes silent. `rm -f` first: the redirection truncates in the child AFTER fork, so the
# first grep can otherwise match a PREVIOUS run's marker.
# ⚠️ KILL IT ON TIMEOUT. A cold build that merely runs long would otherwise leave the preview
# alive after the gate went red — and minutes later its second freePort takes :3000 from
# whatever you started meanwhile, unannounced. 240x5s = 20 min, generous for a clean build.
for i in $(seq 1 240); do
  grep -q '── serving' /tmp/preview.log && break
  kill -0 $PREV 2>/dev/null || { echo "preview exited before serving:"; tail -30 /tmp/preview.log; exit 1; }
  sleep 5
done
grep -q '── serving' /tmp/preview.log || { echo "preview timed out"; kill $PREV 2>/dev/null; tail -30 /tmp/preview.log; exit 1; }
```

```bash
E2E_BASE=http://localhost:3000 npx playwright test --project=guest-desktop --project=guest-mobile
```

⚠️ **`E2E_BASE` is not optional, and forgetting it fails OPEN.** `playwright.config.ts:13` defaults
`GUEST_BASE` to **`https://eno.vn`** — so a bare `npx playwright test` runs the whole suite against
PRODUCTION and passes, while never once loading the build you are about to ship. It looks exactly
like a green local gate. (This bit me on 2026-07-14: a suite reported 44/44 "locally" against prod
while the local build sat untested.) Two ways to be sure you tested the right thing: the run must be
`E2E_BASE=http://localhost:3000`, and a brand-new test for the feature you just built must FAIL
against prod and PASS locally. If a new test passes against both, you are not testing what you think.

⛔ **NEVER POLL FOR A 200 — THAT IS ITS OWN FAIL-OPEN, AND IT IS THE SUBTLER ONE.** A stale
server does not lose the race for :3000, it WINS it: Node prints EADDRINUSE and exits, the OLD
process keeps serving, and the URL keeps answering 200 with whatever code it was started with —
indistinguishable from "my change did nothing". On 2026-08-17 a three-day-old server cost real
time exactly that way. `preview.mjs` now kills the holder BEFORE it builds (and aborts if it
cannot), which closes that window — but it also means a 200 during the multi-minute build can
only be some OTHER server, so "wait until it answers" would latch onto precisely the wrong one
and then die mid-suite when the real server binds. **`── serving` is the only line that means
the port is yours.**

Kill the server when done. The suite is 48 tests (desktop + mobile). It's read-only — no auth, no
writes. `retries: 1` is configured because post-deploy ISR regeneration transiently trips the a11y
homepage spec; a failure that reproduces on the retry is real.

For authed (seller/admin) flows, use `/authed-e2e` instead — it needs a seeded preview deploy and never runs against prod.

## 4. Commit + push

Stage only what belongs to this change (`git add -p` mentally — don't sweep in another agent's half-finished tree; that has broken `origin/main` before by shipping an import whose export was still uncommitted). Include any regenerated `src/generated/ui-strings.ts`.

Repeat `git status --short -- apps/forum` before committing. Every validated Codex
handoff file must be staged; otherwise stop and explain why it is being deferred.

Commit message: a plain sentence saying what changed and why, in the repo's existing voice. End with:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

Then `git push`. The user's standing instruction is to push without asking.

## 5. Wait for the deploy

**Primary (GCP):** the push fires TWO triggers — `eno-vn-deploy-asia` and
`eno-forum-deploy-asia`, both **in `asia-southeast1`** — which build and auto-deploy the two Cloud
Run services. (This said ONE trigger until 2026-08-22; the forum one fires on a plain `src/**`
push too, so wait for BOTH rows before calling the deploy done.) Watch:

```bash
gcloud builds list --region=asia-southeast1 --limit=4 --project=speedy-victory-500106-h8 \
  --format="table(status,substitutions.SHORT_SHA,createTime.date('%H:%M'))"
```

⚠️ **THE REGION USED TO SAY `europe-west1` HERE AND THAT IS WRONG — IT REPORTS A DEPLOY THAT
NEVER HAPPENED.** `europe-west1` still returns rows, because it holds the build HISTORY of the
deleted `eno-vn-deploy` / `eno-forum-deploy` triggers. So the command appeared to work and simply
never showed the new commit. On 2026-08-13 that cost ~10 minutes of polling a region with no
trigger in it while the real build had already gone green in asia-southeast1. Match on
`substitutions.SHORT_SHA`, not on `_TAG` (the old triggers' field), and confirm the SHA is YOURS.

Poll until the row for your commit shows `SUCCESS` (~6–12 min).
`FAILURE` → `gcloud builds log <id> --region=asia-southeast1`, fix, restart at step 1. Then confirm
the new revision serves **via the domain** (ingress is locked — direct run.app URLs 404):
`curl -s -o /dev/null -w '%{http_code}' https://eno.vn`.

GCP is the ONLY deploy path — the Vercel projects were deleted 2026-07-19.

Prefer a bounded poll loop (e.g. check every 20s, give up after ~15 min and report) over an
open-ended `until` loop — one of those was left running for nearly 3 hours.

## 6. Prod smoke

```bash
E2E_BASE=https://eno.vn npx playwright test --project=guest-desktop --project=guest-mobile
```

⛔ **PURGE CLOUDFLARE FIRST — THIS STEP WAS MISSING FROM THIS SKILL AND THE DEPLOY IS NOT DONE
WITHOUT IT.** `CLAUDE.md` mandates it; this file did not, and on 2026-08-22 that gap shipped a
green build that real visitors could not see for hours. Use `purge_everything`, never purge-by-URL
(purge-by-file returns `success: true` and silently does nothing on cached HTML, because the
`vary: normalize` cache key includes the encoding variant):

```bash
for Z in 55e558b62f68a44f8177d7d98cb5369e cc81e3ff1d792c0aa5384e8feab21efa; do   # eno.vn, eno.forum
  curl -sS --fail -X POST "https://api.cloudflare.com/client/v4/zones/$Z/purge_cache" \
    -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
    --data '{"purge_everything":true}' | jq '.success'
done
curl -s -D- -o /dev/null https://eno.vn/ | grep -iE 'cf-cache-status|^age'   # expect MISS, then age: 0
```

⚠️ **BOTH domains deploy, so smoke BOTH.** Step 6 above only points at `https://eno.vn`; a forum
regression sails through. Add `E2E_BASE=https://eno.forum npx playwright test --project=guest-desktop`,
and check the licensing boundary explicitly — it is the one failure that is a legal problem, not a
bug: `curl -s -o /dev/null -w '%{http_code}' https://eno.vn/itinerary` **must be 404**.

⛔ **`/` IS EDGE-CACHED FOR 6 HOURS — A NAIVE POST-DEPLOY CHECK READS THE OLD BUILD.** There is a
Cloudflare Cache Rule on the homepage (`s-maxage=21600`). On 2026-08-22 a freshly-deployed CSS token
looked MISSING from production because `curl https://eno.vn/` returned `cf-cache-status: HIT` with
`age: 20514` — a 5.7-hour-old page, naming 5.7-hour-old content-hashed chunk filenames. The deploy
was fine. Always bust the cache when verifying a deploy, and check the header that tells you:

```bash
curl -s -D- -o /dev/null https://eno.vn/ | grep -iE 'cf-cache-status|^age'   # HIT + age = stale
H=$(curl -s "https://eno.vn/?cb=$RANDOM$RANDOM")                            # bypasses the rule
C=$(printf '%s' "$H" | grep -oE '/_next/static/chunks/[a-zA-Z0-9_-]+\.css' | tail -1)
B=$(curl -s "https://eno.vn$C")
printf '%s' "$B" | grep -o 'the-token-you-changed' | wc -l    # >0 = your change is live
printf '%s' "$B" | grep -o 'a-token-that-cannot-exist' | wc -l # 0 = the grep discriminates
```

⚠️ Two things this recipe learned the hard way. The path is `/_next/static/chunks/*.css` on this
build, **not** Next's documented `/_next/static/css/` — grep for the wrong one and you get a
confident, wrong "missing". And the `?cb=` bypass is only trustworthy because it was checked: the
busted request returned a *different, larger* chunk than the cached one. If a future cache rule
ignores query strings this stops working silently, so compare the two filenames, do not assume.

⚠️ And grep the CHUNK, not the HTML, for CSS changes — and with `grep -o | wc -l`, never `grep -c`:
minified CSS is one line, so `grep -c` reports 1 no matter how many times a token occurs.

Defaults to `https://eno.vn`. All 44 must pass. If one fails, re-run just that spec once — the ISR race is the usual culprit and it never fails twice in a row. A repeat failure is real: revert (`git revert`) and pause.

## 7. Report

Tell the user, in one short paragraph: what shipped, the commit SHA, the deploy status, and the prod suite result (`44/44`). Mention anything you skipped and why.
