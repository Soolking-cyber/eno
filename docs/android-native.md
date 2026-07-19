# eno — native Android app (living plan)

Owner (2026-07-20 overnight): "next do same for android". Sibling of the iOS
rewrite (docs/ios-native.md) — same APIs, same tokens, Jetpack Compose.

## Architecture

- `apps/android/` — Kotlin 2.2, AGP 9.3 (built-in Kotlin — do NOT add the
  kotlin.android plugin, AGP 9 forbids it), Compose BOM 2025.06, minSdk 26.
  applicationId `vn.eno.native` (coexists with the Capacitor `vn.eno.app`).
  Deps: okhttp + kotlinx-serialization + coil. Build: `./gradlew assembleDebug`
  (local.properties carries sdk.dir, gitignored).
- Same BFF (https://eno.vn/api/*), UA `EnoNativeApp/1 android-native`; WebView
  tabs append `EnoNativeTabs/1` → eno.vn hides its bottom nav + Google button
  (the same contract iOS uses).
- Tokens mirror docs/design-language.md via Material3 color schemes.

## Status (v1–v4, 2026-07-20 overnight — Kyle)

Native: feed (rails: Outstanding businesses + category rails on the unfiltered
landing; category chips; 5 sort tabs; offset paging), card badges (urgent >
drop% > New-48h, saved≥3 chip, trust shield bands, ≈USD via /api/fx), search
(debounced ranked results), PDP (pager/price/description/seller/contact→
browser), favorites hearts + native Saved tab (device-local ids, self-heal).
WebView tabs: Post, Messages, Account.

## Backlog (mirror the iOS ladder)

1. Auth: WebView enoAuth-equivalent bridge (addJavascriptInterface or
   onMessage) + EncryptedSharedPreferences/Keystore session + Bearer
2. Native Messages (inbox/thread/offers) — port from iOS ThreadModel semantics
   (clientId idempotency, poll backstop, offer state machine)
3. Native Post wizard (upload multipart + facets from /api/categories)
4. Notifications, My Listings management, subcategory chips, price filter
5. Recently-viewed rail, typeahead suggest, gallery zoom
6. Device testing (no Android hardware known — emulator or owner's device TBD)
