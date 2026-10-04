/**
 * App Store gate `ios-hide-visa` (D5 = b; src/lib/ios-hide-visa.ts) — THE API BACKSTOP, run by src/proxy.ts.
 *
 * ⛔ ITS OWN MODULE, IMPORTED ONLY BY THE PROXY. The route list names e-Visa endpoints; kept out of
 * ios-hide-visa.ts (which client components import), it never reaches a browser chunk on either edition (opus,
 * review). And on the marketplace build the list is EMPTY — `IS_SERVICES` is a build-time constant, so the literal
 * folds away there: no iOS app ever loads eno.vn, so there is nothing for it to refuse.
 */
import { IS_SERVICES } from './edition'
import { appReviewGate, isIosAppUserAgent } from './app-review-gates'

/**
 * Where an application or an identity/business document is WRITTEN. Admin routes (/api/visa/admin/*) are not here:
 * the desk is not an applicant. Reads stay open — a status, a case the person already started, a finished e-Visa PDF —
 * and so does DELETE: removing one's own draft or document captures nothing (opus, review).
 */
export const IOS_HIDDEN_WRITE_PREFIXES: readonly string[] = IS_SERVICES
  ? [
      '/api/visa/applications', // start, create, edit, documents, extract, select-product, advance, submit, checkout, …
      '/api/visa/cards', //        the chat cards' answers
      '/api/seller/identity', //   eKYC: challenge, document/selfie upload, submit
      '/api/seller/verification', // business verification: its "Business / ID document" takes a person's ID image
    ]
  : []
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'DELETE'])

/** The proxy's backstop: refuse this request? Pure, so the whole rule is unit-tested without a server. */
export function iosHideVisaRefusesApi(pathname: string, method: string, userAgent: string | null | undefined): boolean {
  if (!appReviewGate('ios-hide-visa')) return false // the shipped default, and the cheap exit on every request
  if (ALLOWED_METHODS.has(method.toUpperCase())) return false
  if (!IOS_HIDDEN_WRITE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false
  return isIosAppUserAgent(userAgent)
}
