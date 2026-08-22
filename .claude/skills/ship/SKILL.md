---
name: ship
description: Ship the current work to production — typecheck, design-lint, edition-lint, build, preview, local guest e2e, commit, push, then DEPLOY ON THE BOX (Cloud Build was removed 2026-08-22), purge Cloudflare, and re-run the guest suite against both domains. Aborts on the first failure.
disable-model-invocation: true
model: opus
effort: medium
---

# /ship — the eno.vn release ritual

Run these in order. **Stop at the first failure** and report it — never push through a red gate, and never "fix forward" twice in a row on prod (if a deploy breaks prod, roll back to the last known-good image and pause).

Work from `/Users/mk1e3/eno.vn`. Use absolute paths for anything that starts a server — another project's `next-server` has stolen port 3000 before, producing phantom 404s.

## ⛔ A PUSH IS NOT A DEPLOY. READ THIS BEFORE ANYTHING ELSE.

Cloud Build was removed on **2026-08-22** (owner: *"remove cloud build entirely we preview locally and deploy on box from now on"*). Pushing to `main` now runs CI and **nothing else**. Code reaches users only when `eno-deploy.sh` runs on the box.

⚠️ **This is not a footnote, it is the failure this project already had.** When DNS moved to the box on 2026-08-21, Cloud Build kept building and deploying Cloud Run perfectly — to a service with no traffic. The box built from its own checkout, which nobody pulled. Production drifted **fourteen commits behind, including seven security fixes**, while CI and Cloud Build both reported green the entire time. A green pipeline was never evidence that users got the code, and now there is no pipeline to mistake for one.

So: **step 5 is mandatory.** A ship that stops after `git push` has shipped nothing.

## 0. Pick up the Codex handoff

Before running gates, and again immediately before staging, run:

```bash
git status --short -- apps/forum
git diff -- apps/forum
```

Any pending `apps/forum/**` files are a Codex handoff. Read the current conversation for the exact files and validation Codex reported. If those forum gates are green, include the handoff files in the commit. If readiness is unclear, rerun the relevant checks from `apps/forum` or stop and report the exact pending files. **Never push a commit while silently leaving validated Codex changes under `apps/forum/**` unstaged.**

## 1. Gates (fast, local)

```bash
npx tsc --noEmit
node scripts/design-lint.mjs
node scripts/edition-lint.mjs
```

`tsc` must be silent; design-lint must print `design-lint: clean`. If design-lint fails, fix the violation — do NOT add a `design-lint-allow` comment unless the line is genuinely third-party (a brand hex, a Leaflet CSS-in-JS color).

## 2. Build **and** preview — one command, not two

```bash
rm -f /tmp/preview-vn.log                      # ⛔ or the first grep matches the LAST run
node scripts/preview.mjs vn > /tmp/preview-vn.log 2>&1 &
PREV=$!
for i in $(seq 1 240); do
  grep -q '── serving' /tmp/preview-vn.log && break
  kill -0 $PREV 2>/dev/null || { echo "preview died:"; tail -20 /tmp/preview-vn.log; exit 1; }
  sleep 5
done
grep -q '── serving' /tmp/preview-vn.log || { echo "preview never became ready"; kill $PREV; exit 1; }
```

⛔ **BACKGROUND IT, WITH A BOUND — AND EVERY LINE ABOVE IS LOAD-BEARING.** `preview.mjs` builds
and then serves *without returning*; in the foreground, anyone following this file top to bottom
(or an agent running it in one shell) blocks here forever and never reaches the deploy. A shorter
version of this recipe shipped for one revision and failed open three ways at once:

* **`rm -f` first.** The redirection truncates the log in the *child*, after fork — so the first
  `grep` can match a **previous** run's `── serving` and race straight into the suite.
* **240 × 5s, not 240 × 1s.** A clean build here takes ~360s. A four-minute bound times out on a
  perfectly normal build.
* **The assertion after the loop.** Without it a timeout is *silent*: the loop just ends and
  execution falls into the e2e step, which then runs against a stale :3000 or nothing at all and
  reports green while the real preview binds mid-suite.

⛔ **WAIT FOR THE `── serving` LINE, NEVER FOR THE PORT TO ANSWER 200.** Polling the URL passes
the instant *any* server answers — including a leftover one on that port — so it fails open in
exactly the case worth guarding. `preview.mjs:12` documents the same rule from the other side.

