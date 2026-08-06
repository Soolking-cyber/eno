# eno — native iOS app (living plan)

Owner direction (2026-07-19): **"comprehensive native app rewrite … ios
native"**, UI mirroring the web app as closely as possible, Kyle + Murat in
parallel. Supersedes the WebView-shell ladder (docs/native-shell-phase2.md,
closed) as the app-likeness strategy; the Capacitor app stays the shipping app
until this one reaches parity.

## Architecture

- **Location**: `apps/ios/` — SwiftUI, iOS 17+, Swift 6.3 compiler (language
  mode 5 for now; strict-concurrency is a later deliberate pass). ZERO
  third-party dependencies so far — URLSession + Codable + AsyncImage.
- **Project is GENERATED**: `project.yml` → `xcodegen generate` →
  `Eno.xcodeproj` (gitignored). Sources are globbed, so new .swift files never
  touch a pbxproj — no merge conflicts between lanes. Never hand-edit the
  xcodeproj.
- **Signing**: bundle id `vn.eno.app` rides an EXISTING local team profile
  (headless xcodebuild cannot mint new profiles — "No Accounts"). Free-team
  profiles expire weekly; renew by opening the project in Xcode once.
  Display name "eno native"; coexists with the Capacitor app on the phone.
- **API**: `https://eno.vn/api/*` is the BFF — the same REST routes the web
  uses. Guest reads are plain GETs; auth is `Authorization: Bearer <supabase
  jwt>` (the Phase-2 M2 server path — already live). Native URLSession is NOT
  subject to CORS; requests go through Cloudflare so the edge-pin header is
  attached automatically. UA marker: `EnoNativeApp/1 ios-native`.
- **Images**: always `/_next/image?w=640|1080&q=60` (CF-edge cached), never
  raw Supabase originals.
- **Design**: `Core/DesignTokens.swift` mirrors docs/design-language.md
  (brand #0A66C2 / dark #3B8EE6, canvas/card/tint/sub/ring pairs, radius
  12/14). On iOS the web app renders -apple-system, so native SF typography
  matches the web exactly. Money/i18n mirror `vnd.ts` + `tr(en, vi)` via
  `Format.vnd` / `L10n.tr` — every user-facing string bilingual.
- **Hybrid escape hatch**: any surface not yet native embeds the REAL web page
  (`WebTabView` tab embed / `WebSheet` modal) — full product usable from day
  one, screens replaced one by one, zero divergence while we build.

## Lane protocol (mirrors COORDINATION.md rules)

- **Kyle**: `Eno/Core/*`, `Eno/App/*`, Feed, Listing (PDP), Search + the
  server-side endpoints the app needs. Shared files (Core, RootView,
  project.yml) are Kyle's — Murat requests changes via the board.
- **Murat**: `Eno/Features/Auth/*`, `Messages/*`, `Saved/*`, `Dashboard/*`,
  `Post/*` — native replacements for the WebTabView stubs in RootView (swap
  the tab's view when a surface lands; that one-line RootView edit is the
  handoff point, note it on the board). Auth design: Supabase REST (phone OTP
  + Google via ASWebAuthenticationSession), tokens in **Keychain** (not
  UserDefaults), set `APIClient.shared.accessToken` on launch/refresh.
- Both: build gate before commit =
  `cd apps/ios && xcodegen generate && xcodebuild -project Eno.xcodeproj
  -scheme Eno -destination 'generic/platform=iOS' build`.
  Install: `xcrun devicectl device install app --device 4A26AB54-… <app>`.

## Status

- 2026-07-20 (Kyle) v7–v9 (86a15293, 72aea9b6, 98d26006) — owner reassigned
  <!-- docs-lint-allow: historical note on July 2026 lane assignment, not a claim about today's limiter -->
