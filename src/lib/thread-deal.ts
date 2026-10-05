/**
 * THE DEAL A THREAD AGREED — AND WHETHER IT STILL STANDS FOR THE LISTING THE THREAD IS ABOUT NOW.
 *
 * Drives the seller's "Deal! Mark as sold?" chip and the "Agreed price" the mark-sold sheet starts from
 * (B6). Pure, so the rule is pinned by src/lib/thread-deal.test.ts rather than by mounting the thread page.
 *
 * ⛔ AN ACCEPTED OFFER IS A FACT ABOUT THE CONVERSATION, NOT ABOUT ITS CURRENT LISTING. Message has no
 * listingId, and a thread is one-per-buyer-per-seller: when the buyer asks the same seller about another
 * item, POST /api/conversations RETARGETS the thread to it (retargetForListing). Only a PENDING offer
 * blocks that move — an ACCEPTED one does not. So after a sofa deal, the buyer asking about the table
 * leaves the sofa's accepted offer sitting in a thread that now shows the table, and a chip keyed on "the
 * thread has an accepted offer" would offer to mark the TABLE sold, to that buyer, at the sofa's price.
 *
 * The client cannot see a retarget happen, but it can see what one always leaves behind: the buyer's own
 * message. A marketplace thread is retargeted only by the buyer sending something from another listing's
 * page (/messages/pending posts a note or an offer — the bare "open the thread" handoff is the trip
 * desk's, which is never a listing thread). ⚠️ The SHELVED native apps break that assumption: they POST
 * `{ listingId }` alone to open a thread (apps/ios ListingDetailView.swift, apps/android Detail.kt), a
 * retarget with no message. If they are ever revived, fix it on the server — refuse to retarget a thread
 * holding an ACCEPTED offer, as retargetForListing already does for a pending one — not here. So the
 * deal STANDS only while:
 *   · it is the newest offer in the thread — a later offer is a new negotiation, or a retarget that came
 *     with one;
 *   · the buyer has written nothing since, apart from their own "✅ accepted" line when it was the BUYER
 *     who accepted (actOnOffer posts that line as the acceptor) — anything more may be a retarget, and is
 *     at least a conversation that has moved on. That line is IDENTIFIED by its persisted body, not
 *     allowed by count: actOnOffer inserts it after its claim commits, so if that insert ever fails, a
 *     count would wave through the one message a retarget leaves;
 *   · the listing was not relisted or re-confirmed "still available" after it — both stamp
 *     availabilityConfirmedAt (core/listings.ts), and either says this deal did not close the sale;
 *   · the answer is not still unconfirmed (the 5-second undo window and its POST — offer-choices.ts).
 * ⚠️ CONSERVATIVE ON PURPOSE: an ordinary "see you at 5" from the buyer also ends it. The cost is a chip
 * that steps aside (the strip's 'Đã bán' is still there, with the thread's buyer picked); the cost of the
 * other direction is a listing sold that nobody sold.
 * ⚠️ KNOWN RESIDUAL, SERVER-SIDE: retargetForListing commits the thread's new listing BEFORE the buyer's
 * message is inserted, so a refetch landing in that gap (or a failed insert) sees a retargeted thread with
 * no new message. The cure is the server guard named above — refuse to retarget a thread holding an
 * ACCEPTED offer, as it already refuses one holding a pending offer — which would also let the "buyer
 * wrote since" rule go. It changes conversation routing, so it is the owner's call, not this file's.
 */

/** The opening of the line actOnOffer persists for an accept (bilingual composite, messages.ts). */
const ACCEPTED_LINE = '✅ Đã chấp nhận · Offer accepted'

export type DealMessage = {
  id: string
  mine: boolean
  createdAt: string
  kind?: string
  body?: string
  offerStatus?: string | null
  offerAmount?: number | null
}

export type StandingDeal = { offerId: string; amount: number | null }

export function standingDeal(
  messages: readonly DealMessage[],
  listing: { availabilityConfirmedAt?: string | null } | null | undefined,
  /** The VIEWER's frame, as everywhere in the thread: the buyer's messages are `!mine` for a seller. */
  viewerIsSeller: boolean,
  /** An answer the server has not confirmed yet (unconfirmedOfferChoices) — never a standing deal. */
  unconfirmed: (offerId: string) => boolean = () => false,
): StandingDeal | null {
  let at = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.kind === 'offer' && m.offerStatus === 'accepted') { at = i; break }
  }
  if (at < 0) return null
  const offer = messages[at]
  if (unconfirmed(offer.id)) return null
  const later = messages.slice(at + 1)
  if (later.some((m) => m.kind === 'offer')) return null
  const fromBuyer = (m: DealMessage) => (viewerIsSeller ? !m.mine : m.mine)
  // The acceptor posts the "✅" line: the buyer did when the offer was the SELLER's — and that line, by its
  // body, is the only thing the buyer may have written since.
  const buyerLater = later.filter(fromBuyer)
  const isAcceptedLine = (m: DealMessage) => (m.kind ?? 'text') === 'text' && (m.body ?? '').startsWith(ACCEPTED_LINE)
  if (buyerLater.length > 0 && !(buyerLater.length === 1 && !fromBuyer(offer) && isAcceptedLine(buyerLater[0]))) return null
  const reconfirmed = listing?.availabilityConfirmedAt ? Date.parse(listing.availabilityConfirmedAt) : NaN
  const offeredAt = Date.parse(offer.createdAt)
  if (Number.isFinite(reconfirmed) && (!Number.isFinite(offeredAt) || reconfirmed >= offeredAt)) return null
  return { offerId: offer.id, amount: typeof offer.offerAmount === 'number' && offer.offerAmount > 0 ? offer.offerAmount : null }
}