`kill $PREV` when you are done; a forgotten preview holding :3000 is the next person's mystery.

⛔ **THIS IS ONE STEP BECAUSE IT IS ONE COMMAND.** `preview:vn` *is* `preview.mjs vn`, which
builds and then serves without returning. An earlier version of this file listed "run the
build" and "run the preview" as separate steps — following it literally blocks at the first
one forever, or, if you background it, builds the marketplace twice.

⛔ **A BARE `npm run build` COMPILES THE WRONG EDITION.** `src/lib/edition.ts:95` reads
`process.env.NEXT_PUBLIC_ENO_EDITION === 'marketplace' ? 'marketplace' : 'services'` — so with
no edition in the environment it silently builds **eno.forum's** bundle. Verifying the licensed
marketplace against the services build is exactly the wrong way round, and nothing in the
output says so.

It re-runs design-lint, edition-lint, `prisma generate` and `next build` on the way. A build
failure naming a missing table is almost never a code bug — check `DATABASE_URL`
(`scripts/db-identity.mjs`).

⚠️ **:3000 FOR THE MARKETPLACE, :3101 FOR THE FORUM** (`scripts/preview.mjs:51`). `CLAUDE.md`
records the owner on 2026-08-17: *"kill 3000 and 3100 use only 3000 from now on"*. This file
said `:3100` until 2026-08-22; following that points `E2E_BASE` at a dead port, which does not
fail loudly — it reads as a broken app.

Use `--serve` to skip the rebuild and serve what is already in `.next`. For the forum:
`node scripts/preview.mjs forum` (its own terminal — also foreground). Kill previews when
done; a forgotten one holding :3000 is the next person's mystery.

## 3. Local guest e2e against the preview you just started

⛔ **DO NOT START A SECOND SERVER.** `preview.mjs vn` from step 2 is already listening on 3000;
`PORT=3000 npm start` here collides with it. Worse than the `EADDRINUSE`: the second process dies,
Playwright happily tests the *first* one, and the run looks green either way — so you cannot tell
from the output which artifact you tested. Point the suite at the preview that is already up.

```bash
# preview.mjs vn from step 2 is serving :3000 — leave it running
E2E_BASE=http://localhost:3000 npx playwright test --project=guest-desktop --project=guest-mobile
```

⚠️ **AND THAT IS WHY STEP 2 IS A PREVIEW RATHER THAN `npm start`.** `src/lib/edition.ts:95` reads
`process.env.NEXT_PUBLIC_ENO_EDITION === 'marketplace' ? 'marketplace' : 'services'` — so a bare
`npm run build && npm start`, with no edition in the environment, builds and serves the **services**
edition. Running the marketplace guest suite against it tests eno.forum's bundle while believing it
is eno.vn's, and a marketplace licensing leak passes local verification untouched.

⚠️ **`E2E_BASE` is not optional, and forgetting it fails OPEN.** `playwright.config.ts:13` defaults `GUEST_BASE` to **`https://eno.vn`** — a bare `npx playwright test` runs the whole suite against PRODUCTION and passes while never loading your build. This bit us on 2026-07-14: 44/44 "locally" against prod, local build untested. Two ways to be sure: the run must say `E2E_BASE=http://localhost:3000`, and a brand-new test for the feature you just built must FAIL against prod and PASS locally. If a new test passes against both, you are not testing what you think.

For authed (seller/admin) flows use `/authed-e2e`.

## 4. Commit + push

Stage only what belongs to this change — never sweep in another agent's half-finished tree; that has broken `origin/main` before by shipping an import whose export was still uncommitted. Include any regenerated `src/generated/ui-strings.ts`. Repeat `git status --short -- apps/forum` before committing.

⛔ `git add -A` and `commit -a` are **banned**. Commit by literal pathspec and read `--stat` back. Put the check in the SAME shell call as the commit — a separate call has swept a peer's files in before.

Commit message: a plain sentence saying what changed and why, in the repo's voice, ending with:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Then `git push`. CI (`gh run list --limit 5`) must go green.

⚠️ **`gh run list --commit <sha>` is unreliable** — it returned no rows for a run that was live the whole time (2026-08-22). Use the unfiltered list and match the SHA yourself.

