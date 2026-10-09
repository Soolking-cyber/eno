# Sign in with Apple on the VN box

**GoTrue's Apple client secret — the expiry line.** Update it after `install` (I8) and after every `rotate` (I14),
from the last lines the script prints:

> **NOT INSTALLED** — then: `key <KEY_ID> · expires <YYYY-MM-DD> · fingerprint <12 hex> · installed <YYYY-MM-DD>`

With auto-rotation on (D11, `install-timer --auto-rotate`) the timer rotates by itself at 30 days or fewer, so this
line can lag; the authoritative value is `journalctl -u eno-apple-siwa-check -n 30` (it prints the same three
values every day) or `bash /opt/eno/app/infra/vn-node/apply-apple-signin.sh check`.

The plan, with every decision and its reason: `~/eno-ios-prep/siwa/plan.md` (§6 is this runbook's source). The
tool: [`apply-apple-signin.sh`](apply-apple-signin.sh). Its tests (no box needed):
`npx vitest run src/lib/apply-apple-signin.test.ts`.

## What lives where

| Piece | Where | Read by |
| --- | --- | --- |
| The dedicated Sign in with Apple key (.p8) | vault `apple-siwa-p8` → `/opt/eno/secrets/apple-siwa.p8` (0600, kept for re-runs) → base64 in `APPLE_SIWA_PRIVATE_KEY` | the app (a 5-minute secret per Apple call); the script (GoTrue's secret) |
| The token key | vault `apple-token-enc-key` → `/opt/eno/secrets/apple-token-enc.key` (shredded once `install` succeeds) → `APPLE_TOKEN_ENC_KEY` | the app: AES-256-GCM of the refresh tokens kept for revocation (`public.apple_siwa_token`) |
| App env, **both** editions | `/opt/eno/secrets/eno-vn.env` and `eno-forum.env`: `APPLE_SIWA_TEAM_ID`, `_KEY_ID`, `_PRIVATE_KEY`, `_SERVICES_ID`, `_BUNDLE_ID`, `APPLE_TOKEN_ENC_KEY`, `NEXT_PUBLIC_APPLE_SIGNIN` | the containers when created; the build (`NEXT_PUBLIC_*` is inlined) |
| GoTrue's Apple provider | `/opt/eno/supabase/.env`: `GOTRUE_EXTERNAL_APPLE_ENABLED`, `_CLIENT_ID` (`<SERVICES_ID>,vn.eno.app`), `_SECRET` (a 175-day JWT), `_REDIRECT_URI` (`https://sb.eno.vn/auth/v1/callback`), `GOTRUE_EXTERNAL_FLOW_STATE_EXPIRY_DURATION=10m` | the auth container — only through the passthroughs in `docker-compose.override.yml` |
| Backups | `/root/apple-siwa-backups/<UTC timestamp>/` (0700): the four files above + `meta` (no secret) | `restore <ts>` |
| The daily check | `eno-apple-siwa-check.{service,timer}`, the copy `/opt/eno/bin/apply-apple-signin.sh`, `/etc/default/eno-apple-siwa-check` | systemd, 20:40 UTC |
| The edge guard | `nginx/eno.conf`, the `sb.eno.vn` server | nginx |

Why both app env files although the forum shows no Apple (D2 = a, `NEXT_PUBLIC_APPLE_SIGNIN` stays empty there): the
editions share one database, so an Apple account made on eno.vn can be deleted through eno.forum, and that erasure
must be able to revoke its token too.

## ⛔ Rules

- **Never `APPLE_TEAM_ID`.** That name switches on the AASA route (applinks, P7 — on hold). The app reads
  `APPLE_SIWA_*`; the script never writes the other.
- **No secret on a screen, in a log or in an argv.** Never `cat`, `grep` or `less` the env files, never
  `docker compose config` (it prints them interpolated), never `docker inspect` the auth container to the terminal.
  Secrets travel vault → `ssh` pipe → a 0600 file. The script refuses `bash -x`; it prints key ids, dates, booleans
  and 12-character SHA-256 fingerprints only.
- **Recreating auth stops sign-in on BOTH editions for a few seconds** (failed sign-ins and token refreshes).
  `install`, `rotate` and `restore` run at 19:00–22:00 UTC; the timer runs at 20:40 UTC.
- **The token key is never replaced.** It seals every stored token; a different key orphans them all and account
  deletion could then revoke nothing (TN3194). `install` refuses one that differs from what is already there.
- **Rollback order (B5): empty the flag and deploy FIRST, then `restore`.** `restore` refuses the other order.

## Before the box steps (owner, once)

- The Apple portal (plan, owner steps 2–5): Sign in with Apple on App ID `vn.eno.app` as a primary App ID; a
  Services ID (e.g. `vn.eno.web`, not containing the Team ID) with domain `sb.eno.vn` and return URL
  **`https://sb.eno.vn/auth/v1/callback`**, character for character; a dedicated Sign in with Apple key, its .p8
  straight into the vault; the token key minted straight into the vault
  (`openssl rand -base64 32 | ~/eno-vault/vault.sh put apple-token-enc-key /dev/stdin`); the relay sources `eno.vn`
  and `send.eno.vn` registered.
- I2: the DDL (`node scripts/apple-siwa-ddl.mjs`, then `scripts/rls-guard.sql` lists no open relation).
- I3: the dark deploy (flag unset). `install` mints inside `eno-vn:local`, so the image must exist. It also
  publishes /privacy's dated update (D12): `PRIVACY_TEXT_PUBLISHED` in `src/lib/compliance/privacy-updated.ts` must be
  that day in Vietnam — `legal-amendment-gate.sh` refuses the deploy otherwise and prints the fix (re-date, commit,
  re-run).

## I4 · the nginx guard (box)

`sb.eno.vn/auth/v1/authorize` passes only a PKCE request whose `redirect_to` is an https eno.vn / eno.forum URL, and
refuses any query nginx and GoTrue would read differently; `/auth/v1/user/identities/authorize` answers 403. Why, in
the comments above the two maps at the top of `nginx/eno.conf`.

```bash
sha256sum /etc/nginx/sites-enabled/eno.conf; git -C /opt/eno/app show <PREV_SHA>:infra/vn-node/nginx/eno.conf | sha256sum
#   different → stop and merge by hand (nginx/README.md: the box is the source of truth)
nginx -T 2>/dev/null | sed 's/#.*//' | grep -iwE 'underscores_in_headers|ignore_invalid_headers'
#   must print NOTHING: GoTrue reads a `redirect_to` request HEADER before the query, and nginx drops that header
#   only through two defaults left alone — a name with an underscore is invalid, an invalid header is ignored.
#   `nginx -T` prints comments too, so they are cut first (eno.conf's own comment talks about these defaults).
#   (merge_slashes needs no check: the guard's location matches /+auth/+v1/+authorize either way)
cp -p /etc/nginx/sites-enabled/eno.conf /root/eno.conf.bak-$(date +%Y%m%d-%H%M%S)-authz \
  && cp /opt/eno/app/infra/vn-node/nginx/eno.conf /etc/nginx/sites-enabled/eno.conf \
  && nginx -t && systemctl reload nginx
```

Rollback: copy the backup back, then `nginx -t && systemctl reload nginx`.

⚠️ **The cost, on purpose (D21):** from I4 on, an OAuth sign-in (Google, Apple) that starts on a local preview
(`dev:vn`, `preview:vn` against sb.eno.vn) is refused — its `redirect_to` is not https eno.vn / eno.forum — and I8's
`--drop-localhost-redirect` takes `http://localhost:3000/**` off GoTrue's allow-list too. Test signed-in screens
locally with the fake-auth harness (no prod sign-in), and OAuth itself on the deployed site or the apps.

## I5 · the refusal matrix (Mac, through Cloudflare)

```bash
CC=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
ENO='https%3A%2F%2Feno.vn%2Fauth%2Fcallback'
t() { printf '%s (want %s)  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "https://sb.eno.vn/auth/v1/authorize?$2")" "$1" "$3"; }
t 400 "provider=google&redirect_to=evil%3A%2F%2Feno.vn%2F&code_challenge=$CC&code_challenge_method=s256" 'any scheme'
t 400 "provider=google&redirect_to=http%3A%2F%2F127.0.0.1%3A9%2F&code_challenge=$CC&code_challenge_method=s256" loopback
t 400 "provider=google&redirect_to=http%3A%2F%2Feno.vn%2F&code_challenge=$CC&code_challenge_method=s256" 'plain http'
t 400 "provider=google&redirect_to=https%3A%2F%2Feno.vn.evil.com%2F&code_challenge=$CC&code_challenge_method=s256" look-alike
t 400 "provider=google&redirect_to=$ENO" 'no PKCE'
t 400 "provider=google&redirect_to=$ENO&code_challenge=$CC&code_challenge_method=plain" 'plain PKCE'
t 400 "provider=google&Redirect_To=$ENO&redirect_to=evil%3A%2F%2Feno.vn%2F&code_challenge=$CC&code_challenge_method=s256" 'case decoy'
t 400 "provider=google&redirect_to=$ENO;x&code_challenge=$CC&code_challenge_method=s256" semicolon
t 302 "provider=google&redirect_to=$ENO&code_challenge=$CC&code_challenge_method=s256" 'the real thing'
curl -s -o /dev/null -w '%{http_code} (want 403)  identities\n' https://sb.eno.vn/auth/v1/user/identities/authorize
```

The 302 goes to `accounts.google.com` and, like any click, leaves one `flow_state` row. Then one real Google sign-in
in the Android app (it uses the same authorize URL).

⛔ **The guard lives in nginx, so it guards nothing if GoTrue's gateway answers the internet directly.** Docker
publishes its ports past ufw (Kong's `:8000` was once open on `0.0.0.0`; the `DOCKER-USER` rules are what close it),
and every check above goes through Cloudflare. From the Mac, straight at the box's IP — and again after any docker or
firewall change:

```bash
for p in 8000 8443 24700; do nc -z -G 5 162.4.176.233 "$p" 2>/dev/null && echo "$p open" || echo "$p closed"; done
#   want: 8000 closed · 8443 closed · 24700 open — the ssh port this Mac uses is the control, so "closed" is real
```

Either gateway port open: stop, and close it in `DOCKER-USER` before going on — a request there skips the guard and
reaches GoTrue's implicit flow (tokens in the URL).

## I6 · the inputs (Mac → box)

Each line shows a Keychain dialog: click **Allow**, never "Always Allow". (A function, not `SSH='ssh …'` + `$SSH`:
the Mac's shell is zsh, which does not split an unquoted variable into words, so `$SSH` would run as one command name
and the pipe would go nowhere.)

```bash
box() { ssh -i ~/.ssh/CS-Linux-20260920135129228.pem -p 24700 root@162.4.176.233 "$@"; }
~/eno-vault/vault.sh get apple-siwa-p8        | box 'umask 077; cat > /opt/eno/secrets/apple-siwa.p8'
~/eno-vault/vault.sh get apple-token-enc-key  | box 'umask 077; cat > /opt/eno/secrets/apple-token-enc.key'
```

## I7 · read-only look (box)

```bash
cd /opt/eno/supabase && cat docker-compose.override.yml && grep -c '^  auth:' docker-compose.override.yml \
  && grep -nE '^(SITE_URL|ADDITIONAL_REDIRECT_URLS|API_EXTERNAL_URL)=' .env && grep -c '^GOTRUE_EXTERNAL_APPLE_' .env
```

Expect one `auth:` block holding the four Google lines and `GOTRUE_MAILER_OTP_EXP`, `SITE_URL=https://eno.vn`,
`API_EXTERNAL_URL=https://sb.eno.vn`, the eno.vn and eno.forum globs, and 0 Apple variables. (The override should
hold only `${…}` references and plain settings, which is why it may be printed; the `.env` lines are grepped by
name, never printed whole.)

## I8 · install (box, 19:00–22:00 UTC)

```bash
bash /opt/eno/app/infra/vn-node/apply-apple-signin.sh install --team DTP9SKVFMQ --kid <KEY_ID> \
  --services-id <SERVICES_ID> --bundle vn.eno.app --flow-state-expiry 10m --drop-localhost-redirect
```

1. **Pre-flight, nothing written:** the deploy lock (it never runs beside a deploy), `API_EXTERNAL_URL`, `docker
   compose config`, GoTrue answering with google and email on, `GOTRUE_MAILER_OTP_EXP=3600` in the running auth, the
   override mergeable (exactly ONE `services.auth`, holding the Google passthrough), the token key consistent with
   what is already there, then: GoTrue's 175-day secret minted inside `docker run --rm --network none --log-driver
   none eno-vn:local` (the app's own token shape) and **proved at Apple** — a made-up code must come back
   `invalid_grant`; `invalid_client` stops everything here. The same key is tried for `vn.eno.app` (a warning only:
   it is the native iOS code exchange's client).
2. **Backups** of `.env`, the override and both app env files into `/root/apple-siwa-backups/<ts>/`.
3. Both app env files: the `APPLE_SIWA_*` values, `APPLE_TOKEN_ENC_KEY`, and `NEXT_PUBLIC_APPLE_SIGNIN=` (empty, and
   only where absent — a re-run never switches a flipped rollout back off). The running apps read them only when
   they are next created: **I8b, right after this.**
4. `.env`: the four `GOTRUE_EXTERNAL_APPLE_*` values and the 10-minute flow state; `http://localhost:3000/**` out
   of `ADDITIONAL_REDIRECT_URLS`.
5. The five passthroughs merged INTO the existing `services.auth.environment` (only lines added); `docker compose
   config`; `docker compose up -d --no-deps auth`.
6. Polls `/auth/v1/settings` until apple, google and email are on; reads the RECREATED container's environment
   (the Apple values, the secret's fingerprint, the OTP lifetime, the allow-list); checks that GoTrue's authorize
   sends Apple `client_id=<SERVICES_ID>`, `response_mode=form_post`, the return URL.
7. Shreds the token-key file and prints the key id, the expiry and the fingerprint — **record them on the expiry
   line above.**

Exit codes: **0** done · **1** failed after a write: every backed-up file was put back and auth recreated on them ·
**2** usage · **3** refused before any write. A re-run is safe (the token key and the .p8 are taken from the env
files when their input files are gone).

## I8b · the apps read the new env (box, right after I8)

```bash
cd /opt/eno/app && bash infra/vn-node/eno-deploy.sh --expect=<THE DEPLOYED FULL_SHA>   # same SHA, flag still empty
```

⛔ **Do not leave a gap between I8 and this.** From I8 GoTrue answers a hand-made
`/auth/v1/authorize?provider=apple` — the nginx guard pins PKCE and the return URL, not the provider — while the
running apps, created before I8, hold no `APPLE_SIWA_*`. In that window an Apple sign-in keeps no token and keeps
Apple's tokens in the cookie (the callback does nothing without Apple configured), and an admin erase reads no
Apple identity (commit gate, part A round 13). Redeploying the SHA already live re-creates both containers on the
new env; with the flag empty nothing user-visible changes. ⚠️ The DDL (I2) must have run: once `APPLE_SIWA_*` is
in the env, `/api/cron/apple-revocations` answers 500 on a missing token table.

## I9 · Apple probes (Mac, through Cloudflare)

- `https://sb.eno.vn/auth/v1/authorize?provider=apple&redirect_to=https%3A%2F%2Feno.vn%2Fauth%2Fcallback&code_challenge=$CC&code_challenge_method=s256`
  → 302 to `appleid.apple.com` with `client_id=<SERVICES_ID>`, `response_mode=form_post`,
  `redirect_uri=https://sb.eno.vn/auth/v1/callback`.
- `curl -si -X POST https://sb.eno.vn/auth/v1/callback -H 'Origin: https://appleid.apple.com' --data 'state=00000000-0000-0000-0000-000000000000&code=probe'`
  → a 3xx from GoTrue to `https://eno.vn?error=…`. A 403 or a challenge page is Cloudflare (a WAF, bot or rate rule
  would block Apple's form_post); a 404 or 405 is the gateway. Fix either before any flip.

## I10 · the daily check (box)

```bash
bash /opt/eno/app/infra/vn-node/apply-apple-signin.sh install-timer --auto-rotate    # D11: automatic rotation
systemctl list-timers | grep apple-siwa
bash /opt/eno/app/infra/vn-node/apply-apple-signin.sh check --calibrate               # once
```

`check` decodes the secret's expiry, confirms the running auth container holds the same secret as `.env`, probes
Apple (`invalid_grant` = good), and fails at 30 days or fewer — or, with auto-rotate, rotates (inside the
19:00–22:00 UTC window; a catch-up run at another hour defers unless 3 days or fewer remain). With GoTrue's Apple
off it passes without probing. `--calibrate` also sends a copy of the secret with one signature character changed:
it must come back `invalid_client`, or the daily probe cannot tell a dead secret from a live one. Failures show in
`systemctl --failed` and `journalctl -u eno-apple-siwa-check`. The timer runs the COPY in `/opt/eno/bin`: re-run
`install-timer` after a deploy that changes the script.

## I11 · the iOS flip, I12 · the web flip (box)

```bash
sed -i 's/^NEXT_PUBLIC_APPLE_SIGNIN=.*/NEXT_PUBLIC_APPLE_SIGNIN=ios,web-test/' /opt/eno/secrets/eno-vn.env
cd /opt/eno/app && bash infra/vn-node/eno-deploy.sh --expect=<FULL_SHA>    # NEXT_PUBLIC_* is inlined at build
ENO_CRON_ONLY=apple-revocations bash /opt/eno/app/infra/vn-node/cron/install-cron-timers.sh \
  && /opt/eno/bin/eno-cron.sh apple-revocations eno.vn 3001     # → 200 {ok:true, probe:{services:"ok", bundle:"ok"}}
```

I12, after build-3 approval (D18): `ios,web` in `eno-vn.env` (in `eno-forum.env` only per D2), then deploy.

## I13 · rollback

- **The flag:** set it empty in both env files and deploy. ⚠️ `eno-deploy.sh --rollback` is NOT a flag rollback:
  it puts the previous image back, and the buttons follow the flag that image was BUILT with (`NEXT_PUBLIC_*` is
  inlined), not the env file — so it removes Apple only when `:prev` was built without one. `docker inspect -f
  '{{index .Config.Labels "vn.eno.apple-signin"}}' eno-vn-app` prints the flag the running image was built with
  (`eno-build.sh` labels every image).
- **GoTrue's Apple:** the flag first (above), so iOS shows neither Apple nor Google and stays compliant; THEN
  `bash …/apply-apple-signin.sh restore <ts>` with the install's timestamp (`restore` alone lists the backups).
  It puts the four files back as they were, refuses if anything it does not manage changed since (it names the
  keys, never the values; `--force` reverts them too), refuses while a running app still carries a non-empty
  `NEXT_PUBLIC_APPLE_SIGNIN` — in its environment OR in the image it runs (the label above) — takes a pre-restore
  backup first, recreates auth and waits for google and email.
  It keeps the apps' Apple revocation settings (`APPLE_SIWA_*`, `APPLE_TOKEN_ENC_KEY`) exactly as they were before
  the restore — as one set, `--force` included: tokens stored meanwhile stay revocable — the daily retry and every
  erasure need the key to open them and the rest to mint Apple's client secret. A compromised key is replaced by
  rotating it (I14), never by a restore. An app container it cannot read (missing, stopped, mid-swap) counts as
  showing Apple.
- **nginx:** see I4.

Backups: an install's is kept for good; rotate and pre-restore backups past the newest 10 are pruned.

## I14 · rotation and re-keying

`bash …/apply-apple-signin.sh rotate` (or the timer with auto-rotate) mints a new 175-day secret from the key in
`eno-vn.env`, proves it at Apple, backs up, swaps it into `.env`, recreates auth, verifies, and puts everything back
on any failure. Then update the expiry line.

A new key (Apple revoked the old one, or a scheduled change): download the new .p8 into the vault, pipe it as in I6,
and re-run `install` with the new `--kid` — then deploy (or recreate both app containers), because the apps keep
minting with the key they were created with.

## Reading a failure

| Symptom | Meaning |
| --- | --- |
| `invalid_client` at install, rotate or check | Apple refuses the secret (TN3107): the key id, the team id, the .p8 or the client id is wrong, the key is not enabled for Sign in with Apple on the primary App ID — or, in `check`, the secret has expired |
| `the running auth container holds fp:… — not .env's secret` | `.env` changed without a recreate (or a half-finished restore): `cd /opt/eno/supabase && docker compose up -d --no-deps auth`, then `check` |
| `unreachable` | the box could not reach `appleid.apple.com` (twice); the next successful run clears the failed state |
| calibration: the broken copy got `invalid_grant` | the probe proves nothing; do not trust the daily check until this is understood |
| GoTrue log `Unacceptable audience in id_token` | the native token's bundle id is not in `GOTRUE_EXTERNAL_APPLE_CLIENT_ID` |
| GoTrue log `Nonces mismatch` | the app sent Apple a nonce that does not hash to what it gave GoTrue (an app bug, not the box) |
| `OAuth state has expired` | the Apple login took longer than the 10-minute flow state |
| the refusal names `services.auth` | the override does not have exactly one auth block: merge it by hand (compose would refuse a duplicate key anyway) |
| cron `[auth] apple_token_table_missing {"configured":true}`, 500 | `APPLE_SIWA_*` is in the env but `public.apple_siwa_token` is not: run the I2 DDL — until then every Apple sign-in keeps no token |
| cron `[auth] apple_revocation_stalled`, 500 | a queued token has waited over 3 days while the run skipped (Apple `unreachable`, or GoTrue's identities unreadable): fix the route or the grant before day 14 |
| cron `[auth] apple_revoke_gave_up {"reason":"stalled"}` | day 14 passed while skipping: the row was dropped unrevoked (D9) — the person was told to check their Apple Account |
| cron `[auth] apple_queue_age_unreadable`, 500 | the run could not read how long rows have waited: the database, or the app role's grant on `apple_siwa_token` |
