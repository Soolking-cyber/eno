import 'server-only'
import { db } from '@/lib/db'

// ONE definition of "how many things is this person waiting on", so the app-icon badge,
// the header bell and the chat tab can never disagree.
//
// The two halves were already written identically in two places (/api/notifications and
// /api/conversations/unread) before the badge needed a third copy — a number the user sees
// on their home screen is exactly the wrong thing to re-derive by hand.
//
// Both halves read DENORMALIZED counters (Notification.read, Conversation.buyerUnread /
// sellerUnread), so this is two indexed aggregates, not an N+1 — safe to call on the push
// path where it runs per delivered notification.

export type UnreadTotals = {
  /** Unread rows in the notification bell. */
  notifications: number
  /** Unread chat messages, summed across both sides of every conversation. */
  conversations: number
  /** What the app-icon badge shows. */
  total: number
}

export async function unreadTotals(profileId: string): Promise<UnreadTotals> {
  const [notifications, asBuyer, asSeller] = await Promise.all([
    db.notification.count({ where: { recipientId: profileId, read: false } }),
    db.conversation.aggregate({ where: { buyerProfileId: profileId }, _sum: { buyerUnread: true } }),
    db.conversation.aggregate({ where: { sellerProfileId: profileId }, _sum: { sellerUnread: true } }),
  ])
  const conversations = (asBuyer._sum.buyerUnread ?? 0) + (asSeller._sum.sellerUnread ?? 0)
  return { notifications, conversations, total: notifications + conversations }
}

/** Just the badge number. Never throws — a failed count must not take a push down with it,
 *  and a missing badge is far better than a missing notification. */
export async function badgeCountFor(profileId: string): Promise<number | null> {
  try {
    return (await unreadTotals(profileId)).total
  } catch {
    return null
  }
}
