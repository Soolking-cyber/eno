# Perf Phase 1 — measured load-time improvements (2026-07-19)

Uncommitted working-tree changes; owner reviews before any commit/deploy.
Method: one repeatable harness (Playwright + CDP) — iPhone viewport 390×844 @3x,
Slow-4G (150ms RTT / 1.6Mbps down / 750Kbps up), 4× CPU throttle, cold profile,
`http://localhost:3100/` on the production standalone build, 12s post-load settle.
Harness: scratchpad `perf/measure.mjs` (+ `shift-rects.mjs` for CLS attribution,
`lcp-elem.mjs` for LCP identity). JS = first-party transfer over the full 12s
window (i.e. it still counts the deliberately-deferred idle chunks; the
critical-path win shows up in LCP, not this total).

## Before / after (identical conditions)

| Metric | Baseline | Final | Δ |
|---|---|---|---|
| Homepage HTML decoded | 876 KB | **351 KB** | −60% (target ≤400 ✓) |
| Homepage HTML gzip / br | 126 / 50 KB | **37 / 23 KB** | −71% / −54% |
| Inline-CSS duplication in HTML+RSC | ~3× ~184 KB | **none** | eliminated |
| FCP | 884 ms | 1264 ms | +380 ms (the now-cacheable CSS link round-trip — see trade-off) |
| LCP | 5388 ms | **1316 ms** | **−76%** (target −30% ✓, 2.5s desired ✓) |
| CLS | 0.1424 | **0.0023** | target <0.05 ✓; no single rail shift >0.02 ✓ |
| Requests (12s) | 90 | 59 | −34% |
| First-party JS transferred (12s) | 676 KB | 548 KB | −19% total; critical-path JS much lower (deferred chunks now load post-idle) |
| RSC route prefetches | 22 | **0** | ✓ |
| Cold-start API calls | 6 (fx, wards, recommendations, hasVideo, businesses, category-rails) | 3, all post-idle (fx, hasVideo, category-rails) + 1 background feed revalidation | wards/recommendations/businesses eliminated outright |
| Listing-image preloads | 1 (baseline's "4" was a harness mis-parse of one imageSrcSet link) | **1** | ✓ target ≤1 |
| Eagerly-loaded imgs | 5 | 2 (logo + LCP card) | |
| Warm nav (Slow-4G, cached) | n/a | 423 ms cross-page / 805 ms return-home | CSS cached across navs (was re-shipped in every HTML) |
| Native reveal | splash hide awaited splash+keyboard+app imports; 4s floor | hide fires on the splash module alone; floor 3s | keyboard/app/status-bar wiring now post-reveal |

FCP trade-off, explicitly: inlineCss removal costs ~+0.3–0.4s first-cold-paint on
Slow-4G but removes ~90 KB gzip from EVERY page HTML (the stylesheet was embedded
~3× via RSC), makes CSS cacheable across navigations, and leaves LCP unaffected.
Kept per the task's own decision criteria.

## What changed (by task section)

- **B — inlineCss**: `experimental.inlineCss: false` (A/B table above).
- **C — cold-start fan-out**:
  - `prefetch={false}`: all 5 bottom-nav tabs (incl. the self-`/` and auth-gated
    dashboard/messages/post/saved), header logo self-link, header `/signin`,
    header Post menu, cookie-consent `/privacy` link. 22 RSC prefetches → 0.
  - Wards: `area-filter.tsx` ward fetch now gated on the popover being `open`
    (a persisted province made every cold load fetch that province's wards).
  - FX: VND users (the default) defer `/api/fx` to requestIdleCallback; non-VND
    users still fetch immediately (they need rates for first price paint).
  - hasVideo probe: behind an idle flag (`enabled:` on the query).
  - Listings revalidation: measured — the seeded feed does NOT revalidate before
    LCP; one background refresh lands post-idle (kept, per stale-while-revalidate).
- **D — rail CLS (the 0.142)**: root cause was `/api/recommendations` returning
  `[]` for signal-less guests (deliberate thin-catalog guard) → ForYouRail's SSR'd
  skeletons collapsed at hydration. Fixed with SERVER-KNOWN availability:
  - `src/lib/core/trending-rail.ts` + `business-rail.ts` — the rails' data
    fetched in the home page's existing parallel server query, threaded as
    `initialTrending` / `initialBusinesses`. Empty ⇒ the rail never renders;
    non-empty ⇒ final geometry at first paint. ForYouRail personalizes CONTENT
    in place afterwards and never collapses once rendered.
  - `ListingCardSkeleton` rebuilt to structural parity with the real card (was
    ~40px short — every fill grew the rail).
  - CategoryRails: near-viewport + idle-armed mount (was injecting sections and
    fetching immediately after hydration).
- **E — image priority**: `priority={index < 4}` → `index === 0` at both explorer
  call sites (the measured LCP element IS the first card image; its single
  imageSrcSet preload is the one justified listing preload). Logo preloads: the
  wordmark stays (home LCP candidate); the `logo-mark.svg` head preload's emitter
  was not found in src (framework-hoisted) — unresolved-minor, ~1 KB SVG.
- **F — root bundle**: real module splits (dynamic, ssr:false):
  `account-panel-body.tsx` (the 300-line panel + nav-resolver + dashboard cache
  hook now load on first open / signed-in mount only); `CardVideo` + `Slider` out
  of the default listing-card path; header's `AreaFilter` (gated behind first
  open) + `SearchSuggest` out of the header chunk. Removed the global Supabase
  preconnect (measured: nothing hits the origin directly pre-LCP — images proxy
  through same-origin `/_next/image`; videos/realtime are post-LCP/authed).
  Vercel Analytics/Speed Insights were already fully removed in the GCP
  migration; GA stays consent-gated as before.
- **G — native reveal**: `SplashScreen.hide()` no longer waits for the
  keyboard/app plugin imports (single-import reveal path); keyboard bridge,
  back-button, deep-link listeners and status-bar theming all wire after reveal;
  `launchShowDuration` 4000→3000 (watchdog + offline error page behavior
  unchanged); `npx cap copy ios` regenerated only the embedded config JSON.
  On-device timing not re-measured (owner rule: no simulator; device screenshots
  on request) — estimated reveal gain = the removed keyboard+app import wait.
- **H — public API caching**: added CDN-tier headers (`s-maxage` +
  `stale-while-revalidate`) to `/api/fx` (success path only — failures stay
  uncached), `/api/category-rails`, `/api/businesses/top`, `/api/brands`.
  Already correct: `/api/geo` (86400), `/api/listings` (s-maxage=60/120).
  Personalized/authed routes (`/api/recommendations` etc.) remain `private`.

### Cloudflare notes (documentation only — NOT changed in production)
- CF does not cache `/api/*` by default (no extension). If desired, add an
  ALLOWLIST cache rule for exactly: `/api/geo*`, `/api/fx`, `/api/category-rails`,
  `/api/businesses/top`, `/api/brands*`, `/api/listings*` — "respect origin
  headers", cache key MUST include the full query string (CF default). Never add
  a blanket "Cache Everything".
- Cloudflare Speed Brain / speculation rules can duplicate App-Router prefetching;
  with our prefetches now off, run a production A/B (Speed Brain on vs off,
  comparing RSC request volume + LCP) before enabling.

## Validation

- `npm run lint` — exit 0, zero errors (also fixed a pre-existing gap: the new
  `cache-handler.cjs` and Playwright report artifacts were being linted; added to
  ignores).
- `npm test` (vitest) — 185/185.
- `npm run build` — clean.
- Guest e2e (desktop+mobile, `E2E_BASE=http://localhost:3100`) — **53 passed, 1 known-conditional skip**.
- `npx next experimental-analyze --output` — ran; results in `.next/diagnostics/analyze`.
- `npx cap copy ios` — only the generated `capacitor.config.json` changed;
  the owner's local pbxproj/Package.resolved churn untouched.
- Android `./gradlew assembleDebug` — **BUILD SUCCESSFUL** (5s, 384 tasks).
- iOS device build (generic/platform=iOS, owner's local signing preserved) —
  **BUILD SUCCEEDED**, embedded capacitor.config.json carries the new 3s splash
  floor. Testing on the owner's physical iPhone (no simulator, per owner rule);
  install pending the device reconnecting.

## Risks / unresolved

- FCP regression (+0.3–0.4s cold Slow-4G) accepted for the HTML/caching win — an
  earlier owner optimization memo favored inlineCss; this measurement supersedes
  it but the owner should sign off consciously.
- `logo-mark.svg` head preload origin untraced (framework-hoisted; ~1 KB).
- Deferred FX/video-probe/category-rails now land seconds later; any UI reading
  them (currency switcher first-open, ▷ video tab, category sections) appears
  slightly later on slow devices. Deliberate.
- Cards 2-4 now lazy-load; on very fast scrolls their images start a beat later.
- Native reveal timing is estimated, not device-measured.

## Phase 2 — native shell architecture note (design only, nothing implemented)

Goal: move off production `server.url` (Capacitor documents it as a live-reload
facility) toward a locally packaged shell with instant cold start and real
offline behavior.

1. **Local startup + offline/error UI**: package a minimal local bundle (splash,
   offline page, app skeleton) as `webDir`; drop `server.url`. First paint is
   local and instant; content hydrates from the network.
2. **API/BFF boundary**: the shell talks to `https://eno.vn/api/*` as a plain
   HTTPS API origin. Keep the existing REST routes as the BFF; no new server.
3. **Auth**: move the WebView session from cookie-implicit to explicit token
   handling via `@capacitor/preferences` (secure storage) + an Authorization
   header on fetches; keep cookie auth for web. Supabase's JS client already
   supports custom storage — the shell instantiates it with native storage.
4. **CORS/CSP**: API must allow the `capacitor://localhost` /
   `https://localhost` app origins (explicit allowlist, credentials via header
   not cookie); CSP for the local bundle mirrors the web CSP minus web-only
   origins.
5. **Deep links**: unchanged mechanism (canonicalAppPath), but targets rewrite
   to local routes; universal links still land in the shell.
6. **App Router compatibility**: the local shell cannot run RSC — it becomes a
   true client app. Pragmatic path: a small Vite/React (or static-exported
   subset) shell for the core browse/post/chat flows that consumes the same
   APIs, NOT a full Next static export (128 API routes + SSR make `output:
   'export'` a non-starter).
7. **Asset/version updates + rollback**: adopt a Capacitor live-update channel
   (self-hosted zip + signature verification, staged rollout %; keep last-known-
   good bundle for instant rollback). Native binary updates only for plugin
   changes.
8. **Milestones**: (a) local splash+offline shell with server.url still primary;
   (b) auth token migration behind a flag; (c) browse feed native-shell page
   consuming APIs; (d) post/chat; (e) remove server.url.
9. **Observability/risks**: version skew (shell vs API — add an API version
   header + minimum-shell gate), Sentry-style crash + web-vitals beacons per
   bundle version, staged rollout with the update channel.

## Worktree preservation

Confirmed: no reset/revert/clean was run; `apps/forum/**` untouched; the owner's
`ios/App/App.xcodeproj/*` local churn preserved; the previously-deleted
`tailwind.config.ts` was NOT restored and the (already-committed-as-removed)
`undefined/` directory was NOT recreated. All Phase-1 edits are uncommitted in
the working tree for review.
