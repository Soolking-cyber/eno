import 'server-only'
import crypto from 'crypto'
import { IS_SERVICES } from '@/lib/edition'

// Shared config for the product feeds (Google Merchant Center + Meta/Facebook catalog).
// Both platforms accept PHYSICAL PRODUCTS only — rentals, jobs, services, events,
// tickets and property aren't products, so feeding them flags the whole feed. Restrict
// to the sellable retail categories, and to listingType 'sell'.
export const FEED_CATEGORIES = [
  'electronics', 'fashion-beauty', 'vehicles', 'furniture-appliances',
  'baby-kids', 'hobbies-sports', 'pets', 'food-drink', 'moving-sale',
]

/**
 * THE CATEGORIES THIS DEPLOYMENT MAY PUT IN AN AD CATALOGUE.
 *
 * ⛔ `services` IS ADDED ON eno.forum AND NEVER ON eno.vn, AND THAT ASYMMETRY IS THE WHOLE REASON
 * THIS FUNCTION EXISTS RATHER THAN A SECOND CONSTANT. The route comments call the omission of
 * 'services' a licensing guarantee for the licensed sàn TMĐT — "re-categorise ONE product and eno's
 * e-Visa service enters the licensed company's live Merchant Center / Meta ad catalog" — and that
 * stays exactly true. eno.forum is the deployment that MAY sell visa and trip services, and the
 * owner asked for its catalogue (2026-08-18: "we need eno forum catalogue too"), so the same feed
 * has to answer differently there.
 *
 * ⚠️ `IS_SERVICES` IS A BUILD-TIME CONSTANT, so the marketplace artifact folds this to the bare
 * FEED_CATEGORIES list. The guarantee is not a runtime branch someone can flip with an env var.
 *
 * ⚠️ WHAT THIS DOES NOT CHANGE: `scopedListingWhere` still runs on both editions, `verified: true`
 * and `status: 'active'` still apply, and the marketplace still excludes the desk's seller. Adding
 * a category widens what eno.forum MAY advertise; it removes none of the other filters.
 *
 * ⚠️ AND META/GOOGLE TREAT SERVICES DIFFERENTLY FROM GOODS. The header above is right that both
 * platforms are built for physical products — a service catalogue is accepted but is the platform's
 * looser path, so expect more manual review on eno.forum's items than on ordinary retail.
 */
export function feedCategories(): string[] {
  return IS_SERVICES ? [...FEED_CATEGORIES, 'services'] : FEED_CATEGORIES
}

/**
 * The `listingType` values this deployment may put in an ad catalogue.
 *
 * ⛔ THERE ARE TWO INDEPENDENT GUARDS, NOT ONE, AND MISSING THIS SECOND ONE IS WHY THE FORUM FEED
 * STAYED EMPTY AFTER `services` WAS ADDED ABOVE. The route comment states both plainly —
 * "FEED_CATEGORIES omits 'services' AND the desk's rows are listingType 'service'" — and they are
 * belt and braces: either alone keeps visa products out of eno.vn's catalogue. Widening one and
 * declaring victory produced a feed that still returned a bare header, which is exactly the kind of
 * "shipped and silently does nothing" result a 200 response hides.
 *
 * ⚠️ eno.vn KEEPS `['sell']` AND ONLY THAT. A service is not a product on either platform, and on
 * the licensed sàn TMĐT it is also the thing that may not be advertised at all. Both reasons point
 * the same way, so this list must never grow on the marketplace side.
 */
export function feedListingTypes(): string[] {
  return IS_SERVICES ? ['sell', 'service'] : ['sell']
}

// Our top-level categories → Google product taxonomy IDs (broad + safe; the platform
// refines from title/description). Meta's catalog also accepts the Google taxonomy id
// in google_product_category. Omitted categories let the platform auto-categorize.
export const GOOGLE_PRODUCT_CATEGORY: Record<string, string> = {
  electronics: '222',            // Electronics
  'fashion-beauty': '166',       // Apparel & Accessories
  vehicles: '888',               // Vehicles & Parts
  'furniture-appliances': '536', // Home & Garden
  'baby-kids': '537',            // Baby & Toddler
  'hobbies-sports': '988',       // Sporting Goods
  pets: '1',                     // Animals & Pet Supplies
  'food-drink': '422',           // Food, Beverages & Tobacco
  'moving-sale': '536',          // Home & Garden (whole-home liquidations)
}

