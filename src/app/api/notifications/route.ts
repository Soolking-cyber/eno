import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { isCurrentUserAdminByClaims } from '@/lib/admin'
import { conversationUnread } from '@/lib/unread'
import { IS_MARKETPLACE } from '@/lib/edition'
import { notificationScope } from '@/lib/notification-scope'

/**
 * ⚠️ THE PREDICATE MOVED TO `src/lib/notification-scope.ts` AND IS RE-EXPORTED HERE. It had to: the
 * native app-icon badge counts the same rows from `src/lib/unread.ts`, this route imports
 * `conversationUnread` from that module, and a predicate living here would make that a cycle. The
 * re-export keeps `./scope.test.ts` pinning the real thing rather than a copy, and keeps every
 * existing importer working. The licensing reasoning behind the deny-list lives with the code.
 */
export { SERVICES_ONLY_NOTIFICATION_TYPES, notificationScope } from '@/lib/notification-scope'

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
  const [items, unread, convoUnread] = await Promise.all([
    db.notification.findMany({
      where: notificationScope(userId, IS_MARKETPLACE),
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true, type: true, title: true, body: true, actorName: true,
        conversationId: true, listingId: true, url: true, read: true, createdAt: true,
      },
    }),
    // ⚠️ THE COUNT NEEDS THE SAME FILTER AS THE LIST, OR THE BADGE LIES. Scoping only the
    // list above would leave eno.vn showing "3 unread" with nothing to open — and the user
    // could never clear it, because the rows it counts are the ones the feed now hides.
    // A badge that cannot be cleared is how people learn to ignore the badge.
    db.notification.count({ where: { ...notificationScope(userId, IS_MARKETPLACE), read: false } }),
    /**
     * ⛔ THE BADGE NUMBER COMES FROM `conversationUnread()` NOW, AND THIS IS THE FIX FOR THE OWNER'S
     * PHANTOM (2026-09-18: "has 1 message but when clicked no new messages"). What stood here was an
     * inline pair of aggregates over EVERY conversation row — no edition scope, no deleted-thread
     * filter — while the inbox applies both. On eno.vn that counted a trip-desk thread the edition
     * split requires the list to hide, so the badge said 1 and the inbox was empty, permanently.
     * ⚠️ THE COMMENT ABOVE ABOUT THE NOTIFICATION COUNT NEEDING THE LIST'S FILTER SAID THIS ALREADY,
     * one line up, about the other half of the same response. The rule was written and then not
     * applied to the neighbour.
     */
    conversationUnread(userId, { includeSupportDesk: await isCurrentUserAdminByClaims() }),
  ])

  return {
    notifications: items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
    unread,
    convoUnread,
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
