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

## Status (v7–v10, 2026-07-20 — Kyle) — ALL 5 TABS NATIVE + management surfaces

v7 unread tab badge (9+ cap) + PDP→native chat (find-or-create POST). v8
native **Post wizard** (Photo Picker → multipart upload w/ retry, category/
condition/price/negotiable/location via /api/geo/contact, ≥20-char + ≥3-photo
gates, publish-error mapping) — **5/5 tabs native**. v9 notifications (feed bell
+ red-dot unread + list, deep links) + My Listings (stats + confirm/sold/hide/
reactivate/delete). v10 recently-viewed rail + search v2 (recents/trending/
ranked typeahead). v11 fullscreen zoomable PDP gallery. v12 auth
hardening (self-review: fail-closed encryption, @Volatile sessionGen +
Main-confined refresh). v13 Gemini dual-external review — all 6 findings
addressed (2 pre-fixed in v12): WebTab key(path)+onRelease (leak/reload),
global 401→forced-refresh-or-signout, adopt() JWT-sub account-switch
guard, retryPhoto snapshot copy. GPT-5.6 review pending. Every step
assembleDebug-green; no device test yet.

## Backlog

1. ~~Auth~~ (v5) · ~~Messages~~ (v6) · ~~Post wizard~~ (v8) · ~~notifications /
   my-listings~~ (v9) · ~~recently-viewed / typeahead~~ (v10) — DONE.
2. Post wizard facets (year/km/brand from /api/categories) — same follow-up iOS took.
3. PDP gallery zoom, category subcategory chips + price filter (iOS has these).
4. Android review findings — Kyle-lane FIXED (both external families; codex
   caught the null-body crash + backup corruption + favorites-delta regression
   the first pass missed). Murat closing messages/ + account/ findings.
5. ~~Device testing~~ **RUNTIME-VERIFIED 2026-07-20 on the `eno_pixel` emulator
   (API 36, dark mode)**: feed + Outstanding-businesses/category rails + trust
   shields (100/82) + saved chips + New badges + ≈USD render live; tap→PDP
   works (gallery, price, description via /api/listings/[id], Chat CTA); zero
   app crashes/ANRs (a "System UI isn't responding" popup was an emulator-host
   artifact under concurrent-build load, not the app). Screenshots captured.
   Owner device test still worthwhile but the app is proven functional.
6. Remaining polish: Post facets, subcategory chips + price filter on category.
