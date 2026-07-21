import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { after } from 'next/server'
import { syncBadgeToProfile } from '@/lib/native-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST: mark notifications read. { ids: [...] } marks those; empty/no body marks
// ALL of the current user's unread notifications read.
export async function POST(req: Request) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  let body: { ids?: string[] } = {}
  try { body = await req.json() } catch { /* empty body → mark all */ }

  if (Array.isArray(body.ids) && body.ids.length) {
    await db.notification.updateMany({ where: { recipientId: meId, id: { in: body.ids } }, data: { read: true } })
  } else {
    await db.notification.updateMany({ where: { recipientId: meId, read: false }, data: { read: true } })
  }
  // Reading is the ONLY moment the badge should go DOWN, and no ordinary push fires here —
  // without this the circle would sit on the icon after the bell was already cleared.
  // after() so the user's request never waits on APNs.
  after(() => syncBadgeToProfile(meId))
  return NextResponse.json({ ok: true })
}
