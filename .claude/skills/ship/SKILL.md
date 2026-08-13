---
name: ship
description: Ship the current work to production — typecheck, design-lint, build, local guest e2e, commit, push, wait for the deploys (Cloud Build→Cloud Run), then re-run the guest suite against prod. Aborts on the first failure.
disable-model-invocation: true
model: opus
effort: medium
---

# /ship — the eno.vn release ritual

Run these in order. **Stop at the first failure** and report it — never push through a red gate, and never "fix forward" twice in a row on prod (if a push breaks prod, revert to the last known-good commit and pause).

Work from `/Users/mk1e3/eno.vn`. Use absolute paths for anything that starts a server — another project's `next-server` has stolen port 3000 before, producing phantom 404s.

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
PORT=3100 npm start &             # :3000 is SQUATTED by another project's next-server
# wait for it to answer, then:
E2E_BASE=http://localhost:3100 npx playwright test --project=guest-desktop --project=guest-mobile
```

⚠️ **`E2E_BASE` is not optional, and forgetting it fails OPEN.** `playwright.config.ts:13` defaults
`GUEST_BASE` to **`https://eno.vn`** — so a bare `npx playwright test` runs the whole suite against
PRODUCTION and passes, while never once loading the build you are about to ship. It looks exactly
like a green local gate. (This bit me on 2026-07-14: a suite reported 44/44 "locally" against prod
while the local build sat untested.) Two ways to be sure you tested the right thing: the run must be
`E2E_BASE=http://localhost:3100`, and a brand-new test for the feature you just built must FAIL
against prod and PASS locally. If a new test passes against both, you are not testing what you think.

Port must be 3100, not 3000 — 3000 is occupied by an unrelated `next-server`, so a suite pointed
there tests a different application entirely.

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

**Primary (GCP):** the push fires ONE trigger — `eno-vn-deploy-asia`, **in `asia-southeast1`** —
which builds and auto-deploys the Cloud Run service. Watch:

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

Defaults to `https://eno.vn`. All 44 must pass. If one fails, re-run just that spec once — the ISR race is the usual culprit and it never fails twice in a row. A repeat failure is real: revert (`git revert`) and pause.

## 7. Report

Tell the user, in one short paragraph: what shipped, the commit SHA, the deploy status, and the prod suite result (`44/44`). Mention anything you skipped and why.
