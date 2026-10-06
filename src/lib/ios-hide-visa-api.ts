/**
 * App Store gates `ios-hide-visa` (src/lib/ios-hide-visa.ts) and `ios-hide-kyc` (src/lib/ios-hide-kyc.ts) — THE API
 * BACKSTOPS, run by src/proxy.ts. ONE LIST PER GATE since 2026-10-06, each refused only while ITS token is on: the
 * owner keeps the e-Visa flow in both apps and takes only identity verification out of the iOS app.
 *
 * ⛔ ITS OWN MODULE, IMPORTED ONLY BY THE PROXY. The route list names e-Visa endpoints; kept out of
 * ios-hide-visa.ts (which client components import), it never reaches a browser chunk on either edition (opus,
 * review).
 * ⛔ AND IT IS THE SAME LIST ON BOTH EDITIONS SINCE 2026-10-06. It used to fold to [] on the marketplace build because
 * "no iOS app ever loads eno.vn"; both apps render eno.vn now (owner: "ship both with eno.vn"), and eno.vn compiles
 * every route below — VietKite's e-Visa chat under MARKETPLACE_HOSTS_SERVICES (/api/visa/applications answers 401
 * there, measured 2026-10-06), eKYC and business verification as marketplace features. The names are already in
 * eno.vn's server artifact (its route manifest), and this module never reaches a client chunk, so carrying them
 * here leaks nothing new.
 */
import { appReviewGate, isIosAppUserAgent, type AppReviewGate } from './app-review-gates'

/**
 * Where an application or an identity/business document is WRITTEN. Admin routes (/api/visa/admin/*) are not here:
 * the desk is not an applicant. Reads stay open — a status, a case the person already started, a finished e-Visa PDF —
 * and so does DELETE: removing one's own draft or document captures nothing (opus, review).
 */
/** `ios-hide-visa` — the e-Visa application. */
export const IOS_HIDDEN_VISA_WRITE_PREFIXES: readonly string[] = [
  '/api/visa/applications', // start, create, edit, documents, extract, select-product, advance, submit, checkout, …
  '/api/visa/cards', //        the chat cards' answers
]
/** `ios-hide-kyc` — identity and business verification. */
export const IOS_HIDDEN_KYC_WRITE_PREFIXES: readonly string[] = [
  '/api/seller/identity', //   eKYC: challenge, document/selfie upload, submit
  '/api/seller/verification', // business verification: its "Business / ID document" takes a person's ID image
]
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'DELETE'])

function refuses(gate: AppReviewGate, prefixes: readonly string[], pathname: string, method: string, userAgent: string | null | undefined): boolean {
  if (!appReviewGate(gate)) return false // the shipped default, and the cheap exit on every request
  if (ALLOWED_METHODS.has(method.toUpperCase())) return false
  if (!prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false
  return isIosAppUserAgent(userAgent)
}

/** The proxy's e-Visa backstop: refuse this request? Pure, so the whole rule is unit-tested without a server. */
export function iosHideVisaRefusesApi(pathname: string, method: string, userAgent: string | null | undefined): boolean {
  return refuses('ios-hide-visa', IOS_HIDDEN_VISA_WRITE_PREFIXES, pathname, method, userAgent)
}

/** The proxy's identity / business-verification backstop (`ios-hide-kyc` — or `ios-hide-visa`, see ios-hide-kyc.ts). */
export function iosHideKycRefusesApi(pathname: string, method: string, userAgent: string | null | undefined): boolean {
  return refuses('ios-hide-kyc', IOS_HIDDEN_KYC_WRITE_PREFIXES, pathname, method, userAgent)
    || refuses('ios-hide-visa', IOS_HIDDEN_KYC_WRITE_PREFIXES, pathname, method, userAgent)
}
