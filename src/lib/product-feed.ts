import 'server-only'
import crypto from 'crypto'

// Shared config for the product feeds (Google Merchant Center + Meta/Facebook catalog).
// Both platforms accept PHYSICAL PRODUCTS only — rentals, jobs, services, events,
// tickets and property aren't products, so feeding them flags the whole feed. Restrict
// to the sellable retail categories, and to listingType 'sell'.
export const FEED_CATEGORIES = [
  'electronics', 'fashion-beauty', 'vehicles', 'furniture-appliances',
  'baby-kids', 'hobbies-sports', 'pets', 'food-drink', 'moving-sale',
]

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
