import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'

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
  return NextResponse.json({ ok: true })
}
