/**
 * ⛔ SERVICES-TIER NOTIFICATIONS MUST NOT REACH THE MARKETPLACE FEED — AND THIS IS A DATA
 * PATH, WHICH IS WHY THE EXISTING GUARD MISSED IT. `sendVisaResultCard` deliberately keeps
 * its copy in the notification ROW rather than in notification-bell.tsx, precisely so no visa
 * string ships inside the eno.vn BUNDLE. That reasoning is correct and it is only half the
 * boundary: the row is still returned by /api/notifications, which is `route.ts` (not `.svc.ts`)
 * and therefore compiled into BOTH editions, selecting `title` and `body` verbatim.
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
 *
 * ⛔ IT LIVES IN `src/lib/` RATHER THAN IN THE ROUTE BECAUSE A SECOND SURFACE NEEDS IT, AND THE
 * ROUTE CANNOT LEND IT. `src/lib/unread.ts` counts the same rows for the native app-icon badge, and
 * the route imports `conversationUnread` FROM that module — so unread.ts importing the predicate
 * back out of the route would be a cycle. Three reviewers independently reported the native badge
 * counting notification rows the marketplace bell hides, which is this boundary with one consumer
 * left outside it; the route re-exports both names so its own test keeps pinning the real predicate.
 */
export const SERVICES_ONLY_NOTIFICATION_TYPES = [
  'visa_result',
  // A rental availability check sent from eno.forum (src/lib/messages.ts). Not services-tier CONTENT
  // — rentals are on both editions — but its thread is on the forum's rental desk, which eno.vn
  // hides (edition-scope.ts), so on eno.vn the row could only link to a thread that will not open.
  'availability_request_forum',
] as const

/**
 * ⛔ ONE PREDICATE, USED BY EVERY QUERY THAT COUNTS OR LISTS NOTIFICATIONS. The list, the unread
 * COUNT and the native badge must filter identically or a badge shows a number the feed cannot show
 * and the user cannot clear — and a badge that cannot be cleared teaches people to ignore the badge.
 * Building the clause inline is exactly how those drift apart on the next edit, so it is built once
 * and exported, which is also what lets a test pin the REAL predicate rather than a copy of it.
 */
export function notificationScope(userId: string, isMarketplace: boolean) {
  return {
    recipientId: userId,
    ...(isMarketplace ? { type: { notIn: [...SERVICES_ONLY_NOTIFICATION_TYPES] } } : {}),
  }
}
