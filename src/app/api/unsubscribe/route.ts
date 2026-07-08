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
