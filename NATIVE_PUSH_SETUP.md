# Native Push — Activation Checklist

⛔ **eno.vn's PUSH, AND ONLY eno.vn's (2026-10-06).** Both apps render https://eno.vn (owner decision D18,
docs/ios-appstore-release.md §5), so every native push is sent by eno.vn's server. Every value below goes in
`/opt/eno/secrets/eno-vn.env` **only** — never `APNS_*` / `FCM_*` in `eno-forum.env`, and never a
`NEXT_PUBLIC_NATIVE_PUSH_*` flag there either. `src/lib/native-push.ts` refuses to send from the services build
(`IS_SERVICES`): device tokens carry no edition, so a forum push (a desk result, a forum-only link) would land in the
licensed company's app.

Everything below the code line is **built and dormant**: native push registration, the token endpoints, the
FCM+APNs send library, the DB model, and the wiring into the notifications that push (`sendPushToProfile`). It stays
a **no-op** until the table exists, the APNs/FCM config is in the env and a platform's flag is deployed. iOS needs no
code change and no new binary — just the steps here. Android also needs a new Play build (§2).

⛔ **ORDER (2026-10-06): the token-erasure decision (step 4's FK: `onDelete: SetNull` keeps an erased user's device
tokens — decide Cascade + erasure deleting them FIRST, or the table starts out keeping personal data) → step 4 (the
table) → step 4b (the `APNS_*` env + recreate `eno-vn`) → step 5 (the flag +
deploy).** The env must never go in before the table: from that recreate on, every `sendPushToProfile` reaches
`db.nativePushToken.findMany` (`src/lib/native-push.ts`), which throws on the missing relation — caught and logged on
every offer or enquiry push (`src/lib/push.ts`). The same holds for Android's `FCM_*` (§2 step 3).

## Already done (in the repo)
- `@capacitor/push-notifications` installed **and cap-synced** — `PushNotificationsPlugin` is in
  `packageClassList` (iOS `capacitor.config.json` + `Package.swift`) and Android
  `capacitor.plugins.json`. ⚠️ This happened BEFORE the entitlement existed, which made
  `requestPermissions()` live: it showed the iOS "Allow Notifications?" dialog even though
  `register()` failed at the APNs layer (no `aps-environment`) — a prompt for a dead capability.
- ✅ **The iOS entitlement is in the binary** (P4, 2026-10-06): `ios/App/App/App.entitlements` carries
  `aps-environment` and is wired to the App target; the App ID got Push when the first signed build provisioned it.
- **Dormancy gate (so that prompt does NOT fire until push actually works):**
  `native-push.tsx` is gated PER PLATFORM on **`NEXT_PUBLIC_NATIVE_PUSH_IOS === '1'`** and
  **`NEXT_PUBLIC_NATIVE_PUSH_ANDROID === '1'`** (`src/lib/native-push-flags.ts`; unset ⇒ no prompt, no
  register). Flip a platform's flag in step 5, LAST, after everything below is in place FOR THAT
  PLATFORM. ⚠️ The old shared `NEXT_PUBLIC_NATIVE_PUSH` is no longer read (2026-10-04): iOS and Android
  become ready on different days, and one flag would have prompted Android users the day iOS shipped.
- **AppDelegate APNs callbacks** (`didRegisterForRemoteNotificationsWithDeviceToken` /
  `…didFailToRegisterWithError`) are present in `ios/App/App/AppDelegate.swift` — the hand-written
  AppDelegate had dropped them, which would have silently defeated push; re-added, so no further
  native code change is needed at activation.
- Client registration: `src/components/native/native-push.tsx` (mounted in `providers.tsx`,
  native-only, registers after sign-in ONLY when the gate is on, POSTs the token, deep-links on tap).
  It is the ONE place that asks for notification permission (`native-badge.tsx` only reads the answer).
- Endpoints: `POST /api/push/native-subscribe`, `POST /api/push/native-unsubscribe`.
- DB model: `NativePushToken` (in `prisma/schema.prisma`) — **table not created yet** (see step 4).
- Send library: `src/lib/native-push.ts` — FCM v1 (Android) + APNs token-auth (iOS), env-gated,
  prunes dead tokens, refuses on the services build. Fired from `sendPushToProfile`, which is called for — among
  others — offers and counter-offers, a listing's first enquiry, sale confirmations, account notices (enforcement,
  identity and business verification), price drops (`src/lib/price-drop.ts`), saved-search alerts
  (`cron/saved-search-alerts`), availability reminders (`cron/daily-reminders`), dispute updates (`src/lib/dispute.ts`),
  rental availability requests (`src/lib/messages.ts`), the e-Visa "photos sent" line to the seller and the e-Visa
  result to the applicant (`src/lib/visa/result.ts`). ⚠️ **A plain chat message does not push**
  (`src/lib/messages.ts`: it shows on the Messages badge instead).
