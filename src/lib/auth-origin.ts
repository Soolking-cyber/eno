// Where the sign-in round-trip is allowed to come back to.
//
// ⚠️ THE DEFAULT IS A SECURITY CONTROL, NOT A CONVENIENCE. Both the client (sign-in-form.tsx) and
// the callback route pin the return host to NEXT_PUBLIC_APP_URL rather than the request's own
// origin, because:
//   · Supabase only redirects to allow-listed URLs, and the allow-list holds the canonical host;
//   · the session cookies `exchangeCodeForSession` sets are scoped to eno.vn, so a Location on
//     www.eno.vn or a preview host lands the browser logged-OUT and bounces through
//     /signin → /onboard, after which the /api/* edge pin 403s /api/me.
// Both failure modes are silent-ish and were expensive to diagnose. Do not replace the pin with
// `window.location.origin` or `url.origin`.
//
// Until 2026-08-02 the only escape hatch was `NODE_ENV === 'development'`, which is exactly wrong
// for the new local-review workflow: `npm run preview:*` serves a PRODUCTION build on purpose (see
// scripts/preview.mjs), so NODE_ENV is 'production' and every sign-in attempt on localhost:3100
// redirected to https://eno.vn — you could look at the app but never log into it.
//
// So the hatch is now an explicit build-time opt-in. `NEXT_PUBLIC_LOCAL_AUTH=1` is set by
// scripts/preview.mjs and by nothing else — Cloud Build's env comes from Secret Manager
// (eno-root-env / eno-services-env), which does not contain it, so a deployed artifact has the flag
// absent and this module folds to `false`.
//
// ⚠️ WHY IT IS NOT `!isProd` OR A HOSTNAME SNIFF. An implicit rule ("if we're on localhost, allow
// it") would be evaluated on production traffic too, where the hostname comes from a client-
// supplied Host header. An explicit flag that is never set in the deploy path cannot be reached at
// all in production — the same reasoning as GOOGLE_VERTEX_ADC in vertex-search.ts.
// ⚠️ TWO VARIABLES FOR ONE SWITCH, AND THE SPLIT IS NOT REDUNDANCY — it is the difference between
// build-time and runtime, which cost a debugging round to establish. Next INLINES every
// `process.env.NEXT_PUBLIC_*` reference at build time, in the SERVER bundle as well as the client
// one. So a NEXT_PUBLIC flag that was absent when `next build` ran is frozen as `undefined`
// forever, and setting it in the server's runtime environment does nothing at all — measured
// 2026-08-02: the same standalone build, restarted with NEXT_PUBLIC_LOCAL_AUTH=1 explicitly in its
// env, still redirected to https://eno.vn.
//
// Hence: the CLIENT gets the inlined NEXT_PUBLIC value (it has no other way to know), and the
// SERVER reads an un-prefixed variable at call time, which is read from the live process env and
// can be flipped without rebuilding. scripts/preview.mjs sets both.

/**
 * CLIENT-side predicate. Inlined at build time, so it is only ever true in `next dev` or in a
 * build that had NEXT_PUBLIC_LOCAL_AUTH=1 present when it ran.
 */
export const AUTH_USES_REQUEST_ORIGIN = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_LOCAL_AUTH === '1'

/**
 * SERVER-side predicate. A FUNCTION, not a const, and un-prefixed on purpose: `LOCAL_AUTH` is read
 * from the live process environment on every call, so it is immune to the inlining trap above.
 * Always pair it with {@link isLoopbackHost} — see the note there.
 */
export function serverAuthUsesRequestOrigin(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.LOCAL_AUTH === '1'
}

/**
 * Loopback check for the SERVER side, used as defence in depth alongside the flag above.
 *
 * The callback route derives its redirect from `request.url`, whose host is client-controllable in
 * principle. Requiring loopback as well as the flag means that even a build which somehow carried
 * `NEXT_PUBLIC_LOCAL_AUTH=1` into production could not be talked into redirecting a real user
 * somewhere else — the belt to the flag's braces. The client side needs no equivalent: there,
 * "request origin" is `window.location.origin`, which on a production host is already the
 * canonical one.
 */
// ⚠️ TAKE THE RAW `Host` HEADER, NOT `new URL(request.url).hostname`. Measured 2026-08-02 on the
// standalone server: `request.url`'s hostname does NOT reflect the host the client asked for —
// requests to BOTH http://localhost:3100 and http://127.0.0.1:3100 failed this check identically,
// because Next synthesises that URL from the server's own bind address (HOSTNAME, which the
// standalone runner sets to 0.0.0.0). The `Host` header is the value the browser actually sent.
// Accepts an optional :port, which a Host header carries and a hostname does not.
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}

/**
 * The local origin to redirect back to, built from the `Host` header.
 *
 * ⚠️ NOT `new URL(request.url).origin` — same trap as above, one step further. After switching the
 * CHECK to the Host header the redirect correctly stayed local but came out as
 * `http://0.0.0.0:3100/`, because Next composes `request.url` from the server's bind address. A
 * browser cannot follow that to the tab it came from. The Host header carries the authority the
 * client actually used ("localhost:3100"), which is the only thing that round-trips.
 *
 * Always http: this is only ever reached for a loopback host (callers gate on isLoopbackHost), and
 * the local preview server does not speak TLS.
 */
export function loopbackOrigin(host: string): string {
  return `http://${host}`
}
