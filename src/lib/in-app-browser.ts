/**
 * Whether Google OAuth ("Sign in with Google") will be REJECTED in the current
 * context with `403 disallowed_useragent`. Google's "Use secure browsers" policy
 * blocks OAuth inside embedded webviews — in-app browsers (Facebook/Instagram/Zalo/
 * Line/TikTok/…), Android System WebViews, and iOS Home-Screen PWAs (which run in a
 * webview, not Safari). Phone-OTP and email magic-link are NOT affected, so when this
 * returns true we hide the Google button and steer the user to those instead.
 *
 * Deliberately conservative: normal mobile Safari/Chrome and Android installed PWAs
 * (which DO support Google OAuth via Chrome) are NOT matched.
 */
/** Known in-app browsers (all platforms) — embedded webviews Google rejects. ONE regex: googleOauthBlocked below and
 *  the pre-paint `no-apple-web` script (src/lib/apple-web-head.ts) both read it, so the first frame and the mount
 *  effect cannot disagree about where the web Apple button may show. */
export const IN_APP_UA_RE = /\b(FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|MicroMessenger|Zalo|TikTok|musical_ly|Snapchat|Pinterest|LinkedInApp|GSA|KAKAOTALK)\b/i

export function googleOauthBlocked(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''

  // Known in-app browsers (all platforms) — embedded webviews Google rejects.
  if (IN_APP_UA_RE.test(ua)) return true

  // Android System WebView (apps embedding a raw WebView).
  if (/Android/.test(ua) && /\bwv\b/.test(ua)) return true

  // iOS Home-Screen PWA (standalone) — runs in a webview, not Safari → blocked.
  const iOS = isIOS()
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (iOS && standalone) return true

  return false
}

/**
 * The native iOS app's EMBEDDED web tabs (apps/ios WebTabView/WebSheet append
 * "EnoNativeTabs/1" to the UA). Google rejects OAuth in these raw WKWebViews, and
 * unlike an in-app browser there is no "open in Safari" menu — and even a manual
 * Safari sign-in could not hand its session back to the app's WebView. So these
 * surfaces hide Google entirely and steer to Phone/Email, which work in-place.
 * The Capacitor app is NOT this: it has window.Capacitor and its own
 * nativeGoogleSignIn path (SFSafariViewController + deep-link back).
 */
export function isNativeTabs(): boolean {
  if (typeof navigator === 'undefined') return false
  return /EnoNativeTabs/.test(navigator.userAgent || '')
}

/**
 * WHICH APP'S BUILT-IN BROWSER THIS IS — or null for a real browser, a home-screen PWA or the eno app.
 *
 * Two uses, both added for the UX3 sign-up work (2026-10-05):
 *   · copy that names the place the visitor actually is — the Google hand-off used to tell people in
 *     Facebook or Zalo to "go back to the eno app", which they were never in (handoff-*.tsx);
 *   · the anonymous sign-up counters' coarse context class (`browserContext` below).
 * ⚠️ MESSENGER BEFORE FACEBOOK: Messenger's iOS UA carries `FBAN/MessengerForiOS`, so the Facebook
 * pattern matches it too. The order of this list is the precedence.
 * ⚠️ Same scope as `googleOauthBlocked`'s in-app list, plus Android's raw `wv` WebView as 'other' — and
 * NEVER the Capacitor app (its WebView also says `wv`) or the native iOS tabs: those are the eno app.
 */
