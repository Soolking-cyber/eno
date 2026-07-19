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

## Status (v6, 2026-07-20 — Murat)

Native **Messages** tab (port of apps/ios InboxView + ThreadView): guest hero →
web /signin in the origin-scoped WebTab (bridge flips `Auth.isSignedIn` live);
inbox with eno-AI pinned row, counterpart avatar, offer-aware preview line,
unread rail + count, long-press delete; thread with chronological bubbles, day
separators, first-contact safety note, offer CARDS (Accept/Decline for the
recipient, Counter gated by `listing.negotiable` — the landmine), optimistic
sends with clientId idempotency + the poll-vs-send merge (no blink, no dup id)
+ tap-to-retry, and a 12s poll backstop. Both CONFIRMED iOS review bugs avoided
from the start: a network-failed counter shows tap-to-retry (never a live
pending offer), and offer accept/decline only reloads on a real 2xx and
surfaces every other outcome. Inbox↔thread nav is internal to `MessagesScreen`
(no NavHost change). New package `messages/` (ChatModels/Messages/Thread); POST
helpers live there so Core.kt/Auth.kt (Kyle's) stay untouched. assembleDebug
green; not device-tested. FOLLOW-UPS: unread tab badge (needs EnoApp wiring),
"Message seller" on the PDP → open the native thread (find-or-create POST
/api/conversations, currently contact→browser in Detail.kt).

## Backlog (mirror the iOS ladder)

1. ~~Auth~~ DONE (v5, Kyle): origin-scoped WebMessageListener bridge +
   EncryptedSharedPreferences + sessionGen refresh guard + Bearer.
2. ~~Native Messages~~ DONE (v6, Murat).
3. Native Post wizard (upload multipart + facets from /api/categories)
2. Native Messages (inbox/thread/offers) — port from iOS ThreadModel semantics
   (clientId idempotency, poll backstop, offer state machine)
3. Native Post wizard (upload multipart + facets from /api/categories)
4. Notifications, My Listings management, subcategory chips, price filter
5. Recently-viewed rail, typeahead suggest, gallery zoom
6. Device testing (no Android hardware known — emulator or owner's device TBD)