## 5. ⛔ DEPLOY — the step that actually ships

```bash
printf 'export CF_TOKEN=%q\nexec bash /opt/eno/app/infra/vn-node/eno-deploy.sh --expect=%s\n' \
  "$CF_TOKEN" "$(git rev-parse HEAD)" \
  | ssh -i "$ENO_SSH_KEY" -p 24700 root@162.4.176.208 'bash -s'
```

⛔ **THE TOKEN GOES OVER STDIN, NEVER IN THE SSH COMMAND STRING.** An ssh remote command is
argv on the box: it shows in `ps` to every local user and lands in root's shell history. This
project has already made that exact mistake once — `setup-offsite-backup.sh` shipped with the
Bizfly keys in argv, in a script whose own header warned against it. Only the commit SHA, which
is not a secret, travels as an argument.

⛔ **BOTH ARGUMENTS MATTER.** Without `CF_TOKEN` the script refuses to start rather than
finishing with an unpurged cache — a deploy nobody can see for six hours is the failure this
whole change exists to prevent, and it used to exit 0. Without `--expect` the box builds
whatever `origin/main` holds *at the moment it runs*, which is not necessarily the commit that
just passed review; if someone else pushed in between, you deploy their untested work under
your green CI.

The script pulls to `origin/main`, pins `:prev` images for rollback, builds both editions sequentially, **verifies the marketplace bundle contains no visa/itinerary routes by reading the route manifest inside the built image**, swaps via `apps.compose.yml`, and health-checks through Cloudflare. Any failure rolls back automatically.

⚠️ Builds are **network-heavy and occasionally fail transiently** — the install scripts pull ~85MB (libvips + a 78MB ffmpeg binary) from GitHub. Two consecutive failures on 2026-08-22 were transient; the third succeeded with nothing changed. Re-run before investigating, but read the error first: `eno-build.sh` now fails loudly and asserts the image ID changed, because it used to end in `|| true` and reported success while printing the size of the image it had not replaced.

Roll back at any time with `eno-deploy.sh --rollback` (instant, offline, uses the `:prev` tags).

## 6. Confirm the purge actually happened

`eno-deploy.sh` purges both zones itself and **exits non-zero if the purge fails**, so a green
deploy already implies a purged edge. Verify rather than repeat it — the check is cheap and the
failure it catches is invisible:

```bash
curl -s -D- -o /dev/null https://eno.vn/ | grep -iE 'cf-cache-status|^age'   # expect MISS, then age: 0
```

⛔ **`/` IS EDGE-CACHED FOR 6 HOURS, SO A NAIVE POST-DEPLOY CHECK READS THE OLD BUILD.** There is
a Cloudflare Cache Rule on the homepage (`s-maxage=21600`). On 2026-08-22 a freshly-deployed CSS
token looked MISSING from production because `curl https://eno.vn/` returned `cf-cache-status:
HIT` with `age: 20514` — a 5.7-hour-old page naming 5.7-hour-old content-hashed chunks. The
deploy was fine. Always read the header that tells you which you got.

⚠️ **`purge_everything` only.** Purge-by-file returns `success: true` and silently does nothing
to cached HTML, because the `vary: normalize` cache key includes the encoding variant. The
script also reads Cloudflare's `"success"` field rather than trusting HTTP 200 — a rejected
purge comes back 200 with `"success": false`.

## 7. Prod smoke — BOTH domains

⚠️ **Both editions deploy together, so smoke both.** Pointing only at `https://eno.vn` lets a forum
regression sail through.

```bash
E2E_BASE=https://eno.vn    npx playwright test --project=guest-desktop --project=guest-mobile
E2E_BASE=https://eno.forum npx playwright test --project=guest-desktop
```

⛔ And check the licensing boundary explicitly — it is the one failure that is a legal problem
rather than a bug:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://eno.vn/itinerary   # MUST be 404
curl -s -o /dev/null -w '%{http_code}\n' https://eno.vn/visa        # MUST be 404
```

All 44 must pass. A single failure — re-run that spec once; the ISR race never fails twice. A repeat failure is real: `eno-deploy.sh --rollback` and pause.

## 8. Report

One short paragraph: what shipped, the commit SHA, **that the box was deployed and the boundary check passed**, and the prod suite result. Mention anything skipped and why.
