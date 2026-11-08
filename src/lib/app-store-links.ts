/**
 * Where the mobile apps live. One module so the header's "Get the app" control, the mobile-web
 * install prompt, the footer and `/app` cannot disagree about what is released.
 *
 * ⚠️ THE PLAY LISTING IS REAL AND LIVE — production carries versionCode 3 (1.0.1, "Eno Marketplace")
 * as of 2026-09-15. The package id is `eno.vn`; Play bound that identifier before the first upload and
 * it cannot be changed. Up to versionCode 4 the app rendered www.eno.forum; from versionCode 5 (1.0.3),
 * like the iOS app, it renders https://eno.vn (owner, 2026-10-06: "ship both with eno.vn").
 *
 * ✅ THE APP STORE LISTING IS LIVE SINCE 2026-11-07 (owner, 2026-11-08: "ios app is live"): "Eno Marketplace"
 * 1.0.3, App Store id 6819638569, bundle vn.eno.app — read from Apple's public lookup
 * (itunes.apple.com/lookup?bundleId=vn.eno.app), released 2026-11-07. Until then iOS said "coming soon"
 * everywhere and the header control stood down on iPhones (O-04); those branches went with this.
 * ⚠️ THE LINK CARRIES NO COUNTRY (`/app/id…`, not `/vn/app/…`): the App Store opens it in the reader's own
 * storefront, and most readers here are expats whose Apple ID is British, Korean, Australian… A storefront
 * where the app is not offered shows Apple's "not available in your country" — that is App Store Connect's
 * Pricing and Availability, not this link.
 *
 * ⚠️ `NEXT_PUBLIC_*` IS INLINED AT BUILD TIME, so changing the Android env var needs a rebuild + deploy,
 * not just a restart. Both editions build from this repo, so both get the same links.
 * ⛔ THE iOS LINK HAS NO ENV OVERRIDE ANY MORE (NEXT_PUBLIC_IOS_APP_URL is no longer read): one id, one link, in code.
 */
export const ANDROID_APP_URL =
  process.env.NEXT_PUBLIC_ANDROID_APP_URL || 'https://play.google.com/store/apps/details?id=eno.vn'

/** Apple's numeric id for the listing. */
export const IOS_APP_STORE_ID = '6819638569'

export const IOS_APP_URL = `https://apps.apple.com/app/id${IOS_APP_STORE_ID}`

/**
 * Which store a device installs from, by its user agent — EXACTLY the tests STORE_OS_HEAD_JS runs before paint (and isIOS()),
 * case-sensitive like them, so the footer's pre-paint class and the card / header link never name different stores (codex,
 * review 2026-11-08: a case-insensitive copy here disagreed with the head script on a lowercase token).
 */
export function storeOs(ua: string, platform = '', maxTouchPoints = 0): 'ios' | 'android' | null {
  if (/Android/.test(ua)) return 'android'
  // iPadOS 13+ Safari sends a Macintosh agent by default; a Mac with a touch screen does not exist.
  if (/iPhone|iPod|iPad/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios'
  return null
}

/**
 * The pre-paint half of naming ONE store on a phone (owner, 2026-11-08: "apple device should be shown ios download and
 * android one the android version"): `os-ios` on an iPhone or iPad — the same test as storeOs() below and
 * isIOS() in src/lib/in-app-browser.ts, iPadOS's Mac agent included — and `os-android` on Android go on <html>, and globals.css hides
 * the other store's link (`data-store`) from the first frame. A desktop gets neither class and keeps both.
 * Read by layout.tsx's head script, inside its web branch (never in the app); src/test/head-script.ts runs it.
 * (Until the App Store listing went live on 2026-11-07 layout.tsx's APP_DOWNLOAD_OFF_JS hid the header control on iOS — O-04.)
 * The string is spliced into a template literal, so it must stay free of backslashes (a `\s` there would silently become `s`).
 */
export const STORE_OS_HEAD_JS =
  "var u=navigator.userAgent||'';if(/Android/.test(u))dc.add('os-android');else if(/iPhone|iPod|iPad/.test(u)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))dc.add('os-ios');";
