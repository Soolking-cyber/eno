import type { SupabaseClient } from '@supabase/supabase-js'
import { clearStalePkceCookies } from '@/lib/auth-pkce'
import {
  appleCredential,
  signInPluginAvailable,
  signInPluginErrorCode,
  webAuthSession,
  type AppleCredential,
} from '@/lib/native-sign-in-plugin'

/**
 * Native (Capacitor) OAuth — Google, and Apple's WEB flow in the Android app.
 *
 * Google REJECTS OAuth inside embedded WebViews (`disallowed_useragent`), and the app's WebView is
 * exactly that — so the normal `signInWithOAuth` full-page redirect would hit Google's block page.
 * Instead we:
 *   1. ask Supabase for the OAuth URL WITHOUT navigating (`skipBrowserRedirect`),
 *   2. open it in a REAL system browser surface — ASWebAuthenticationSession on an iOS binary that
 *      carries `EnoSignIn` (build 3 on), otherwise SFSafariViewController / Chrome Custom Tab
 *      (@capacitor/browser) — which Google DOES allow, and
 *   3. Supabase redirects that browser to the ALREADY-ALLOW-LISTED `https://eno.vn/auth/callback
 *      ?native=1&p=<provider>`. That route detects `native=1` and, instead of exchanging (its cookies are
 *      the browser tab's, not the app's), 302s to the app deep link `enovn://auth-callback?code=…`.
 *   4. The callback URL comes back INTO the WebView — captured by ASWebAuthenticationSession (resolved
 *      here), or delivered as a deep link that native-bootstrap catches — and the WebView loads
 *      `/auth/callback?code=…`, where the PKCE verifier cookie set in step 1 lives → the existing server
 *      route exchanges it, provisions + onboards, and the session lands in the WebView's own cookie jar.
 *
 * ⚠️ `NATIVE_OAUTH_REDIRECT` must be registered natively (iOS CFBundleURLTypes / Android
 * intent-filter). It does NOT need to be in Supabase's allow-list — Supabase only ever redirects to
 * the already-allow-listed https://eno.vn/auth/callback; the custom scheme is an app-internal hop
 * issued by our own callback route.
 */
export const NATIVE_OAUTH_REDIRECT = 'enovn://auth-callback'

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!c?.isNativePlatform?.()
}

/**
 * Why a native sign-in did not finish. The sign-in form maps these to its own copy:
 *   · `canceled`          — the person closed Apple's sheet or the web-auth sheet: SILENT, no error shown.
 *   · `apple_unavailable` — Sign in with Apple cannot run here (no Apple Account on the device, or this
 *                           deployment is not configured for it).
 *   · `apple_failed`      — anything else on the Apple path (network, a rejected token, the plugin failed).
 *   · `oauth_failed`      — the web-auth sheet failed or returned something that is not our callback.
 */
export type NativeAuthErrorCode = 'canceled' | 'apple_unavailable' | 'apple_failed' | 'oauth_failed'

export class NativeAuthError extends Error {
  constructor(readonly code: NativeAuthErrorCode) {
    super(code)
    this.name = 'NativeAuthError'
  }
}

export function nativeAuthErrorCode(e: unknown): NativeAuthErrorCode | null {
  return e instanceof NativeAuthError ? e.code : null
}

/**
 * The WebView path for an `enovn://auth-callback?…` deep link, or null for any other URL.
 *
 * ⛔ THE QUERY ONLY — NEVER THE FRAGMENT. The old dispatcher forwarded `url.split('?')[1]`, which carried a
 * `#…` along with it; an implicit-flow redirect puts the TOKENS in the fragment, so a crafted flow could
 * smuggle them into the app. `URL.search` stops at `#` by definition. Precise match on scheme AND host — a
 * substring test would also hit a legitimate link that merely CONTAINS "://auth-callback" in a parameter.
 */
export function authCallbackPathFromDeepLink(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'enovn:' || u.host !== 'auth-callback') return null
    return `/auth/callback${u.search}`
  } catch {
    return null
  }
}

export type NativeOAuthProvider = 'google' | 'apple'

/**
 * Start Google (any native app) or Apple's web flow (the Android app) in a real browser surface.
 * Resolves once the browser is open (Custom Tab / SFSafariViewController — the deep link finishes it), or
 * once the WebView is on its way to `/auth/callback` (ASWebAuthenticationSession captured the callback).
 * Throws NativeAuthError('canceled') when the web-auth sheet is closed; other failures throw.
 */