export type InAppHost = 'messenger' | 'facebook' | 'instagram' | 'zalo' | 'tiktok' | 'line' | 'google' | 'other'
const IN_APP_HOSTS: ReadonlyArray<readonly [InAppHost, RegExp]> = [
  ['messenger', /\bFBAN\/Messenger|\bFB_IAB\/Orca|\bMessengerForiOS\b|\bMessengerLite/],
  ['facebook', /\b(FBAN|FBAV|FB_IAB|FBIOS|FB4A)\b/],
  ['instagram', /\bInstagram\b/],
  ['zalo', /\bZalo/i],
  ['tiktok', /\b(TikTok|musical_ly|BytedanceWebview)\b/i],
  ['line', /\bLine\//],
  ['google', /\bGSA\//],
  ['other', /\b(MicroMessenger|Snapchat|Pinterest|LinkedInApp|KAKAOTALK)\b/i],
]

/** Inside the eno app itself (Capacitor shell or the native iOS tabs) — never an "in-app browser". */
function insideEnoApp(ua: string): boolean {
  if (/EnoNativeApp|EnoNativeTabs/.test(ua)) return true
  try {
    return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  } catch { return false }
}

export function inAppHost(uaArg?: string): InAppHost | null {
  if (typeof navigator === 'undefined' && uaArg === undefined) return null
  const ua = uaArg ?? navigator.userAgent ?? ''
  if (typeof window !== 'undefined' && insideEnoApp(ua)) return null
  for (const [host, re] of IN_APP_HOSTS) if (re.test(ua)) return host
  // Android System WebView embedded by some other app, with no name we know.
  if (/Android/.test(ua) && /\bwv\b/.test(ua)) return 'other'
  return null
}

/** True for a host we can name in copy ("Facebook", "Zalo" …); 'other' and null are not. */
export const IN_APP_HOST_VALUES: readonly InAppHost[] = IN_APP_HOSTS.map(([h]) => h)
export const isInAppHost = (v: unknown): v is InAppHost =>
  typeof v === 'string' && (IN_APP_HOST_VALUES as readonly string[]).includes(v)

/** The name a visitor knows the host app by. 'other' has none — callers fall back to neutral copy. */
export function inAppHostName(host: InAppHost | null | undefined): string | null {
  switch (host) {
    case 'facebook': return 'Facebook'
    case 'messenger': return 'Messenger'
    case 'instagram': return 'Instagram'
    case 'zalo': return 'Zalo'
    case 'tiktok': return 'TikTok'
    case 'line': return 'LINE'
    // Not 'Google' (opus, gate 2026-10-05): "sign in with Google in Google" names the account and the app the
    // same; the Google app's visitors get the neutral copy, like 'other'.
    default: return null
  }
}

/**
 * THE COARSE CONTEXT CLASS the anonymous sign-up counters are split by (UX3 J1). Six values and
 * nothing finer — the counters stay anonymous daily totals; this only says what KIND of browser the
 * event happened in, because a Facebook or Zalo in-app visitor and a Chrome visitor meet a different
 * sign-in (Google cannot finish in-app).
 *   native      — the eno app (Capacitor shell or the native iOS tabs)
 *   inapp-fb    — Facebook or Messenger's built-in browser
 *   inapp-zalo  — Zalo's built-in browser
 *   inapp-other — any other app's built-in browser (Instagram, TikTok, the Google app, a raw WebView…)
 *   pwa         — eno.vn added to the home screen (standalone display mode)
 *   browser     — everything else
 */
export type BrowserContext = 'native' | 'inapp-fb' | 'inapp-zalo' | 'inapp-other' | 'pwa' | 'browser'
export function browserContext(uaArg?: string): BrowserContext {
  if (typeof navigator === 'undefined' && uaArg === undefined) return 'browser'
  const ua = uaArg ?? navigator.userAgent ?? ''
  if (typeof window !== 'undefined' && insideEnoApp(ua)) return 'native'
  const host = inAppHost(ua)
  if (host === 'facebook' || host === 'messenger') return 'inapp-fb'
  if (host === 'zalo') return 'inapp-zalo'
  if (host) return 'inapp-other'
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return 'pwa'
    if (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa'
  } catch { /* no matchMedia — a browser */ }
  return 'browser'
}

/** Phone or desktop, coarsely: a touch-first device (no hover, coarse pointer) is a phone — tablets included. */
export function deviceClass(): 'phone' | 'desktop' {
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) return 'phone'
  } catch { /* no matchMedia */ }
  return 'desktop'
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPhone|iPod|iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/**
 * Best-effort: re-open `url` in the device's REAL browser, escaping the in-app
 * webview so Google OAuth is allowed. Android: an `intent:` URL hands the link to the
 * default browser. iOS has no reliable API to leave a WKWebView, so we try `_blank`
 * and the caller shows an "Open in Safari" hint as the fallback. Returns true if a
 * real hand-off was issued (Android), false if the user likely must do it manually.
 */
export function openInSystemBrowser(url: string): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/Android/.test(ua)) {
    const noScheme = url.replace(/^https?:\/\//, '')
    // A VIEW intent with an https browser_fallback_url opens the system default browser.
    window.location.href = `intent://${noScheme}#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url)};end`
    return true
  }
  // iOS / others — best effort; most in-app browsers require their own "Open in
  // browser" menu, so the caller surfaces a hint too.
  window.open(url, '_blank', 'noopener,noreferrer')
  return false
}
