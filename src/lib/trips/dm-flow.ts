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
async function postCard(
  requestId: string,
  kind: 'trip_quote' | 'trip_status',
  meta: { v: 1; requestId: string; status?: string },
  preview: string,
): Promise<SentCard> {
  try {
    const thread = await findTripThread(requestId)
    if (!thread) return null
    const convo = await db.conversation.findUnique({ where: { id: thread.conversationId }, select: THREAD_SELECT })
    // sellerProfileId is the DESK. findTripThread already refuses a thread without one, so this
    // is a type narrowing rather than a real branch — but it is checked, not asserted.
    if (!convo?.sellerProfileId) return null
    const message = await insertMessage(convo, convo.sellerProfileId, '', { kind, meta, preview })
    return { messageId: message.id }
  } catch (e) {
    // The gates throw by design (trip_card_conversation_mismatch, trip_card_traveller_mismatch,
    // and the status predicate). A refused card is a normal outcome, not a server error.
    console.error('[trips-dm] card refused', { requestId, kind, error: (e as Error)?.message })
    return null
  }
}
