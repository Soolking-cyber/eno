import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { hashApiKey, API_KEY_RE } from '@/lib/api/auth'
import { canSignAccessTokens, issueAccessToken, TOKEN_TTL_SECONDS , TOKEN_RATE_PER_IP, TOKEN_RATE_PER_CLIENT } from '@/lib/api/oauth'
import { GRANT_PREFIX, MCP_RESOURCE, redeemCode, rotateRefresh, type GrantResult } from '@/lib/api/oauth-grant'
import { rateLimit, type RateLimitSnapshot } from '@/lib/ratelimit'
import { rateLimitHeaders, tightestRate } from '@/lib/api/respond'
import { clientIp } from '@/lib/client-ip'
import { logError } from '@/lib/log'
import { JSON_BODY_CAP, readBytesCapped } from '@/lib/api/body'
import { ApiError } from '@/lib/api/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/v1/oauth/token — OAuth 2.0 client-credentials grant ─────────────────
// Exchange an API key for a short-lived bearer access token (so a partner never puts the
// long-lived key on the wire per request). client_id = key prefix, client_secret = the full
// `eno_live_…` key. Credentials may be sent via HTTP Basic or in the form/JSON body. The
// returned JWT works anywhere the raw key does (resolveApiKey accepts both), incl. /api/mcp.

// RFC 6749 §5.2 error envelope. `no-store` is mandated for token responses.
//
// ⚠️ `rate` IS OPTIONAL AND ARRIVES ONLY AFTER THE LIMITER HAS RUN. The grant_type and
// client_secret-shape rejections above happen before either bucket is touched, so they have no
// budget to report — an unauthenticated caller learning the exact throttle on the credential
// endpoint is a gift to a brute-forcer, and a made-up `remaining` would be worse than silence.
function oauthError(status: number, error: string, description: string, rate?: RateLimitSnapshot): NextResponse {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }
  if (rate) {
    Object.assign(headers, rateLimitHeaders(rate))
    // Only on the 429: on a 401 `invalid_client` the client's problem is its credentials, and
    // telling it when to retry the same wrong secret is telling it to keep guessing.
    if (status === 429) headers['Retry-After'] = String(rate.resetSec)
  }
  return NextResponse.json({ error, error_description: description }, { status, headers })
}

// Read client_id/client_secret from HTTP Basic first (preferred), else the parsed body.
function readCredentials(req: NextRequest, body: Record<string, string>): { id: string; secret: string } {
  const basic = /^Basic\s+(.+)$/i.exec((req.headers.get('authorization') || '').trim())
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
    const i = decoded.indexOf(':')
    if (i >= 0) return { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) }
  }
  return { id: String(body.client_id || ''), secret: String(body.client_secret || '') }
}

