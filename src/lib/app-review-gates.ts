/**
 * APP STORE REVIEW GATES — dormant switches for what the native apps show, each one an OWNER DECISION.
 *
 * The apps are WebViews of www.eno.forum, so anything App Review would reject has to be changed on the
 * SITE (docs/ios-appstore-release.md, bucket 1). None of these changes may reach anyone until the
 * owner chooses it, so every one sits behind a token in ONE build-time variable:
 *
 *   NEXT_PUBLIC_APP_REVIEW_GATES=ios-hide-google,ios-hide-wallet,app-signin-tidy,app-no-gtm,site-brand-copy
 *
 * Unset (the default) ⇒ every helper below returns false and nothing changes, on the web or in either
 * app. It is a NEXT_PUBLIC_* value, so it is inlined at build time: set it in
 * /opt/eno/secrets/eno-forum.env (and eno-vn.env — the code is shared) and deploy on the owner's word.
 *
 * | token            | plan | what it does                                                             | decision |
 * |------------------|------|--------------------------------------------------------------------------|----------|
 * | ios-hide-google  | R2   | no "Continue with Google" in the iOS app (Guideline 4.8)                 | D2 = b   |
 * | ios-hide-wallet  | R6   | no Payments row, /dashboard/payments|wallet|payout redirect, iOS app     | D7       |
 * | app-signin-tidy  | R7/R13 | both apps: no disabled "Phone · soon" tab; legal links open in-app     | —        |
 * | app-no-gtm       | R11  | both apps: no Google Tag Manager container                               | —        |
 * | site-brand-copy  | R7   | web + apps, eno.forum: its own name where copy hard-codes eno.vn; an     | —        |
 * |                  |      | English /privacy sentence for the not-yet-registered operator            |          |
 * | ugc-safety       | R3   | web + apps, both sites: block a user (chat header, storefront), unblock  | —        |
 * |                  |      | in settings; a block refuses new threads/messages/offers both ways and   |          |
 * |                  |      | tells moderators (src/lib/user-blocks.ts)                                |          |
 * | app-ai-notice    | R8   | both apps: chat translation asks once (one answer for all chats) before  | D14      |
 * |                  |      | anything goes to Microsoft (Azure AI Translator); "Turn off translation" |          |
 * |                  |      | stops every request THIS person's app makes (what they send follows the  |          |
 * |                  |      | other person's setting); Settings → Preferences turns it back on         |          |
 * |                  |      | (src/lib/chat-translation-consent.ts)                                    |          |
 *
 * ⚠️ "iOS app" = the Capacitor shell on iOS: `window.Capacitor.getPlatform() === 'ios'` on the client,
 * the `EnoNativeApp` user-agent token plus an iOS device string on the server. "Both apps" = the
 * `EnoNativeApp` token alone — Android injects `window.Capacitor` only into server.url, so a UA test
 * is the one that holds on every origin (capacitor.config.ts).
 * ⚠️ CLIENT HELPERS ARE FALSE DURING SSR. Anything rendered on the server that must not flash in the
 * app uses the CSS hooks instead — `ios-app-hidden` / `native-app-hidden` (globals.css), keyed off the
 * `native` / `native-ios` classes the pre-paint head script sets — so the first frame is already right.
 */
/**
 * The native apps' user-agent tokens — the SAME pattern as `NATIVE_UA_RE` in src/lib/consent-value.ts
 * (app-review-gates.test.ts pins the two together). Repeated rather than imported so this module stays
 * dependency-free: next.config.ts imports it at build time to refuse a misspelled gate.
 */
const NATIVE_UA_RE = /EnoNativeApp|EnoNativeTabs/

export const APP_REVIEW_GATES = ['ios-hide-google', 'ios-hide-wallet', 'app-signin-tidy', 'app-no-gtm', 'site-brand-copy', 'ugc-safety', 'app-ai-notice'] as const
export type AppReviewGate = (typeof APP_REVIEW_GATES)[number]

/** Parse the comma list; unknown tokens are ignored (a typo turns nothing on). */
export function parseAppReviewGates(raw: string | undefined | null): Set<AppReviewGate> {
  const known = new Set<string>(APP_REVIEW_GATES)
  const out = new Set<AppReviewGate>()
  for (const t of (raw ?? '').split(',')) {
    const token = t.trim().toLowerCase()
    if (known.has(token)) out.add(token as AppReviewGate)
  }
  return out
}

/**
 * Tokens in the variable that name NO gate. next.config.ts refuses to build when this is non-empty:
 * a typo such as `ios-hide-walet` would otherwise build green with the wallet still showing (codex,
 * review of this change) — fail the build, not the App Review.
 */
export function unknownAppReviewGates(raw: string | undefined | null): string[] {
  const known = new Set<string>(APP_REVIEW_GATES)
  return (raw ?? '').split(',').map((t) => t.trim().toLowerCase()).filter((t) => t && !known.has(t))
}

/** Is this gate switched on for this build? Read per call so tests can stub the env. */
export function appReviewGate(gate: AppReviewGate): boolean {
  return parseAppReviewGates(process.env.NEXT_PUBLIC_APP_REVIEW_GATES).has(gate)
}

/** Client only: the Capacitor app on iOS (the injected bridge reports its platform). */
export function isNativeIOSClient(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
  return cap?.getPlatform?.() === 'ios'
}

/** Client only: either native app, on any origin (UA token — see the header). */
export function isNativeAppClient(): boolean {
  if (typeof navigator === 'undefined') return false
  return NATIVE_UA_RE.test(navigator.userAgent || '')
}

/** Server or client: is this user agent either native app? */
export function isNativeAppUserAgent(ua: string | null | undefined): boolean {
  return NATIVE_UA_RE.test(ua ?? '')
}

/**
 * Server or client: is this user agent the iOS app? The shell appends `EnoNativeApp/1` to WebKit's own
 * UA, and only two apps carry that token — this one and the Android one, whose UA always names Android.
 * ⚠️ NOT A DEVICE-NAME TEST. The same iOS binary on an Apple-silicon Mac ("Designed for iPhone") reports
 * `Macintosh`, while `Capacitor.getPlatform()` still says 'ios' there — a device test would hide the row
 * on the client and still serve the page on the server (opus, review of this file).
 * ⚠️ `EnoNativeTabs` (the shelved SwiftUI app) is deliberately NOT matched here.
 */
export function isIosAppUserAgent(ua: string | null | undefined): boolean {
  const s = ua ?? ''
  return /EnoNativeApp\//.test(s) && !/Android/i.test(s)
}

/** Client: an iOS-app gate is on AND we are in the iOS app. */
export function iosAppGate(gate: AppReviewGate): boolean {
  return appReviewGate(gate) && isNativeIOSClient()
}

/** Client: a both-apps gate is on AND we are in either app. */
export function nativeAppGate(gate: AppReviewGate): boolean {
  return appReviewGate(gate) && isNativeAppClient()
}

/**
 * `site-brand-copy` (R7): the brand a sentence should name. Copy that hard-codes "eno.vn" reads wrong
 * on eno.forum ("not verified by eno.vn" on the forum, in the app). With the gate on it names THIS
 * edition; off, it keeps today's words. On eno.vn both answers are "eno.vn".
 */
export function brandForCopy(siteName: string): string {
  return appReviewGate('site-brand-copy') ? siteName : 'eno.vn'
}
