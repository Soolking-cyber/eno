---
name: authed-e2e
description: Run the authed (seller + admin) Playwright suite against a local build — seeds ephemeral Supabase users, signs them in via admin magic-link, runs the seller/admin projects, then cleans the users up.
disable-model-invocation: true
---

# /authed-e2e — the seller + admin suite

The guest suite (`/ship`) is read-only and runs against prod. The authed suite **writes** — it creates listings, moderates, edits a storefront — so it never points at prod. Run it against a local build (or a preview deploy backed by a seeded branch).

Everything below runs from `/Users/mk1e3/eno.vn`.

## 1. Seed the ephemeral users

```bash
set -a; . ./.env; set +a
npx tsx .claude/skills/authed-e2e/seed-users.ts
```

Creates `e2e-seller@eno.vn` (business Profile + a Seller storefront) and `e2e-admin@eno.vn` (individual Profile), reusing them if they already exist. It prints the exports you need next.

Why a Seller row: the seller dashboard resolves the storefront by `ownerId` and 404s without it. Why `email_confirm: true`: no inbox round-trip.

## 2. Start the app on a port nothing else owns

```bash
npm run build && PORT=3100 npm start
```

Use **3100**, not 3000 — another project's `next-server` has squatted 3000 and served phantom 404s into a test run. Wait until it answers on `http://localhost:3100`.

## 3. Run the suite

```bash
E2E_AUTHED_BASE=http://localhost:3100 \
E2E_SELLER_EMAIL=e2e-seller@eno.vn \
E2E_ADMIN_EMAIL=e2e-admin@eno.vn \
ADMIN_EMAILS=e2e-admin@eno.vn \
node --env-file=.env node_modules/.bin/playwright test --project=setup --project=seller --project=admin
```

Three things that are easy to get wrong:
- **Playwright does not read `.env` on its own** — hence `node --env-file=.env`. Without it, `auth.setup.ts` sees no `SUPABASE_SECRET_KEY` and every authed spec silently *skips* (a green run that tested nothing).
- **`ADMIN_EMAILS` must include the admin user**, or `/admin` 403s and the moderation specs fail.
- Sign-in goes `admin.auth.admin.generateLink('magiclink')` → `verifyOtp(token_hash)`, serialized through `@supabase/ssr` into a Playwright storageState. Turnstile guards OTP *sends* and password grants — never `/verify` — so this path is captcha-proof. Don't "fix" a failure by reaching for `E2E_TEST_PASSWORD`; that grant is blocked while the captcha is on.

Expect **10/10** (setup + seller + admin). The projects only register when `E2E_AUTHED_BASE` is set, so a missing env means they vanish rather than fail — check the project list in the output if the count looks light.

## 4. Clean up

```bash
set -a; . ./.env; set +a
npx tsx .claude/skills/authed-e2e/seed-users.ts --cleanup
```

Removes the Seller row, the Profiles, and the auth users. Also stop the server on 3100. Leaving the users behind is not dangerous (they own no public listings), but the suite is designed to be hermetic — leave it that way.

## Report

Tell the user the pass count, anything that skipped (and why), and confirm the users were purged.
