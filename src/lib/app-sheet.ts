import { APP_SHEET_FRAME_ATTR, IN_APP_SHEET_PARAM, inAppSheetFrame } from './app-review-gates'

export { APP_SHEET_FRAME_ATTR, inAppSheetFrame }

/**
 * ⛔ IN THE APP, AN eno PAGE NEVER OPENS IN A BROWSER (owner, 2026-10-29, on a screenshot of the sign-in's Terms
 * link: "in ios pages should show like native app and not ask to open in the app … for whole app"). A link that asks
 * for a NEW WINDOW (`target="_blank"`) used to leave the app's WebView: on iOS WebKit hands it to Capacitor's
 * `createWebViewWith`, which gives it to Safari; the sign-in's legal links went to the in-app browser sheet
 * (SFSafariViewController / a Custom Tab). Both are a browser showing eno.vn — the whole site again, its own tab bar
 * over the browser's toolbar, and iOS's Universal-Link banner "Open in the eno app" inside the eno app.
 *
 * Now the app shows such a page as ITS OWN sheet (src/components/native/app-sheet-host.tsx): the page in a frame of
 * this same origin, nothing but the page — no header, no tab bar, no footer — under a title and "Done". The screen
 * underneath is left exactly as it was (a half-finished sign-in keeps its typed email and sent code; a half-written
 * listing keeps its photos), which is why a new-window link is a sheet and not a navigation.
 *
 * What stays as it was: another site (the in-app browser or the system, src/lib/native-browser.ts), a file or an API
 * route (a PDF, a CV — the frame is no place for a download), `download` links, and every link on the web.
 */

/** The window event that opens the app's page sheet; `detail` is the URL (already from appSheetUrl). */
export const APP_SHEET_EVENT = 'eno:app-sheet'
/** The window event a page INSIDE the sheet sends its parent for a link to another site (the frame has no bridge). */
export const APP_SHEET_EXTERNAL_EVENT = 'eno:app-sheet-external'

// The app's own hosts — keep in sync with capacitor.config.ts `server.allowNavigation` (src/lib/native-browser.ts).
const APP_HOSTS = new Set(['eno.vn', 'www.eno.vn'])
// A path that names a file is a download or a document the frame cannot show well — it keeps its old way out.
const FILE_PATH_RE = /\.(pdf|png|jpe?g|webp|avif|gif|svg|heic|mp4|mov|webm|mp3|m4a|wav|zip|csv|xlsx?|docx?|pptx?|txt|json|xml|ics|vcf)$/i

const isFileOrApi = (u: URL) => u.pathname.startsWith('/api/') || FILE_PATH_RE.test(u.pathname)

/**
 * The URL the app's sheet shows for `href`, or null when it is not an eno page. `here` is the current document's
 * URL: a relative href resolves against it, and an eno host is rewritten onto ITS origin — the sheet's frame must be
 * same-origin to find its marker, and www.eno.vn only redirects to eno.vn anyway (a dev build serves from its own).
 */
