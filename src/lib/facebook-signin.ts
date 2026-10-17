import { inAppSheetDocument } from './app-review-gates'
import { META_IN_APP_HOSTS, inAppHost, isNativeTabs } from './in-app-browser'

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

/**
 * The account has a Facebook identity: `app_metadata.providers` (or the first `provider`) names it, in any case (GoTrue
 * keeps a provider as the authorize request spelled it). ⛔ Its email is then Platform Data under Meta's Platform Terms,
 * which bar passing it to another ad network — so TikTok never gets it (api/teachers/me, the D14 rule widened).
 */
export function isFacebookLinked(appMetadata: unknown): boolean {
  if (!appMetadata || typeof appMetadata !== 'object') return false
  const m = appMetadata as { provider?: unknown; providers?: unknown }
  const is = (p: unknown) => typeof p === 'string' && p.trim().toLowerCase() === FACEBOOK_PROVIDER
  return is(m.provider) || (Array.isArray(m.providers) && m.providers.some(is))
}

/**
 * Meta's own apps — the in-app browsers Facebook Login is expected to work inside (see facebookAvailableHere). ONE list
 * with the teacher landing's "Open in your browser" (in-app-browser.ts), so the hold-back and the escape never disagree.
 */
const META_HOSTS: ReadonlySet<string> = META_IN_APP_HOSTS

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

/**
 * ⛔ HELD BACK WHERE IT CANNOT FINISH TODAY (owner, 2026-10-17 — the bounce study's "now" list): Meta returns no email
 * until its App Review passes, so no attempt has ever produced an account (15 on 10-17, 0 Facebook identities). Most
 * came from the teacher form's sign-in and Meta's own built-in browsers, where it was the second button. Kept on the
 * /signin page in a real browser — where Meta's reviewer is told to test it. Lift this (delete the call) once a Facebook
 * identity exists, then show it FIRST inside Facebook's browser.
 */
export function facebookHeldBack(gate: string | undefined): boolean {
  if (gate === 'teacher') return true
  if (typeof navigator === 'undefined') return false
  const host = inAppHost(navigator.userAgent || '')
  return host !== null && META_HOSTS.has(host)
}
