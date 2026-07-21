import type { MouseEvent } from 'react'

/**
 * Leaving the app, done properly (Capacitor shell).
 *
 * Capacitor sends any URL outside `server.allowNavigation` to the SYSTEM browser: the
 * WebView hands the link off to Safari/Chrome and eno is left behind entirely — the user
 * is now in a different app and has to task-switch back by hand. That HARD EXIT is the most
 * jarring thing a wrapped app does. Route genuinely EXTERNAL links through @capacitor/browser
 * instead (SFSafariViewController on iOS, a Chrome Custom Tab on Android): a real, sandboxed
 * browser presented ON TOP of eno, one "Done" tap from exactly where they were.
 *
 * ⚠️ Three kinds of URL must NOT come through here:
 *
 *  1. FIRST-PARTY (eno.vn / eno.forum, and whatever origin we're actually served from — a LAN
 *     dev build is `http://192.168.x.x:3100`). Those are in capacitor.config `allowNavigation`
 *     and MUST stay in the WebView: that is where the session cookie jar and the SPA router
 *     live. An eno.forum hop additionally needs goToForum()'s single-use SSO handoff — send it
 *     to an in-app browser tab and the user arrives on the forum as a GUEST.
 *
 *  2. NON-http SCHEMES (`mailto:`, `tel:`, `sms:`, `intent:`). SFSafariViewController refuses
 *     anything but http/https outright (@capacitor/browser's iOS `prepare(for:)` checks the
 *     scheme and the call rejects), so these are left to the platform's own handling, which
 *     already opens Mail/Phone correctly from the WebView.
 *
 *  3. GOOGLE OAUTH. It keeps its dedicated path in src/lib/native-auth.ts. The two look
 *     interchangeable — both end at `Browser.open` — but they are not: OAuth needs
 *     `skipBrowserRedirect`, the PKCE verifier cookie that `signInWithOAuth` sets in THIS
 *     WebView, and the `enovn://auth-callback` deep-link return that native-bootstrap
 *     catches. Google also rejects the app's own WebView with `disallowed_useragent`, which is
 *     the whole reason that flow exists. Do NOT fold it into openExternal().
 */

// Hosts the WebView is allowed to navigate to itself — keep in sync with
// capacitor.config.ts `server.allowNavigation`.
const FIRST_PARTY_HOSTS = new Set(['eno.vn', 'www.eno.vn', 'eno.forum', 'www.eno.forum'])

/** True inside the Capacitor shell (iOS/Android). False on web, SSR and desktop. */
export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return !!c?.isNativePlatform?.()
}

/**
 * A third-party http(s) destination — i.e. the only thing that should be handed to the in-app
 * browser. Relative URLs, first-party hosts, the current origin and non-http schemes are all
 * false, so callers can pass any href blindly and get the safe answer.
 */
export function isExternalUrl(url: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const u = new URL(url, window.location.href)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = u.hostname.toLowerCase()
    if (host === window.location.hostname.toLowerCase()) return false
    return !FIRST_PARTY_HOSTS.has(host)
  } catch {
    return false
  }
}

/**
 * Open `url`, keeping the user inside eno wherever we can.
 *  · native shell + external http(s) → in-app browser tab over the app,
 *  · everything else (web, first-party, mailto:/tel:) → unchanged `window.open` behaviour.
 * Never throws: a missing/failed plugin falls back to the web path rather than dead-ending
 * the tap.
 */
export async function openExternal(url: string): Promise<void> {
  const web = () => { window.open(url, '_blank', 'noopener,noreferrer') }
  if (!isNativeShell() || !isExternalUrl(url)) { web(); return }
  try {
    const { Browser } = await import('@capacitor/browser')
    // Brand the Custom Tab / SFSafariViewController toolbar with the LIVE --card token (same
    // surface as the in-app header, already theme-flipped) — the exact pattern native-auth
    // uses. The token is authored as hex in globals.css and Browser.open accepts hex only, so
    // pass it through only while it still is one; anything else just gets the default toolbar.
    const card = getComputedStyle(document.documentElement).getPropertyValue('--card').trim()
    await Browser.open({ url, ...(/^#[0-9a-f]{3,8}$/i.test(card) ? { toolbarColor: card } : {}) })
  } catch {
    web()
  }
}

/**
 * `onClick` for an `<a href>` that may point off-site. Safe to attach to ANY anchor: it reads
 * the anchor's own resolved href and no-ops unless we're in the native shell AND the target is
 * genuinely third-party, so internal routes and `mailto:` links keep their normal behaviour.
 *
 * The web is deliberately untouched — the anchor's own `target="_blank"`, middle-click,
 * cmd/ctrl-click and "open in new tab" all keep working, exactly as before.
 */
export function handleExternalClick(e: MouseEvent<HTMLAnchorElement>): void {
  // Same modifier guard the footer's forum interception uses: a modified or non-primary click
  // is the user asking their BROWSER to do something, and on web that path is untouched anyway.
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const href = e.currentTarget.href // absolute, resolved by the DOM
  if (!isNativeShell() || !isExternalUrl(href)) return
  e.preventDefault()
  void openExternal(href)
}
