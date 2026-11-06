import { NextResponse } from 'next/server'
import { canonicalAuthOrigin } from '@/lib/auth/google-oauth'
import { buildConnectUrl, facebookConnectConfigured, FB_TX_TTL_SECONDS, fbTxCookieName, newConnectState, newPkceVerifier, pkceChallenge } from '@/lib/auth/facebook-connect'
import { facebookSignInEnabled } from '@/lib/auth/facebook'
import { createSupabaseServer } from '@/lib/supabase/server'
import { authRedirect } from '@/lib/auth-finish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Begin Connect Facebook. Why this flow and not GoTrue's: src/lib/auth/facebook-connect.ts.
export async function GET(request: Request) {
  const origin = canonicalAuthOrigin(request)
  const params = new URL(request.url).searchParams
  // ?for=import: the same round trip, which also connects Facebook if it isn't yet, then queues the import (callback).
  const forImport = params.get('for') === 'import'
  // ?native=1: the iOS app (facebook-connect-client.ts), which can't let Facebook into its WebView. It fetches this, gets `{ to }` instead of a redirect, and
  // opens Facebook in its in-app browser sheet; the state is marked so the callback hands the return back to the app (facebook-connect.ts NATIVE_CONNECT_PREFIX).
  // The cookie is set here all the same, in the app's own jar, and the app's callback still needs it.
  const native = params.get('native') === '1'
  const go = (to: string) => (native ? NextResponse.json({ to }, { headers: { 'cache-control': 'no-store' } }) : authRedirect(to))
  // Connect starts from our own Settings row, never from a link on another site: with no code any more, that link would be one tap from adding whichever
  // Facebook this browser has open (commit gate, opus, 2026-11-04). A browser that sends no such header is let through; the rest of the flow still binds it.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return go(`${origin}/dashboard/settings?tab=privacy`)
  const settings = (fb: string) => go(`${origin}/dashboard/settings?tab=privacy&fb=${fb}`)
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
  if (!userId) return go(`${origin}/signin?next=${encodeURIComponent(forImport ? '/dashboard/listings?tab=facebook' : '/dashboard/settings?tab=privacy')}`)

  const state = newConnectState(native)
  // The code's PKCE verifier (facebook-connect.ts newPkceVerifier): kept only in the cookie below, so a code caught on its way back is useless.
  const verifier = newPkceVerifier()
  const authorize = buildConnectUrl(state, origin, pkceChallenge(verifier))
  if (!authorize) return settings('failed')

  const res = native ? NextResponse.json({ to: authorize }, { headers: { 'cache-control': 'no-store' } }) : NextResponse.redirect(authorize, { headers: { 'cache-control': 'no-store' } })
  // sameSite 'lax': Facebook returns the visitor by a top-level GET, which `strict` would drop. ⛔ The user id in here is
  // what binds the flow to this browser and this account (the callback requires both).
  res.cookies.set(fbTxCookieName(state), JSON.stringify({ s: state, u: userId, v: verifier, ...(forImport ? { f: 'import' } : {}) }), {
    httpOnly: true,
    secure: origin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: FB_TX_TTL_SECONDS,
  })
  return res
}
