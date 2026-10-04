/**
 * BLOCKING ANOTHER USER — App Store Guideline 1.2 (plan R3), behind the `ugc-safety` review gate.
 *
 * With the gate OFF (the default) every helper here answers "nothing is blocked" WITHOUT touching the
 * database, so the messaging hot paths that call them pay nothing and behave exactly as before.
 *
 * STORAGE: `ForumUserBlock` — already a generic Profile↔Profile table (composite primary key, cascade
 * delete on either profile), so no DDL. Its rows predate this file only through the dormant forum API
 * (`/api/forum/blocks`, which nothing in the root app calls); a block is a block wherever it was made.
 *
 * WHAT A BLOCK DOES, both directions (Apple asks that a blocked user can no longer reach the blocker):
 *   · no NEW conversation between the two (POST /api/conversations),
 *   · no message and no offer in an EXISTING one (POST …/[id]/messages, …/[id]/offer),
 *   · the blocker's inbox stops listing threads with the blocked user.
 * The thread itself is not deleted — it is evidence if either side reports the other.
 *
 * ⛔ IT NOTIFIES MODERATORS THROUGH THE FEEDBACK QUEUE, NOT A REPORT. The plan said "open a moderation
 * report on every block". A `Report` row against the blocked profile is not neutral here: an OPEN report
 * makes `eraseAccount` refuse that user's own deletion ('under_review', src/app/api/account/delete), so
 * merely being blocked would cost someone their deletion right until an admin acted. The `Feedback` row
 * lands in /admin/feedback for a human, with no trust, enforcement or deletion effect. Reporting stays a
 * separate, deliberate act (the Report button beside Block).
 */
import { db } from '@/lib/db'
import { appReviewGate } from '@/lib/app-review-gates'
import { isAdminEmail } from '@/lib/admin'
import { logError } from '@/lib/log'

/** Is blocking switched on for this build? (`ugc-safety` in NEXT_PUBLIC_APP_REVIEW_GATES.) */
export const blockingOn = (): boolean => appReviewGate('ugc-safety')

/**
 * Has either of these two profiles blocked the other? False — with no query — when the gate is off,
 * when either side is unknown (an ownerless storefront, a support thread), or for the same profile.
 */
export async function isBlockedBetween(a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (!blockingOn() || !a || !b || a === b) return false
  const row = await db.forumUserBlock.findFirst({
    where: { OR: [{ blockerProfileId: a, blockedProfileId: b }, { blockerProfileId: b, blockedProfileId: a }] },
    select: { blockerProfileId: true },
  })
  if (!row) return false
  // ⛔ A BLOCK WITH THE ENO TEAM ON EITHER SIDE IS VOID FOR ENFORCEMENT. The API refuses to create one
  // (cannot_block_staff), but rows from the dormant forum API predate that rule, and an admin's own
  // block would close the very desk threads where cases are settled (opus, review). Costs a query only
  // when a block row actually exists.
  if ((await isStaffProfile(a)) || (await isStaffProfile(b))) return false
  return true
}

/**
 * The profiles THIS user has blocked (empty, with no query, while the gate is off) — the eno team
 * excluded, by the same rule that voids such a block in isBlockedBetween, so the inbox and badge can
 * never hide a thread the send path still treats as open (codex + opus, review). A staffer blocking
 * someone is refused by the API, so a staff `me` normally has no rows; if one exists it is void too.
 */
export async function profilesBlockedBy(me: string): Promise<Set<string>> {
  if (!blockingOn()) return new Set()
  const rows = await db.forumUserBlock.findMany({ where: { blockerProfileId: me }, select: { blockedProfileId: true } })
  if (!rows.length) return new Set()
  // ONE query for the staff test of me and every blocked profile — this runs on every badge poll while
  // the gate is on, so a per-row lookup would cost N+2 queries per poll (opus, review).
  const people = await db.profile.findMany({ where: { id: { in: [me, ...rows.map((r) => r.blockedProfileId)] } }, select: { id: true, email: true } })
  const staff = new Set(people.filter((p) => isAdminEmail(p.email)).map((p) => p.id))
  if (staff.has(me)) return new Set()
  return new Set(rows.map((r) => r.blockedProfileId).filter((id) => !staff.has(id)))
}

/**
 * The conversations this user's inbox and unread badge must leave out: threads with someone they
 * blocked. Ids, so the caller can exclude them with `id: { notIn }` in the WHERE — filtering after
 * the inbox's `take` would shrink the page and hide older threads, and a `NOT IN` on the nullable
 * `sellerProfileId` would drop every support-desk thread (NULL) along with them (codex, review).
 */
export async function blockedConversationIds(me: string): Promise<string[]> {
  const blocked = [...(await profilesBlockedBy(me))]
  if (!blocked.length) return []
  const rows = await db.conversation.findMany({
    where: { OR: [{ buyerProfileId: me, sellerProfileId: { in: blocked } }, { sellerProfileId: me, buyerProfileId: { in: blocked } }] },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/**
 * Is this profile the eno team (ADMIN_EMAILS)? ⛔ THE TEAM CANNOT BE BLOCKED. It owns the e-Visa / trip
 * desk and imported shops, so one applicant's block would 403 every admin reply in the thread where
 * their own case is being settled, and silence the admin across every other shop it owns (opus,
 * review). Report stays available for the team's conduct.
 */
export async function isStaffProfile(profileId: string): Promise<boolean> {
  const p = await db.profile.findUnique({ where: { id: profileId }, select: { email: true } })
  return isAdminEmail(p?.email)
}

/**
 * Block or unblock. Idempotent both ways, including two taps racing each other: the insert skips a
 * duplicate instead of throwing on the composite key, and the moderation note (see the header) is filed
 * only by the request that actually inserted — best-effort, the block must not fail because of it.
 */
export async function setUserBlock(
  blocker: string,
  blocked: string,
  on: boolean,
  context: { surface: 'chat' | 'storefront' | 'settings'; conversationId?: string | null; sellerId?: string | null },
): Promise<void> {
  if (!on) {
    await db.forumUserBlock.deleteMany({ where: { blockerProfileId: blocker, blockedProfileId: blocked } })
    return
  }
  const { count } = await db.forumUserBlock.createMany({ data: [{ blockerProfileId: blocker, blockedProfileId: blocked }], skipDuplicates: true })
  if (count === 0) return
  try {
    const where = context.conversationId ? ` in conversation ${context.conversationId}` : context.sellerId ? ` from storefront ${context.sellerId}` : ''
    await db.feedback.create({
      data: {
        kind: 'other',
        profileId: blocker,
        message: `[user block] Profile ${blocker} blocked profile ${blocked} (${context.surface})${where}. Review the exchange; a block alone is not a report.`,
        url: context.conversationId ? `/messages/${context.conversationId}` : context.sellerId ? `/sellers/${context.sellerId}` : null,
      },
    })
  } catch (e) {
    logError(e, { op: 'user-blocks.notify' })
  }
}
