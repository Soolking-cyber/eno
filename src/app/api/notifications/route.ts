import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: the current user's recent notifications + unread count (newest first).
// Also piggybacks the conversations-unread total (same math as
// /api/conversations/unread — denormalized per-side counters, no N+1) so the
// chat badge rides THIS poll instead of running a duplicate 45s interval:
// NotificationsProvider broadcasts `convoUnread` and ChatProvider consumes it.
//
// ⚠️ WS6 MIGRATION. `auth: 'userId'` because the old code called getCurrentProfileId() and uses the
// id for nothing but `recipientId`/`buyerProfileId`/`sellerProfileId` scoping. It must stay that
// mode: NotificationsProvider polls this every 45s for every signed-in tab, so 'profile' would put
// an auth-server round trip + a Profile read + lazy provisioning on the app's most frequent request.
// Guest → 401 `auth_required`, unchanged.
//
// ⚠️ ERROR-PATH CHANGE, DELIBERATE: nothing wrapped the Promise.all, so a DB rejection was an
// unhandled throw and Next served its own 500. route() now logs it and answers
// `{"error":"internal_error"}` 500. Same status, structured body, never the exception text.
export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  const [items, unread, asBuyer, asSeller] = await Promise.all([
    db.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true, type: true, title: true, body: true, actorName: true,
        conversationId: true, listingId: true, url: true, read: true, createdAt: true,
      },
    }),
    db.notification.count({ where: { recipientId: userId, read: false } }),
    db.conversation.aggregate({ where: { buyerProfileId: userId }, _sum: { buyerUnread: true } }),
    db.conversation.aggregate({ where: { sellerProfileId: userId }, _sum: { sellerUnread: true } }),
  ])

  return {
    notifications: items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    unread,
    convoUnread: (asBuyer._sum.buyerUnread ?? 0) + (asSeller._sum.sellerUnread ?? 0),
  }
})

// DELETE: clear ALL of my notifications.
//
// ⚠️ RETURNS THE Response ITSELF, not a plain object. The success body is 204 + NO body; handing the
// wrapper an object would make it a 200 with `{}`, which is a wire change on the one branch clients
// actually hit here. route()'s escape hatch keeps it byte-identical while still contributing the
// auth preamble. Same error-path note as GET: a deleteMany rejection is now `internal_error` 500.
export const DELETE = route({ auth: 'userId' }, async ({ userId }) => {
  await db.notification.deleteMany({ where: { recipientId: userId } })
  return new NextResponse(null, { status: 204 })
})
