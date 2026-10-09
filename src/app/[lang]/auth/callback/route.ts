import { NextResponse } from 'next/server'
import type { Session, User } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authRedirect, finishSignIn } from '@/lib/auth-finish'
import { safeNextPath } from '@/lib/url'
import { NATIVE_OAUTH_REDIRECT } from '@/lib/native-auth'
import { IS_SERVICES } from '@/lib/edition'
import { serverAuthUsesRequestOrigin, isLoopbackHost, loopbackOrigin } from '@/lib/auth-origin'

/**
 * What a provider's `?error=` means for the visitor — a CODE, never the provider's prose.
 *   cancel          — they backed out: Apple's web flow returns `user_cancelled_authorize` (its ONLY web error,
 *                     per Apple's "other platforms" guide), Google `access_denied`, and the app's own native hop
 *                     forwards `cancel`. GoTrue's OAuth errors carry no `error_code`, so `access_denied` WITH one
 *                     (signup_disabled) is not a cancel.
 *   signup_disabled — the project refuses new accounts (the 2026-08-17 production finding below).
 *   oauth           — anything else.
 */
type CallbackError = 'cancel' | 'signup_disabled' | 'oauth'
function callbackError(error: string, errorCode: string): CallbackError {
  if (error === 'user_cancelled_authorize' || error === 'cancel') return 'cancel'
  if (errorCode === 'signup_disabled' || error === 'signup_disabled') return 'signup_disabled'
  if (error === 'access_denied' && !errorCode) return 'cancel'
  return 'oauth'
}

/** GoTrue's record of which provider minted this PKCE code (auth.flow_state), or null — read BEFORE the exchange. */
type CodeFlow = { provider: string; userId: string | null } | null
/** A stalled read must never hold a sign-in (commit gate round 5, codex): past this, the flow is unknown. */
const CODE_FLOW_TIMEOUT_MS = 1_500

async function codeFlow(code: string): Promise<CodeFlow> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const { appleOnOffer, pkceCodeProvider } = await import('@/lib/auth/apple-siwa')
    // ⛔ Only where Apple can have been used (commit gate round 8, opus): before Apple is configured on this server, no
    // sign-in pays for the read — the dark deploy changes nothing for Google and email sign-ins.
    if (!appleOnOffer()) return null
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), CODE_FLOW_TIMEOUT_MS) })
    return await Promise.race([pkceCodeProvider(code), timeout])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Sign in with Apple's web flow (GoTrue's Apple OAuth, the Services ID): keep Apple's refresh token for
 * revocation at account deletion (TN3194 — src/lib/auth/apple-siwa.ts), then rewrite the session cookie WITHOUT
 * the provider tokens. ⚠️ THE SECOND STEP IS WHY THIS RUNS EVEN WHEN THE KEEP FAILS: exchangeCodeForSession saved
 * the whole session, `provider_refresh_token` included, into the JS-readable auth cookie; setSession saves it back
 * with only the access and refresh tokens and the user (auth-js setSession builds a fresh session object).
 * ⛔ KEPT ONLY WHEN GOTRUE SAYS THE CODE WAS APPLE'S (commit-gate C4, 2026-10-08). `p=apple` is a query parameter
 * anyone can add to any callback: on an account where Google and Apple are linked, a GOOGLE callback carrying it found
 * the Apple identity and kept GOOGLE's provider_refresh_token as an Apple token — sent to Apple at deletion. `flow` is
 * GoTrue's own flow state for this code (pkceCodeProvider): provider `apple`, and the user it was issued to — the
 * user just signed in. Anything else, or no answer at all, keeps nothing. The flow is read for every code (round 4):
 * `p` was once a pre-filter here, and an Apple flow without it skipped both the keep and the strip.
 * ⛔ ONLY GOTRUE'S WORD THAT THE CODE WAS APPLE'S MOVES ANYTHING (commit gate rounds 3–6). Google — and any flow GoTrue
 * cannot vouch for (a stalled or unreadable flow read) — is left exactly as before this work: no keep, no rewrite, no
 * new way to fail. ⚠️ THE STRIP IS BEST EFFORT, ON PURPOSE: four rounds of "fail closed when it fails" each found a new
 * way to break someone's sign-in. What bounds the risk is Apple's own contract — every token call is client-
 * authenticated with a secret signed by eno's private key (TN3194), so a refresh token read off the cookie is useless to
 * anyone else. A failed rewrite is logged and the sign-in goes on.
 */