- ✅ **Android Gradle wiring** (was step 2.2): `android/build.gradle` carries
  `classpath 'com.google.gms:google-services:4.4.4'`, and `android/app/build.gradle` applies
  `com.google.gms.google-services` only when `google-services.json` exists — so the build works without it.

---

## 1. iOS (the paid team `DTP9SKVFMQ` — a free personal team cannot do push)
1. ✅ APNs key, 2026-10-06: "eno APNs", Key ID `BQYKUSQG43`, Sandbox & Production, team-scoped; the `.p8` is
   `~/eno-vault/apple/AuthKey_BQYKUSQG43.p8` (downloadable once — that file is the only copy). docs/apns-setup.md.
2. ✅ Entitlement in the binary (above). No Xcode capability click and no new binary are needed to activate push.
3. The `APNS_*` env — ⛔ NOT YET: it goes in only AFTER step 4's table exists. Step 4b below (the ORDER above).

## 2. Android (needs a free **Firebase** project) — ⏳ NOT STARTED
Measured 2026-10-06: no `google-services.json` in the repo, the main checkout or `~/eno-vault`.
⚠️ **Android push needs a NEW Play build.** The Gradle plugin compiles `google-services.json` into the bundle, so
versionCode 5 / 1.0.3 — built without it — can never register for FCM. Keep `NEXT_PUBLIC_NATIVE_PUSH_ANDROID` unset
until a versionCode built with the file is live.
1. [Firebase console](https://console.firebase.google.com) → add project (can reuse `eno-vn`) → add an
   **Android app** with package **`eno.vn`** — the `applicationId` Play knows (android/app/build.gradle). The
   Java namespace `vn.eno.app` is NOT the package: a google-services.json keyed on it fails the build with
   "No matching client found for package name 'eno.vn'" → download **`google-services.json`** → put it in
   `android/app/google-services.json`.
2. ✅ The Gradle side is done (see Already done). ⛔ Do not re-apply Capacitor's push docs here: they name
   `google-services:4.4.2`, older than the `4.4.4` the project carries — never downgrade the classpath.
3. Firebase → Project settings → **Service accounts → Generate new private key** (JSON). Set env (OWNER-APPROVED
   prod write), in `eno-vn.env` only — and only once step 4's table exists (the ORDER above) — then recreate `eno-vn`
   as in 4b:
   - `FCM_PROJECT_ID` = the Firebase project id
   - `FCM_CREDENTIALS` = that service-account JSON (raw or base64)

## 3. The plugin in the native builds — ✅ already synced
`@capacitor/push-notifications` is in both native projects (Already done), and `npx cap sync` runs on every native
build anyway: `scripts/ios-release.sh` does it for iOS, and the Android build starts with `npx cap sync android`
(docs/android-play-release.md). This step used to say the Android build fails without `google-services.json`; it
does not — the plugin is simply not applied, and FCM cannot register (hence §2's new build).

## 4. Create the DB table — OWNER-APPROVED prod write
⛔ **NEVER `npx prisma db push`** — this step used to say so, and since 2026-08 it DROPS the 18 tables
Prisma does not manage (live visa PII, the rate limiter, the OTP chain…). Use CLAUDE.md "Schema changes" — the safe
flow:
1. Drop both cross-schema FKs (`profile_auth_fk`, `visa_applications_user_id_fkey`).
2. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
3. Read it and apply ONLY the statements that create `NativePushToken`: `CREATE TABLE "NativePushToken"`, its
   index statements (the unique `token`, the `profileId` index) and its `ADD CONSTRAINT … FOREIGN KEY` to
   `Profile` — `psql -v ON_ERROR_STOP=1` inside `BEGIN/COMMIT`. Reject the run if any other statement would go in
   (any `DROP`, any `ALTER` of another table): the rest of the diff is other drift, not this step's.
4. Restore both FKs, re-run the DDL scripts CLAUDE.md step 4 names, `npx prisma generate`.

The table must exist BEFORE step 4b's `APNS_*` env — and so before step 5's deploy.
⚠️ **OPEN — decide before the table is created** (measured in code 2026-10-06): the model's FK is
`onDelete: SetNull`, and account erasure (`src/lib/core/account-erasure.ts`) deletes the Profile but never its
tokens — so an erased account's device tokens would survive with `profileId` NULL. The comment on that field was
copied from a verification-history model. Cascade (or a delete in the erasure) makes the DDL right the first time.
⚠️ If the decision edits `prisma/schema.prisma` (`onDelete: Cascade`), step 5's deploy is refused unless it carries
`SCHEMA_OK=<full sha of the commit being deployed>` (`infra/vn-node/eno-deploy.sh`, "2. schema": prisma/ changed
since the deployed commit) — set it only once the table was created from that same schema.

## 4b. iOS env — AFTER the table, BEFORE step 5 (OWNER-APPROVED prod write)
Set env in `/opt/eno/secrets/eno-vn.env` **ONLY**, then recreate the container — `APNS_*` are read at runtime, so no
rebuild: `docker compose -f /opt/eno/app/infra/vn-node/apps.compose.yml up -d --no-deps --force-recreate eno-vn` (`--no-deps`: nothing else restarts).
⚠️ **This skips `eno-deploy.sh`'s health check and auto-rollback, so do both by hand:** copy the file first
(`cp eno-vn.env eno-vn.env.bak-$(date +%F-%H%M%S)` — a new name each time, so a second attempt never
overwrites the good copy), and after the recreate check https://eno.vn through Cloudflare (home page
200, a listing page 200, `docker ps` shows `eno-vn` healthy). On any failure restore the copy and recreate again.
⛔ **Never in the shared local `.env`.** It points at the PRODUCTION database (127.0.0.1:5433, the SSH tunnel), so with
`APNS_*` in it any `dev:vn` or `preview:vn` server sends real APNs pushes to real users for every `sendPushToProfile`
it triggers. Never run a dev or preview server with APNs credentials. The diagnostic gets them from a separate,
gitignored `.env.apns.local`, loaded for it alone, in a subshell:
`( set -a; . ./.env; . ./.env.apns.local; set +a; node scripts/push-test.mjs )` (docs/apns-setup.md).
Base64 the `.p8` so `sh` can source it (docs/apns-setup.md step 2):
- `APNS_KEY_ID` = `BQYKUSQG43`
- `APNS_TEAM_ID` = `DTP9SKVFMQ`
- `APNS_KEY` = the `.p8`, base64 (raw PEM also decodes, but is not dotenv-safe)
- `APNS_BUNDLE_ID` = `vn.eno.app` (registered on the team by the first signed build, 2026-10-06)
- `APNS_PRODUCTION` = `true` — ALWAYS, and never toggled: a TestFlight build exists (1.0.3 (2), 2026-10-06), and this
  one value serves every installed app. Unset (or anything but `true`), every TestFlight and App Store token comes
  back `BadDeviceToken`, which `native-push.ts` marks dead and DELETES from the production `NativePushToken` table.
  Debug-build (sandbox) push is not tested against the box — test push on TestFlight (docs/ios-appstore-release.md
  P8, P10).

## 5. Flip the gate, deploy + test (OWNER-APPROVED prod write + deploy)
Set **`NEXT_PUBLIC_NATIVE_PUSH_IOS=1`** — and `NEXT_PUBLIC_NATIVE_PUSH_ANDROID=1` only once §2's new Play build is
live — in `/opt/eno/secrets/eno-vn.env`, the build both apps render. ⛔ **Never in `eno-forum.env`**: no CURRENT app
renders the forum's build (D18: iOS 1.0.3 and Android 1.0.3 load eno.vn); Android installs below versionCode 5 still
load www.eno.forum, but they ship no `google-services.json` and the forum's server never sends a native push. They are NEXT_PUBLIC values, so they need a
build: deploy the web on the owner's word (`infra/vn-node/eno-deploy.sh`). No new iOS binary is needed.
Then on the device: sign in → the app requests notification permission and registers (a `NativePushToken` row) →
have a second account send an **offer** on one of your listings → it arrives natively; tapping it deep-links to the
`url` in the payload. A plain chat message never pushes — do not test with one. Test on the TestFlight build — a
debug build's token is sandbox, and the box stays `APNS_PRODUCTION=true` (step 4b). ⚠️ Do NOT set a platform's flag
before steps 1–4b are done for it, or you re-introduce the "prompt for a dead capability" bug the gate was added to
prevent.

---

**Env summary** — `/opt/eno/secrets/eno-vn.env` on the box ONLY (never the shared local `.env` — step 4b), after
step 4's table, then recreate `eno-vn`; the `NEXT_PUBLIC_*` ones need a rebuild too (`eno-deploy.sh`; historically
Vercel, then Cloud Run, both retired):
`NEXT_PUBLIC_NATIVE_PUSH_IOS` / `NEXT_PUBLIC_NATIVE_PUSH_ANDROID` (the client gates — `1` to enable
prompt+register on that platform),
`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION`,
`FCM_PROJECT_ID`, `FCM_CREDENTIALS`.
Both platform flags unset → the app never prompts/registers (measured unset on both box env files, 2026-10-04).
The APNS/FCM set gate the SEND side: missing all → send is a silent no-op; set the iOS set only → iOS works,
Android no-ops (and vice-versa).
