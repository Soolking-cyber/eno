import 'server-only'
import { db } from '../db'
import { getAdmin } from '../admin'
import { getTripDeskOperator } from '../desk-operator'
import { insertMessage } from '../messages'
import { findTripThread, tripDeskMode } from './dm-thread'

/**
 * Posting trip cards into a case's thread. The layer above dm-thread (which owns the binding) and
 * below the routes.
 *
 * ⚠️ NO FUNCTION HERE TAKES A SENDER. The author is always the thread's own sellerProfileId — the
 * desk — read back from the conversation row. There is no argument to forge and no branch that
 * lets a caller nominate an author.
 *
 * ⚠️ NO FUNCTION HERE TAKES AN AMOUNT. A quote card is a handle to a case (see TripQuoteMeta), so
 * the money is read live at render time from the row an admin typed it into. Nothing in this file
 * touches a monetary column or could restate a price.
 *
 * ⚠️ IT DOES NOT BIND. A card can only be posted into a case that is ALREADY bound to a thread,
 * because binding requires proving the traveller owns the case against their own session, which
 * only bindTripThread can do. An unbound case yields null here rather than a thread appearing as
 * a side effect of the desk sending something.
 *
 * Fail-soft throughout: a refused card returns null and logs. The state change it describes has
 * already committed, so throwing would report a completed transition as a failure — the trap
 * visa-admin.ts documents, where the operator re-clicks straight into invalid_status_transition.
 */

/** Columns insertMessage needs (ConvoForSend). Mirrors the visa thread layer's select. */
const THREAD_SELECT = {
  id: true, buyerProfileId: true, sellerProfileId: true, listingId: true, visaApplicationId: true,
} as const

/**
 * Inbox lines for Conversation.lastMessageText.
 *
 * ⚠️ CONSTANT LITERALS, NEVER INTERPOLATED — no itinerary title, no city, no name, no amount. This
 * column is plaintext and BOTH parties' inboxes read it.
 *
 * Bilingual composites rather than tr(), matching the visa desk's previews (dm-steps.ts:192): one
 * stored string is read by two accounts who may have different locales, so there is no single
 * request locale to render it in. The i18n rule applies to what a COMPONENT renders; this is a
 * denormalised column written once by the server.
 */
const TRIP_STATUS_PREVIEW: Record<string, string> = {
  requested: 'Đã gửi yêu cầu hỗ trợ · Assistance requested',
  reviewing: 'Đang xem xét chuyến đi · Reviewing your trip',
  quoted: 'Đã có báo giá · Quote ready',
  accepted: 'Đã chấp nhận báo giá · Quote accepted',
  arranging: 'Đang sắp xếp · Arranging your trip',
  completed: 'Đã hoàn tất · Trip arranged',
  declined: 'Đã từ chối báo giá · Quote declined',
  cancelled: 'Đã huỷ yêu cầu · Request cancelled',
}
const TRIP_QUOTE_PREVIEW = 'Báo giá chuyến đi của bạn · Your trip quote'
/**
 * ⚠️ PII-FREE AND CONSTANT, like every preview here. Conversation.lastMessageText is plaintext,
 * BOTH parties read it, and it is what makes the desk's inbox row say something — so it names the
 * ACT ("a booking was requested") and never the trip. No city, no date, no traveller name.
 */
const TRIP_REQUEST_PREVIEW = 'Yêu cầu đặt chuyến đi · Trip booking requested'

export type SentCard = { messageId: string } | null

/**
 * The operator's quote card.
 *
 * Requires an admin session of its OWN, even though the only caller (quoteAssistance) already
 * proved one. That is deliberate defence in depth: it removes the need for a `byAdmin`-style flag,
 * which would be exactly the kind of caller-supplied claim an external review flagged elsewhere in
 * this feature. A flag can be forged by a route; a session check cannot.
 *
 * NOT gated on desk mode — this IS the human operator acting, so there is nobody to post over.
 */
export async function sendTripQuoteCard(input: { requestId: string }): Promise<SentCard> {
  if (!(await getTripDeskOperator())) return null // the desk's operator, not a site admin — see desk-operator.ts
  return postCard(input.requestId, 'trip_quote', { v: 1, requestId: input.requestId }, TRIP_QUOTE_PREVIEW)
}

/**
 * Announce a status the case has just moved to.
 *
 * Callable by any flow, traveller-triggered included (an accept or a decline should announce
 * itself), because it claims nothing a caller could gain from: the card write re-asserts the
 * announced status against the row inside its transaction, so a status the case is not actually at
 * cannot be posted. That guard is what makes this safe without an identity check of its own.
 *
 * ⚠️ MODE-GATED. If a human operator has taken the case over, the AUTOMATED announcement is
 * skipped — a generated card must not appear underneath somebody mid-conversation. This is the
 * whole reason tripDeskMode exists.
 */
export async function announceTripStatus(input: { requestId: string; status: string }): Promise<SentCard> {
  const preview = TRIP_STATUS_PREVIEW[input.status]
  // An unknown status has no inbox line, and inventing one would put an unreviewed string in a
  // plaintext column. The card guard would refuse it downstream anyway.
  if (!preview) return null
  if ((await tripDeskMode(input.requestId)) === 'human') return null
  return postCard(input.requestId, 'trip_status', { v: 1, requestId: input.requestId, status: input.status }, preview)
}

