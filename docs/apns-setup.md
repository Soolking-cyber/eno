# Turning on native push (and the app-icon badge)

⛔ **SINCE 2026-10-06 BOTH APPS RENDER eno.vn (owner decision D18), SO NATIVE PUSH IS eno.vn's ALONE.** The
credentials go in the box env file `/opt/eno/secrets/eno-vn.env` and nowhere else — never `eno-forum.env`:
`src/lib/native-push.ts` refuses to send from the services build (`IS_SERVICES`), because device tokens carry no
edition and a forum push would land in the licensed company's apps. The full activation (the table, the client flag,
Android) is `NATIVE_PUSH_SETUP.md`; this file is the APNs key, where it goes, and the badge.

The app-icon badge — the red circle counting unread notifications + messages — is **built**, and inert until push is
on: iOS shows a badge only after the person grants notification permission, and the only thing that asks is
`src/components/native/native-push.tsx`, silent until `NEXT_PUBLIC_NATIVE_PUSH_IOS=1` is deployed (NATIVE_PUSH_SETUP.md
step 5). From then on iOS applies `aps.badge` to the icon on delivery — no new binary: the 1.0.3 shell already carries
`aps-environment` (docs/ios-appstore-release.md P4).

`src/lib/native-push.ts` no-ops entirely when the credentials are absent, which is why the apps are quiet rather than
broken.

