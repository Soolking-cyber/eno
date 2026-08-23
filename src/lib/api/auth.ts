import 'server-only'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { rateLimit, type RateLimitSnapshot } from '@/lib/ratelimit'
import { verifyAccessToken, looksLikeAccessToken } from '@/lib/api/oauth'
import { logError } from '@/lib/log'

// ── /api/v1 machine authentication ───────────────────────────────────────────────
// The ONLY authn for the partner API. Keys are Bearer tokens of the form
// `eno_live_<32+ base62>`; only their sha256 hash is stored (the secret is shown once at
// mint). Resolving a key yields the shop (sellerId) it acts for + its scopes, and applies
// a per-key rate limit. The edge pin exempts /api/v1 precisely because THIS is its guard.

export const API_KEY_RE = /^eno_(live|test)_[A-Za-z0-9]{32,}$/
export const API_RATE_PER_MIN = 600
/**
 * The window those 600 requests are counted over, in seconds, as a NUMBER.
 * ⚠️ Exported so `/api/v1/status` can publish the authenticated budget without retyping it. That
 * endpoint had `window_seconds: 60` hardcoded beside the imported limit, which meant a change to
 * the window here would have left the one document whose job is to state the budget confidently
 * stating the old one. The `'1 m'` string below is what `rateLimit()` actually parses; this is its
 * value in the unit the RFC headers and the status document use. Keep them in step.
 */
export const API_RATE_WINDOW_SEC = 60

export function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

// Mint a fresh key: returns the FULL secret (return to the user ONCE) + the parts to
// persist (prefix for display, hash for lookup).
export function generateApiKey(env: 'live' | 'test' = 'live'): { secret: string; prefix: string; hashedKey: string } {
  const body = crypto.randomBytes(24).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 32)
  const secret = `eno_${env}_${body}`
  return { secret, prefix: secret.slice(0, 16), hashedKey: hashApiKey(secret) }
}

export type ApiAuth = { keyId: string; sellerId: string; profileId: string; scopes: Set<string> }
export type ApiAuthResult =
  | { ok: true; auth: ApiAuth; rate: RateLimitSnapshot }
  /**
   * ⚠️ `rate` IS OPTIONAL ON THE FAILURE SIDE BECAUSE MOST FAILURES HAPPEN BEFORE THE LIMITER.
   * A missing/malformed key is rejected without ever counting against a bucket, so there is no
   * honest budget to report — and inventing one (`limit=600, remaining=600`) would advertise a
   * quota to an unauthenticated caller. The 429 branches DO carry it: that is the one response
   * a self-throttling client most needs the numbers and `Retry-After` on, and until 2026-08-23
   * it was the only /api/v1 response that shipped none of them.
   */
  | { ok: false; status: number; code: string; message: string; rate?: RateLimitSnapshot }

/**
 * Resolve + authorize a partner request. Reads the `Authorization: Bearer <key>` header,
 * looks the key up by hash, rejects missing/invalid/revoked keys, enforces `requiredScope`,
 * and applies a per-key sliding-window rate limit (fail-OPEN — a Redis blip must not 500 a
 * partner; abuse stays bounded by revocability + the global breakers). Best-effort touches
 * lastUsedAt. NEVER throws.
 */
export async function resolveApiKey(req: Request, requiredScope?: string): Promise<ApiAuthResult> {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get('authorization') || '').trim())
  const raw = (m?.[1] || '').trim()

  // OAuth2 access token (JWT from /api/v1/oauth/token) — stateless, no DB lookup. Scopes
  // travel in the token; rate-limit keyed by the underlying key id (shared with the key).
  if (raw && looksLikeAccessToken(raw)) {
    const tok = verifyAccessToken(raw, Math.floor(Date.now() / 1000))
    if (!tok) return { ok: false, status: 401, code: 'unauthorized', message: 'Invalid or expired access token.' }
    if (requiredScope && !tok.scopes.has(requiredScope)) {
      return { ok: false, status: 403, code: 'insufficient_scope', message: `This token is missing the "${requiredScope}" scope.` }
    }
    const rl = await rateLimit('apiv1', tok.keyId, API_RATE_PER_MIN, '1 m')
    if (!rl.success) return { ok: false, status: 429, code: 'rate_limited', message: 'Rate limit exceeded. Slow down or back off.', rate: rl }
    return { ok: true, auth: { keyId: tok.keyId, sellerId: tok.sellerId, profileId: tok.profileId, scopes: tok.scopes }, rate: rl }
  }

  if (!raw || !API_KEY_RE.test(raw)) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Missing or malformed API key. Send `Authorization: Bearer eno_live_…`.' }
  }
  let key: { id: string; sellerId: string; profileId: string; scopes: string; revokedAt: Date | null } | null = null
  try {
    key = await db.apiKey.findUnique({
      where: { hashedKey: hashApiKey(raw) },
      select: { id: true, sellerId: true, profileId: true, scopes: true, revokedAt: true },
    })
  } catch {
    return { ok: false, status: 503, code: 'unavailable', message: 'Authentication is temporarily unavailable.' }
  }
  if (!key || key.revokedAt) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Invalid or revoked API key.' }
  }
  const scopes = new Set(key.scopes.split(/\s+/).filter(Boolean))
  if (requiredScope && !scopes.has(requiredScope)) {
    return { ok: false, status: 403, code: 'insufficient_scope', message: `This key is missing the "${requiredScope}" scope.` }
  }
  // ⛔ strict: FAIL CLOSED. Without it a limiter backend error returns success:true and
  // every API key becomes unlimited for the duration of the outage — the one moment
  // the database is already unhealthy is the worst possible time to remove its only
  // throttle. A partner seeing 429s during an outage retries; an unthrottled partner
  // during an outage is what turns a blip into an incident.
  const rl = await rateLimit('apiv1', key.id, API_RATE_PER_MIN, '1 m', { strict: true })
  if (!rl.success) {
    return { ok: false, status: 429, code: 'rate_limited', message: 'Rate limit exceeded. Slow down or back off.', rate: rl }
  }
  void db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch((e) => logError(e, { op: 'apiKey.touchLastUsed' }))
  // ⚠️ `rate: rl` — the limiter's own snapshot, not a re-derived `{ limit, remaining }` pair. The
  // reset it carries was measured by the same SQL statement that did the check (see
  // src/lib/ratelimit.ts), and rebuilding the object here is how that field silently gets lost.
  return { ok: true, auth: { keyId: key.id, sellerId: key.sellerId, profileId: key.profileId, scopes }, rate: rl }
}

// Confirm a listing belongs to the key's shop — the v1 write/mutate guard (RLS is
// bypassed, so ownership MUST be checked in app code). True iff the listing exists AND its
// sellerId matches; a non-owned/absent id is treated as 404 by the caller (no leak).
export async function listingOwnedBy(listingId: string, sellerId: string): Promise<boolean> {
  const l = await db.listing.findUnique({ where: { id: listingId }, select: { sellerId: true } }).catch(() => null)
  return !!l && l.sellerId === sellerId
}
