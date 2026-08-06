import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { HANDOFF_COOKIE, HANDOFF_TTL_MS, handoffState, isNonce } from '@/lib/auth/handoff'

// Polled by the ORIGINATING context while the visitor is in the browser.
//
// ⚠️⚠️ THIS ENDPOINT RETURNS A STATE AND NOTHING ELSE. It is structurally incapable of returning an
// authorization code, and that is the security property, not an oversight: the ONLY path that
// returns a code is /redeem, which requires the pairing code shown on the browser's screen. If a
// future edit makes this return a code "to save a round trip", the account takeover this design was
// rebuilt to defeat comes straight back.
//
// ⚠️ POST-ONLY. The handoff cookie is SameSite=Lax, and Lax cookies ARE sent on cross-site top-level
// GET navigations — so a GET version could be triggered by any link.
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' }

export async function POST(request: Request) {
  const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').origin
  if (process.env.NODE_ENV === 'production' && request.headers.get('origin') !== appOrigin) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const nonce = (await cookies()).get(HANDOFF_COOKIE)?.value
  // ⚠️ FROM THE COOKIE, NEVER THE BODY. The cookie is what proves this is the jar that started the
  // flow and therefore holds the PKCE verifier.
  if (!isNonce(nonce)) return NextResponse.json({ state: 'gone' }, { headers: NO_STORE })

  const state = await handoffState(nonce)
  const res = NextResponse.json({ state }, { headers: NO_STORE })

  // ⚠️ RE-ISSUE THE COOKIE ON EVERY POLL. A visitor can spend ten minutes inside Google; without
  // this the cookie could lapse while they were away and they would return to a live parked code
  // the app had forgotten how to claim.
  if (state !== 'gone' && state !== 'void') {
    res.cookies.set(HANDOFF_COOKIE, nonce, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', path: '/', maxAge: Math.floor(HANDOFF_TTL_MS / 1000),
    })
  }
  return res
}
