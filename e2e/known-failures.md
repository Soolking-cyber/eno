# The 48 guest-suite failures are expected on eno.vn — here is how to check that cheaply

`npm run e2e:guest` against the **marketplace** edition finishes red and always has:

```
48 failed · 1 skipped · ~80 passed
```

That is not a broken suite and it is not something to fix by editing assertions. But a
permanent 48-failure baseline is dangerous in a specific way: it only takes ONE real
regression hiding inside that set for the whole signal to be worth nothing, and the usual
way people check ("48 again, same as last time") cannot tell 48-old from 47-old-plus-1-new.

So do not count them. Check the SHAPE.

## The invariant

**Every one of the 48 lives in exactly two spec files, split evenly across the two projects.**

| spec file | failures |
|---|---|
| `e2e/guest/trip-assistance.spec.ts` | 38 |
| `e2e/guest/visa.spec.ts` | 10 |
| — `[guest-desktop]` | 24 |
| — `[guest-mobile]` | 24 |

A failure in **any other spec file is a real regression**, whatever the total says.

## Check it in one command

```bash
E2E_BASE=https://eno.vn npm run e2e:guest > /tmp/e2e.log 2>&1
awk '/^  [0-9]+ failed/,/^  [0-9]+ (flaky|skipped|passed)/' /tmp/e2e.log \
  | grep -E "^\s+\[" | sed 's/.*› \(e2e\/[^:]*\):.*/\1/' | sort | uniq -c
```

Expected output — and nothing else:

```
  10 e2e/guest/visa.spec.ts
  38 e2e/guest/trip-assistance.spec.ts
```

⚠️ Compare the FILE LIST, not the number. If a trip-assistance test starts passing while a
listing test starts failing, the total stays 48 and the deploy looks clean.

## Why they fail, and why the fix is not to "fix" them

These specs assert that the visa and trip endpoints are **closed to guests** — that an
unauthenticated request gets `401` or `403`:

```
Expected value: 404
Received array: [401, 403]
```

On eno.vn those routes do not exist at all, so the server answers `404`. The suite is
written for the **services** edition, where the routes are present and gated; on the
marketplace edition they were removed by the edition split.

**A 404 is at least as closed as a 403** — the guest is refused either way, and 404 leaks
strictly less (it does not confirm the endpoint exists). So the security property the specs
were written to protect is intact on eno.vn; only the mechanism differs.

Two ways to actually resolve this, neither urgent:

1. Teach the specs the edition — assert `[401, 403, 404]`, or skip the file when
   `NEXT_PUBLIC_ENO_EDITION=marketplace`. Cheapest, and makes the suite green so a real
   failure is visible without this document.
2. Run these two files only against the services edition.

Until one of those happens, this file is the baseline. **If you change what is expected here,
change this file in the same commit** — a stale baseline is worse than no baseline, because
it is trusted.

⚠️ Also note `E2E_BASE` is not optional: `playwright.config.ts` defaults `GUEST_BASE` to
`https://eno.vn`, so a bare `npx playwright test` silently tests PRODUCTION and passes
while never loading the build you are about to ship.

_Baseline captured against `origin/main` = `92bca678`, marketplace edition._

## Why there is no marketplace browser gate on merge, and what one would take (review Q01, 2026-09-05)

The guest suite reads LIVE listing data, and on eno.vn the hide-list keeps the marketplace
empty, so the same run is red on the licensed edition and green on eno.forum. That is why
`ci.yml` deliberately runs only the dormant forum tree's e2e on merge and leaves the root suite
to the post-deploy pass. The consequence is that a marketplace regression reaches production
before any browser sees it.

A fixture-backed gate closes that without touching production data:

1. **Fixtures, not live rows.** `scripts/e2e-seed.mjs` already seeds a namespaced seller and one
   `verified=false` listing over `DIRECT_URL`. A marketplace gate needs ~6 `verified=true`
   listings across three categories with the three images in `e2e/fixtures/` — and they must
   NEVER land in the production database, because verified rows are public.
2. **Therefore a throwaway database.** The gate runs against a preview on `:3100` pointed at a
   Supabase branch (`supabase branches create`, seeded by the same script) or a Postgres service
   container with the schema applied by `scripts/*-table.mjs` + `prisma migrate diff`. The
   preview builds the MARKETPLACE edition with an empty hide-list, so the listings show.
3. **The specs are the existing guest ones** (`e2e/guest/home|category|listing|search.spec.ts`),
   with their "expects at least N cards" assertions reading the fixture count rather than a live
   minimum. `known-failures.md` above then describes a suite that no longer has a baseline.
4. **On merge, not on a schedule** — the point is to stop a regression before the deploy script
   runs, so the job goes beside `check` in `ci.yml`, `--fail-on-flaky-tests`, 12-minute budget.

**BUILT 2026-09-06 — and it needed neither.** The branch database was the wrong shape for the
problem: a CI job can create its own Postgres in five seconds. `.github/workflows/ci.yml` job
`marketplace-e2e` now runs on every push and PR:

1. `postgres:17-alpine` as a service container.
2. `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` → `psql`. ⛔ NOT
   `prisma db push`, which reconciles a database TO the schema and emits 18 `DROP TABLE`s against
   ours; the job greps the generated SQL for `DROP`/`TRUNCATE` and refuses to apply it if one
   ever appears.
3. `scripts/ci-fixtures.ts` — 15 categories, two sellers, six verified listings across three
   categories, plus the visa/trip DESK account. The desk exists because the marketplace edition
   fails closed when it cannot resolve the desk it must exclude (`DeskResolutionError`), so an
   empty database cannot render `/` at all. ⛔ The script refuses any non-loopback host: it writes
   PUBLIC rows, and a verified listing on production is visible to every visitor.
4. `npm run build` as the marketplace edition, served from `.next/standalone` on :3100.
5. `npx playwright test --project=ci-fixtures` (`e2e/ci/**`, `E2E_CI_BASE` — its own variable, so
   the gate cannot be aimed at a real deployment by setting the one everything else uses).

Five assertions, all against rows the job just created: every fixture is in the feed; the desk
listing reaches neither the feed nor `?q=visa` (the licensing control, in a browser, which is the
path that leaked on 2026-09-01); a category page shows its own and no others; search finds one by
title; and no price run spills outside its card at 390px — the overlap the owner reported twice.

No production secret, no Supabase project, no billing decision. Reproducible on a laptop with the
same commands; measured locally end to end before it was committed (5 passed in 4.6s).

The paragraphs above still describe the LIVE-data guest suite, which stays out of the merge gate
for the reason given there.
