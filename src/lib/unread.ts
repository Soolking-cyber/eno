import 'server-only'
import { db } from '@/lib/db'
import { editionSellerScope } from '@/lib/edition-scope'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'
import { notificationScope } from '@/lib/notification-scope'
import { IS_MARKETPLACE } from '@/lib/edition'

/**
 * ONE definition of "how many things is this person waiting on", so the app-icon badge, the header
 * bell and the chat tab can never disagree.
 *
 * ⛔ THAT SENTENCE STOOD HERE WHILE THREE COPIES OF THE SUM EXISTED, AND THE OWNER FOUND THE GAP
 * (2026-09-18, signed in to eno.vn as the support account: "has 1 message but when clicked no new
 * messages there is an error somewhere"). The file claimed to be the single definition; meanwhile
 * `/api/conversations/unread` had grown an edition scope and a deleted-thread filter, and
 * `/api/notifications` — which is what actually feeds the badge, by broadcasting `convoUnread` to
 * ChatProvider — carried its own inline `aggregate` pair with NEITHER. So on eno.vn the badge
 * counted a trip-desk thread that the inbox is required by the edition split to hide: a number with
 * nothing behind it, unclearable, on the one surface that must never cry wolf.
 * ⚠️ THE LESSON IS THE COMMENT, NOT THE QUERY. A note promising that callers agree does not make
 * them agree; only being the code they all call does. Everything below is now the only place this
 * sum is written — if a fourth surface needs it, import it, do not re-derive it.
 *
 * Every half reads DENORMALIZED counters (Notification.read, Conversation.buyerUnread /
 * sellerUnread), so these are indexed aggregates rather than an N+1.
 * ⚠️ THE OLD VERSION OF THAT SENTENCE ENDED "— safe on the push path where it runs per delivered
 * notification", and it was carried forward onto a body that no longer earns it. `conversationUnread`
 * now awaits `editionSellerScope()`, which resolves owner emails to seller ids with a DB query
 * whenever a hide-list is configured — which it is on eno.vn. React's `cache()` collapses that per
 * REQUEST, and the push worker is not a request, so `badgeCountFor()` pays one extra indexed lookup
 * per delivered notification. A reviewer caught the stale claim. That is the price of the native
 * badge counting the same rows the inbox shows; if it ever matters, memoise the scope at module
 * level with a TTL rather than dropping the scope.
 */

/**
 * ⛔ A THREAD THE VIEWER DELETED IS NOT UNREAD. The inbox hides a conversation whose `…DeletedAt` is
 * set and which has had no newer message since (conversations/route.ts filters exactly that), so a
 * count that sums every row is a permanent phantom — and it is HALF of what the owner saw.
 *
 * ⚠️ THE SAME PREDICATE THE LIST USES, WRITTEN IN SQL INSTEAD OF JS. `db.conversation.fields.…` is
 * Prisma's typed field reference, so this is a field-to-field comparison in the database rather than
 * two round trips and two clocks. ⚠️ PER ROLE, because the delete is per side: a buyer clearing
 * their copy must not hide the seller's unread, and for the support desk the operator's side is
 * `sellerDeletedAt`.
 *
 * ⛔ BUILT INSIDE THE CALL, NEVER AT MODULE SCOPE, AND A TEST RUN PROVED WHY. As two consts these
 * read `db.conversation.fields` the instant anything imported this file — and `src/lib/push.ts`
 * imports it at the top — so three suites that mock `db` without a `fields` property died on
 * `Cannot read properties of undefined` during IMPORT, before a single test ran. The same coupling
 * is a hazard in production: it makes module load order depend on the Prisma client being fully
 * constructed. Touching the field references only when a query is actually being built removes both.
 */
const liveForBuyer = () => ({
  OR: [{ buyerDeletedAt: null }, { lastMessageAt: { gt: db.conversation.fields.buyerDeletedAt } }],
})
const liveForSeller = () => ({
  OR: [{ sellerDeletedAt: null }, { lastMessageAt: { gt: db.conversation.fields.sellerDeletedAt } }],
})

