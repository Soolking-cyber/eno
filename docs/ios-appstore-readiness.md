# iOS native app — App Store readiness plan (2026-07-20)

Owner ran a 13-item App Store audit of the SwiftUI app (`apps/ios`). This is the
verified, lane-split execution plan. Verification pass: 6 read-only agents cross-
checked every claim against current code (workflow `ios-appstore-readiness-plan`).

**Three live sessions share this worktree** — Kyle-NATIVE (this plan), Kyle-SERVER
(server §5 + **#131 native quick-edit** = native EDIT files), Murat (Auth/Post/
Messages). Stage explicitly, `git add -A` BANNED. Do NOT touch `EditListingView.swift`
or native listing-edit files — that is Kyle-SERVER's live claim.

## Audit corrections (things the audit slightly over-stated)
- **#5 account deletion is ALREADY reachable** in-app (Settings row → `WebSheet("/dashboard/settings")` → `<DeleteAccount/>` → `/api/account/delete`). Guideline 5.1.1(v) is satisfied; only **Sign in with Apple** is missing.
- **#6 APIClient DOES refresh tokens** (`ensureFreshToken` in `run()`). The real gap is that it throws away the error body; PostModel bypasses it with `URLSession.shared` (lines 354-365) only to recover `contact_in_text`/`banned_words`/`photos_min` codes.
- **#7 reload() already has a `reloadGen` latest-wins token.** Only `loadMoreIfNeeded` (line 108) lacks the guard, so a stale page can append.
- **#3 AASA route + rewrite already exist and are correct** — the route returns 404 *by design* until `APPLE_TEAM_ID` env is set. No server code change; just env.

## ✅ OWNER DECISIONS (2026-07-20)
- **Bundle ID: a NEW dedicated App ID** for the native app (not `vn.eno.app`, not the Capacitor `com.mk1e3.enovn`). Proposed: **`vn.eno.ios`** (consistent with the `vn.eno.*` family + Android `vn.eno.native`) — owner to confirm the exact string when registering.
- **Display name: `eno.vn`** (done — Info.plist + project.yml).
- **Enable all three Apple capabilities** (Associated Domains + Push/APNs + Sign in with Apple) — native code built dormant now, live once the portal + env land.

### 🔧 OWNER PORTAL CHECKLIST (do these in the Apple Developer portal / Xcode)
1. **Register the new App ID `vn.eno.ios`** (or your chosen string) under team `S4VCY6N8QR`, with capabilities: **Associated Domains, Push Notifications, Sign in with Apple**.
2. **Create an APNs Auth Key (.p8)** — note the Key ID. (One key covers all your apps.)
3. **Generate a provisioning profile** for `vn.eno.ios` (open `Eno.xcodeproj` in Xcode once with Automatic signing, or create manually).
4. **Sign in with Apple**: create an Apple **Services ID** + key, and configure the **Apple provider in Supabase Auth** (client id = Services ID, team id, key id, .p8).
5. Tell me the confirmed bundle-ID string → I flip `PRODUCT_BUNDLE_IDENTIFIER`, add the entitlements, and set env: `APPLE_TEAM_ID=S4VCY6N8QR`, `APNS_KEY_ID/APNS_TEAM_ID/APNS_KEY/APNS_BUNDLE_ID=<new id>/APNS_PRODUCTION`.
6. **DB**: create the `NativePushToken` table (`prisma db push` flow) for #4.

Until #1–#3 land I keep signing on `vn.eno.app` so headless device builds/installs keep working (a new ID can't be provisioned headlessly). Entitlement-dependent code (#3 router, #4 push, #5 Apple button) is written but its entitlement is NOT wired into the signed build until the profile supports the capabilities.

