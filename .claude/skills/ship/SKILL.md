---
name: ship
description: Ship the current work to production — typecheck, design-lint, build, local guest e2e, commit, push, wait for the Vercel deploy, then re-run the guest suite against prod. Aborts on the first failure.
disable-model-invocation: true
model: opus
effort: medium
---

# /ship — the eno.vn release ritual

Run these in order. **Stop at the first failure** and report it — never push through a red gate, and never "fix forward" twice in a row on prod (if a push breaks prod, revert to the last known-good commit and pause).

Work from `/Users/mk1e3/eno.vn`. Use absolute paths for anything that starts a server — another project's `next-server` has stolen port 3000 before, producing phantom 404s.

## 1. Gates (fast, local)

```bash
npx tsc --noEmit
node scripts/design-lint.mjs
```

`tsc` must be silent; design-lint must print `design-lint: clean`. If design-lint fails, fix the violation — do NOT add a `design-lint-allow` comment unless the line is genuinely third-party (a brand hex, a Leaflet CSS-in-JS color).

## 2. Build

```bash
npm run build
```

This re-runs design-lint, `prisma generate`, and `next build`. A build failure that mentions a missing table is almost never a code bug — check `DATABASE_URL` in the Vercel env (it has been clobbered by another project before; see `scripts/db-identity.mjs`).

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

Commit message: a plain sentence saying what changed and why, in the repo's existing voice. End with:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

Then `git push`. The user's standing instruction is to push without asking.

## 5. Wait for the deploy

```bash
npx vercel ls | head -8
```

Poll until the newest Production deployment shows `● Ready` (it takes ~1–2 min). `● Building` → keep waiting. `● Error` → read the build log (`npx vercel inspect --logs <url>`), fix, and start over at step 1.

Prefer a bounded poll loop (e.g. check every 20s, give up after ~5 min and report) over an open-ended `until` loop — one of those was left running for nearly 3 hours.

## 6. Prod smoke

```bash
npx playwright test --project=guest-desktop --project=guest-mobile
```

Defaults to `https://eno.vn`. All 44 must pass. If one fails, re-run just that spec once — the ISR race is the usual culprit and it never fails twice in a row. A repeat failure is real: revert (`git revert`) and pause.

## 7. Report

Tell the user, in one short paragraph: what shipped, the commit SHA, the deploy status, and the prod suite result (`44/44`). Mention anything you skipped and why.
