import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

// Token-scoped, NO auth session required (the token IS the credential, per-Profile and
// unguessable). Flips Profile.weeklyDigestOptIn.
//
// POST /api/unsubscribe?token=… — RFC 8058 one-click target (mail clients POST here) and
//   the /unsubscribe page's fetch. Body {optIn:true} re-subscribes; default unsubscribes.
// GET  /api/unsubscribe?token=… — a bare GET (or a link scanner) must NOT mutate, so it
//   just redirects to the confirm page. Only the POST changes state.
//
// ⚠️ WS6 — NOT MIGRATED, BOTH METHODS, AND `auth:` IS THE TRAP TO NAME OUT LOUD. This is reached
// from an EMAIL by a reader who is signed out — often from the mail client itself, on a different
// device, with no cookie in sight. The token IS the credential. `auth: 'userId'`/`'profile'` would
// 401 every real unsubscribe link and leave RFC 8058 one-click broken in a way nothing would report,
// so `'public'` is the only correct mode — which means auth contributes nothing.
// Nor does anything else:
//  · NO `body:` SCHEMA IS POSSIBLE. One-click POSTs are form-encoded (`List-Unsubscribe=One-Click`),
//    NOT JSON, so `req.json()` throws on the single most important caller and the catch treats that
//    as "unsubscribe". A schema turns that into 400 and the mail client reports a failed
//    unsubscribe — the same class of change as /api/notifications/read, and worse consequences.
//  · No rate limit today, and adding one is a behaviour change, not a migration.
// That leaves all four options empty on POST. GET is a bare redirect (and a synchronous function),
// which the wrapper can only wrap in an async layer.
export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'missing_token' }, { status: 400 })

  let optIn = false
  try {
    const body = await req.json()
    if (typeof body?.optIn === 'boolean') optIn = body.optIn
  } catch {
    /* one-click POST bodies are form-encoded (List-Unsubscribe=One-Click), not JSON → unsubscribe */
  }

  const res = await db.profile.updateMany({
    where: { unsubscribeToken: token },
    data: { weeklyDigestOptIn: optIn },
  })
  if (res.count === 0) return NextResponse.json({ error: 'invalid_token' }, { status: 404 })
  return NextResponse.json({ ok: true, optIn })
}

export function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  return NextResponse.redirect(`${ORIGIN}/unsubscribe?token=${encodeURIComponent(token)}`)
}