// A listing seeded with mock images (picsum / loremflickr) is TEST data. Excluded from
// a feed when ?exclude_mock=1 (or env CATALOG_EXCLUDE_MOCK=true), so paid catalog ads
// never run against fake products. Default OFF so the initial catalog import still works.
const MOCK_IMAGE_HOSTS = ['picsum.photos', 'loremflickr.com', 'placehold']
export function isMockImages(images: string[]): boolean {
  if (images.length === 0) return false
  // Match the URL HOSTNAME (not a substring of the whole URL) so a real image whose
  // query string merely mentions a mock host isn't wrongly dropped.
  return images.every((u) => {
    try { return MOCK_IMAGE_HOSTS.some((h) => new URL(u).hostname.includes(h)) }
    catch { return false }
  })
}

// ── Feed access protection ───────────────────────────────────────────────────
// HTTP Basic Auth so ONLY Meta/Google (with the credentials entered in their
// scheduled-fetch "login details") can pull the full product list — not anonymous
// scrapers. Returns a 401 Response when auth is required and fails, else null (allow).
// OPEN by default (no env set) so the feed is never locked out before creds exist —
// set FEED_USER + FEED_PASSWORD in the host to turn protection on.
export function feedAuthError(req: Request): Response | null {
  const user = process.env.FEED_USER
  const pass = process.env.FEED_PASSWORD
  if (!user || !pass) return null // not configured → open (back-compat)

  /**
   * ⛔ A `?key=` TOKEN IS ACCEPTED AS WELL AS BASIC AUTH, BECAUSE META'S VALIDATOR NEVER SENDS THE
   * CREDENTIALS YOU TYPE INTO IT. Measured in Cloud Run's logs while the owner was on the "Add
   * products" screen with the username and password filled in:
   *
   *   13:26:24  401  facebookexternalhit/1.1  /feeds/facebook-catalog.csv
   *   13:25:16  401  facebookexternalhit/1.1  /feeds/facebook-catalog.csv   (×4)
   *
   * Commerce Manager pre-flights the URL ANONYMOUSLY, gets the 401, and reports it as "URL does not
   * link to supported file" — which reads like a format problem and is an auth problem. The Basic
   * credentials are only used later, by the scheduled fetch. So a URL that needs a header can never
   * pass that form, however correct the file is.
   *
   * ⚠️ THE TOKEN IS THE SAME SECRET AS FEED_PASSWORD, deliberately: one value to rotate, and it is
   * already the thing that guards this feed. Compared in constant time like the header path.
   *
   * ⚠️ AND A TOKEN IN A URL IS WEAKER THAN A HEADER — it lands in browser history, referrers and
   * access logs. That is an accepted trade here and NOT a pattern to copy elsewhere: this feed
   * exposes only product data that is already public on the site, and the alternative is no
   * catalogue at all. It must never be used for anything carrying PII.
   */
  const key = new URL(req.url).searchParams.get('key')
  if (key) {
    const a = Buffer.from(key)
    const b = Buffer.from(pass)
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return null
  }

  const hdr = req.headers.get('authorization') || ''
  // Only valid base64 credentials (RFC 7617) — no trailing junk. Buffer.from(base64)
  // never throws, so no try/catch is needed; the length + constant-time compare decide.
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(hdr)
  if (m) {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8')
    const expected = `${user}:${pass}` // full-string compare → a ':' in the password is fine
    // Constant-time compare (length-guarded — timingSafeEqual needs equal lengths).
    if (decoded.length === expected.length && crypto.timingSafeEqual(Buffer.from(decoded), Buffer.from(expected))) {
      return null
    }
  }
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="eno-feeds", charset="UTF-8"', 'Cache-Control': 'no-store', Vary: 'Authorization' },
  })
}

// Cache headers for a feed response. CRITICAL: when the feed is PROTECTED, never let a
// shared CDN cache it (a cached authed body could be served to an anonymous request →
// auth bypass). When open, cache normally — the platforms only fetch hourly.
export function feedCacheHeaders(): Record<string, string> {
  // The open feed and the protected feed share one path, so a shared-CDN copy could be
  // served across the auth boundary (e.g. a stale open copy after protection is turned
  // on). Vary on Authorization for correct cache keying + no-store so there's no
  // cross-request reuse at all. Feeds are pulled hourly, so CDN caching buys nothing.
  return { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }
}
