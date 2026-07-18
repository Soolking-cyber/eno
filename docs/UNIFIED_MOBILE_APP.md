# Unified eno mobile app contract

## Architecture

Ship one App Store / Play Store application. The native project remains in the
`eno.vn` repository and starts at `https://eno.vn`. Marketplace pages stay on
`eno.vn`; community, itinerary, and visa pages stay on `eno.forum`. Browser URLs
and independent Vercel deployments do not change.

The native WebView may navigate between both first-party origins. Each origin
continues to own its Next.js routing, API routes, CSP, cookies, errors, and
deployment. Do not copy the forum back into the marketplace repository and do
not add a second Capacitor project here.

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

## Required eno.vn native-source changes before release

These changes belong to eno.vn and were deliberately **not** made by this work.

1. Add `eno.forum` and `www.eno.forum` to Capacitor `server.allowNavigation`.
   This keeps first-party cross-origin navigation in the WebView; third-party
   links must continue to open externally.
2. Add a verified Android App Link intent filter for the canonical
   `www.eno.forum` host and only the
   intended paths: `/`, `/itinerary`, `/visa`, and `/dashboard`. Keep `/auth`
   excluded. Confirm the Play App Signing SHA-256 fingerprint matches the forum
   `assetlinks.json`; update both applications if Google rotates the signing key.
3. Enable the iOS Associated Domains capability and include
   `applinks:www.eno.forum` alongside the marketplace domains. The current Xcode
   target uses team `S4VCY6N8QR` and bundle
   `com.mk1e3.enovn`; those exact release values must be supplied to this forum
   Vercel project as `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID`.
4. Extend eno.vn's deep-link router to accept both forum hosts. Use
   `window.location.assign()` for the other origin and the SPA router only for
   the current origin. For custom links use
   `enovn://open?url=<absolute-first-party-url>`; retain the existing marketplace
   `path` form only for backward compatibility.
5. Add forum, itinerary, visa, and marketplace actions to the native navigation
   affordance that product design chooses. Do not render two competing bottom
   bars on one screen.

## One account without unsafe token sharing

Supabase maps both sites to the same user ID, but `.vn` and `.forum` cannot share
cookies or local storage. A WebView does not change that browser security rule.

Implement a server-to-server, one-time session handoff before calling the mobile
experience seamless:

1. The signed-in source origin requests a handoff code from its server.
2. Store only a hash of the random code, bound to user ID, destination origin,
   native installation/device proof, and a maximum 60-second expiry.
3. Navigate to a destination endpoint with the opaque code. Never place an
   access token, refresh token, PKCE verifier, or user data in a URL.
4. The destination server atomically consumes the code once, confirms the exact
   destination, establishes its own Supabase session cookie, and redirects to a
   clean URL.
5. Reject replay, wrong-origin, expired, browser-only, or already-used codes and
   audit only non-secret identifiers.

Until that coordinated backend work exists on both origins, keep each site's
current explicit login flow. A visible second login is preferable to an insecure
URL-token shortcut.

## Deployment order

1. Deploy this forum version and set the two Apple variables in every production
   environment that serves the association file.
2. Verify `/.well-known/assetlinks.json` and
   `/.well-known/apple-app-site-association` on `www.eno.forum` without a redirect
   or authentication challenge. The apex `eno.forum` currently redirects to the
   canonical `www` host, so it must not be declared as an associated/app-link
   domain unless that redirect is later removed and both files are served there
   directly. Apple requires a separate, non-redirecting association response for
   every declared hostname.
3. Implement and deploy the eno.vn source-owner items, then sync the native
   projects and make signed internal iOS/Android builds.
4. Release native changes only after the test matrix below passes. Browser
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
