import 'server-only'
import crypto from 'crypto'

// ── Partner API · OAuth 2.0 client-credentials access tokens ──────────────────────
// An alternative to sending the raw `eno_live_` key on every request: a client exchanges
// its key (client_id = key prefix, client_secret = full key) at /api/v1/oauth/token for a
// short-lived, stateless **HS256 JWT** access token. resolveApiKey accepts either form.
//
// Signing key: derived via HKDF from SUPABASE_SECRET_KEY (always present) with a dedicated
// context label, so it is cryptographically separate from Supabase's own JWTs and needs NO
// new env var (which we can't provision). Tokens are stateless — revoking the underlying
// key takes effect within TTL_SECONDS (standard bearer-token semantics), so keep TTL short.

export const TOKEN_TTL_SECONDS = 3600 // 1 hour
const ISSUER = 'https://eno.vn'

let cachedKey: Buffer | null = null
function signingKey(): Buffer | null {
  if (cachedKey) return cachedKey
  const ikm = process.env.SUPABASE_SECRET_KEY || process.env.CRON_SECRET
  if (!ikm) return null // no base secret → token endpoint reports unavailable
  // HKDF-SHA256 with a fixed salt + info label → a 32-byte key used ONLY for these tokens.
  cachedKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(ikm), Buffer.from('eno-oauth-v1'), Buffer.from('partner-api-access-token'), 32))
  return cachedKey
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')
function sign(input: string, key: Buffer): string {
  return crypto.createHmac('sha256', key).update(input).digest('base64url')
}

export type AccessClaims = { keyId: string; sellerId: string; profileId: string; scopes: string[] }

// Mint a signed access token for the resolved client. `now` is injected (seconds) so the
// caller controls the clock. Returns null if no signing key is available.
export function issueAccessToken(c: AccessClaims, now: number): string | null {
  const key = signingKey()
  if (!key) return null
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: ISSUER, sub: c.keyId, sid: c.sellerId, pid: c.profileId,
    scope: c.scopes.join(' '), iat: now, exp: now + TOKEN_TTL_SECONDS, jti: crypto.randomUUID(),
  }))
  const data = `${header}.${payload}`
  return `${data}.${sign(data, key)}`
}

export type VerifiedToken = { keyId: string; sellerId: string; profileId: string; scopes: Set<string> }

// Verify an access token: shape, HMAC signature (constant-time), issuer, and expiry against
// `now` (seconds). Returns the claims or null. Never throws.
export function verifyAccessToken(token: string, now: number): VerifiedToken | null {
  const key = signingKey()
  if (!key) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, sig] = parts
  const expected = sign(`${header}.${payload}`, key)
  // Constant-time compare; bail if lengths differ (timingSafeEqual throws otherwise).
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let claims: Record<string, unknown>
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return null }
  if (claims.iss !== ISSUER) return null
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null
  if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string' || typeof claims.pid !== 'string') return null
  return {
    keyId: claims.sub, sellerId: claims.sid, profileId: claims.pid,
    scopes: new Set(String(claims.scope || '').split(/\s+/).filter(Boolean)),
  }
}

// Is this bearer value an access token (JWT) rather than a raw `eno_live_` key? Cheap shape
// check so resolveApiKey can route without trying the DB.
export function looksLikeAccessToken(raw: string): boolean {
  return raw.split('.').length === 3 && !raw.includes(' ')
}
