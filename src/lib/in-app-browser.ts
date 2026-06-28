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
export function googleOauthBlocked(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''

  // Known in-app browsers (all platforms) — embedded webviews Google rejects.
  if (/\b(FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|MicroMessenger|Zalo|TikTok|musical_ly|Snapchat|Pinterest|LinkedInApp|GSA|KAKAOTALK)\b/i.test(ua)) return true

  // Android System WebView (apps embedding a raw WebView).
  if (/Android/.test(ua) && /\bwv\b/.test(ua)) return true

  // iOS Home-Screen PWA (standalone) — runs in a webview, not Safari → blocked.
  const iOS = isIOS()
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (iOS && standalone) return true

  return false
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
