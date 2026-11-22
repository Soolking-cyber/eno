import { NextRequest, NextResponse } from 'next/server'
import { looksLikeAccessToken, TOKEN_RATE_PER_IP } from '@/lib/api/oauth'
import { revokeRefresh } from '@/lib/api/oauth-grant'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { JSON_BODY_CAP, readBytesCapped } from '@/lib/api/body'
import { ApiError } from '@/lib/api/api-error'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ── RFC 7009 · OAuth 2.0 Token Revocation (owner 2026-11-22: the Personal Agent Protocol 1.0 issuer binding requires a
 * revocation_endpoint; agents call it with token_type_hint=refresh_token when a person signs out). Advertised in
 * /.well-known/oauth-authorization-server.
 *
 * What it revokes: the refresh token of a sign-in grant (oauth-grant.ts revokeRefresh), which ends the grant. The clients
 * are public (Client ID Metadata Documents, token_endpoint_auth_methods_supported "none"), so the client identifies itself
 * with `client_id`, and only the client the token was issued to may revoke it (§2.1).
 * ⛔ ACCESS TOKENS ARE NOT REVOKED ONE BY ONE (oauth.ts, a stateless JWT): a presented one is answered `unsupported_token_type`
 * (§2.2.1). A sign-in's access tokens stop anyway when its refresh token is revoked here (each call checks the grant).
 * Everything else that is not a live refresh token of this client is a 200 with no body (§2.2): an invalid token is already
 * unusable, and the answer reveals nothing about which tokens exist.
 */
function oauthError(status: number, error: string, description: string): NextResponse {
  return NextResponse.json({ error, error_description: description }, { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
}

export async function POST(req: NextRequest) {
  const limit = await rateLimit('oauth-revoke', clientIp(req), TOKEN_RATE_PER_IP, '1 m')
  if (!limit.success) return oauthError(429, 'slow_down', 'Too many requests; try again in a minute.')
  let body: Record<string, string> = {}
  const ct = req.headers.get('content-type') || ''
  let raw: Buffer | null = null
  try { raw = await readBytesCapped(req, JSON_BODY_CAP) } catch (e) {
    if (e instanceof ApiError && e.status === 413) return oauthError(413, 'invalid_request', 'Request body too large.')
    throw e
  }
  try {
    if (ct.includes('application/json')) body = JSON.parse(raw ? new TextDecoder().decode(raw) : '') as Record<string, string>
    else {
      const form = await new Response(raw && new Uint8Array(raw), { headers: { 'content-type': ct } }).formData()
      for (const [k, v] of form.entries()) body[k] = String(v)
    }
  } catch {
    return oauthError(400, 'invalid_request', 'Send the token as application/x-www-form-urlencoded.')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return oauthError(400, 'invalid_request', 'Send the token as application/x-www-form-urlencoded.')
  const token = String(body.token || '')
  const clientId = String(body.client_id || '')
  if (!token) return oauthError(400, 'invalid_request', 'token is required.')
  // token_type_hint is a hint, not a rule (RFC 7009 §2.1): a refresh token is looked up as one whatever the hint says, and
  // only a token that IS an access token is refused as unsupported.
  if (!/^eno_rt_/.test(token) && looksLikeAccessToken(token)) {
    return oauthError(400, 'unsupported_token_type', 'Access tokens are not revoked one by one; revoke the refresh token to end the connection.')
  }
  if (!clientId) return oauthError(401, 'invalid_client', 'client_id is required.')
  try {
    const r = await revokeRefresh({ token, clientId }, Math.floor(Date.now() / 1000))
    if (r === 'wrong_client') return oauthError(400, 'unauthorized_client', 'This token was issued to another client.')
  } catch (e) {
    logError(e, { op: 'oauth.revoke' })
    return oauthError(503, 'temporarily_unavailable', 'Could not revoke right now; try again.')
  }
  return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
}
