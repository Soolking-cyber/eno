import 'server-only'
import crypto from 'crypto'
import type { SerializedListing } from '@/lib/types'
import { containsPhoneNumber } from '@/lib/phone'

// ── The Partner API sandbox (owner 2026-11-18: ora "sandbox-environment", "onboarding-friction", "async-job-pattern") ──
//
// ⛔ NOTHING HERE READS OR WRITES THE DATABASE, AND THAT IS THE DESIGN, NOT A SHORTCUT. A test key is not a row: it is
// `eno_test_<expiry>_<nonce>_<mac>`, signed with a key derived from the server secret under its OWN HKDF label (so no
// sandbox signature can ever verify as an access token, a grant or anything else), and checked by recomputing the mac.
// A job id is signed the same way, bound to the key that started it, and its state is a function of its age. The data
// is the fixture below. The only shared state the routes touch is the rate limiter every public route already uses.
// ⛔ A TEST KEY OPENS NOTHING BUT /api/v1/sandbox. Its body has underscores, so it fails `API_KEY_RE`, and it has no dots,
// so it is not an access token either: resolveApiKey refuses it as malformed before any lookup (sandbox.test.ts pins
// both). The sandbox in turn reads ONLY this shape, so a live key or token sent here is refused without being looked up.

export const SANDBOX_KEY_TTL_SEC = 24 * 3600
/** Per IP, because a key costs nothing to mint and the limiter needs something the caller cannot multiply. */
export const SANDBOX_KEYS_PER_IP_PER_HOUR = 10
export const SANDBOX_RATE_PER_MIN = 120
/** A job is `pending` for its first 2 s, `running` until 5 s, then `done`; after an hour its id is refused. */
export const JOB_RUNNING_AFTER_MS = 2_000
export const JOB_DONE_AFTER_MS = 5_000
export const JOB_TTL_MS = 3_600_000

const KEY_RE = /^eno_test_([0-9a-z]{6,9})_([0-9a-f]{24})_([0-9a-f]{32})$/
const JOB_RE = /^job_([0-9a-z]{8,9})_([0-9a-f]{16})_([0-9a-f]{32})$/

let cached: { ikm: string; key: Buffer } | null = null
function signingKey(): Buffer | null {
  const ikm = process.env.SUPABASE_SECRET_KEY || process.env.CRON_SECRET
  if (!ikm) return null
  if (cached?.ikm !== ikm) {
    cached = { ikm, key: Buffer.from(crypto.hkdfSync('sha256', Buffer.from(ikm), Buffer.from('eno-sandbox-v1'), Buffer.from('partner-api-sandbox'), 32)) }
  }
  return cached.key
}
const mac = (key: Buffer, input: string) => crypto.createHmac('sha256', key).update(input).digest('hex').slice(0, 32)
const sameMac = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** A new test key, or null when the server has no secret to sign with. */
export function mintSandboxKey(nowMs: number): { key: string; expiresAt: Date } | null {
  const k = signingKey()
  if (!k) return null
  const exp = Math.floor(nowMs / 1000) + SANDBOX_KEY_TTL_SEC
  const e36 = exp.toString(36)
  const nonce = crypto.randomBytes(12).toString('hex')
  return { key: `eno_test_${e36}_${nonce}_${mac(k, `key|${e36}|${nonce}`)}`, expiresAt: new Date(exp * 1000) }
}

export type SandboxKeyCheck = { ok: true; keyId: string } | { ok: false; reason: 'invalid' | 'expired' | 'unavailable' }

/** `keyId` is the key's nonce: not secret, never the key itself. */
export function verifySandboxKey(raw: string, nowMs: number): SandboxKeyCheck {
  const m = KEY_RE.exec(raw)
  if (!m) return { ok: false, reason: 'invalid' }
  const k = signingKey()
  if (!k) return { ok: false, reason: 'unavailable' }
  const [, e36, nonce, sig] = m
  if (!sameMac(sig, mac(k, `key|${e36}|${nonce}`))) return { ok: false, reason: 'invalid' }
  if (parseInt(e36, 36) * 1000 <= nowMs) return { ok: false, reason: 'expired' }
  return { ok: true, keyId: nonce }
}