export type UnreadTotals = {
  /** Unread rows in the notification bell. */
  notifications: number
  /** Unread chat messages, summed across both sides of every conversation. */
  conversations: number
  /** What the app-icon badge shows. */
  total: number
}

/**
 * Unread chat messages for one person, counting exactly the threads their inbox will show them.
 *
 * @param includeSupportDesk whether to add the shared support desk's unread — true only for an
 * operator, because for everyone else those threads are not theirs to read. ⚠️ THE CALLER DECIDES,
 * AND DELIBERATELY SO: proving admin-ness costs a different amount on each path (a remote
 * `getAdmin()` in a route handler, a local JWT claim on the 45s poll, nothing at all on the push
 * worker), and burying the most expensive of those in here would put an auth round trip on the
 * app's most frequent request. See the notes at each call site.
 */
export async function conversationUnread(
  profileId: string,
  { includeSupportDesk = false }: { includeSupportDesk?: boolean } = {},
): Promise<number> {
  /**
   * ⛔ THE EDITION SCOPE IS THE OTHER HALF OF THE OWNER'S PHANTOM, and it is the half that had no
   * copy here at all. eno.vn is a licensed sàn TMĐT and hides the visa/trip desk outright, so a
   * desk thread is invisible in that edition's inbox by law, not by preference — a count that
   * ignores the scope is guaranteed to exceed what the list can show.
   */
  const notDesk = await editionSellerScope()
  /**
   * ⛔ `AND: [...]`, NOT A SPREAD — THE SAME COLLISION THIS FILE SPENDS FOUR PARAGRAPHS ON, ONE KEY
   * OVER. `{ ...notDesk, ...liveForBuyer() }` was the first version, and a reviewer pointed out that
   * it reintroduces the exact hazard the desk branch below documents: `liveForBuyer()` owns the key
   * `OR`, so the day `editionSellerScope()` returns an `OR` of its own, the delete filter silently
   * eats it and the edition's hide-list stops applying. Nothing fails; the count is just wrong again.
   * `AND` composes two independent predicates with no shared keys to lose, and costs nothing.
   * ⚠️ THE TEST CANNOT CATCH THE SPREAD VERSION, which is why the shape matters rather than the
   * coverage: its stub scope is `{ sellerId: { notIn: [...] } }`, so there is no `OR` to be eaten.
   */
  /**
   * ⛔ THE THREE TERMS ARE SUMMED, SO THEY MUST BE DISJOINT — AND THIS IS NOT DEFENDED BY AN
   * INVARIANT ANY MORE, IT IS ENFORCED. Two independent reviewers, in two rounds, reported the
   * support operator's badge doubling: the desk branch counts `sellerId = SUPPORT_SELLER_ID` and the
   * seller branch counts `sellerProfileId = me`, so a row carrying both is counted twice — one unread
   * customer message showing as 2, forever.
   * ⚠️ support-thread.ts states that cannot happen ("BOTH ROWS ARE UNOWNED … `sellerProfileId` stays
   * null"), the only `create` for a desk thread sets no `sellerProfileId`, and I could not reach the
   * production database to check the claim against real rows. That is exactly the situation in which
   * a documented invariant is worth the one clause it costs to stop depending on: a legacy row, a
   * backfill, or someone "fixing" the null ownerId later would each turn a comment into a wrong
   * number on the one surface that must never cry wolf.
   * ⚠️ IT ALSO MAKES THE COUNT MATCH THE LIST, which shows a desk thread only through its operator
   * branch (conversations/route.ts) — never through the viewer's own seller role.
   */
  const notTheDesk = { sellerId: { not: SUPPORT_SELLER_ID } }
  const [asBuyer, asSeller, asSupport] = await Promise.all([
    db.conversation.aggregate({ where: { AND: [{ buyerProfileId: profileId }, notDesk, liveForBuyer()] }, _sum: { buyerUnread: true } }),
    db.conversation.aggregate({ where: { AND: [{ sellerProfileId: profileId }, notTheDesk, notDesk, liveForSeller()] }, _sum: { sellerUnread: true } }),
    /**
     * ⛔ NO EDITION SCOPE ON THIS ONE, AND IT MUST MATCH THE LIST EXACTLY. Two drafts got this wrong
     * in opposite directions and two reviewers caught the pair disagreeing:
     *   · `{ sellerId: SUPPORT_SELLER_ID, ...notDesk }` — a SPREAD, and edition-scope.ts documents
     *     that trap in as many words ("Object spread overwrites on key collision, so the obvious
     *     usage silently loses"). `notDesk` IS `{ sellerId: … }` whenever an edition hides anyone,
     *     which eno.forum does, so the support filter was discarded outright and the badge summed
     *     sellerUnread across EVERY seller.
     *   · `AND: [{ sellerId }, notDesk]` — no longer wrong, but no longer the same question the LIST
     *     asks: that exempts the desk from the scope entirely.
     * `SUPPORT_SELLER_ID` is build-scoped, so naming it IS the edition scope; nothing further to
     * intersect with, and the list branch says exactly this.
     */
    /**
     * ⚠️ THE DESK'S `sellerDeletedAt` IS SHARED BETWEEN OPERATORS, and that is inherent to the row
     * rather than introduced here: the desk thread is ONE conversation owned by nobody, so operator A
     * clearing it drops it from operator B's badge as well. The INBOX behaves identically for the
     * same reason, so badge and list still agree — which is this module's contract. A per-operator
     * read state would need its own table; a reviewer raised it and it is a product decision, not a
     * bug in this count.
     */
    includeSupportDesk
      ? db.conversation.aggregate({ where: { sellerId: SUPPORT_SELLER_ID, ...liveForSeller() }, _sum: { sellerUnread: true } })
      : Promise.resolve({ _sum: { sellerUnread: 0 } }),
  ])
  return (asBuyer._sum.buyerUnread ?? 0) + (asSeller._sum.sellerUnread ?? 0) + (asSupport._sum.sellerUnread ?? 0)
}