Murat's lanes to Kyle (Murat on the Upstash work). **4/5 tabs native; the
  full buyer journey is native.** v7 #117 auth: enoAuth WKWebView bridge (web
  sign-in posts the session; guest tabs can't clobber it), Keychain storage,
  Supabase refresh, Bearer on every call, native Account tab. v8 #118
  messages: native inbox (AI pinned row, offer previews, unread, swipe-
  delete), thread (bubbles, day separators, offer cards with accept/decline/
  counter-gated-by-negotiable, clientId-idempotent optimistic sends, 12s
  poll), tab badge 9+, PDP → native thread. v9 Saved: device-local favorites
  (base+delta count rule honored), hearts on cards/PDP, native Saved grid
  with self-heal.
- 2026-07-20 (Kyle) native GOOGLE sign-in (fdb6c45a): ASWebAuthenticationSession
  (system Safari sheet Google allows) + native PKCE → authorize with
  redirect_to the ALREADY-ALLOW-LISTED https://eno.vn/auth/callback?native=2 →
  new server native=2 branch 302s the raw code to enonative:// (our scheme,
  vs Capacitor's enovn://) → exchange at /token?grant_type=pkce → adopt to
  Keychain. NO Supabase config change (only the allow-listed https callback is
  hit; the scheme hop is ours). "Continue with Google" on the Account hero;
  phone/email is the second option. REMAINING: realtime sockets, strict
  concurrency; native Google on the Messages/Saved guest heroes too (Account
  only for now); post-Google onboarding (accountType stays null until set).
- 2026-07-20 (Kyle) v3–v6 (14c429fc, ad0ca74c, 20d7b312, 268880c8): PDP v2
  (AVKit video page, share sheet, market gauge via priceBand on the GET,
  stats, condition chips, similar rail, zoomable fullscreen gallery, seller
  tap-through) · sort tabs + price filter on all result surfaces · search v2
  (recents + trending + ranked typeahead) · recently-viewed rail ·
  subcategory facet chips (/api/categories now carries TAXONOMY subs) ·
  header ✨ AI entry. **Guest browse journey is fully native.** Kyle's lane
  now pauses at the auth boundary — Saved/chat/dashboard wait on #117.
- 2026-07-20 (Kyle) v2 — web-parity home + embedded-tab fixes (1f69f1e5):
  home mirrors the web landing (icon category grid from the taxonomy table,
  For-you + Outstanding-businesses + per-category rails, latest grid); card v2
  = the web's exact badge rules (urgent > drop% > New-48h, goodPrice yields to
  drops, video/saved≥3 chips, trust mini-shield bands, business glyph) + ≈USD
  approximation via /api/fx. Embedded web tabs now send UA `EnoNativeTabs/1`:
  the web hides its bottom nav (double-bar fix) and the Google button (Google
  rejects OAuth in raw WKWebViews — owner hit "access blocked"; phone/email
  OTP work in place; the REAL fix is Murat's native-auth lane #117).
- 2026-07-19 (Kyle): scaffold SHIPPED and running on the owner's phone —
  project.yml/xcodegen, tokens, APIClient, models, home feed (2-col cards,
  chips, pull-to-refresh, infinite scroll, disk-cache SWR instant paint,
  offline state), native search (debounced /api/listings?q=), native PDP v1
  (gallery pager, price-first block, seller card, web-sheet contact CTA),
  WebTabView tabs for Saved/Post/Messages/Account. Server: added public
  `GET /api/listings/[id]` (visibility contract = verified+active, phone
  stays null). App icon + launch background reuse the brand assets.

## Backlog (ordered)

1. Auth + Keychain session (Murat — unblocks everything personalized)
2. Native Messages (inbox + thread; realtime later)
3. Saved (needs auth; POST /api/favorites exists)
4. PDP: save/share actions, video playback, market-price band, trust shelves
5. Post wizard (big; keep WebTabView until designed properly)
6. Filters/sort on feed + category landing parity
7. Push notifications (needs paid Apple program — owner)
8. Strict concurrency migration; snapshot tests
