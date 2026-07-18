import { NextResponse } from 'next/server'
import { safeNext } from '@/lib/safe-next'

// First leg of the native one-app SSO (see /auth/handoff for the last leg):
//   app (on eno.vn) → GET /auth/bridge?next=… → sets a short-lived nonce cookie on THIS
//   origin → 302 to eno.vn/api/auth/forum-handoff?nonce=…&next=… → eno.vn mints a
//   single-use token for ITS signed-in user → 302 back to /auth/handoff with the token
//   AND the nonce. The handoff only accepts the login when the nonce round-trips to the
//   same browser that started here — a handoff URL gifted to a victim (login CSRF) dies
//   because the victim's cookie jar never held that nonce. Everything is a top-level
//   navigation, so no CORS and no third-party-cookie dependence.
// Native-only flow: a plain web hop never enters here (goToForum gates on the app shell).

const MARKETPLACE_URL = process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn'


export async function GET(request: Request) {
  const url = new URL(request.url)
  const next = safeNext(url.searchParams.get('next'))
  const ua = request.headers.get('user-agent') || ''
  // Outside the app shell there is nothing to bridge — land on the target as a guest.
  if (!ua.includes('EnoNativeApp')) {
    return NextResponse.redirect(`${url.origin}${next}`, { headers: { 'Cache-Control': 'no-store' } })
  }
  const nonce = crypto.randomUUID()
  const res = NextResponse.redirect(
    `${MARKETPLACE_URL}/api/auth/forum-handoff?nonce=${nonce}&next=${encodeURIComponent(next)}`,
    { headers: { 'Cache-Control': 'no-store' } },
  )
  // Lax is enough: /auth/handoff arrives as a top-level GET navigation. Path-scoped so the
  // cookie never rides ordinary browsing.
  res.cookies.set('eno_handoff_nonce', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/auth',
    maxAge: 120,
  })
  return res
}
