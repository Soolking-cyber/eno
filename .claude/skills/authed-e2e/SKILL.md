---
name: authed-e2e
description: Run the authed (seller + admin) Playwright suite against a local build — seeds ephemeral Supabase users, signs them in via admin magic-link, runs the seller/admin projects, then cleans the users up.
disable-model-invocation: true
model: opus
effort: low
---

# /authed-e2e — the seller + admin suite

The guest suite (`/ship`) is read-only and runs against prod. The authed suite **writes** — it creates listings, moderates, edits a storefront — so it never points at prod. Run it against a local build (or a preview deploy backed by a seeded branch).

Everything below runs from `/Users/mk1e3/eno.vn`.

## 1. Seed users AND fixtures

```bash
set -a; . ./.env; set +a
node scripts/e2e-seed.mjs
```

⚠️ Use `scripts/e2e-seed.mjs`, NOT the older `seed-users.ts` here: several specs
(listing-lifecycle's "E2E Test Item", offer-counter's `e2e-conv-1` pending-offer
conversation) need the FULL fixture set — seller + admin + buyer users PLUS the
owner-only listing and the seeded conversation/offer. `seed-users.ts` creates only
the users; a suite run without the fixtures fails 3 specs with "element not found"
that look exactly like app regressions (cost a debugging detour on 2026-07-18).
⚠️ `seed-users.ts --cleanup` cascades away the fixture listing/conversation too —
after any cleanup, re-run `scripts/e2e-seed.mjs`, and `rm -rf e2e/.auth` so the
setup project mints sessions for the recreated user ids.
Note (Node 25): `npx tsx` chokes on seed-users.ts' top-level await (CJS detect) —
copy to `.mts` first if you must run it.

Why a Seller row: the seller dashboard resolves the storefront by `ownerId` and 404s without it. Why `email_confirm: true`: no inbox round-trip.

## 2. Start the app on :3000

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

Use **3000** — the one port the marketplace runs on (owner, 2026-08-17). `preview.mjs` kills
whatever already holds it BEFORE it builds, and aborts if it cannot, so a stale server cannot
silently serve the suite old code.

⛔ **Wait for the `── serving` line, NOT for the port to answer.** The port is free for the
whole multi-minute build, so a 200 in that window is by definition somebody else's server —
polling for one would run the entire authed suite against the wrong build and then lose the
server mid-run.

⚠️ This replaced `npm run build && PORT=3100 npm start`, and the difference is not only the
port: `preview.mjs` also sets `NEXT_PUBLIC_LOCAL_AUTH=1`, which is what keeps a local sign-in
local (without it, auth pins its return host to `NEXT_PUBLIC_APP_URL` and the seeded seller is
sent to production to complete the login). The authed suite has NOT been re-run under this
recipe since the switch — if it behaves oddly at the sign-in step, suspect this first.

## 3. Run the suite

```bash
E2E_AUTHED_BASE=http://localhost:3000 \
E2E_SELLER_EMAIL=e2e-seller@eno.vn \
E2E_ADMIN_EMAIL=e2e-admin@eno.vn \
ADMIN_EMAILS=e2e-admin@eno.vn \
node --env-file=.env node_modules/.bin/playwright test --project=setup --project=seller --project=admin
```

> ### ⛔ NEVER mint a magic link for a REAL `ADMIN_EMAILS` address
>
> `ADMIN_EMAILS` is overridden **to the seeded user** on line 4 of that command for a reason.
> `admin.auth.admin.generateLink()` **CREATES the account if it does not exist** — it is not a read.
>
> On 2026-07-26 a worker needed an admin session, did not spot this override, and generated a link
> for `ADMIN_EMAILS[0]` (`support@eno.vn`), which had no account. That **created a production auth
> user + Profile for a live admin identity** and signed into it four times. They reported it and
> correctly refused to reverse it unauthorised. Resolved non-destructively: the four refresh tokens
> were revoked (a pure `UPDATE`) and the account, Profile and identity were all kept.
>
> The seeded admin exists precisely so no real identity is ever needed. If you only want an admin
> session for a screenshot, run the local server with `ADMIN_EMAILS="…,e2e-admin@eno.vn"` — the
> allowlist is plain env, so this needs no code change and touches nothing real.

Three things that are easy to get wrong:
- **Playwright does not read `.env` on its own** — hence `node --env-file=.env`. Without it, `auth.setup.ts` sees no `SUPABASE_SECRET_KEY` and every authed spec silently *skips* (a green run that tested nothing).
- **`ADMIN_EMAILS` must include the admin user**, or `/admin` 403s and the moderation specs fail. Include the **seeded** one; see the warning above for why never a real one.
- **`existsSync` on the storageState files runs at CONFIG LOAD**, so a first run cannot use a session it writes mid-run. Run `--project=setup` **first**, then the authed projects as a second invocation.
- Sign-in goes `admin.auth.admin.generateLink('magiclink')` → `verifyOtp(token_hash)`, serialized through `@supabase/ssr` into a Playwright storageState. Turnstile guards OTP *sends* and password grants — never `/verify` — so this path is captcha-proof. Don't "fix" a failure by reaching for `E2E_TEST_PASSWORD`; that grant is blocked while the captcha is on.

Expect **10/10** (setup + seller + admin). The projects only register when `E2E_AUTHED_BASE` is set, so a missing env means they vanish rather than fail — check the project list in the output if the count looks light.

## 4. Clean up

```bash
set -a; . ./.env; set +a
node scripts/e2e-cleanup.mjs
```

Removes the fixtures, the Seller row, the Profiles, and the auth users. Also stop the server on 3000. Leaving the users behind is not dangerous (they own no public listings), but the suite is designed to be hermetic — leave it that way.

> ⚠️ **NOT `seed-users.ts --cleanup`** — that is this skill's own older script and it now **fails**,
> which cost a detour on 2026-07-27. It knows about the listing and the conversation but not the
> trip fixture added later, so deleting the buyer Profile while it still owns `e2e-itinerary-1`
> throws a bare `P2003` / `ForeignKeyConstraintViolation` with no hint about which row is holding it.
> `scripts/e2e-cleanup.mjs` is the counterpart to `scripts/e2e-seed.mjs` and clears all of it —
> the pairing is stated at the top of the seed script. The rule generalises: **the cleanup lives
> beside the seeder that created the fixtures**, so a new fixture means updating that pair, not this
> skill's legacy copy.
>
> (Node 25 note: `npx tsx` chokes on `seed-users.ts`' top-level await, and copying it to `.mts`
> outside the repo then breaks its relative Prisma import — two dead ends before the real problem is
> even visible. Reach for `e2e-cleanup.mjs` and neither happens.)

## Report

Tell the user the pass count, anything that skipped (and why), and confirm the users were purged.
