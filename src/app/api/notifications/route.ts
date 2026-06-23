import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: the current user's recent notifications + unread count (newest first).
export async function GET() {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { recipientId: meId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true, type: true, title: true, body: true, actorName: true,
        conversationId: true, listingId: true, url: true, read: true, createdAt: true,
      },
    }),
    db.notification.count({ where: { recipientId: meId, read: false } }),
  ])

  return NextResponse.json({
    notifications: items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    unread,
  })
}
