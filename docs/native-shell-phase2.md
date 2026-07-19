# Native shell — Phase 2 (living plan)

Goal: move the native apps off production `server.url` (Capacitor documents it as
a live-reload facility) toward a locally packaged shell: instant cold start, real
offline behavior, updatable independently of app-store releases. Full design
rationale in docs/perf-phase1.md ("Phase 2" section).

## Milestones

- **M1 — instant local shell (BUILT, behind a flag).** `capacitor/www/index.html`
  is now a canon-styled skeleton (header, chips, 2-col shimmer feed) that boots
  from disk in ~100ms, hides the splash itself, checks connectivity (inline
  bilingual offline/retry state), resolves the cold-start deep link through a
  mirror of the deep-link contract (first-party hosts only, /auth blocked), and
  forwards to the live site. Toggle: `ENO_LOCAL_SHELL=1 npx cap copy ios` →
  local-first build; default remains the exact pre-Phase-2 remote mode.
  Owner A/B on the physical iPhone decides whether local-first becomes default.
  Known trade in M1: one extra navigation hop (local → remote) — the skeleton
  covers it; measured perception is the deciding metric.
- **M2 — auth tokens (SHIPPED 2026-07-20).** Server: every cookie-auth API also accepts Authorization: Bearer <supabase jwt> (same JWKS verification — additive, explicit token wins). Client: the native app mirrors its session (access+refresh) into Preferences key eno-session on every auth-state change, cleared on sign-out — M3 shell pages restore it via setSession. Original design: session storage moves from cookie-implicit to explicit
  secure storage (@capacitor/preferences) + Authorization header, behind a flag;
  Supabase client instantiated with native storage in the shell context. Web
  unchanged.
- **M3 — first native-shell surface (SHIPPED 2026-07-19).** The browse feed is
  now a LOCAL page: a `/` launch renders cards inside the shell (vanilla JS, no
  build step) from `GET /api/listings?limit=24` cross-origin, with SWR through
  shell-origin localStorage (`eno-feed-v1`) — cold launch paints the last feed
  instantly, revalidates in the background, and works fully offline from cache.
  Cards mirror ListingCard's essentials: `/_next/image` thumbnails (w=420 q=60,
  CF-edge cached), vi dot-thousand `đ` prices, urgent badge, price-drop
  strikethrough, titleVi by device language. Every deeper interaction hands off
  to the live site (card → /listings/[id], chips → /?category=…, search +
  see-more → home). Deep links for non-home launches still forward; /auth still
  blocked. Server side: `src/proxy.ts` reflects CORS for exactly the app origins
  (`capacitor://localhost`, `https://localhost`) — preflight 204 before the edge
  pin, headers on every /api return path, NO allow-credentials (Bearer only;
  cookies never cross origins). Hostile origins get no CORS headers.
- **M4 — post + chat surfaces.**
- **M5 — retire server.url;** live-update channel (signed bundles, staged
  rollout, last-known-good rollback) becomes the shipping path.

## Cross-cutting requirements (from the design note)

CORS/CSP for `capacitor://localhost`; deep-link rewrites stay canonicalAppPath-
compatible; App-Router reality = the shell is a client app on the public APIs
(no RSC); version-skew gate (API version header + minimum-shell check);
crash/vitals beacons per bundle version.

## Status log

- 2026-07-19 (M3): local feed shipped. Verified: CORS curl matrix (preflight
  204 + reflected origin + Vary, hostile origin bare, android origin ok);
  headless Chromium render against the LIVE API (20 cards, dot-thousand
  prices, optimizer images 200, zero console errors, cached repaint 35ms);
  full gates (tsc 0, design-lint clean, vitest 185, build ✓, guest e2e 53 ✓).
- 2026-07-20: M2 shipped (Bearer path + session mirror); offline query cache live (per-query Preferences persistence).
- 2026-07-19: M1 built (shell page + config toggle + iOS build); awaiting owner
  device verdict on making local-first the default.
