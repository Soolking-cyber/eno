/**
 * APP STORE GATE `ios-hide-kyc` (decision D5, split from `ios-hide-visa` on 2026-10-06; docs/ios-appstore-release.md) —
 * IDENTITY and BUSINESS-DOCUMENT capture kept out of the iOS app for v1: eKYC's passport/CCCD photograph and live
 * selfie (/dashboard/account/verify, KycCapture) and the business panel's "Business / ID document" + bank uploads.
 * Owner, 2026-10-06: the e-Visa application stays in BOTH apps (so `ios-hide-visa` stays OFF) and identity
 * verification stays web-only on iOS — this switch.
 *
 * Off (the default: NEXT_PUBLIC_APP_REVIEW_GATES unset) ⇒ every predicate here is false and nothing changes on the web,
 * in the Android app or in the iOS app. On, ONLY the iOS app changes: where it would have verified someone it says, in
 * plain text, that this is done in a web browser on the build's own site (IosVerifyElsewhereNote — "eno.vn" on the
 * marketplace build the app loads). Plain text, never a link — the reason is in src/lib/ios-hide-visa.ts.
 *
 * THE LAYERS (the same shape as ios-hide-visa's, minus the ISR one — no edge-cached page carries a KYC control):
 *  · per request, on the SERVER: /dashboard/account/verify redirects the app to the verification hub;
 *  · client screens: the verification hub and the business panel ask `useIosHideKyc()`; KycCapture asks
 *    `iosHideKycClient()` after mount, so the camera is never requested in the app;
 *  · the API BACKSTOP: `iosHideKycRefusesApi` (src/lib/ios-hide-visa-api.ts, run by src/proxy.ts) refuses every
 *    write under /api/seller/identity and /api/seller/verification from the iOS app with 403 `ios_app_unavailable`.
 */
import { appReviewGate, iosAppGate, isIosAppUserAgent } from './app-review-gates'

/**
 * ⛔ `ios-hide-visa` STILL HIDES IDENTITY CAPTURE TOO (review, 2026-10-06). Until the split that token covered eKYC, so
 * an env line that still names only it must keep doing so: the split may never REOPEN the passport/selfie camera in an
 * iOS build (guideline 5.1.1(ix)). The other way stays free — `ios-hide-kyc` alone leaves the e-Visa flow in the app.
 */
const KYC_TOKENS = ['ios-hide-kyc', 'ios-hide-visa'] as const

/** The build flag: either token on (no user-agent test — callers use it to skip work, e.g. reading headers). */
export function iosHideKycOn(): boolean {
  return KYC_TOKENS.some((t) => appReviewGate(t))
}

/** Server: the gate is on AND this request comes from the iOS app (see isIosAppUserAgent for the Mac caveat). */
export function iosHideKycFor(userAgent: string | null | undefined): boolean {
  return iosHideKycOn() && isIosAppUserAgent(userAgent)
}

/** Client: the gate is on AND this is the iOS app. FALSE DURING SSR — see useIosHideKyc. */
export function iosHideKycClient(): boolean {
  return KYC_TOKENS.some((t) => iosAppGate(t))
}