export async function unreadTotals(
  profileId: string,
  opts: { includeSupportDesk?: boolean } = {},
): Promise<UnreadTotals> {
  const [notifications, conversations] = await Promise.all([
    /**
     * ⛔ EDITION-SCOPED, AND IT WAS NOT UNTIL THREE REVIEWERS SAID SO. This counted
     * `{ recipientId, read: false }` — every unread row — while /api/notifications has filtered the
     * bell through `notificationScope()` for months, precisely so a `visa_result` row never surfaces
     * on eno.vn. So the NATIVE app-icon badge carried a number the in-app bell could not show and the
     * user could not clear: the same phantom as the conversation half, on the other counter, and on
     * eno.vn it is the licensing boundary rather than a cosmetic one.
     * ⚠️ It predates this refactor rather than arriving with it — but "one definition" is the whole
     * point of this module, and leaving the second half unscoped would have re-created the split it
     * exists to close.
     */
    db.notification.count({ where: { ...notificationScope(profileId, IS_MARKETPLACE), read: false } }),
    conversationUnread(profileId, opts),
  ])
  return { notifications, conversations, total: notifications + conversations }
}

/** Just the badge number. Never throws — a failed count must not take a push down with it,
 *  and a missing badge is far better than a missing notification.
 *  ⚠️ NO DESK BRANCH HERE, and that is a deliberate hold rather than an oversight: the push worker
 *  has a profile id and no session, so proving admin-ness would be a fresh query on a path that
 *  runs per delivered notification. An operator's native badge therefore omits desk threads, which
 *  is the same behaviour it has always had; the in-app badge is the surface that was wrong. */
export async function badgeCountFor(profileId: string): Promise<number | null> {
  try {
    return (await unreadTotals(profileId)).total
  } catch {
    return null
  }
}
