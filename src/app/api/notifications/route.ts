import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: the current user's recent notifications + unread count (newest first).
// Also piggybacks the conversations-unread total (same math as
// /api/conversations/unread — denormalized per-side counters, no N+1) so the
// chat badge rides THIS poll instead of running a duplicate 45s interval:
// NotificationsProvider broadcasts `convoUnread` and ChatProvider consumes it.
export async function GET() {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const [items, unread, asBuyer, asSeller] = await Promise.all([
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
    db.conversation.aggregate({ where: { buyerProfileId: meId }, _sum: { buyerUnread: true } }),
    db.conversation.aggregate({ where: { sellerProfileId: meId }, _sum: { sellerUnread: true } }),
  ])

  return NextResponse.json({
    notifications: items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    unread,
    convoUnread: (asBuyer._sum.buyerUnread ?? 0) + (asSeller._sum.sellerUnread ?? 0),
  })
}

// DELETE: clear ALL of my notifications.
export async function DELETE() {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  await db.notification.deleteMany({ where: { recipientId: meId } })
  return new NextResponse(null, { status: 204 })
}
