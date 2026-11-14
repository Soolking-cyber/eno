import 'server-only'
import { db } from '@/lib/db'
import { isReviewSeatEmail } from '@/lib/review-seat-accounts'

/**
 * The database half of the review-seat rules (src/lib/review-seat-accounts.ts), kept out of that pure module so its table
 * test needs no client: the two reads behind "a review seat's listings are never public" (REVIEW_SEAT_HELD_NOTE), and the
 * one predicate behind "a review seat never reaches a teacher" (reviewSeatMeetsTeacher).
 */

/**
 * ⛔ WOULD THIS ACT PUT A REVIEW SEAT IN FRONT OF A TEACHER? The ONE predicate every seat-side act in a thread asks before
 * it writes, rings or notifies anything (round 4, 2026-11-14 — codex + opus: the messages route asked it, while the call,
 * the deal line and the sale question still reached a teacher the seat SOLD to):
 *   · a message — api/conversations (the opener), api/conversations/[id]/messages;
 *   · a new reaction on the other person's message — api/messages/[id]/reactions (taking one back stays open);
 *   · an answer to an offer — api/conversations/[id]/offer (accept or decline is a line, a bell and a push);
 *   · a deal confirm or its undo — api/conversations/[id]/deal (the 'deal_confirmed' / withdrawn line);
 *   · "did you buy this?" — api/listings/[id]/sold naming a buyer (a bell and a push);
 *   · a call, its request and its accept — calls/server/eligibility.ts callPermit, BOTH WAYS (`eitherWay`): a call is two
 *     people talking, whoever dialled;
 *   · a seller's number — api/listings/[id]/contact, when the seller is a teacher (round 5: a thread a teacher answered
 *     before the seat rules still passes reply-first). The teacher thread's own reads — api/teachers/contact and
 *     api/teachers/cv — refuse a seat by its address alone: their other side is always the teacher.
 * src/lib/review-seat-writes.test.ts pins that every write route under api/conversations and api/messages asks it (or
 * callPermit), or says why it need not.
 *
 * TRUE when the actor holds a STORE-review seat's address (review-seat-accounts.ts — never the lawyer's) — Profile.email, the address ensureProfile pins on a seat's row
 * (src/lib/profile.ts), never the session's — and the other person is a teacher: they own a TeacherProfile, live or hidden
 * (a hidden profile is the teacher's own switch, not a sign they are not one), or they are `teacherSeller`, the seller of
 * the thread's teacher listing, which the thread says without a read. With `eitherWay`, also the other way round.
 * In ANY role and over ANY listing type: the seat as the buyer, and as the seller a teacher wrote to (a seat's job post,
 * anything else it sells), in a thread opened before this rule too.
 * Reads: the actor's Profile — none when the route passes `actorEmail`, the Profile row auth 'profile' already read;
 * `eitherWay` reads the other's too. Only a seat reads further (one TeacherProfile). Nobody on the other side, or the
 * actor on both, is no teacher, with no read. A failed read THROWS: the caller refuses (fail closed).
 */
export async function reviewSeatMeetsTeacher(
  actorId: string,
  otherId: string | null | undefined,
  opts: { actorEmail?: string | null; teacherSeller?: string | null; eitherWay?: boolean } = {},
): Promise<boolean> {
  if (!otherId || otherId === actorId) return false
  const emailOf = async (id: string) => (await db.profile.findUnique({ where: { id }, select: { email: true } }))?.email ?? null
  const [actorEmail, otherEmail] = await Promise.all([
    opts.actorEmail !== undefined ? opts.actorEmail : emailOf(actorId),
    opts.eitherWay ? emailOf(otherId) : null,
  ])
  const isTeacher = async (id: string) =>
    id === opts.teacherSeller || !!(await db.teacherProfile.findUnique({ where: { profileId: id }, select: { id: true } }))
  if (isReviewSeatEmail(actorEmail) && (await isTeacher(otherId))) return true
  return isReviewSeatEmail(otherEmail) && (await isTeacher(actorId))
}

/**
 * Is this storefront owner a review seat? Read from Profile.email — the address ensureProfile pins on a seat's row
 * (src/lib/profile.ts), never the session's, which the seat can change. No owner (a platform import) is no seat, with no
 * read. A failed read THROWS: the create that asked fails with it, so no listing is written past an unanswered check.
 */
export async function ownerIsReviewSeat(ownerId: string | null | undefined): Promise<boolean> {
  if (!ownerId) return false
  const owner = await db.profile.findUnique({ where: { id: ownerId }, select: { email: true } })
  return isReviewSeatEmail(owner?.email)
}

/**
 * Which of these listings a review seat owns — what an admin publish refuses by name (api/admin/listings,
 * api/admin/moderate). Any state, a tombstone included: the refusal is about the owner, not the row.
 * ⛔ JUDGED BY isReviewSeatEmail, THE CREATE HOLD'S OWN TEST (opus, round 3): ownerIsReviewSeat trims and ignores case, so a
 * row it held must be one this names — a SQL `in` would miss an owner whose stored address differs in case or spacing,
 * and the admin's Activate would publish the row the create held. The owners' addresses are read and matched here.
 */
export async function reviewSeatListingIds(ids: readonly string[]): Promise<string[]> {
  if (!ids.length) return []
  // edition-lint-allow: an admin-side ownership probe over the ids the admin's own request named; a list of ids that
  // never reaches a public surface — an edition scope would hide a desk row and let its publish through unchecked.
  const rows = await db.listing.findMany({ where: { id: { in: [...ids] } }, select: { id: true, seller: { select: { owner: { select: { email: true } } } } } })
  return rows.filter((r) => isReviewSeatEmail(r.seller?.owner?.email)).map((r) => r.id)
}