export function appSheetUrl(href: string, here: string): string | null {
  let u: URL
  let base: URL
  try {
    base = new URL(here)
    u = new URL(href, base)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  // THIS origin, or an eno.vn host while the app itself is on eno.vn. Never folded across editions: from another
  // origin (eno.forum, a dev build) an explicit eno.vn link stays eno.vn's, so it keeps its old way out (review, codex).
  if (u.host !== base.host && !(APP_HOSTS.has(u.hostname.toLowerCase()) && APP_HOSTS.has(base.hostname.toLowerCase()))) return null
  if (isFileOrApi(u)) return null
  u.protocol = base.protocol
  u.host = base.host
  // The sheet's page is marked like the old browser sheet's (app-review-gates.ts IN_APP_SHEET_PARAM): no analytics,
  // no cookie bar, no sign-in providers — and the frame check below covers every page it moves on to.
  u.searchParams.set(IN_APP_SHEET_PARAM, '1')
  return u.href
}

// Schemes that run or inline content rather than leave for an app — never handed anywhere (review, opus).
const UNSAFE_SCHEME_RE = /^(javascript|vbscript|data|blob|about|file):$/i

/** True for a URL the phone itself opens (tel:, mailto:, sms:, an app's own scheme) — not http(s), never a script. */
export function isPhoneScheme(href: string): boolean {
  try {
    const p = new URL(href).protocol
    return p !== 'http:' && p !== 'https:' && !UNSAFE_SCHEME_RE.test(p)
  } catch {
    return false
  }
}

/**
 * True when a link INSIDE the sheet must be handed to the app's main frame instead of moving the frame: every http(s)
 * URL the sheet does not take itself (another site, another edition, our own files and API routes — the frame is no
 * place for them, and a SAMEORIGIN page of another origin would only load blank, review codex) and a scheme the phone
 * opens. The frame has no bridge, and the shells hand a subframe's own navigation to nobody.
 */
export function leavesThroughApp(href: string, here: string): boolean {
  let u: URL
  try { u = new URL(href, here) } catch { return false }
  if (u.protocol === 'https:' || u.protocol === 'http:') return appSheetUrl(u.href, here) === null
  return isPhoneScheme(u.href)
}

/**
 * True when `href` only moves within the page at `here` — a #section link, or a bare `#` (a toggle's href): a fragment
 * navigation, which scrolls and never reloads the page.
 */
export function samePageHash(href: string, here: string): boolean {
  try {
    const u = new URL(href, here)
    const h = new URL(here)
    return href.includes('#') && u.origin === h.origin && u.pathname === h.pathname && u.search === h.search
  } catch {
    return false
  }
}

let hostReady = false
/** Set by the sheet's host while it listens (app-sheet-host.tsx) — before that an open would go nowhere. */
export function setAppSheetReady(ready: boolean): void {
  hostReady = ready
}
/** The app's sheet can open right now: its host is mounted and listening in this (top) frame. */
export function appSheetReady(): boolean {
  return hostReady
}

/** Open `url` (from appSheetUrl) in the app's sheet. Only the app mounts the sheet's host, so call it only there. */
export function openAppSheet(url: string): void {
  window.dispatchEvent(new CustomEvent<string>(APP_SHEET_EVENT, { detail: url }))
}

/**
 * The pre-paint half, for layout.tsx's inline head script. A page inside the sheet:
 *  · marks <html> `app-sheet` (CSS hides the header, the tab bar and the floating controls) and takes the app's
 *    `native` + platform class from its parent — the platform only: never `native-siwa` (no bridge here for Apple's
 *    native sign-in, review opus) or `native-tabs`, so every rule the app already applies (no footer, no prelaunch banner, no "Get
 *    the app") applies inside the sheet too;
 *  · ⛔ HIDES `window.Capacitor` FROM ITSELF, for good (a getter that answers undefined, a setter that drops the write).
 *    The frame is a plain page of the app, never a second app: on Android the bridge script is injected into EVERY
 *    frame of the allowed origin (WebViewCompat.addDocumentStartJavaScript), so without this the framed page would run
 *    the native branch of this script and mount NativeBootstrap a second time — a second hardware-back listener (one
 *    press, two steps back), a second deep-link handler, push registration (review, opus). On iOS the bridge script
 *    is main-frame only, but `@capacitor/core` would rebuild the global from WebKit's message handler, which every
 *    frame sees. Every check in the app reads that global, and every `@capacitor/*` import in src is a dynamic one
 *    behind such a check (no static import — app-sheet.test.ts keeps it that way), so this keeps the frame off the
 *    bridge.
 * It runs before the native branch (its own try block, first) and before any bundle, so nothing sees the bridge first.
 */
export const APP_SHEET_HEAD_JS =
  "try{var af=window.frameElement;if(af&&af.hasAttribute('" + APP_SHEET_FRAME_ATTR + "')){var ac=document.documentElement.classList;ac.add('app-sheet');" +
  "try{Object.defineProperty(window,'Capacitor',{configurable:false,get:function(){return undefined},set:function(){}})}catch(e){}" +
  "parent.document.documentElement.classList.forEach(function(c){if(c==='native'||c==='native-ios'||c==='native-android')ac.add(c)})}}catch(e){}"
