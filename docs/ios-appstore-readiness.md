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

## Sequence
Wave 1 (GO, ship first): #1, #7, #13 → build → review → push.
Wave 2: #8, #10, #6a+#6b(notif), #2m → build → push.
Wave 3: #11 tests, #12k a11y, #9k image pipeline.
Wave 4 (after owner provisions): #3 router, #4 push client, #2 identity finalize.
Capacitor: #92 (+#90) alongside.
