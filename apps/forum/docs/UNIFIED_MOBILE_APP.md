# Unified eno mobile app contract

## Architecture

Ship one App Store / Play Store application. The native project remains at the
monorepo root and starts at `https://eno.vn`. Marketplace pages stay on
`eno.vn`; community, itinerary, and visa pages stay on `eno.forum`. Browser URLs
and independent Vercel deployments do not change.

The native WebView may navigate between both first-party origins. Each origin
continues to own its Next.js routing, API routes, CSP, cookies, errors, and
deployment. `apps/forum` is the forum deployment root; do not add a second
Capacitor project here.

## Forum-side readiness implemented here

- The same `eno-theme` System / Light / Dark preference and pre-paint behavior
  used by eno.vn, including an account-panel display control.
- Capacitor-aware safe areas, keyboard behavior, status bar, Android back, splash
  dismissal, cold/warm deep links, and native-only footer removal. All of it is a
  no-op in a normal browser.
- Android Digital Asset Links for package `vn.eno.app` and the current production
  signing fingerprint.
- An Apple AASA endpoint for forum, itinerary, visa, and dashboard paths. It
  deliberately excludes `/auth` and `/signin`.
- One shared `eno` PWA identity with forum, itinerary, and e-Visa shortcuts.

## Cross-app work already present in the monorepo

- Root Capacitor navigation allows only the two eno origins and stamps the
  `EnoNativeApp/1` user-agent token used on Android forum pages.
- Root and forum deep-link bridges understand both domains and validate paths
  before same-origin routing or cross-origin navigation.
- Native navigation into the forum uses a nonce-bound, single-use Supabase OTP
  handoff. It gives the forum its own cookie without exposing an access or refresh
  token and falls back to a normal guest visit when the handoff cannot complete.
- Marketplace and forum account rails link the same dashboard, community,
  itinerary, visa, listing, message, and saved surfaces.

## Native-source work remaining before release

1. Add a verified Android App Link intent filter for the canonical
   `www.eno.forum` host and only the
   intended paths: `/`, `/itinerary`, `/visa`, and `/dashboard`. Keep `/auth`
   excluded. Confirm the Play App Signing SHA-256 fingerprint matches the forum
   `assetlinks.json`; update both applications if Google rotates the signing key.
2. Enable the iOS Associated Domains capability and include
   `applinks:www.eno.forum` alongside the marketplace domains. The current Xcode
   target uses team `S4VCY6N8QR` and bundle
   `com.mk1e3.enovn`; those exact release values must be supplied to this forum
   Vercel project as `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID`.
3. Add forum, itinerary, visa, and marketplace actions to the native navigation
   affordance that product design chooses. Do not render two competing bottom
   bars on one screen.

## One account without unsafe token sharing

Supabase maps both sites to the same user ID, but `.vn` and `.forum` cannot share
cookies or local storage. A WebView does not change that browser security rule.

The implemented handoff is a three-hop top-level navigation:

1. `eno.forum/auth/bridge` sets a short-lived, HTTP-only nonce cookie.
2. `eno.vn/api/auth/forum-handoff` verifies the native UA and source session,
   rate-limits strictly, and generates a single-use hashed OTP for that user.
3. `eno.forum/auth/handoff` requires the matching nonce cookie, consumes the OTP,
   establishes an independent forum session, clears the nonce, and redirects to
   a clean local path.

Never replace this with access/refresh tokens in query parameters or shared
cross-domain cookies. Browser navigation remains an ordinary cross-site visit;
the automatic handoff is native-app-only.

## Deployment order

1. Re-point the existing `eno-forum` Vercel project to the monorepo, set Root
   Directory `apps/forum`, and preserve its existing environment and domains.
2. Set the two Apple variables in every production environment that serves the
   association file, then verify `/.well-known/assetlinks.json` and
   `/.well-known/apple-app-site-association` on `www.eno.forum` without a redirect
   or authentication challenge. The apex `eno.forum` currently redirects to the
   canonical `www` host, so it must not be declared as an associated/app-link
   domain unless that redirect is later removed and both files are served there
   directly. Apple requires a separate, non-redirecting association response for
   every declared hostname.
3. Complete the remaining native-source items, sync the native projects, and make
   signed internal iOS/Android builds.
4. Run one forum-only and one marketplace-only test push, verify the correct
   Vercel project builds or skips, then archive the standalone forum repository.
5. Release native changes only after the test matrix below passes. Browser
   deployments can remain independent afterward.

## Release test matrix

Test iOS and Android separately, cold and warm:

- open marketplace, forum home, itinerary, visa, and dashboard links;
- move between `.vn` and `.forum`, then use system back and in-app back;
- sign in, hand off the session once, sign out, and verify both origins revoke or
  intentionally retain sessions according to the final product policy;
- open/dismiss keyboards in search, post composer, itinerary, and visa fields;
- verify notch, status-bar, home-indicator, dark theme, rotation lock, offline
  fallback, external links, file/photo uploads, and Word downloads;
- ensure OAuth callbacks remain browser/custom-scheme flows and are never
  intercepted by universal/app links;
- confirm browser visits still show canonical URLs, footer/legal content, and no
  native-only behavior.

## Platform references

- [Apple: Supporting associated domains](https://developer.apple.com/documentation/Xcode/supporting-associated-domains)
- [Apple: Supporting universal links in your app](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app)
- [Android: Configure website associations](https://developer.android.com/training/app-links/configure-assetlinks)
- [Android: Verify App Links](https://developer.android.com/training/app-links/verify-applinks)
