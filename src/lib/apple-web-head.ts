import { appleSignInTokens } from './apple-signin'
import { appReviewGate, IN_APP_SHEET_PARAM } from './app-review-gates'
import { IN_APP_UA_RE } from './in-app-browser'

/**
 * THE WEB APPLE BUTTON'S FIRST FRAME — `no-apple-web` on <html>, set before paint where the web Sign in with Apple
 * flow cannot run (the follow-up the `web` flip promised, sign-in-form.tsx at `showApple`).
 *
 * With `web` in NEXT_PUBLIC_APPLE_SIGNIN the server renders the Apple button for everyone (`appleWebAll`), and the
 * mount effect then removes it wherever appleAvailableHere() says no: a known in-app browser, an Android System
 * WebView, an iOS home-screen web app (googleOauthBlocked), the shelved SwiftUI tabs (EnoNativeTabs) and the app's
 * in-app sheet (inAppSheetDocument, only while `app-signin-tidy` is on). Until hydration the button flashed there.
 * This snippet makes the same call before paint, and globals.css hides `.apple-web` under `no-apple-web`.
 *
 * ⛔ THE SAME TESTS, FROM THE SAME SOURCES: IN_APP_UA_RE is googleOauthBlocked's own regex; isIOS, the Android
 * `wv` test, the standalone flag, the EnoNativeApp/EnoNativeTabs tokens and the sheet marker are written as they are
 * there (apple-web-head.test.ts holds the snippet to appleAvailableHere() over a corpus of user agents).
 * ⛔ NEVER IN THE CAPACITOR APPS: there the native branch decides (ios-nosiwa-hidden / native-siwa on iOS; Android
 * shows the web flow), so a native bridge skips the snippet entirely.
 * ⚠️ ITS OWN <script>, not a splice into layout.tsx's template literal: it needs real regexes, and a backslash typed
 * into that template would be eaten. Inline and parser-blocking in <head>, so it still runs before first paint.
 * '' when this build has no `web` — the script tag is then not emitted at all.
 */
export function noAppleWebHeadJs(o: { web: boolean; sheetGate: boolean }): string {
  if (!o.web) return ''
  const sheet = o.sheetGate
    ? `||new URLSearchParams(location.search).get(${JSON.stringify(IN_APP_SHEET_PARAM)})==='1'`
    : ''
  return (
    '(function(){try{var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform())return;' +
    "var u=navigator.userAgent||'';" +
    "var ios=/iPhone|iPod|iPad/.test(u)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);" +
    `if(new RegExp(${JSON.stringify(IN_APP_UA_RE.source)},${JSON.stringify(IN_APP_UA_RE.flags)}).test(u)` +
    '||(/Android/.test(u)&&/\\bwv\\b/.test(u))' +
    '||(ios&&navigator.standalone===true)' +
    '||/EnoNativeApp|EnoNativeTabs/.test(u)' +
    sheet +
    ")document.documentElement.classList.add('no-apple-web')}catch(e){}})();"
  )
}

/** The snippet for THIS build — what layout.tsx emits as its own <script> ('' without `web`: no tag). */
export const NO_APPLE_WEB_JS = noAppleWebHeadJs({ web: appleSignInTokens().has('web'), sheetGate: appReviewGate('app-signin-tidy') })
