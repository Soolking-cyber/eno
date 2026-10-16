import { inAppSheetDocument } from './app-review-gates'
import { inAppHost, isNativeTabs } from './in-app-browser'

/**
 * CONTINUE WITH FACEBOOK (owner, 2026-10-16: "in facebook browser sign in doesnt show google sign in or apple sign in … if
 * needed add sign in with facebook"). GoTrue's `facebook` provider — what it asks Facebook for by default: `email` and
 * the public profile (id, name, picture link). Client-safe; the server's "is it on?" is src/lib/auth/facebook.ts.
 *
 * ⛔ DARK UNTIL CONFIGURED. The owner creates the Meta app and runs infra/vn-node/apply-facebook-signin.sh; until GoTrue's
 * own settings say `facebook: true` no button shows anywhere, and no deploy is needed to switch it on.
 *
 * ⚠️ OFFERED, NOT LEADING (plan v4 review, codex + opus, 2026-10-16). 85% of the teacher landings are in Facebook's
 * in-app browser, where Facebook's own sign-in is EXPECTED to know the visitor already ("Continue as …") — but nobody
 * has watched it happen on a real phone yet. Until the owner has, and the counters (signup-prompt.ts `facebook`) show
 * Facebook sign-ins finishing there, the emailed code — measured, it works in place — stays first in in-app browsers,
 * and Facebook sits beside Google under it; in a real browser it follows Google and Apple.
 *
 * Facebook's picture link expires (fbcdn/fbsbx `ext` + `hash`), so it never becomes the account photo (profile.ts
 * providerAvatarUrl). Facebook's access token is never kept: GoTrue's flow state is blanked by a trigger the apply
 * script installs, and /auth/callback strips any that still arrives (stripFacebookToken).
 */
export const FACEBOOK_PROVIDER = 'facebook'

/** Meta's own apps — the in-app browsers Facebook Login is expected to work inside (see facebookAvailableHere). */
const META_HOSTS: ReadonlySet<string> = new Set(['facebook', 'messenger', 'instagram'])

/**
 * May "Continue with Facebook" show in THIS context? Every real browser; never inside the eno apps (the Capacitor shell,
 * the native tabs: they sign in through their own native flows, which have no Facebook yet) or the app's in-app sheet.
 * ⛔ AND NOT IN ANOTHER APP'S ANDROID WEBVIEW (gate review, 2026-10-16): Meta stopped Facebook Login in Android embedded
 * browsers on 2021-10-05 (developers.facebook.com/docs/facebook-login/android/deprecating-webviews) — Zalo's, TikTok's or
 * any raw `wv` would end on Facebook's "not supported" page. Meta's own (Facebook, Messenger, Instagram) stay offered:
 * whether its dialog runs inside Facebook's Android browser is the owner's first phone test (facebook-signin.md § Test).
 * iOS in-app browsers were not part of that deprecation.
 */
export function facebookAvailableHere(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (c?.isNativePlatform?.()) return false
  const ua = navigator.userAgent || ''
  if (/EnoNativeApp|EnoNativeTabs/.test(ua)) return false
  if (isNativeTabs() || inAppSheetDocument()) return false
  if (/Android/.test(ua)) {
    const host = inAppHost(ua)
    if (host ? !META_HOSTS.has(host) : /\bwv\b/.test(ua)) return false
  }
  return true
}
