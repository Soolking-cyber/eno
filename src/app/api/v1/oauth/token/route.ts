import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { hashApiKey, API_KEY_RE } from '@/lib/api/auth'
import { issueAccessToken, TOKEN_TTL_SECONDS } from '@/lib/api/oauth'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/v1/oauth/token — OAuth 2.0 client-credentials grant ─────────────────
// Exchange an API key for a short-lived bearer access token (so a partner never puts the
// long-lived key on the wire per request). client_id = key prefix, client_secret = the full
// `eno_live_…` key. Credentials may be sent via HTTP Basic or in the form/JSON body. The
// returned JWT works anywhere the raw key does (resolveApiKey accepts both), incl. /api/mcp.

// RFC 6749 §5.2 error envelope. `no-store` is mandated for token responses.
function oauthError(status: number, error: string, description: string): NextResponse {
  return NextResponse.json({ error, error_description: description }, { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
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
  try {
    if (ct.includes('application/json')) {
      body = (await req.json()) as Record<string, string>
    } else {
      const form = await req.formData()
      for (const [k, v] of form.entries()) body[k] = String(v)
    }
  } catch { /* empty/invalid body → handled by missing-field checks below */ }

  if (String(body.grant_type || '') !== 'client_credentials') {
    return oauthError(400, 'unsupported_grant_type', 'Only grant_type=client_credentials is supported.')
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
    rateLimit('oauth-token', clientIp(req), 30, '1 m'),
    rateLimit('oauth-token-client', clientId || clientSecret.slice(0, 16), 60, '1 m'),
  ])
  if (!byIp.success || !byClient.success) return oauthError(429, 'invalid_request', 'Too many token requests. Slow down.')

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
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
  )
}
