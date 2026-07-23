# Native Push — Activation Checklist

Everything below the code line is **already built and shipped, dormant**. Native push registration,
the token endpoints, the FCM+APNs send library, the DB model, and the wiring into every existing
notification (`sendPushToProfile`) are in place. It stays a **no-op** until you (a) provide the
FCM/APNs config as env, and (b) wire the plugin into the native builds. No code changes needed to
turn it on — just the steps here.

## Already done (in the repo)
- `@capacitor/push-notifications` installed **and cap-synced** — `PushNotificationsPlugin` is in
  `packageClassList` (iOS `capacitor.config.json` + `Package.swift`) and Android
  `capacitor.plugins.json`. ⚠️ This happened BEFORE the entitlement existed, which made
  `requestPermissions()` live: it showed the iOS "Allow Notifications?" dialog even though
  `register()` fails at the APNs layer (no `aps-environment`) — a prompt for a dead capability.
- **Dormancy gate (so that prompt does NOT fire until push actually works):**
  `native-push.tsx` is gated on **`NEXT_PUBLIC_NATIVE_PUSH === '1'`** (unset ⇒ no prompt, no
  register). Flip it in step 5, LAST, after everything below is in place.
- **AppDelegate APNs callbacks** (`didRegisterForRemoteNotificationsWithDeviceToken` /
  `…didFailToRegisterWithError`) are present in `ios/App/App/AppDelegate.swift` — the hand-written
  AppDelegate had dropped them, which would have silently defeated push; re-added, so no further
  native code change is needed at activation.
- Client registration: `src/components/native/native-push.tsx` (mounted in `providers.tsx`,
  native-only, registers after sign-in ONLY when the gate is on, POSTs the token, deep-links on tap).
- Endpoints: `POST /api/push/native-subscribe`, `POST /api/push/native-unsubscribe`.
- DB model: `NativePushToken` (in `prisma/schema.prisma`) — **table not created yet** (see step 4).
- Send library: `src/lib/native-push.ts` — FCM v1 (Android) + APNs token-auth (iOS), env-gated,
  prunes dead tokens. Fired automatically from `sendPushToProfile`, so every existing push
  (new message, availability reminder, …) fans out to native devices once configured.

---

## 1. iOS (needs the **paid** Apple Developer Program — a free personal team cannot do push)
1. Apple Developer → Certificates, Identifiers & Profiles → **Keys → +** → enable **Apple Push
   Notifications service (APNs)** → download the **`.p8`** key. Note the **Key ID** and your **Team ID**.
2. In Xcode (`ios/App/App.xcodeproj`) → target App → **Signing & Capabilities → + Capability →
   Push Notifications**. (This adds the `aps-environment` entitlement.)
3. Set env (Vercel + local):
   - `APNS_KEY_ID` = the 10-char Key ID
   - `APNS_TEAM_ID` = your Apple Team ID
   - `APNS_KEY` = the contents of the `.p8` (raw PEM, or base64)
   - `APNS_BUNDLE_ID` = the app bundle id (the production one you ship with; the dev build uses
     `com.mk1e3.enovn`)
   - `APNS_PRODUCTION` = `true` for TestFlight/App Store builds; leave unset/`false` for dev.

## 2. Android (needs a free **Firebase** project)
1. [Firebase console](https://console.firebase.google.com) → add project (can reuse `eno-vn`) → add an
   **Android app** with package `vn.eno.app` → download **`google-services.json`** → put it in
   `android/app/google-services.json`.
2. Apply the Google Services Gradle plugin (Capacitor's push docs): add
   `classpath 'com.google.gms:google-services:4.4.2'` to `android/build.gradle` and
   `apply plugin: 'com.google.gms.google-services'` at the bottom of `android/app/build.gradle`.
   *(Ask me — I'll make these two edits; I left them out so the build works without the json.)*
3. Firebase → Project settings → **Service accounts → Generate new private key** (JSON). Set env:
   - `FCM_PROJECT_ID` = the Firebase project id
   - `FCM_CREDENTIALS` = that service-account JSON (raw or base64)

## 3. Wire the plugin into the native builds
```
npx cap sync ios && npx cap sync android
```
(Adds `@capacitor/push-notifications` to both native projects. Only do this AFTER step 1/2, or the
Android build fails without `google-services.json`.)

## 4. Create the DB table
Run the schema-change flow (the `NativePushToken` model is already in `schema.prisma`):
```
# drop the profile_auth_fk over DIRECT_URL, then:
npx prisma db push
node scripts/profile-auth-fk.mjs
npx prisma generate
```
(Additive table — safe. See CLAUDE.md "Schema changes".)

## 5. Flip the gate, rebuild + test
Set **`NEXT_PUBLIC_NATIVE_PUSH=1`** (Cloud Run env + local `.env`) — this is the switch that lets
`native-push.tsx` prompt + register. Deploy the web (it loads live), then rebuild iOS + Android,
install, sign in → the app requests notification permission and registers. Trigger any notification
(e.g. send yourself a message) → it should arrive natively. Tapping it deep-links to the `url` in the
payload. ⚠️ Do NOT set the flag before the entitlement (step 1) exists, or you re-introduce the
"prompt for a dead capability" bug the gate was added to prevent.

---

**Env summary** (set in the Cloud Run env / GCP secret; historically Vercel):
`NEXT_PUBLIC_NATIVE_PUSH` (the client gate — `1` to enable prompt+register),
`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION`,
`FCM_PROJECT_ID`, `FCM_CREDENTIALS`.
`NEXT_PUBLIC_NATIVE_PUSH` unset → the app never prompts/registers (current state). The APNS/FCM set
gate the SEND side: missing all → send is a silent no-op; set the iOS set only → iOS works, Android
no-ops (and vice-versa).
