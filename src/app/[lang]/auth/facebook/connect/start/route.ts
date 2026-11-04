import { NextResponse } from 'next/server'
import { canonicalAuthOrigin } from '@/lib/auth/google-oauth'
import { buildConnectUrl, confirmationValid, facebookConnectConfigured, FB_OK_COOKIE, FB_TX_TTL_SECONDS, fbTxCookieName, newConnectState, readCookie } from '@/lib/auth/facebook-connect'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authRedirect } from '@/lib/auth-finish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Begin Connect Facebook. Why this flow and not GoTrue's: src/lib/auth/facebook-connect.ts.
export async function GET(request: Request) {
  const origin = canonicalAuthOrigin(request)
  const settings = (fb: string) => authRedirect(`${origin}/dashboard/settings?tab=privacy&fb=${fb}`)
  if (!facebookConnectConfigured()) return settings('failed')

  let userId: string | null = null
  let sessionId: unknown = null
  try {
    const sb = await createSupabaseServer()
    const { data } = await sb.auth.getClaims()
    userId = typeof data?.claims?.sub === 'string' ? data.claims.sub : null
    sessionId = data?.claims?.session_id
  } catch {
    return settings('failed')
  }
  if (!userId) return authRedirect(`${origin}/signin?next=${encodeURIComponent('/dashboard/settings?tab=privacy')}`)
  // Only with this flow's own code confirmed for this very session: see FB_OK_COOKIE.
  if (typeof sessionId !== 'string' || !confirmationValid(readCookie(request, FB_OK_COOKIE), userId, sessionId, Math.floor(Date.now() / 1000))) return settings('expired')

  const state = newConnectState()
  const authorize = buildConnectUrl(state, origin)
  if (!authorize) return settings('failed')

  const res = NextResponse.redirect(authorize, { headers: { 'cache-control': 'no-store' } })
  // sameSite 'lax': Facebook returns the visitor by a top-level GET, which `strict` would drop. ⛔ The user id in here is
  // what binds the flow to this browser and this account (the callback requires both).
  res.cookies.set(fbTxCookieName(state), JSON.stringify({ s: state, u: userId }), {
    httpOnly: true,
    secure: origin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: FB_TX_TTL_SECONDS,
  })
  return res
}