## OWNER-BLOCKED — needs your decision / Apple Developer portal (gates #2/#3/#4/#5)
1. **Bundle-ID strategy + store display name (#2).** Three IDs today: native `vn.eno.app`, Capacitor source `vn.eno.app`, Capacitor Xcode target `com.mk1e3.enovn`. Decide the ONE production ID + real public name ("eno native" is a coexistence dev placeholder). This ID drives APNs topic, OAuth callback, Keychain service, AASA app-id.
2. **Associated Domains capability (#3)** on the shipping App ID + set prod env `APPLE_TEAM_ID=S4VCY6N8QR` → AASA serves 200, Universal Links work.
3. **Push: APNs Auth Key (.p8) + Push capability (#4)** on the App ID; set `APNS_KEY_ID/APNS_TEAM_ID/APNS_KEY/APNS_BUNDLE_ID/APNS_PRODUCTION` env; create the `NativePushToken` DB table (`prisma db push` flow). Server (`native-push.ts` + `/api/push/native-subscribe`) is already built and dormant.
4. **Sign in with Apple (#5)** — enable the capability + Apple Services ID + signing key, and configure the Apple provider in Supabase Auth. (Required by Guideline 4.8 because Google login is present.)

Native code for #3/#4/#5 can be written now and sits dormant until the portal capabilities + env land — same pattern as the already-dormant server push.

## Kyle-NATIVE lane — GO now (no owner input, no collision)
| # | Item | Effort | Files |
|---|---|---|---|
| 1 | **PrivacyInfo.xcprivacy** — 1 required-reason (`NSPrivacyAccessedAPICategoryUserDefaults` CA92.1) + data types (Email, Phone, Photos, OtherUserContent=messages, UserID; Linked, no Tracking). Base on `ios/App/App/PrivacyInfo.xcprivacy`, drop CoarseLocation. | S | `apps/ios/Eno/PrivacyInfo.xcprivacy`, `project.yml` |
| 7 | **Feed pagination race** — gen-guard `loadMoreIfNeeded` (capture `reloadGen`, `guard gen==reloadGen` before append/offset); route filter didSets through one retained/cancelled `reloadTask`. | S | `FeedModel.swift` |
| 13 | **Concurrency** — `nonisolated static let cacheURL`; `nonisolated(unsafe) static let` formatters; drop dead Vision `as?` casts in OnDeviceAI. | S | `FeedModel.swift`, `Formatters.swift`, `OnDeviceAI.swift`† |
| 8 | **Home startup fan-out** — delete duplicate `loadRecentlyViewed()` (FeedView:69); defer FX off the critical path; cache-first paint; viewport-trigger rails. | M | `HomeModel.swift`, `FeedView.swift` |
| 10 | **WebViews** — replace KVC `value(forKey:"userAgent")` with `applicationNameForUserAgent`; add a `WKNavigationDelegate` (first-party in-webview, external→system browser, block custom schemes, handle process-terminate + load-fail retry). **Preserve Murat's enoAuth guard.** | M | `WebViews.swift` |
| 6a | **APIClient error-body primitive** (Core part) — a call that surfaces `(Data,status)` / typed `APIErrorBody` through `run()` so refresh/UA/cache-policy still apply. Add request timeout. (Murat rewires PostModel:354 onto it — see below.) | M | `APIClient.swift` |
| 6b | **Notification delete rollback** (Notifications is my lane) — reconcile `NotifModel.delete/clearAll` on failure. | S | `NotificationsView.swift` |
| 2m | **Version → build settings** (mechanical part of #2) — `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` in project.yml, Info.plist → `$(…)`. Display name waits on owner. | S | `project.yml`, `Info.plist` |
| 11 | **Test target** — `EnoTests` (Swift Testing) covering Fx/Formatters/FavoritesStore-delta/RecentStore-cap/ImageURL/Categories/APIClient-decode. NOT edit files. | M | `project.yml`, `EnoTests/` |
| 12k | **Accessibility (my subset)** — labels for heart/bell/gallery-dismiss/share/report-ellipsis/MyListings-ellipsis; Dynamic Type in Feed/Listing/MyListings/Notifications/GalleryViewer. | L | Feed/Listing/MyListings/Notifications/GalleryViewer |
| 9k | **Shared image pipeline** (Core part) — ImageIO downsample-to-point-size + coalesce/cancel/cache; swap the 7 bare `AsyncImage` sites. | L | new `Core/ImagePipeline.swift` + 7 call sites |

† OnDeviceAI lives under Features/Post (Murat's coordination lane) — trivial 1-liner, coordinate lightly.

## Native code, dormant until owner provisions (write now)
- **#3 router + entitlements** — `Eno.entitlements` (`associated-domains = applinks:eno.vn`), `.onOpenURL`/`.onContinueUserActivity` in EnoApp/RootView → central router (`/listings/*`, `/c/*`, `/brands/*` → native PDP/Feed), cold+warm start.
- **#4 push client** — `aps-environment` entitlement, `UIApplicationDelegateAdaptor` + `UNUserNotificationCenterDelegate`: request auth after sign-in, `registerForRemoteNotifications`, upload hex token to `/api/push/native-subscribe`, tap-routing reuses `NotificationsView.open()`.

## Murat lane (Auth / Post / Messages) — hand-off recipes
- **#5 Sign in with Apple** — `ASAuthorizationAppleIDButton` + controller in `AccountView.signInHero` mirroring Google → `supabase signInWithIdToken(apple)` → `AuthModel.adopt`. (Kyle-native adds the entitlement; owner enables the capability + Supabase provider.)
- **#6b PostModel rewire** — replace the `URLSession.shared` bypass (PostModel:354-365) with the new APIClient error-body primitive.
- **#9 Post image path** — off-main ImageIO downsample+encode, store thumbnail + compressed Data (not 2000px UIImage), bounded(2) parallel uploads.
- **#6b conversation delete rollback** (`InboxModel.delete`); **#12** AI ✨ / camera / send / xmark labels + Dynamic Type in Post/Messages/Account/Saved.

## Kyle-SERVER lane
- **#3 AASA** — no code change; owner sets `APPLE_TEAM_ID` env. Optionally widen the AASA `components` list.

## Capacitor legacy (kyle-native) — small correctness wins
- **#92** implement `webContentProcessDidTerminate` → reload (blank-on-memory-pressure is a real failure). **GO.**
- **#90** delete the private `WKContentView` runtime-subclass hack (App-Review surface, "app mirrors web" direction). **GO, low urgency.**
- **#91 / #93** — recommend **DEFER** (owner just settled local-shell; refresh-timer is inherently approximate under Next's `router.refresh()`).

## #9 feed image pipeline — ATTEMPTED, REVERTED (2026-07-20)
Built an ImageIO downsampling pipeline (`RemoteImage` + decoded NSCache + request
coalescing) and swapped the feed card. **Reverted**, for two reasons found while
verifying:
1. **The optimizer always serves AVIF** (`/_next/image` → `image/avif`, ~25KB;
   Cloudflare-cached so `Accept` can't force webp/jpeg). **iOS simulators cannot
   decode AVIF** — a known gap — so the feed is blank in the simulator with EITHER
   AsyncImage or a custom pipeline. It renders on-device (device ImageIO decodes
   AVIF). Net: a custom image path **can't be visually verified in the simulator**.
2. The win is marginal here — the fetched AVIF is already ~640px/25KB, so decoded-
   bitmap downsampling saves little; AsyncImage + URLCache already handles it fine
   on-device.
Shipping an unverifiable image path to the owner's daily-driver phone for a marginal
gain isn't worth it. **AsyncImage kept.** The REAL #9 memory win is the **POST image
path (Murat's lane)** — 8×2000px full-res UIImages on the main actor (>100MB), which
is a genuine problem worth the off-main downsample + bounded uploads. If feed scroll
CPU ever becomes an issue, revisit the pipeline with **on-device** visual verification.

## 🚀 PORTAL RUNBOOK (native code is READY — 2026-07-20)
The native halves of #3 (router + entitlements) and #4 (push client) are committed
and dormant (`3ead98ae`). Everything below is the owner's portal/env work; when it's
done I do ONE finishing commit (flip bundle id, wire entitlements, `PushManager.enabled=true`,
set `APPLE_BUNDLE_ID`).

**Decide the bundle id first.** Recommended: **`vn.eno.ios`** (confirm or give another).
Everything below uses `<BUNDLE>` = that id and team `S4VCY6N8QR`.

### A. App ID + capabilities — easiest via Xcode (it auto-registers)
1. Tell me the confirmed `<BUNDLE>`. I flip `PRODUCT_BUNDLE_IDENTIFIER` + wire
   `CODE_SIGN_ENTITLEMENTS` and push. (Until then device builds stay on vn.eno.app.)
2. Open `apps/ios/Eno.xcodeproj` in **Xcode**, sign in with your Apple ID, select the
   Eno target → Signing & Capabilities → "Automatically manage signing", team =
   your team. Because `Eno.entitlements` already declares them, Xcode **registers the
   App ID and enables Associated Domains + Push Notifications + Sign in with Apple**
   and makes the profile. (One-time; headless builds then work again.)

### B. APNs Auth Key (Xcode can't make this) — https://developer.apple.com/account → Keys
3. Keys → **+** → enable **Apple Push Notifications service (APNs)** → Continue →
   Register → **download the `.p8`** (you can only download once) and note the **Key ID**.

### C. Sign in with Apple service (for Supabase) — Certificates, IDs & Profiles
4. Identifiers → **+** → **Services IDs** → register one (e.g. `vn.eno.signin`); enable
   **Sign in with Apple**, configure it with your domain `eno.vn` + return URL
   `https://<project>.supabase.co/auth/v1/callback`.
5. Keys → **+** → enable **Sign in with Apple** → download that `.p8` + Key ID.
6. In **Supabase → Auth → Providers → Apple**: enable it; Client ID = the Services ID,
   Team ID = `S4VCY6N8QR`, Key ID + the Sign-in `.p8` from step 5.

### D. Env + DB (I can help wire once you have the values)
7. Prod env (Cloud Run secret): `APPLE_TEAM_ID=S4VCY6N8QR`, `APPLE_BUNDLE_ID=<BUNDLE>`,
   `APNS_KEY_ID=<from step 3>`, `APNS_TEAM_ID=S4VCY6N8QR`, `APNS_KEY=<the p8 contents,
   base64 — sh-safe per the GCP rule>`, `APNS_BUNDLE_ID=<BUNDLE>`, `APNS_PRODUCTION=true`.
   → the AASA endpoint starts serving 200 and push can send.
8. Create the `NativePushToken` table (it's in `prisma/schema.prisma` already) via the
   schema-push flow (drop FK → `prisma db push` → re-add FK). (server lane — Murat/me.)

### E. I finish (one commit)
9. Flip `PRODUCT_BUNDLE_IDENTIFIER` → `<BUNDLE>`, wire `CODE_SIGN_ENTITLEMENTS`,
   `PushManager.enabled = true`; rebuild + install. Deep links (share a listing / tap a
   push) open the native PDP; push permission is requested after sign-in; tokens upload.

**Verify:** `curl https://eno.vn/.well-known/apple-app-site-association` → 200 with
`S4VCY6N8QR.<BUNDLE>`; tap a `https://eno.vn/listings/<id>` link → opens the app on the PDP;
sign in → allow notifications → a test push (cron/admin) deep-links correctly.

## Sequence
Wave 1 (GO, ship first): #1, #7, #13 → build → review → push.
Wave 2: #8, #10, #6a+#6b(notif), #2m → build → push.
Wave 3: #11 tests, #12k a11y, #9k image pipeline.
Wave 4 (after owner provisions): #3 router, #4 push client, #2 identity finalize.
Capacitor: #92 (+#90) alongside.

## ⚠️ AVIF / simulator rendering (consistency sweep 2026-07-20) — DO NOT re-chase
eno.vn's `/_next/image` optimizer serves **AVIF** (Cloudflare-cached; the `Accept`
header can't override it). Findings from a device-matrix sweep:
- **Real devices (incl. iOS 26) + iOS 18.x simulators decode AVIF → photos render.**
- **The iOS 26.x SIMULATOR cannot decode AVIF → blank gray image boxes.** This is the
  "completely different on the emulator vs my phone" the owner saw — a SIMULATOR
  limitation, NOT an app bug. Preview on a device or an iOS 18.x sim.
- Attempts to work around it in-app FAILED and were reverted: a custom
  URLSession+ImageIO pipeline regressed even the working path; a nested-AsyncImage
  webp fallback can't trigger because AsyncImage does not surface an AVIF decode
  failure (`phase.error` stays nil — it fetched fine, the decode just silently
  yields nothing). **Kept the plain AsyncImage (proven on device + 18.x).**
- **Cross-device CONSISTENCY verified**: identical structure + clean layout on
  iPhone SE (375pt, iOS 18.4, home button) and iPhone 16 Pro Max (440pt, iOS 26.5,
  Dynamic Island) — header, category row, rails, cards, bottom nav all adapt; safe
  areas handled; Dynamic Type scales. No breakage old↔new / small↔large.
- Web-etalon: native PDP matches the web PDP structure; the native HOME uses native
  patterns (inline search + category tabs + rails) vs the web mobile home (search
  card + POPULAR chips + big category icons + businesses-first) — a deliberate native
  adaptation, restructure only on explicit request.
