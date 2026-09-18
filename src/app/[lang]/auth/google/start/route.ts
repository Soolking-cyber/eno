import { NextResponse } from 'next/server'
import {
  buildAuthorizeUrl,
  canonicalAuthOrigin,
  googleOauthConfigured,
  newTransaction,
  TX_TTL_SECONDS,
  txCookieName,
} from '@/lib/auth/google-oauth'
import { safeNextPath } from '@/lib/url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Begin first-party Google sign-in. See src/lib/auth/google-oauth.ts for why this exists at all.
//
// ⛔ EVERY FAILURE HERE FALLS BACK, IT NEVER ERRORS. A visitor who taps "Continue with Google" must
// end up signing in, even if this flow is misconfigured. `?g=fallback` tells the sign-in form to run
// the old signInWithOAuth immediately — an unbranded consent screen instead of no sign-in at all.
// Both external reviewers refuted the first version of this plan precisely because it had no way
// back from a bad secret or an unregistered redirect URI.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = canonicalAuthOrigin(request)
  // Same-origin guard — `next` is attacker-supplied and ends up in a Location header.
  const next = safeNextPath(url.searchParams.get('next'), origin)

  const fallback = () =>
    NextResponse.redirect(`${origin}/signin?g=fallback&next=${encodeURIComponent(next)}`, {
      // An auth redirect carries Set-Cookie and must never be cached by a CDN.
      headers: { 'cache-control': 'no-store' },
    })

  if (!googleOauthConfigured()) return fallback()

  const tx = newTransaction()
  const authorize = buildAuthorizeUrl(tx, origin)
  if (!authorize) return fallback()

  const res = NextResponse.redirect(authorize, { headers: { 'cache-control': 'no-store' } })
  // ⚠️ sameSite: 'lax' IS REQUIRED AND IS ALSO CORRECT. Google returns the visitor by a top-level
  // GET navigation, which `lax` allows and `strict` would not — a strict cookie is simply absent on
  // the callback and every sign-in fails. `none` would be weaker for no benefit: we never need this
  // cookie in a cross-site subresource.
  //
  // ⛔ THE VALUE HOLDS THE RAW NONCE AND THE PKCE VERIFIER, so httpOnly is load-bearing rather than
  // hygiene: script access to either would let a page in the visitor's browser complete somebody
  // else's sign-in transaction.
  res.cookies.set(txCookieName(tx.state), JSON.stringify({ s: tx.state, n: tx.nonceRaw, v: tx.codeVerifier, next }), {
    httpOnly: true,
    // In dev the round-trip is plain-http localhost, where a `secure` cookie is dropped silently.
    secure: origin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: TX_TTL_SECONDS,
  })
  return res
}
