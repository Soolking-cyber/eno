import { NextResponse } from 'next/server'
import { handoffAuthUrl, isNonce } from '@/lib/auth/handoff'

// Polled by the REAL BROWSER while it waits for the app to finish writing the row.
//
// ⚠️ THIS EXISTS BECAUSE OF A GESTURE CONSTRAINT, NOT A DESIGN PREFERENCE. `openInSystemBrowser`
// must be called inside the live user gesture — three awaits later the activation is gone and
// nothing opens at all. So the app launches the browser FIRST, with a nonce it has already chosen,
// and writes the row a beat later. The browser therefore arrives before the row exists, and without
// this it would see "no such handoff" and bounce to /signin.
//
// Returning the Google URL to anyone holding the nonce is the same exposure as the /auth/escape
// redirect itself, and equally by design: the nonce is in the URL the browser was handed. The URL
// is host-validated on write and carries only a public PKCE code_challenge.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const h = new URL(request.url).searchParams.get('h')
  if (!isNonce(h)) return NextResponse.json({ ready: false }, { headers: { 'Cache-Control': 'no-store' } })
  const url = await handoffAuthUrl(h)
  return NextResponse.json(url ? { ready: true, url } : { ready: false }, { headers: { 'Cache-Control': 'no-store' } })
}
