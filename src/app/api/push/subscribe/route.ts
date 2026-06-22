import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Store (or refresh) a browser's Web Push subscription for the signed-in user.
// Endpoint is unique — re-subscribing the same browser upserts (and re-homes it
// to the current account if the device switched users).
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const endpoint = String(body.endpoint || '')
  const p256dh = String(body.keys?.p256dh || '')
  const auth = String(body.keys?.auth || '')
  if (!endpoint.startsWith('https://') || !p256dh || !auth) {
    return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 })
  }

  const userAgent = req.headers.get('user-agent')?.slice(0, 255) || null
  await db.pushSubscription.upsert({
    where: { endpoint },
    create: { profileId: profile.id, endpoint, p256dh, auth, userAgent },
    update: { profileId: profile.id, p256dh, auth, userAgent },
  })
  return NextResponse.json({ ok: true })
}
