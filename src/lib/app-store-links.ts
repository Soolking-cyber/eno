/**
 * Where the mobile apps live. One module so the header's "Get the app" control, the mobile-web
 * install prompt and anything added later cannot disagree about what is released.
 *
 * ⚠️ THE PLAY LISTING IS REAL AND LIVE — production carries versionCode 3 (1.0.1, "Eno Marketplace")
 * as of 2026-09-15. The package id is `eno.vn`, which is NOT the site the app renders (it loads
 * eno.forum); Play bound that identifier before the first upload and it cannot be changed.
 *
 * ⛔ iOS HAS NO LINK YET, AND "COMING SOON" IS THEREFORE A FACT, NOT A PLACEHOLDER. The App Store id
 * is assigned at submission, so there is nothing to link to — the UI must say so rather than ship a
 * dead link (owner, 2026-09-16: "tap once android linked ios coming soon"). Set
 * NEXT_PUBLIC_IOS_APP_URL and every surface picks it up with no code change.
 *
 * ⚠️ `NEXT_PUBLIC_*` IS INLINED AT BUILD TIME, so changing either env var needs a rebuild + deploy,
 * not just a restart. Both editions build from this repo, so both get the same links.
 */
export const ANDROID_APP_URL =
  process.env.NEXT_PUBLIC_ANDROID_APP_URL || 'https://play.google.com/store/apps/details?id=eno.vn'

/** Absent until the App Store listing exists — callers show "coming soon" rather than a dead link. */
export const IOS_APP_URL = process.env.NEXT_PUBLIC_IOS_APP_URL || null
