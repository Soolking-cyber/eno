import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authRedirect, finishSignIn } from '@/lib/auth-finish'
import { safeNextPath } from '@/lib/url'
import { NATIVE_OAUTH_REDIRECT } from '@/lib/native-auth'
import { serverAuthUsesRequestOrigin, isLoopbackHost, loopbackOrigin } from '@/lib/auth-origin'

// OAuth / magic-link callback — exchanges the code for a session, then redirects.
export async function GET(request: Request) {
  const url = new URL(request.url)
  // ⚠️ The redirect host MUST be the CANONICAL public origin, NOT `url.origin`. Behind Vercel /
  // Cloudflare, `request.url` can carry a *.vercel.app (or www / preview) host — and a Location on
  // THAT host does not carry the eno.vn-scoped session cookies `exchangeCodeForSession` just set,
  // so the browser lands logged-OUT and bounces through /signin → /onboard → … (and the /api/* edge
  // pin then 403s /api/me). In dev we keep the request origin so the round-trip stays on localhost.
  // AUTH_USES_REQUEST_ORIGIN is true in `next dev` and in a preview build that opted in with
  // NEXT_PUBLIC_LOCAL_AUTH=1 (scripts/preview.mjs sets it; the deploy env never does). The loopback
  // check is defence in depth: `request.url`'s host is client-influenceable, so even a build that
  // wrongly carried the flag could not be talked into redirecting a real visitor off-site.
  // See src/lib/auth-origin.ts.
  const origin =
    serverAuthUsesRequestOrigin() && isLoopbackHost(request.headers.get('host'))
      ? loopbackOrigin(request.headers.get('host')!)
      : process.env.NODE_ENV === 'development'
        ? url.origin
        : new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').origin
  const code = url.searchParams.get('code')
  // Same-origin guard — never redirect to an attacker-supplied external URL.
  const next = safeNextPath(url.searchParams.get('next'), origin)

  // Never let a proxy/CDN cache an auth redirect (it carries Set-Cookie): a cached login response
  // would hand one user's session to the next, or serve a stale bounce.
  const redirect = authRedirect

  // NATIVE app OAuth hand-off. The code arrived in the app's in-app browser tab (SFSafariViewController
  // / Chrome Custom Tab), whose cookie jar is NOT the app's WebView — so exchanging HERE would set the
  // session in the wrong place. Instead 302 to the app's deep link with the (single-use, PKCE-bound)
  // code; the app re-enters this route INSIDE its WebView to do the real exchange. `NextResponse.redirect`
  // rejects non-http schemes, so set Location manually. Not cached (carries the code).
  // BROWSER-ESCAPE HAND-OFF. We are in the visitor's REAL browser, reached from an in-app browser
  // or a home-screen PWA because Google refuses OAuth in an embedded webview. Same shape as the
  // native branch below and for the same reason: the PKCE verifier lives in the ORIGINATING
  // context, not here, so exchanging in this jar is impossible and creating a session here would
  // sign in the wrong browser. Park the code; the visitor then confirms and is shown a pairing code
  // to carry back. See src/lib/auth/handoff.ts for the takeover this shape defeats.
  //
  // ⚠️ MUST COME BEFORE ANY exchangeCodeForSession CALL — the Supabase helper will happily attempt
  // an exchange for any `code` it sees and fail with a PKCE error in this browser.
  const handoff = url.searchParams.get('handoff')
  if (handoff) {
    const { isNonce, parkCode, newBrowserSecret, browserCookieName, HANDOFF_TTL_MS } =
      await import('@/lib/auth/handoff')
    // ⚠️⚠️ THIS IS WHERE THE BROWSER IS BOUND, AND IT IS THE FIX FOR THE ACCOUNT TAKEOVER.
    // We are, right now, in the one context that actually completed Google. Mint a secret, store
    // only its hash on the row, and hand the secret back as an httpOnly cookie that no other jar can
    // ever hold. /consent then requires it, so knowing the nonce — which is public, it rides the
    // escape URL — is no longer enough to mint the pairing code and claim someone else's sign-in.
    const browserSecret = newBrowserSecret()
    const ok = isNonce(handoff) && !!code && (await parkCode(handoff, code, browserSecret))
    // ⚠️ The nonce rides the URL (it already did, to get here) but the CODE never does, and neither
    // does the browser secret — a secret in a query string lands in history, referrers and logs.
    const res = redirect(`${origin}/auth/escape/confirm?h=${encodeURIComponent(handoff)}&ok=${ok ? '1' : '0'}`)
    if (ok) {
      res.cookies.set(browserCookieName(handoff), browserSecret, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        // Lax: the visitor arrives here by a top-level navigation from Google, and /consent is a
        // same-origin POST with an Origin check.
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(HANDOFF_TTL_MS / 1000),
      })
    }
    return res
  }

  if (url.searchParams.get('native') === '1') {
    const q = new URLSearchParams()
    if (code) q.set('code', code)
    q.set('next', next)
    return new NextResponse(null, {
      status: 302,
      headers: { Location: `${NATIVE_OAUTH_REDIRECT}?${q.toString()}`, 'Cache-Control': 'private, no-store, max-age=0' },
    })
  }

  // NATIVE-2: the pure-SwiftUI app (apps/ios, NOT Capacitor). It runs the OAuth
  // in ASWebAuthenticationSession with its OWN PKCE verifier (no WebView cookie
  // jar), so we must NOT exchange here — 302 the raw code to the app's own
  // scheme (enonative://, distinct from Capacitor's enovn://) and let the app
  // exchange it directly against Supabase's PKCE token endpoint. Same reason
  // this isn't in the Supabase allow-list: Supabase only redirects to the
  // allow-listed https://eno.vn/auth/callback; the scheme hop is ours.
  if (url.searchParams.get('native') === '2') {
    const q = new URLSearchParams()
    if (code) q.set('code', code)
    q.set('next', next)
    return new NextResponse(null, {
      status: 302,
      headers: { Location: `enonative://auth-callback?${q.toString()}`, 'Cache-Control': 'private, no-store, max-age=0' },
    })
  }

  if (code) {
    const supabase = await createSupabaseServer()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    // Profile provisioning + the onboarding hop are shared with /auth/confirm.
    if (!error) return finishSignIn(data.user, origin, next)
  }
  return redirect(`${origin}/?auth_error=1`)
}
