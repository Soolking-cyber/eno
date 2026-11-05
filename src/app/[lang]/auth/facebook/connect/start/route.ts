import { NextResponse } from 'next/server'
import { canonicalAuthOrigin } from '@/lib/auth/google-oauth'
import { buildConnectUrl, facebookConnectConfigured, FB_TX_TTL_SECONDS, fbTxCookieName, newConnectState } from '@/lib/auth/facebook-connect'
import { facebookSignInEnabled } from '@/lib/auth/facebook'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authRedirect } from '@/lib/auth-finish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Begin Connect Facebook. Why this flow and not GoTrue's: src/lib/auth/facebook-connect.ts.
export async function GET(request: Request) {
  const origin = canonicalAuthOrigin(request)
  // ?for=import: the same round trip, which also connects Facebook if it isn't yet, then queues the import (callback).
  const forImport = new URL(request.url).searchParams.get('for') === 'import'
  // Connect starts from our own Settings row, never from a link on another site: with no code any more, that link would be one tap from adding whichever
  // Facebook this browser has open (commit gate, opus, 2026-11-04). A browser that sends no such header is let through; the rest of the flow still binds it.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return authRedirect(`${origin}/dashboard/settings?tab=privacy`)
  const settings = (fb: string) => authRedirect(`${origin}/dashboard/settings?tab=privacy&fb=${fb}`)
  // Facebook sign-in off means no new Facebook connections either: one could never be used.
  if (!facebookConnectConfigured() || !(await facebookSignInEnabled().catch(() => false))) return settings('failed')

  let userId: string | null = null
  try {
    const sb = await createSupabaseServer()
    const { data } = await sb.auth.getClaims()
    userId = typeof data?.claims?.sub === 'string' ? data.claims.sub : null
  } catch {
    return settings('failed')
  }
  if (!userId) return authRedirect(`${origin}/signin?next=${encodeURIComponent(forImport ? '/dashboard/listings?tab=facebook' : '/dashboard/settings?tab=privacy')}`)

  const state = newConnectState()
  const authorize = buildConnectUrl(state, origin)
  if (!authorize) return settings('failed')

  const res = NextResponse.redirect(authorize, { headers: { 'cache-control': 'no-store' } })
  // sameSite 'lax': Facebook returns the visitor by a top-level GET, which `strict` would drop. ⛔ The user id in here is
  // what binds the flow to this browser and this account (the callback requires both).
  res.cookies.set(fbTxCookieName(state), JSON.stringify({ s: state, u: userId, ...(forImport ? { f: 'import' } : {}) }), {
    httpOnly: true,
    secure: origin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: FB_TX_TTL_SECONDS,
  })
  return res
}