export function startSandboxJob(keyId: string, nowMs: number): string | null {
  const k = signingKey()
  if (!k) return null
  const c36 = nowMs.toString(36)
  const nonce = crypto.randomBytes(8).toString('hex')
  return `job_${c36}_${nonce}_${mac(k, `job|${keyId}|${c36}|${nonce}`)}`
}

export type SandboxJob = { status: 'pending' | 'running' | 'done'; createdAt: Date; doneAt: Date }

/** Null for a malformed, forged, expired or another key's job — all indistinguishable to the caller. */
export function readSandboxJob(jobId: string, keyId: string, nowMs: number): SandboxJob | null {
  const m = JOB_RE.exec(jobId)
  const k = signingKey()
  if (!m || !k) return null
  const [, c36, nonce, sig] = m
  if (!sameMac(sig, mac(k, `job|${keyId}|${c36}|${nonce}`))) return null
  const created = parseInt(c36, 36)
  const age = nowMs - created
  if (age < -5_000 || age > JOB_TTL_MS) return null
  const status = age >= JOB_DONE_AFTER_MS ? 'done' : age >= JOB_RUNNING_AFTER_MS ? 'running' : 'pending'
  return { status, createdAt: new Date(created), doneAt: new Date(created + JOB_DONE_AFTER_MS) }
}

// ── Fixture data: the live API's shapes (SerializedListing, so tsc keeps them in step), sample content ──────────────
// ⛔ Ordinary goods only — no e-Visa, legal-permit or teacher rows (the licensed build serves this file too).

export const SANDBOX_CATEGORIES = [
  { id: 'sbx_cat_electronics', name: 'Electronics', nameVi: 'Điện tử', slug: 'electronics', icon: 'Smartphone', color: 'brand' },
  { id: 'sbx_cat_vehicles', name: 'Vehicles', nameVi: 'Xe cộ', slug: 'vehicles', icon: 'CarFront', color: 'sky' },
  { id: 'sbx_cat_rentals', name: 'Rentals', nameVi: 'Cho thuê', slug: 'rentals', icon: 'KeyRound', color: 'teal' },
] as const satisfies readonly SerializedListing['category'][]

const SELLER: SerializedListing['seller'] = {
  id: 'sbx_shop_1', name: 'Sandbox Shop', avatarColor: '#0f766e', avatarUrl: null, rating: 4.8, reviewCount: 12,
  verifiedSeller: true, officialPartner: false, affiliateDiscountCode: null, affiliateDiscountPercent: null, trustTier: 'trusted',
  trustScore: 82, responseRate: 95, responseTime: 'within an hour', memberSince: '2025-01-15T00:00:00.000Z', phone: null,
  isBusiness: true, unrated: false,
}

function fixture(n: number, cat: SerializedListing['category'], title: string, price: number, extra: Partial<SerializedListing> = {}): SerializedListing {
  return {
    id: `sbx_lst_${n}`, title, titleVi: null, description: 'Sample listing for the sandbox. Not a real item.', descriptionVi: null,
    price, priceUnit: 'VND', currency: '₫', negotiable: true, affiliateUrl: null, isPartnerBooking: false, isSponsored: false,
    affiliateDiscountCode: null, affiliateDiscountPercent: null, prevPrice: null, priceDropAt: null, dropExpiresAt: null, urgent: false,
    urgentUntil: null, location: 'District 1, Ho Chi Minh City', district: 'District 1', city: 'Ho Chi Minh City', lat: null, lng: null,
    condition: 'used', images: [], video: null, categoryId: cat.id, subcategorySlug: null, brandSlug: null, model: null, listingType: 'sell',
    category: cat, sellerId: SELLER.id, seller: SELLER, verified: true, status: 'active', verificationMethod: null, verifiedAt: null,
    verifiedBy: null, verificationNotes: null, postedAt: `2026-11-0${n}T03:00:00.000Z`, views: 0, savedCount: 0, contactCount: 0,
    availabilityConfirmedAt: null, featured: false, attributes: null, year: null, mileageKm: null, engineL: null, ...extra,
  }
}

