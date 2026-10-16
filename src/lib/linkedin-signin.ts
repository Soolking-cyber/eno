import { inAppSheetDocument } from './app-review-gates'
import { IN_APP_UA_RE, googleOauthBlocked, isNativeTabs } from './in-app-browser'

/**
 * SIGN IN WITH LINKEDIN (owner, 2026-10-15: "Add LinkedIn sign-in too") — GoTrue's `linkedin_oidc` redirect provider,
 * offered on the web for the teacher flow. Client-safe; the server's "is it on?" probe is src/lib/auth/linkedin.ts.
 *
 * ⛔ WHAT IT IS AND IS NOT. LinkedIn's only self-serve API (Oct 2026) returns a name, an email, a 100px photo link and a
 * language — never jobs or education (Apply with LinkedIn takes no new partners; Verified on LinkedIn closed to new
 * developers 2026-10-14). So it signs a teacher in and suggests their name; the profile itself comes from their CV or
 * LinkedIn's own "Save to PDF" file (src/app/api/teachers/me/import). LinkedIn says OIDC "does not verify user
 * identities" — never call anything "LinkedIn verified" (API Terms 3.1(11)).
 */
export const LINKEDIN_PROVIDER = 'linkedin_oidc'
/** The consent row's id (start route → /auth/callback, which links it to the account the sign-in lands on). httpOnly. */
export const LINKEDIN_CONSENT_COOKIE = 'eno_li_consent'

/** The account has a LinkedIn identity: `app_metadata.providers` (or the first `provider`) names it, in any case. */
export function isLinkedInLinked(appMetadata: unknown): boolean {
  if (!appMetadata || typeof appMetadata !== 'object') return false
  const m = appMetadata as { provider?: unknown; providers?: unknown }
  const is = (p: unknown) => typeof p === 'string' && p.trim().toLowerCase() === LINKEDIN_PROVIDER
  return is(m.provider) || (Array.isArray(m.providers) && m.providers.some(is))
}

/**
 * The account was CREATED with LinkedIn: GoTrue's `app_metadata.provider` is the first identity's. ⛔ Not merely linked
 * later — a Google account that once signed in with LinkedIn has `linkedin_oidc` among its providers, and its name is
 * still Google's (review, 2026-10-16). Only this may label anything "LinkedIn".
 */
export function signedUpWithLinkedIn(appMetadata: unknown): boolean {
  if (!appMetadata || typeof appMetadata !== 'object') return false
  const p = (appMetadata as { provider?: unknown }).provider
  return typeof p === 'string' && p.trim().toLowerCase() === LINKEDIN_PROVIDER
}

/**
 * May "Sign in with LinkedIn" show for this user agent? Never in the eno apps (their WebView keeps only eno.vn, and
 * RFC 8252 wants the system browser), never in Facebook / Messenger / Zalo / Instagram… in-app browsers — they hold no
 * LinkedIn session (password + LinkedIn's new-device PIN), and LinkedIn's own "Continue with Google" is refused in an
 * embedded webview, a dead end for teachers whose LinkedIn was made with Google. The server reads the same answer from
 * the request's User-Agent for the first paint.
 */
export function linkedinAvailableForUA(ua: string): boolean {
  if (/EnoNativeApp|EnoNativeTabs/.test(ua)) return false
  if (IN_APP_UA_RE.test(ua)) return false
  if (/Android/.test(ua) && /\bwv\b/.test(ua)) return false
  return true
}

/** Client twin of linkedinAvailableForUA: also the Capacitor bridge, the iOS home-screen app and the in-app sheet. */
export function linkedinAvailableHere(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (c?.isNativePlatform?.()) return false
  return linkedinAvailableForUA(navigator.userAgent || '') && !googleOauthBlocked() && !isNativeTabs() && !inAppSheetDocument()
}

/** The start route, with the notice version the button stood beside and where to come back to. */
export function linkedinStartPath(next: string, noticeVersion: string, origin = ''): string {
  return `${origin}/auth/linkedin/start?n=${encodeURIComponent(noticeVersion)}&next=${encodeURIComponent(next)}`
}
