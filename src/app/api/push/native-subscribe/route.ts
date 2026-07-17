import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Store (or re-home) a native FCM/APNs device token for the signed-in user. Token is unique —
// re-registering the same device upserts and re-homes it to the current account if it switched
// users. Sends fan out via src/lib/native-push (see sendPushToProfile). Dormant on the send side
// until FCM/APNs env is configured, but tokens are captured now.
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  let body: { token?: string; platform?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const token = String(body.token || '').trim()
  const platform = body.platform === 'ios' ? 'ios' : body.platform === 'android' ? 'android' : ''
  if (!token || !platform) return NextResponse.json({ error: 'invalid_token' }, { status: 400 })

  await db.nativePushToken.upsert({
    where: { token },
    create: { profileId: profile.id, token, platform },
    update: { profileId: profile.id, platform },
  })
  return NextResponse.json({ ok: true })
}