const [ELEC, VEH, RENT] = SANDBOX_CATEGORIES
const RENTAL = { listingType: 'rent', condition: null } as const
/** Newest first, like the live list. */
export const SANDBOX_LISTINGS: readonly SerializedListing[] = [
  fixture(6, RENT, '2-bedroom apartment in Thao Dien', 18_000_000, { ...RENTAL, district: 'Thu Duc', location: 'Thao Dien, Thu Duc' }),
  fixture(5, RENT, 'Studio apartment in District 3', 7_500_000, { ...RENTAL, district: 'District 3', location: 'District 3, Ho Chi Minh City' }),
  fixture(4, VEH, 'Yamaha NVX 155, 2021', 35_000_000, { year: 2021, mileageKm: 15_000 }),
  fixture(3, VEH, 'Honda Vision, 2022', 28_000_000, { year: 2022, mileageKm: 8_000 }),
  fixture(2, ELEC, 'Dell XPS 13 laptop', 14_000_000),
  fixture(1, ELEC, 'iPhone 14, 128 GB', 9_500_000),
]

// ── Input checks for the create/update calls, the live route's rules (src/app/api/v1/listings/route.ts) ─────────────

const LISTING_TYPES = new Set(['sell', 'rent', 'free', 'wanted'])
export type ListingCheck = { ok: true; value: Record<string, string | number> } | { ok: false; status: 422; code: string; message: string }

/** `partial`: an update, where every field is optional but at least one must be sent. Unknown fields are ignored. */
export function checkSandboxListing(body: unknown, partial: boolean): ListingCheck {
  const bad = (code: string, message: string): ListingCheck => ({ ok: false, status: 422, code, message })
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('invalid_input', 'The body must be a JSON object.')
  const b = body as Record<string, unknown>
  const value: Record<string, string | number> = {}
  const has = (k: string) => b[k] !== undefined && b[k] !== null
  if (has('categorySlug') || !partial) {
    const slug = String(b.categorySlug ?? '').trim()
    if (!SANDBOX_CATEGORIES.some((c) => c.slug === slug)) {
      return bad('unknown_category', `Unknown category. The sandbox has: ${SANDBOX_CATEGORIES.map((c) => c.slug).join(', ')}.`)
    }
    value.categorySlug = slug
  }
  if (has('title') || !partial) {
    const title = (typeof b.title === 'string' ? b.title : '').trim().slice(0, 140)
    if (title.length < 3) return bad('invalid_input', 'A title of at least 3 characters is required.')
    value.title = title
  }
  if (has('price') || !partial) {
    const price = typeof b.price === 'number' ? b.price : NaN
    if (!Number.isFinite(price) || price < 0 || price > 1e12) return bad('invalid_input', 'price must be a number from 0 to 1e12 (VND).')
    value.price = price
  }
  if (has('description')) {
    if (typeof b.description !== 'string' || b.description.length > 5000) return bad('invalid_input', 'description must be a string of at most 5000 characters.')
    value.description = b.description
  }
  if (has('listingType')) {
    if (typeof b.listingType !== 'string' || !LISTING_TYPES.has(b.listingType)) return bad('invalid_input', 'listingType must be one of sell, rent, free, wanted.')
    value.listingType = b.listingType
  }
  if (partial && Object.keys(value).length === 0) return bad('invalid_input', 'Send at least one of categorySlug, title, price, description, listingType.')
  if (containsPhoneNumber(String(value.title ?? '')) || containsPhoneNumber(String(value.description ?? ''))) {
    return bad('no_phone_in_listing', 'Phone numbers are not allowed in the title or description.')
  }
  return { ok: true, value }
}
