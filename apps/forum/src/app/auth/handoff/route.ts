import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { safeNext } from '@/lib/safe-next'

// Last leg of the native one-app SSO (see /auth/bridge for the flow diagram). Verifying the
// single-use token minted by eno.vn/api/auth/forum-handoff creates an INDEPENDENT forum
// cookie session by design (no shared refresh chain with the eno.vn session).
// Login-CSRF binding: the token is only accepted when the `nonce` query param matches the
// eno_handoff_nonce cookie set by /auth/bridge in THIS browser — a handoff URL opened
// anywhere else (attacker gifting their own session, forwarded links) is rejected before
// verifyOtp, so the gifted token is not even consumed.

const NO_STORE = { 'Cache-Control': 'no-store' }


export async function GET(request: Request) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const nonce = url.searchParams.get('nonce')
  const next = safeNext(url.searchParams.get('next'))

  const cookieHeader = request.headers.get('cookie') || ''
  const cookieNonce = /(?:^|;\s*)eno_handoff_nonce=([^;]+)/.exec(cookieHeader)?.[1]

  const fail = () => {
    const res = NextResponse.redirect(`${url.origin}/?auth_error=1`, { headers: NO_STORE })
    res.cookies.set('eno_handoff_nonce', '', { path: '/auth', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax' })
    return res
  }

  if (!tokenHash || !nonce || !cookieNonce || nonce !== cookieNonce) return fail()

  const supabase = await createSupabaseServer()
  const { error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash })
  if (error) return fail()

  const res = NextResponse.redirect(`${url.origin}${next}`, { headers: NO_STORE })
  res.cookies.set('eno_handoff_nonce', '', { path: '/auth', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax' })
  return res
}