export async function POST(req: NextRequest) {
  // Accept both form-urlencoded (the OAuth standard) and JSON for convenience.
  let body: Record<string, string> = {}
  const ct = req.headers.get('content-type') || ''
  // Capped (64 KB) before it is parsed: this runs before both limiters. A real token request is a few hundred bytes.
  let raw: Buffer | null = null
  try { raw = await readBytesCapped(req, JSON_BODY_CAP) } catch (e) {
    if (e instanceof ApiError && e.status === 413) return oauthError(413, 'invalid_request', 'Request body too large.')
  }
  try {
    if (ct.includes('application/json')) {
      body = JSON.parse(raw ? new TextDecoder().decode(raw) : '') as Record<string, string>
    } else {
      // The same parser req.formData() runs (urlencoded or multipart, by the content-type), over the capped bytes.
      const form = await new Response(raw && new Uint8Array(raw), { headers: { 'content-type': ct } }).formData()
      for (const [k, v] of form.entries()) body[k] = String(v)
    }
  } catch { /* empty/invalid body → handled by missing-field checks below */ }

  const grantType = String(body.grant_type || '')
  if (grantType === 'authorization_code' || grantType === 'refresh_token') return signInGrant(req, body, grantType)
  if (grantType !== 'client_credentials') {
    return oauthError(400, 'unsupported_grant_type', 'grant_type must be client_credentials, authorization_code or refresh_token.')
  }

  const { id: clientId, secret: clientSecret } = readCredentials(req, body)
  if (!clientSecret || !API_KEY_RE.test(clientSecret)) {
    return oauthError(401, 'invalid_client', 'client_secret must be a valid eno API key.')
  }

  // Throttle credential checks (brute-force guard). Keyed by caller IP — the presented
  // id/secret is attacker-controlled, so keying on it lets a brute-forcer rotate keys to
  // dodge the limit. Also AND a per-clientId bucket so one shared IP (CGNAT) can't be
  // used to hammer a single client's credentials from many sources unnoticed.
  const [byIp, byClient] = await Promise.all([
    // ⚠️ THE CONSTANTS, NOT LITERALS. /auth.md publishes these exact numbers; exporting them from
    // lib/api/oauth.ts is only worth anything if the ENFORCEMENT reads the same source. Otherwise
    // the document is pinned to a constant the limiter ignores, which is worse than the retyped
    // prose it replaced — it would look maintained while drifting.
    rateLimit('oauth-token', clientIp(req), TOKEN_RATE_PER_IP, '1 m'),
    rateLimit('oauth-token-client', clientId || clientSecret.slice(0, 16), TOKEN_RATE_PER_CLIENT, '1 m'),
  ])
  // ⚠️ THE HEADERS DESCRIBE THIS ENDPOINT'S OWN POLICY, NOT THE 600/min PARTNER-API BUDGET.
  // Token minting is throttled far harder than the API it hands out tokens for (30/min per IP,
  // 60/min per client), because it is the credential-guessing surface. A client that reads
  // `RateLimit` here and infers its /api/v1 budget from it would under-use its quota by 20x,
  // which is why `RateLimit-Policy` is emitted alongside — the window and limit are stated
  // outright rather than left to be inferred from a running `remaining`.
  const tokenRate = tightestRate(byIp, byClient)
  if (!byIp.success || !byClient.success) return oauthError(429, 'invalid_request', 'Too many token requests. Slow down.', tokenRate)

  let key: { id: string; sellerId: string; profileId: string; scopes: string; prefix: string; revokedAt: Date | null } | null = null
  try {
    key = await db.apiKey.findUnique({
      where: { hashedKey: hashApiKey(clientSecret) },
      select: { id: true, sellerId: true, profileId: true, scopes: true, prefix: true, revokedAt: true },
    })
  } catch {
    return oauthError(503, 'temporarily_unavailable', 'Authentication is temporarily unavailable.')
  }
  if (!key || key.revokedAt) return oauthError(401, 'invalid_client', 'Invalid or revoked client credentials.')
  // A sign-in grant row is never a client_credentials client (its hash is a refresh token's, under another label —
  // oauth-grant.ts): refused by name too, so no future hashing change can turn a refresh token into a key.
  if (key.prefix.startsWith(GRANT_PREFIX)) return oauthError(401, 'invalid_client', 'Invalid or revoked client credentials.')
  // If a client_id is supplied it must match the key's prefix (constant-time).
  if (clientId) {
    const a = Buffer.from(clientId), b = Buffer.from(key.prefix)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return oauthError(401, 'invalid_client', 'client_id does not match client_secret.')
  }

  const keyScopes = key.scopes.split(/\s+/).filter(Boolean)
  // Optional `scope` narrows (never escalates) the token to a subset of the key's scopes.
  let granted = keyScopes
  const requested = String(body.scope || '').split(/\s+/).filter(Boolean)
  if (requested.length) {
    const bad = requested.find((s) => !keyScopes.includes(s))
    if (bad) return oauthError(400, 'invalid_scope', `The key does not have the "${bad}" scope.`)
    granted = requested
  }

  const now = Math.floor(Date.now() / 1000)
  const token = issueAccessToken({ keyId: key.id, sellerId: key.sellerId, profileId: key.profileId, scopes: granted }, now)
  if (!token) return oauthError(503, 'temporarily_unavailable', 'Token signing is temporarily unavailable.')

  // Best-effort: mark the key used (mirrors resolveApiKey).
  void db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch((e) => logError(e, { op: 'oauth.touchLastUsed' }))

  return NextResponse.json(
    { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS, scope: granted.join(' ') },
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...rateLimitHeaders(tokenRate) } },
  )
}

/**
 * The sign-in grants (oauth-grant.ts): a PUBLIC client (token_endpoint_auth_method "none") proves itself with PKCE and its
 * client_id binding, never a secret. Rate-limited per IP and per client like client_credentials. The access token is
 * the same 1-hour HS256 token, with `aud` = the MCP server; the refresh token rotates on every use.
 */
async function signInGrant(req: NextRequest, body: Record<string, string>, grantType: 'authorization_code' | 'refresh_token'): Promise<NextResponse> {
  const clientId = String(body.client_id || '')
  if (!clientId) return oauthError(400, 'invalid_request', 'client_id is required.')
  // Per IP only: a public client's id is published in its metadata document, so a per-client bucket could be drained
  // by strangers to lock that app's real users out (review 2026-11-13). Every credential here is single-use anyway.
  const tokenRate = await rateLimit('oauth-token', clientIp(req), TOKEN_RATE_PER_IP, '1 m')
  if (!tokenRate.success) return oauthError(429, 'invalid_request', 'Too many token requests. Slow down.', tokenRate)
  const now = Math.floor(Date.now() / 1000)
  // Before any credential is consumed: a code or refresh token is spent only if the answer can actually be signed.
  if (!canSignAccessTokens()) return oauthError(503, 'temporarily_unavailable', 'Token signing is temporarily unavailable.', tokenRate)
  let result: GrantResult
  try {
    result = grantType === 'authorization_code'
      ? await redeemCode({ code: String(body.code || ''), verifier: String(body.code_verifier || ''), redirectUri: String(body.redirect_uri || ''), clientId, resource: body.resource ? String(body.resource) : undefined }, now)
      : await rotateRefresh({ refreshToken: String(body.refresh_token || ''), clientId, scope: body.scope ? String(body.scope) : undefined, resource: body.resource ? String(body.resource) : undefined }, now)
  } catch (e) {
    logError(e, { op: `oauth.${grantType}` })
    return oauthError(503, 'temporarily_unavailable', 'The sign-in service is temporarily unavailable.', tokenRate)
  }
  if (!result.ok) return oauthError(400, result.error, result.description, tokenRate)
  const g = result.grant
  const token = issueAccessToken({ keyId: g.keyId, sellerId: g.sellerId, profileId: g.profileId, scopes: g.scopes, aud: MCP_RESOURCE }, now)
  if (!token) return oauthError(503, 'temporarily_unavailable', 'Token signing is temporarily unavailable.', tokenRate)
  return NextResponse.json(
    { access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS, scope: g.scopes.join(' '), refresh_token: g.refreshToken },
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...rateLimitHeaders(tokenRate) } },
  )
}
