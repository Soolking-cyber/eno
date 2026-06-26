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
}

// A listing seeded with mock images (picsum / loremflickr) is TEST data. Excluded from
// a feed when ?exclude_mock=1 (or env CATALOG_EXCLUDE_MOCK=true), so paid catalog ads
// never run against fake products. Default OFF so the initial catalog import still works.
const MOCK_IMAGE_HOSTS = ['picsum.photos', 'loremflickr.com', 'placehold']
export function isMockImages(images: string[]): boolean {
  return images.length > 0 && images.every((u) => MOCK_IMAGE_HOSTS.some((h) => u.includes(h)))
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
  const m = /^Basic\s+(.+)$/i.exec(hdr)
  if (m) {
    let decoded = ''
    try { decoded = Buffer.from(m[1], 'base64').toString('utf8') } catch { decoded = '' }
    const expected = `${user}:${pass}`
    // Constant-time compare (length-guarded — timingSafeEqual needs equal lengths).
    if (decoded.length === expected.length && crypto.timingSafeEqual(Buffer.from(decoded), Buffer.from(expected))) {
      return null
    }
  }
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="eno-feeds", charset="UTF-8"', 'Cache-Control': 'no-store' },
  })
}

// Cache headers for a feed response. CRITICAL: when the feed is PROTECTED, never let a
// shared CDN cache it (a cached authed body could be served to an anonymous request →
// auth bypass). When open, cache normally — the platforms only fetch hourly.
export function feedCacheHeaders(): Record<string, string> {
  const isProtected = Boolean(process.env.FEED_USER && process.env.FEED_PASSWORD)
  return isProtected
    ? { 'Cache-Control': 'private, no-store' }
    : { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' }
}
