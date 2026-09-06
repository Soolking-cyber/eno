import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * TURNS THE NATIVE APP'S TOKENS INTO THE WEB SESSION COOKIES ITS WEBVIEWS NEED.
 *
 * ⛔ THE GAP THIS CLOSES IS AS OLD AS THE APP'S WEB SHEETS. A seller who signs in NATIVELY — Google
 * through ASWebAuthenticationSession — ends up with an access and refresh token in the Keychain and
 * NOTHING in any WebView's cookie jar. Every embedded page therefore believed them signed out: the
 * new Availability and Bulk-upload rows, and equally the older `/listings/<id>/edit` and
 * `/messages/ai` sheets, would show a sign-in screen to someone who is manifestly signed in.
 *
 * ⚠️ THE TOKENS ARRIVE IN THE BODY, NEVER IN THE URL. A query string is written to server logs, to
 * the browser's history and to any referrer — a refresh token there is a durable credential leak.
 * POST-only for the same reason: a GET with a body is not a thing, and a GET without one would mean
 * putting them back in the URL.
 *
 * ⚠️ IT VALIDATES BY USING THEM. `setSession` asks the auth server to accept the pair; a forged or
 * expired token fails there and nothing is set. This endpoint therefore grants no authority the
 * caller does not already hold — it converts a credential the caller HAS into the cookie form of
 * the same credential, which is why it needs no secret of its own.
 */
export async function POST(request: Request) {
  let body: { access_token?: unknown; refresh_token?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const accessToken = typeof body.access_token === 'string' ? body.access_token : ''
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  // ⚠️ BOTH, OR NEITHER. A session set from an access token alone cannot be refreshed and dies
  // within the hour — the same trap the password route documents at its own setSession call.
  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: 'missing_tokens' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  // ⚠️ THROTTLED PER SESSION FIRST, PER IP ONLY AS A BACKSTOP. An IP-only limit makes strangers
  // share one allowance: a carrier-grade NAT or an office wifi puts thousands of phones behind one
  // address, and the first busy one would lock the rest out of their own dashboards (gate). The
  // token hash is the natural key — it identifies the SESSION doing the priming without logging a
  // credential — and a much looser IP ceiling still catches someone spraying stolen tokens.
  const tokenKey = createHash('sha256').update(accessToken).digest('hex').slice(0, 32)
  const perSession = await rateLimit('native-session', tokenKey, 30, '5 m')
  if (!perSession.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Cache-Control': 'no-store' } })
  }
  const perIp = await rateLimit('native-session-ip', clientIp(request), 600, '5 m')
  if (!perIp.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Cache-Control': 'no-store' } })
  }

  const sb = await createSupabaseServer()
  const { data, error } = await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
  if (error || !data.user) {
    return NextResponse.json({ error: 'invalid_session' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  // The cookies are the entire payload — the body says only that it worked, and deliberately
  // carries no profile: the app already knows who it signed in.
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
