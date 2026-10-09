import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { rateLimit } from '@/lib/ratelimit'
import { apiFail } from '@/lib/api/handler'
import { canonicalAuthOrigin } from '@/lib/auth/google-oauth'
import { APPLE_NONCE_COOKIE, APPLE_NONCE_PATH, APPLE_NONCE_TTL_S, nativeAppleBundleId, newAppleNonce } from '@/lib/auth/apple-siwa'

// Step 1 of native Sign in with Apple (the iOS app, build 3 on — src/lib/native-auth.ts nativeAppleSignIn):
// mint a nonce, keep the RAW value in an HttpOnly cookie, hand the app only its SHA-256 hex for Apple's request.
// Step 2 is POST /api/auth/apple/native, which spends the cookie. See src/lib/auth/apple-siwa.ts.
//
// Branches: cross-origin → 403 bad_origin · over the per-IP limit → 429 rate_limited · native Apple not open on
// this deployment → 503 not_configured, before Apple's sheet ever opens: no APPLE_SIWA_BUNDLE_ID, OR no `ios` in the
// build's rollout flag (the dark deploy, `web-test`/`web` alone), OR the services edition (eno.forum — D2) —
// nativeAppleBundleId, the same rule /api/auth/apple/native applies (commit gate round 2, C2: the values sit in BOTH
// editions' env, so the bundle ID alone opened these routes everywhere) · otherwise 200 { nonce } + the cookie.
// ⚠️ NOT route(): the origin check must run BEFORE the limiter (the handoff/open reasoning — a cross-origin
// caller must not spend an honest visitor's per-IP budget), and the success response sets a cookie.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(request: Request) {
  // ⚠️ A MISSING Origin IS REFUSED IN PRODUCTION — the app's WebView always sends one on a POST. The expected
  // origin is the site's own (canonicalAuthOrigin: the visitor's host from the auth allow-list, or the loopback
  // host of a local preview) — the same rule /api/auth/apple/native applies.
  if (process.env.NODE_ENV === 'production' && request.headers.get('origin') !== canonicalAuthOrigin(request)) {
    return apiFail('bad_origin', 403)
  }
  // ⚠️ NOT strict: this is the sign-in path, so a limiter blip must not lock people out.
  const rl = await rateLimit('apple-nonce', clientIp(request), 30, '10 m').catch(() => ({ success: true }))
  if (!rl.success) return apiFail('rate_limited', 429)
  if (!nativeAppleBundleId()) return apiFail('not_configured', 503)

  const { raw, hashed } = newAppleNonce()
  const res = NextResponse.json({ nonce: hashed }, { headers: noStore })
  res.cookies.set(APPLE_NONCE_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Strict: only ever read by the same-origin POST that follows, from the page that asked for it.
    sameSite: 'strict',
    path: APPLE_NONCE_PATH,
    maxAge: APPLE_NONCE_TTL_S,
  })
  return res
}