Check the current state at any time from a laptop — with the `APNS_*` lines in a separate, gitignored
`.env.apns.local` (the box's five values, `APNS_PRODUCTION=true`), loaded for the diagnostic alone, in a subshell so
the key does not stay in the terminal's environment:

```bash
( set -a; . ./.env; . ./.env.apns.local; set +a; node scripts/push-test.mjs )
```

⛔ **Never put `APNS_*` in the shared `.env`, and never run a dev or preview server with APNs credentials.** That
`.env` points at the PRODUCTION database (127.0.0.1:5433, the SSH tunnel), so a `dev:vn` or `preview:vn` server holding
the key sends real APNs pushes to real users for every `sendPushToProfile` it triggers. Next never reads
`.env.apns.local` (it is not one of the env files Next loads), which is why the diagnostic gets its own file.

---

## 1. The APNs auth key — ✅ CREATED 2026-10-06

"eno APNs", Key ID **`BQYKUSQG43`**, Sandbox & Production, team-scoped (team `DTP9SKVFMQ`, Eno Company Limited).
The `.p8` is `~/eno-vault/apple/AuthKey_BQYKUSQG43.p8`. Apple lets you download it exactly once, so that file is the
only copy: never commit it, never paste it into a chat or a terminal.

Only if the key is ever revoked — how it is made. One key works for **every** app on the team, for both sandbox and
production, and does not expire; Apple allows two at a time.

1. <https://developer.apple.com/account/resources/authkeys/list> → **＋**
2. Name it, tick **Apple Push Notifications service (APNs)**, Continue → Register.
3. **Download the `.p8`** — once only; losing it means revoking and starting over.
4. The **Key ID** is 10 chars (also in the filename `AuthKey_XXXXXXXXXX.p8`); the Team ID is under Membership.

## 2. Encode the key

The `.p8` is a multi-line PEM. It is stored **base64-encoded** because the box loads secrets from a dotenv file (the
compose `env_file`, and the image build's `buildenv` secret), and a raw multi-line value is not shell-safe — the same
rule that already applies to the Google service-account JSON. `native-push.ts` decodes it automatically
(`decodeMaybeB64`).

```bash
base64 -i ~/eno-vault/apple/AuthKey_BQYKUSQG43.p8 | tr -d '\n' | pbcopy   # to the clipboard, never to the screen
```

## 3. Set the values

| Variable | Value | Notes |
|---|---|---|
| `APNS_KEY` | the base64 string from step 2 | not the file path, not the raw PEM |
| `APNS_KEY_ID` | `BQYKUSQG43` | |
| `APNS_TEAM_ID` | `DTP9SKVFMQ` | |
| `APNS_BUNDLE_ID` | `vn.eno.app` | must match the installed app exactly |
| `APNS_PRODUCTION` | `true` | **always on the box, never toggled — see below; this is the one that bites** |

### ⛔ `APNS_PRODUCTION=true` on the box, always — never toggled

A device token is only valid on the APNs environment its build was signed for: a **TestFlight or App Store build** →
production (`api.push.apple.com`); an **Xcode / debug build on a cabled device** → sandbox. A mismatch is the most
common silent failure, and it looks identical to "push is broken": every send returns `BadDeviceToken` and nothing
arrives.

`eno-vn.env` holds ONE value for every installed app, and a TestFlight build exists (1.0.3 (2), 2026-10-06) — so on
the box it is `true` from now on and is never unset to try a debug build. Unsetting it would turn every TestFlight and
App Store token into `BadDeviceToken`, which `src/lib/native-push.ts` marks dead and DELETES from the production
`NativePushToken` table. Debug-build (sandbox) push is not tested against the box: test push on TestFlight
(docs/ios-appstore-release.md P8, P10).

### Where they go — the box env file, then a container recreate

⛔ **OWNER-APPROVED prod write — and only once the `NativePushToken` table exists** (NATIVE_PUSH_SETUP.md step 4,
then its step 4b): from the recreate on, every `sendPushToProfile` queries that table, and a missing one throws on
every offer or enquiry push. Production reads `/opt/eno/secrets/eno-vn.env` on the box (`env_file` of the
`eno-vn` service in `infra/vn-node/apps.compose.yml`). Append the five lines there — **`eno-vn.env` ONLY, never
`eno-forum.env`** — then recreate the container so it re-reads the file (a brief eno.vn restart):

```bash
docker compose -f /opt/eno/app/infra/vn-node/apps.compose.yml up -d --no-deps --force-recreate eno-vn
```

`APNS_*` are read at runtime, so they need no rebuild; the client switch `NEXT_PUBLIC_NATIVE_PUSH_IOS` is inlined at
build time and needs a deploy (`infra/vn-node/eno-deploy.sh`, on the owner's word) — NATIVE_PUSH_SETUP.md step 5, after
the `NativePushToken` table exists (its step 4). To test from a laptop, put the lines in `.env.apns.local` (above) —
never in the shared `.env`.
(This section used to add a Secret Manager version and redeploy Cloud Run — both retired in August 2026; the box is
the only production.)

## 4. Verify

```bash
# the diagnostic only, in a subshell — never a dev or preview server with these loaded
( set -a; . ./.env; . ./.env.apns.local; set +a; node scripts/push-test.mjs )                       # config only
( set -a; . ./.env; . ./.env.apns.local; set +a; node scripts/push-test.mjs --send you@email.com )  # real push + badge to your devices
```

The script builds the auth JWT, prints the resolved host, and decodes every APNs rejection into
what actually causes it — `BadDeviceToken` (sandbox/production or bundle mismatch),
`InvalidProviderToken` (key/team mismatch or revoked), `TopicDisallowed` (bundle id isn't this
key's app), `Unregistered` (app deleted).

If it reports **0 registered iOS devices**, open the app once while signed in — with
`NEXT_PUBLIC_NATIVE_PUSH_IOS=1` deployed, or nothing registers: registration happens in
`src/components/native/native-push.tsx` and POSTs the token to `/api/push/native-subscribe`.

⚠️ What pushes (`sendPushToProfile`), including: offers and counter-offers, a listing's first enquiry, sale
confirmations, account notices (enforcement, identity and business verification), price drops (`price-drop.ts`),
saved-search alerts (`cron/saved-search-alerts`), availability reminders (`cron/daily-reminders`), dispute updates
(`dispute.ts`), rental availability requests (`messages.ts`), the e-Visa "photos sent" line to the seller and the
e-Visa result to the applicant (`visa/result.ts`). **A plain chat message does not push** (`src/lib/messages.ts`) —
test with an offer from a second account.

---

## How the badge behaves once this is on

- **Goes up**: every push carries the profile's true unread total (notifications + unread chat
  messages, `src/lib/unread.ts`). The value is *absolute*, not a delta, so it also repairs a
  badge that drifted while the app was closed.
- **Goes down**: `syncBadgeToProfile()` sends a badge-only push (no alert, no sound) when
  notifications are marked read and when a conversation is opened — the two moments the count
  drops with no ordinary push to carry it.
- **Fails soft**: if the count can't be read the badge is *omitted* rather than set to 0,
  because clearing a badge we couldn't measure is worse than leaving it. A missed sync
  self-heals on the next real push.
- **On resume**: the binary ships `@capawesome/capacitor-badge`, and `src/components/native/native-badge.tsx`
  re-asserts the same absolute count when the app comes to the foreground — once notification permission is
  granted. (This section used to list that as "worth doing later"; it is done.)

### Android

`FCM_PROJECT_ID` + `FCM_CREDENTIALS` (service-account JSON, base64) enable Android push — in `eno-vn.env` too (OWNER-APPROVED, and only after the `NativePushToken` table), for
the same reason. ⚠️ Android also needs `android/app/google-services.json` compiled into a Play build, and 1.0.3 has
none (NATIVE_PUSH_SETUP.md §2). The badge there is best-effort by nature: FCM `notificationCount` is sent, but the
badge is drawn by the launcher — Samsung and Xiaomi render the number, stock Android shows only a dot — and there is
no server-side clear, since the badge is tied to a visible notification. Treat iOS as the guarantee.
