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

// ⚠️ WS6 — NOT MIGRATED: all four options would be empty AND both exits set a header.
// Public (the nonce is the only credential and is deliberately not a secret — see above), no
// limiter, GET so no JSON body — so `route({}, …)` would add an import and a closure for nothing.
// On top of that both returns carry `Cache-Control: no-store` (`{"ready":false}` and
// `{"ready":true,"url":…}`), which the wrapper's plain-object return cannot attach; keeping the
// header would mean returning a `Response` from the handler, i.e. writing exactly this code inside
// a wrapper that then contributes nothing.
export async function GET(request: Request) {
  const h = new URL(request.url).searchParams.get('h')
  if (!isNonce(h)) return NextResponse.json({ ready: false }, { headers: { 'Cache-Control': 'no-store' } })
  const url = await handoffAuthUrl(h)
  return NextResponse.json(url ? { ready: true, url } : { ready: false }, { headers: { 'Cache-Control': 'no-store' } })
}
