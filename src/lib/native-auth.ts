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
 *   3. catch the deep-link return (`NATIVE_OAUTH_REDIRECT`) in native-bootstrap, which forwards the
 *      `code` to the same server `/auth/callback` route the web flow uses. That route runs INSIDE
 *      this WebView, so it reads the PKCE verifier cookie set here in step 1, exchanges it, and
 *      lands the session in the WebView's own cookie jar.
 *
 * ⚠️ `NATIVE_OAUTH_REDIRECT` must be BOTH registered natively (iOS CFBundleURLTypes / Android
 * intent-filter) AND added to Supabase → Auth → URL Configuration → Redirect URLs, or Supabase
 * rejects the `redirect_to` and bounces to the Site URL.
 */
export const NATIVE_OAUTH_REDIRECT = 'enovn://auth-callback'

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!c?.isNativePlatform?.()
}

export async function nativeGoogleSignIn(supabase: SupabaseClient, next: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser')
  const redirectTo = `${NATIVE_OAUTH_REDIRECT}?next=${encodeURIComponent(next)}`
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  })
  if (error) throw error
  if (!data?.url) throw new Error('No OAuth URL returned')
  await Browser.open({ url: data.url })
}