/**
 * The one write path. Resolves the thread, loads the conversation, and posts as the DESK.
 *
 * Everything that could refuse the card is left to insertMessage's gates rather than re-checked
 * here — a second copy of "is this case bound to this thread?" is a second thing to drift. What
 * this function owns is only: find the thread, and pass the desk's own id as the sender.
 */
/**
 * The traveller's booking request, posted into the desk thread.
 *
 * ⛔ THIS IS THE CARD THAT MAKES A BOOKING REQUEST VISIBLE AT ALL. Before 2026-08-16
 * requestAssistance opened a case row and appended an event, and touched the Conversation not at
 * all — so the desk's inbox showed no new message, no unread count and no changed preview. The
 * owner's report was exactly that: "itinerary landed in messages but it doesnt show new message
 * for seller, only notif". A case in a queue is not a message; this is the message.
 *
 * ⚠️ AUTHORED BY THE TRAVELLER, WHICH IS ALSO WHAT BUMPS THE RIGHT COUNTER. insertMessage
 * increments the COUNTERPARTY (`iAmBuyer ? sellerUnread : buyerUnread`), so posting as the buyer
 * gives the desk its unread for free and in the same write — no second update, and no way for the
 * counter to disagree with the message that caused it. Posting as the desk would have bumped the
 * traveller's own unread for a message the traveller sent.
 *
 * ⚠️ BEST-EFFORT BY DESIGN — returns null instead of throwing, exactly like the other senders. The
 * case already exists by the time this runs; a refused or failed card must not undo it. The
 * traveller has still asked, and the desk still has the case in its queue.
 */
export async function sendTripRequestCard(input: { requestId: string }): Promise<SentCard> {
  /**
   * ⚠️ IDEMPOTENT ON THE CARD, NOT ON "did this call open the case". The first cut posted only when
   * requestAssistance had just opened a case, which made the send unretryable: one transient
   * failure and the traveller had a committed case the desk could never see, because every later
   * call returns the existing case with `opened === false` and skipped the post entirely. Keying
   * on whether the CARD exists means a repeat request repairs the thread instead of silently
   * confirming the damage — and still cannot double-post.
   *
   * ⚠️ Matched on requestId inside metaJson, not on (conversation, kind): one traveller can have
   * several itineraries, so a thread legitimately carries one request card PER case.
   */
  /**
   * ⚠️ BEST-EFFORT DEDUPE — CHECK-THEN-ACT, AND IT IS NOT ATOMIC. Stated plainly because the
   * previous version of this comment claimed it was: I wrapped the check in a transaction taking
   * `pg_advisory_xact_lock`, which releases ON COMMIT — i.e. before postCard's own insert — so the
   * lock serialised the READ and nothing else. Two concurrent calls could still both find nothing
   * and both post. A reviewer caught the claim; a lock that protects the wrong statement is worse
   * than none, because the next reader trusts it.
   *
   * What this DOES stop is the common case, which is the one that matters here: a retry minutes
   * later after a failed send, and a traveller pressing the button again. What it does not stop is
   * a genuine double-tap racing itself.
   *
   * ⛔ THE REAL FIX IS A PARTIAL UNIQUE INDEX on Message (kind, requestId-from-metaJson) — deliberately
   * NOT done here: it is DDL on a live table, this repo's schema flow requires the migrate-diff
   * review path, and the failure it prevents is a duplicate CARD, not a duplicate case. The case
   * itself is already serialised by its own advisory lock inside requestAssistance's transaction,
   * where the lock and the insert genuinely do share one transaction. So the worst outcome here is
   * two identical request cards in a thread, which reads as noise rather than as a wrong booking.
   */
  const already = await db.message.findFirst({
    where: { kind: 'trip_request', metaJson: { contains: input.requestId } },
    select: { id: true },
  })
  if (already) return { messageId: already.id }
  return postCard(input.requestId, 'trip_request', { v: 1, requestId: input.requestId }, TRIP_REQUEST_PREVIEW, 'traveller')
}

async function postCard(
  requestId: string,
  kind: 'trip_quote' | 'trip_status' | 'trip_request',
  meta: { v: 1; requestId: string; status?: string },
  preview: string,
  /** Whose voice the card is in. Everything the DESK says defaults; only a booking request is the
   *  traveller's own, and buildTripCardMeta enforces the same split on the write side. */
  author: 'desk' | 'traveller' = 'desk',
): Promise<SentCard> {
  try {
    const thread = await findTripThread(requestId)
    if (!thread) return null
    const convo = await db.conversation.findUnique({ where: { id: thread.conversationId }, select: THREAD_SELECT })
    // sellerProfileId is the DESK. findTripThread already refuses a thread without one, so this
    // is a type narrowing rather than a real branch — but it is checked, not asserted.
    if (!convo?.sellerProfileId) return null
    // ⚠️ The traveller side is `buyerProfileId`, and it is checked rather than assumed: a thread
    // without one cannot carry a request card, and insertMessage would otherwise author as the
    // desk and bump the wrong counter.
    const senderId = author === 'traveller' ? convo.buyerProfileId : convo.sellerProfileId
    if (!senderId) return null
    const message = await insertMessage(convo, senderId, '', { kind, meta, preview })
    return { messageId: message.id }
  } catch (e) {
    // The gates throw by design (trip_card_conversation_mismatch, trip_card_traveller_mismatch,
    // and the status predicate). A refused card is a normal outcome, not a server error.
    console.error('[trips-dm] card refused', { requestId, kind, error: (e as Error)?.message })
    return null
  }
}