async function keepAppleToken(supabase: Awaited<ReturnType<typeof createSupabaseServer>>, user: User | null, session: Session | null, flow: CodeFlow): Promise<void> {
  if (!user || !session || flow?.provider !== 'apple') return
  // Any case: GoTrue keeps the provider as the authorize request spelled it (isAppleLinked; `flow` is lowercased too).
  const identity = user.identities?.find((i) => typeof i.provider === 'string' && i.provider.trim().toLowerCase() === 'apple')
  const refreshToken = session.provider_refresh_token
  if (identity && refreshToken) {
    if (flow.userId !== null && flow.userId !== user.id) {
      console.warn('[auth] apple_token_not_kept', { reason: 'user_mismatch', flow: 'web', provider: flow.provider })
    } else {
      try {
        const { appleServicesId, storeAppleToken } = await import('@/lib/auth/apple-siwa')
        const clientId = appleServicesId()
        const appleSub = (typeof identity.identity_data?.sub === 'string' && identity.identity_data.sub) || identity.id
        if (!clientId) console.warn('[auth] apple_token_not_kept', { reason: 'unconfigured', flow: 'web' })
        else await storeAppleToken({ userId: user.id, clientId, appleSub, refreshToken })
      } catch (e) {
        console.warn('[auth] apple_token_not_kept', { reason: 'error', flow: 'web', name: (e as Error)?.name })
      }
    }
  }
  if (!session.provider_token && !session.provider_refresh_token) return
  // One retry: setSession only re-reads the user, so a transient GoTrue blip is usually absorbed.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { error } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
      if (!error) return
      console.warn('[auth] apple_session_rewrite_failed', { status: error.status, attempt })
    } catch (e) {
      console.warn('[auth] apple_session_rewrite_failed', { name: (e as Error)?.name, attempt })
    }
  }
}

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
    // UX3 J2: where the visitor started (Facebook, Zalo …), for the confirm screen's copy — an
    // allow-listed word passed through, never echoed as text (parseHandoffVia).
    const { parseHandoffVia } = await import('@/lib/auth/handoff-client')
    const via = parseHandoffVia(url.searchParams.get('via'))
    // ⚠️ The nonce rides the URL (it already did, to get here) but the CODE never does, and neither
    // does the browser secret — a secret in a query string lands in history, referrers and logs.
    const res = redirect(`${origin}/auth/escape/confirm?h=${encodeURIComponent(handoff)}&ok=${ok ? '1' : '0'}${via ? `&via=${via}` : ''}`)
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

  // ⛔ THE HOP CARRIES ONLY WHAT THE APP NEEDS, AND NOTHING THE TAB WAS HANDED (plan A2). Three rules:
  //   · ONLY WITH A CODE OR AN ERROR. With neither there is nothing to hand back, and hopping anyway let a
  //     crafted `?native=1` bounce any visitor into the app; stay in the tab and show /signin instead.
  //   · AN ERROR GOES AS A MAPPED CODE (cancel | signup_disabled | oauth), never `error_description` — a cancel
  //     must still reach the app (stranding it in the tab was the cost of "hop only with a code"), but the
  //     provider's prose is attacker-influenceable text.
  //   · `p` ONLY WHEN IT IS apple OR google, and Location ENDS WITH `#`: a redirect without a fragment inherits
  //     the request's, and an implicit-flow redirect carries the tokens there. An explicit empty fragment wins.
  if (url.searchParams.get('native') === '1') {
    const q = new URLSearchParams()
    const hopError = url.searchParams.get('error')
    if (code) q.set('code', code)
    else if (hopError) q.set('error', callbackError(hopError, url.searchParams.get('error_code') || ''))
    else return redirect(`${origin}/signin`)
    q.set('next', next)
    const p = url.searchParams.get('p')
    if (p === 'apple' || p === 'google') q.set('p', p)
    return new NextResponse(null, {
      status: 302,
      headers: { Location: `${NATIVE_OAUTH_REDIRECT}?${q.toString()}#`, 'Cache-Control': 'private, no-store, max-age=0' },
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
      // ⚠️ THE SCHEME FOLLOWS THE EDITION SERVING THIS REQUEST. Hardcoding `enonative://` sent the
      // SERVICES app (which registers `enoforum://`) to a scheme it does not own: iOS had nothing
      // to hand the code back to, so the sign-in sheet hung until the user cancelled. eno.forum
      // answers its own callback, so the edition flag here is the right authority.
      headers: { Location: `${IS_SERVICES ? 'enoforum' : 'enonative'}://auth-callback?${q.toString()}`, 'Cache-Control': 'private, no-store, max-age=0' },
    })
  }

  /**
   * ⛔ THE PROVIDER'S OWN ERROR WAS ARRIVING HERE AND BEING THROWN AWAY. This route only ever
   * looked for `code`; when Google/Supabase came back with `?error=…` instead, execution fell
   * straight through to the generic `/?auth_error=1` bounce below. Measured in production
   * (Cloud Run logs, 2026-08-17T10:10:09Z):
   *
   *   /auth/callback?error=access_denied&error_code=signup_disabled
   *                 &error_description=Signups+not+allowed+for+this+instance
   *
   * The diagnosis was sitting in the query string and the visitor was shown a home page with a
   * meaningless flag. ⚠️ AND THE UNDERLYING CAUSE IS A PROJECT SETTING, NOT CODE: the live
   * Supabase project answers `"disable_signup": true` on /auth/v1/settings, so a Google sign-in
   * by anyone the project does not already know is refused. That is the first-attempt failure —
   * it cannot be fixed here, only reported honestly.
   */
  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    const errorCode = url.searchParams.get('error_code') || ''
    const kind = callbackError(oauthError, errorCode)
    // ⚠️ A CANCEL IS A DECISION, NOT A FAILURE: back to the form, silently, with `next` kept — no toast. (The
    // first-party Google callback learned the same lesson: treating a refusal as an error sent people round in
    // a loop.) Logged for the post-flip monitoring — with which of the three cancels it was and a capped description
    // (commit gate round 11, opus): a refusal that ever arrived as a bare access_denied (a database trigger raising
    // PT403 — none exists today) would otherwise look exactly like a person backing out.
    if (kind === 'cancel') {
      const p = url.searchParams.get('p')
      console.log('[auth] oauth cancelled', {
        provider: p === 'apple' || p === 'google' ? p : 'unknown',
        error: oauthError, // one of the three cancel codes: callbackError returned 'cancel'
        description: url.searchParams.get('error_description')?.slice(0, 120) ?? null,
      })
      return redirect(`${origin}/signin?next=${encodeURIComponent(next)}`)
    }
    console.error('[auth] oauth callback error', {
      error: oauthError,
      code: errorCode,
      description: url.searchParams.get('error_description'),
    })
    // ⚠️ A CODE, NEVER THE PROVIDER'S PROSE. `error_description` is attacker-influenceable text
    // arriving in a query string; reflecting it into the page would be a content-injection vector
    // and would also show a visitor a sentence written for a developer. The client maps this to its
    // own copy.
    return redirect(`${origin}/?auth_error=${kind}`)
  }

  if (code) {
    /**
     * ⛔ EVERY CODE, NOT ONLY `p=apple` (commit gate round 4, codex): an Apple flow started without the marker reached
     * the exchange unchecked, and its provider tokens stayed in the JS-readable cookie. Which provider minted the code
     * is GoTrue's to say, and its flow state is deleted BY the exchange: read it first, for every code (one indexed
     * read). `p` now only labels the return for the UI.
     */
    const flow = await codeFlow(code)
    const supabase = await createSupabaseServer()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Keep Apple's refresh token for revocation (when GoTrue confirms Apple) and strip Apple's provider tokens from the
      // cookie; every other provider is unchanged.
      await keepAppleToken(supabase, data.user, data.session, flow)
      // Profile provisioning + the onboarding hop are shared with /auth/confirm.
      return finishSignIn(data.user, origin, next)
    }
    /**
     * ⚠️ THIS LOG IS THE POINT OF THE WHOLE CHANGE. A `code` that fails to exchange is the OTHER
     * half of the owner's "first attempt does not log in, the second does" report, and it happens
     * in production — three code-bearing callbacks on 2026-08-13 and a pair minutes apart on
     * 2026-08-18 all ended at /?auth_error=1. Until now NOTHING recorded why: the error was
     * discarded on this line, so there was no way to tell a used code from a missing PKCE verifier
     * from a clock skew. Diagnosing it needed a log more than it needed a guess.
     */
    console.error('[auth] exchangeCodeForSession failed', { message: error.message, status: error.status })
    return redirect(`${origin}/?auth_error=exchange`)
  }
  return redirect(`${origin}/?auth_error=1`)
}
