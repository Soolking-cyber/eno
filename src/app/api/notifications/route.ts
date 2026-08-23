import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { IS_MARKETPLACE } from '@/lib/edition'

/**
 * ⛔ SERVICES-TIER NOTIFICATIONS MUST NOT REACH THE MARKETPLACE FEED — AND THIS IS A DATA
 * PATH, WHICH IS WHY THE EXISTING GUARD MISSED IT. `sendVisaResultCard` deliberately keeps
 * its copy in the notification ROW rather than in notification-bell.tsx, precisely so no visa
 * string ships inside the eno.vn BUNDLE. That reasoning is correct and it is only half the
 * boundary: the row is still returned by this route, which is `route.ts` (not `.svc.ts`) and
 * therefore compiled into BOTH editions, selecting `title` and `body` verbatim.
 *
 * Concretely: an applicant who receives "eno e-Visa" on eno.forum and then signs into eno.vn
 * saw it in the marketplace bell, deep-linking into the visa conversation. eno.vn is a
 * licensed sàn TMĐT that may not surface eno's own e-Visa service at all — that is a
 * licensing failure, not a cosmetic one. Both external reviewers found it independently.
 *
 * ⚠️ NOT THE SAME AS THE PARTNER'S VISA CHAT, which eno.vn IS admitted to via
 * MARKETPLACE_HOSTS_SERVICES. The line is eno's OWN services tier (`.forum.svc.`), and
 * `visa_result` is on the wrong side of it.
 *
 * ⚠️ A DENY-LIST, AND IT NEEDS MAINTAINING. Any future services-tier notification type must
 * be added here in the same commit that starts writing it. A type-level allow-list would be
 * safer but would silently swallow every ordinary marketplace type the day someone adds one.
 */
export const SERVICES_ONLY_NOTIFICATION_TYPES = ['visa_result'] as const

/**
 * ⛔ ONE PREDICATE, USED BY BOTH QUERIES. The list and the unread COUNT must filter
 * identically or the badge shows a number the feed cannot show and the user cannot clear —
 * and a badge that cannot be cleared teaches people to ignore the badge. Building the clause
 * inline twice is exactly how those two drift apart on the next edit, so it is built once and
 * exported, which is also what lets a test pin the REAL predicate rather than a copy of it.
 */
export function notificationScope(userId: string, isMarketplace: boolean) {
  return {
    recipientId: userId,
    ...(isMarketplace ? { type: { notIn: [...SERVICES_ONLY_NOTIFICATION_TYPES] } } : {}),
  }
}

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