export async function nativeOAuth(supabase: SupabaseClient, provider: NativeOAuthProvider, next: string): Promise<void> {
  // ⚠️ A FLOW START, SO IT STARTS CLEAN — the web paths always did (sign-in-form.tsx); this one never did, so
  // every abandoned native attempt left a verifier cookie behind for good. See src/lib/auth-pkce.ts.
  clearStalePkceCookies()
  // Point Supabase at the ALREADY-ALLOW-LISTED web callback with a `native=1` marker (NOT the custom
  // scheme, which isn't allow-listed). That route hands the code back to the app via the deep link.
  // `p` names the provider so the callback can keep Apple's refresh token for revocation (p=apple).
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}&native=1&p=${provider}`
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  })
  if (error) throw error
  if (!data?.url) throw new Error('No OAuth URL returned')

  // iOS build 3 on: ASWebAuthenticationSession, ephemeral (D13) — no "wants to use sb.eno.vn to sign in"
  // alert, and the session captures its own `enovn://` callback, so no other app can claim it.
  if (signInPluginAvailable()) {
    let captured: string | null = null
    try {
      captured = (await webAuthSession(data.url, true))?.url ?? null
    } catch (e) {
      throw new NativeAuthError(signInPluginErrorCode(e) === 'canceled' ? 'canceled' : 'oauth_failed')
    }
    const path = captured ? authCallbackPathFromDeepLink(captured) : null
    if (!path) throw new NativeAuthError('oauth_failed')
    window.location.assign(path)
    return
  }

  const { Browser } = await import('@capacitor/browser')
  // Brand the Custom Tab / SFSafariViewController toolbar with the LIVE --card token (the same
  // surface the in-app header uses, already theme-flipped). The token is authored as hex in
  // globals.css; Browser.open accepts hex only, so pass it through only if it still is —
  // a retokenized non-hex value just falls back to the default toolbar rather than erroring.
  const card = getComputedStyle(document.documentElement).getPropertyValue('--card').trim()
  await Browser.open({ url: data.url, ...(card.startsWith('#') ? { toolbarColor: card } : {}) })
}

/** Google, the way every native caller started it before Apple existed. Kept for the existing call sites. */
export async function nativeGoogleSignIn(supabase: SupabaseClient, next: string): Promise<void> {
  return nativeOAuth(supabase, 'google', next)
}

/**
 * Only ever navigate to a path on THIS origin. The server already sanitized `next` (safeNextPath) and builds
 * `to` itself; this is the client's half of A4 — `/`-rooted, never `//host` or `/\host` (which URL parsing
 * turns into another origin), and resolving to this origin. Anything else goes home.
 */
function sameOriginPath(to: unknown): string {
  if (typeof to !== 'string' || !to.startsWith('/') || to.startsWith('//') || to.startsWith('/\\')) return '/'
  try {
    return new URL(to, window.location.origin).origin === window.location.origin ? to : '/'
  } catch {
    return '/'
  }
}

/**
 * NATIVE Sign in with Apple, iOS build 3 on (plan §7.5 / §7.7):
 *   1. POST /api/auth/apple/nonce → `{ nonce }`, the SHA-256 hex of a raw nonce the server keeps in an
 *      HttpOnly cookie;
 *   2. EnoSignIn.signInWithApple({ nonce }) — Apple's own sheet;
 *   3. POST /api/auth/apple/native with the credential and `next` → the server redeems the identity token
 *      with GoTrue (raw nonce), writes Apple's name into the session, provisions the profile, keeps the
 *      refresh token for revocation, and answers `{ to }`;
 *   4. navigate there (a full load, so every server component sees the new session).
 * Throws NativeAuthError: `canceled` (silent), `apple_unavailable`, `apple_failed`.
 */
export async function nativeAppleSignIn(next: string): Promise<void> {
  const post = async (path: string, body?: unknown): Promise<Response> => {
    try {
      return await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
    } catch {
      throw new NativeAuthError('apple_failed') // offline, or the request never left
    }
  }
  const failed = (res: Response) => new NativeAuthError(res.status === 503 ? 'apple_unavailable' : 'apple_failed')

  const nonceRes = await post('/api/auth/apple/nonce')
  if (!nonceRes.ok) throw failed(nonceRes)
  const { nonce } = (await nonceRes.json().catch(() => ({}))) as { nonce?: unknown }
  if (typeof nonce !== 'string' || !/^[0-9a-f]{64}$/.test(nonce)) throw new NativeAuthError('apple_failed')

  let credential: AppleCredential
  try {
    credential = await appleCredential(nonce)
  } catch (e) {
    const code = signInPluginErrorCode(e)
    throw new NativeAuthError(code === 'canceled' ? 'canceled' : code === 'unavailable' ? 'apple_unavailable' : 'apple_failed')
  }
  if (!credential || typeof credential.identityToken !== 'string' || !credential.identityToken) {
    throw new NativeAuthError('apple_failed')
  }

  const res = await post('/api/auth/apple/native', {
    identityToken: credential.identityToken,
    authorizationCode: credential.authorizationCode ?? null,
    user: credential.user ?? null,
    email: credential.email ?? null,
    givenName: credential.givenName ?? null,
    familyName: credential.familyName ?? null,
    fullName: credential.fullName ?? null,
    next,
  })
  if (!res.ok) throw failed(res)
  const { to } = (await res.json().catch(() => ({}))) as { to?: unknown }
  window.location.assign(sameOriginPath(to))
}
