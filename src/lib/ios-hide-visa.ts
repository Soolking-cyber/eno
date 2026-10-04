/**
 * APP STORE GATE `ios-hide-visa` (decision D5 = b; docs/ios-appstore-release.md) — the e-Visa APPLICATION and every
 * identity-document capture, kept out of the iOS app when the Apple account cannot carry them (Guideline 5.1.1(ix):
 * an Individual, or an organisation that is not the licensed provider, may not take passports, faces and visa forms).
 *
 * Off (the default: NEXT_PUBLIC_APP_REVIEW_GATES unset) ⇒ every predicate here is false and nothing changes on the web,
 * in the Android app or in the iOS app. On, ONLY the iOS app changes; where it would have applied or verified it says,
 * in words, that this is done at www.eno.forum in a web browser.
 *
 * ⛔ PLAIN TEXT, NEVER A LINK. Inside the app a link to www.eno.forum loads in the same WebView (it is the app's own
 * origin, and the gate hides the flow again), and the in-app Safari sheet would put the very flow this gate removes
 * back inside the app. The person opens Safari themselves.
 *
 * THE FOUR LAYERS (each named where it lives, so the next surface knows which one it needs):
 *  · per-request dashboard pages decide on the SERVER from the user agent and redirect or omit — /dashboard/visa,
 *    /dashboard/services' e-Visa tab, /dashboard/account/verify (the ios-hide-wallet precedent);
 *  · ISR / edge-cached pages (the PDP, the /vietnam-evisa family) must not vary by user agent — the Cloudflare Worker
 *    keys HTML on URL + language only — so they carry the CSS hooks `ios-app-hidden` / `ios-app-only` (globals.css),
 *    emitted only while the build flag is on;
 *  · client screens (the chat thread, the verification hub, the business panel) ask `iosHideVisaClient()`;
 *  · the API BACKSTOP — `iosHideVisaRefusesApi` (src/lib/ios-hide-visa-api.ts, imported ONLY by src/proxy.ts so its
 *    route list never enters a client chunk) — refuses every write under the visa-application and
 *    identity/business-verification routes from the iOS app, so a surface someone forgets to hide still cannot take a
 *    passport, a selfie or a form. POST /api/conversations (the funnel every "Chat with seller" reaches) and the send
 *    route check the same thing themselves, because only they know the listing or thread is an e-Visa one.
 */
import { appReviewGate, iosAppGate, isIosAppUserAgent } from './app-review-gates'

/** The refusal code the backstop answers with; /messages/pending turns it into the sentence. */
export const IOS_APP_UNAVAILABLE = 'ios_app_unavailable'

/** Server: the gate is on AND this request comes from the iOS app (see isIosAppUserAgent for the Mac caveat). */
export function iosHideVisaFor(userAgent: string | null | undefined): boolean {
  return appReviewGate('ios-hide-visa') && isIosAppUserAgent(userAgent)
}

/** Client: the gate is on AND this is the iOS app. FALSE DURING SSR — server-rendered HTML uses the CSS hooks. */
export function iosHideVisaClient(): boolean {
  return iosAppGate('ios-hide-visa')
}
