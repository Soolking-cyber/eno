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

// ⚠️ WS6 — NOT MIGRATED: a guard runs before everything, no branch is an error envelope, and the
// success path sets a cookie.
//   · THE ORIGIN CHECK IS FIRST AND IS THE CSRF DEFENCE. `{"error":"bad_origin"}` 403, decided before
//     the cookie is even read. The wrapper's fixed order is auth → rateLimit → body → handler, so
//     anything it did would run ahead of it.
//   · A CALLER WITH NO (OR A MALFORMED) HANDOFF COOKIE GETS `{"state":"gone"}` AT 200 — the ordinary
//     "this flow is over" answer the poller expects, not a 401. There is no signed-in user here at
//     all; the cookie nonce IS the credential, so no auth mode applies.
//   · EVERY RESPONSE CARRIES `Cache-Control: no-store, no-cache, must-revalidate` AND
//     `Pragma: no-cache`, and the live branch additionally re-issues the `HANDOFF_COOKIE` Set-Cookie
//     ("RE-ISSUE THE COOKIE ON EVERY POLL"). A plain-object return carries neither.
//   · NO LIMITER AND NO BODY SCHEMA — the request body is never read — so even setting the above
//     aside all four options would be empty.
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
