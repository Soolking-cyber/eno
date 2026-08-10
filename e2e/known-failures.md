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
