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
- **M3 — local feed surface (SHIPPED then ROLLED BACK 2026-07-19, owner
  verdict).** The browse feed ran as a local vanilla-JS page in the shell
  (SWR via localStorage, /_next/image thumbs, handoff taps). It worked, but
  the owner rejected the direction on sight of the device build: **"we need
  native app same as web app as close as possible"** — a re-implemented
  surface inevitably diverges (no bottom nav, no dark header, simplified
  cards) and creates a second UI to maintain. The shell reverted to the M1
  forwarding behavior. **Standing direction: local pages must never
  re-implement app surfaces; the shell is a launch cover + offline state
  ONLY, and the app IS the web app.** What SURVIVES from M3 (server-side,
  additive, invisible): `src/proxy.ts` CORS for exactly the app origins
  (`capacitor://localhost`, `https://localhost`) — preflight 204 before the
  edge pin, NO allow-credentials — plus the M2 Bearer path. Both stay for any
  future native fetch needs. The M3 feed page itself lives in git history
  (4fd72881) if ever needed as reference.
- ~~**M4 — post + chat surfaces.**~~ ~~**M5 — retire server.url; live-update
  channel.**~~ **CANCELLED by the M3 verdict** — local re-implementations are
  off the table. The ladder's remaining goal (app-likeness) is pursued the
  other way around: the REAL web app served remotely, made to feel native
  (instant boot cover, offline state, native chrome/haptics/theme sync — all
  already shipped). Revisit only if the owner asks for true offline surfaces
  again, and then via rendering the actual app bundle, never a parallel UI.

## Cross-cutting requirements (from the design note)

CORS/CSP for `capacitor://localhost`; deep-link rewrites stay canonicalAppPath-
compatible; App-Router reality = the shell is a client app on the public APIs
(no RSC); version-skew gate (API version header + minimum-shell check);
crash/vitals beacons per bundle version.

## Status log

- 2026-07-19 (M3 rollback): owner saw the local feed on device and set the
  standing direction — native app mirrors the web app, no parallel local
  surfaces. Shell reverted to M1 forwarding; CORS + Bearer kept; M4/M5
  cancelled.
- 2026-07-19 (M3): local feed shipped. Verified: CORS curl matrix (preflight
  204 + reflected origin + Vary, hostile origin bare, android origin ok);
  headless Chromium render against the LIVE API (20 cards, dot-thousand
  prices, optimizer images 200, zero console errors, cached repaint 35ms);
  full gates (tsc 0, design-lint clean, vitest 185, build ✓, guest e2e 53 ✓).
- 2026-07-20: M2 shipped (Bearer path + session mirror); offline query cache live (per-query Preferences persistence).
- 2026-07-19: M1 built (shell page + config toggle + iOS build); awaiting owner
  device verdict on making local-first the default.
