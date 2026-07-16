import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Native (Capacitor) Google OAuth.
 *
 * Google REJECTS OAuth inside embedded WebViews (`disallowed_useragent`), and the app's WebView is
 * exactly that — so the normal `signInWithOAuth` full-page redirect would hit Google's block page.
 * Instead we:
 *   1. ask Supabase for the OAuth URL WITHOUT navigating (`skipBrowserRedirect`),
 *   2. open it in a REAL system in-app browser (SFSafariViewController / Chrome Custom Tab), which
 *      Google DOES allow, and
 *   3. Supabase redirects the in-app browser to the ALREADY-ALLOW-LISTED `https://eno.vn/auth/callback
 *      ?native=1`. That route detects `native=1` and, instead of exchanging (its cookies are the
 *      browser tab's, not the app's), 302s to the app deep link `enovn://auth-callback?code=…`.
 *   4. native-bootstrap catches the deep link and forwards the `code` to `/auth/callback` INSIDE the
 *      app WebView, where the PKCE verifier cookie set in step 1 lives → the existing server route
 *      exchanges it, provisions + onboards, and the session lands in the WebView's own cookie jar.
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

export async function nativeGoogleSignIn(supabase: SupabaseClient, next: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser')
  // Point Supabase at the ALREADY-ALLOW-LISTED web callback with a `native=1` marker (NOT the custom
  // scheme, which isn't allow-listed). That route hands the code back to the app via the deep link.
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}&native=1`
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  })
  if (error) throw error
  if (!data?.url) throw new Error('No OAuth URL returned')
  await Browser.open({ url: data.url })
}
