/**
 * APP STORE GATE `ios-hide-visa` (decision D5; docs/ios-appstore-release.md) — the e-Visa APPLICATION, kept out of the
 * iOS app when the Apple account cannot carry it (Guideline 5.1.1(ix): an Individual, or an organisation that is not
 * the licensed provider, may not take passports, faces and visa forms).
 * SPLIT 2026-10-06: identity and business-document capture (eKYC, the business panel) is its own switch,
 * `ios-hide-kyc` (src/lib/ios-hide-kyc.ts). Owner, 2026-10-06 (decision D19): the e-Visa flow stays in BOTH apps via
 * eno.vn, so this gate stays OFF; only `ios-hide-kyc` is meant to go on.
 *
 * Off (the default: NEXT_PUBLIC_APP_REVIEW_GATES unset) ⇒ every predicate here is false and nothing changes on the web,
 * in the Android app or in the iOS app. On, ONLY the iOS app changes: where it would have applied for an e-Visa it
 * shows VisaInAppNote (visa-start.tsx).
 * SINCE 2026-10-06 THE iOS APP LOADS eno.vn (owner: "ship both with eno.vn"), AND eno.vn IS BUILT WITH
 * MARKETPLACE_HOSTS_SERVICES=true (infra/vn-node/eno-build.sh): visa-start is the REAL module there, so a partner's
 * (VietKite's) e-Visa product, step or thread shows VisaInAppNote's words in the app — words that name no site (owner
 * decision D18).
 *
 * PLAIN TEXT, NEVER A LINK. Inside the app a link to the app's own site reloads the same gated page in the WebView, a
 * link to eno.forum leaves the app for a site the licensed company's app may not send people to, and the in-app Safari
 * sheet would put the very flow this gate removes back inside the app. The person opens Safari themselves.
 *
 * THE FOUR LAYERS (each named where it lives, so the next surface knows which one it needs):
 *  · per-request dashboard pages decide on the SERVER from the user agent and redirect or omit — /dashboard/visa,
 *    /dashboard/services' e-Visa tab (the ios-hide-wallet precedent);
 *  · ISR / edge-cached pages (the PDP, the /vietnam-evisa family) must not vary by user agent — the Cloudflare Worker
 *    keys HTML on URL + language only — so they carry the CSS hooks `ios-app-hidden` / `ios-app-only` (globals.css),
 *    emitted only while the build flag is on;
 *  · client screens (the chat thread, VisaStart / VisaStartPicker) ask `iosHideVisaClient()` / useIosHideVisa;
 *  · the API BACKSTOP — `iosHideVisaRefusesApi` (src/lib/ios-hide-visa-api.ts, imported ONLY by src/proxy.ts so its
 *    route list never enters a client chunk) — refuses every write under the visa-application and visa-card routes
 *    from the iOS app, so a surface someone forgets to hide still cannot take a passport, a portrait or a form.
 *    POST /api/conversations (the funnel every "Chat with seller" reaches) and the send route check the same thing
 *    themselves, because only they know the listing or thread is an e-Visa one.
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
