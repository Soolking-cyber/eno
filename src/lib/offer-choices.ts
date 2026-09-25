/**
 * AN ANSWER TO AN OFFER THAT THE SERVER HAS NOT HEARD YET.
 *
 * Owner, 2026-09-25: "Undo toast, 5 seconds" for Accept/Decline in chat. The card shows the choice
 * the moment it is tapped, but the POST waits out the undo window (see useUndoWindow), and after that
 * it is in flight for a round trip. For that whole stretch the thread's own refetches — the 15s poll,
 * the focus refetch, the realtime nudge — keep bringing back the server's truth, which is still
 * `pending`. Painted as-is, that truth resurrects the Accept/Decline buttons under a toast that says
 * "Offer accepted", and a second tap on them is a second POST.
 *
 * So the thread keeps a map of these unconfirmed choices and lays it over every server payload with
 * `overlayOfferChoices`. Pure, and in its own module, so the rule is tested without mounting the
 * 2,700-line thread page.
 */

export type OfferChoice = 'accepted' | 'declined'
export type OfferAction = 'accept' | 'decline'

/**
 * THE MAP ITSELF — messageId → the answer the card shows, from the tap until the server is seen to
 * agree. MODULE-LEVEL, NOT A COMPONENT REF, because the answer outlives the thread page: leaving the
 * thread sends the deferred POST, and a user who comes straight back mounts a NEW page while that
 * request is still in flight. With a per-mount ref the new page painted the cached (and freshly
 * refetched) `pending` with live Accept/Decline, and a second tap was a second POST that 409s and
 * toasts "not accepted" about an offer that WAS accepted (reviewer-caught, panel round 1).
 * Message ids are globally unique, so one map serves every thread.
 * An entry is dropped when the answer is refused or its outcome is unknown (the server's `pending`
 * is then the truth), when Undo takes it back, and when a refetch shows the server holding a decided
 * status. A successful answer's entry deliberately OUTLIVES the POST: a poll that left before the POST
 * and lands after it still carries `pending`, and this is what stops it resurrecting the buttons.
 */
export const unconfirmedOfferChoices = new Map<string, OfferChoice>()

export const choiceFor = (action: OfferAction): OfferChoice => (action === 'accept' ? 'accepted' : 'declined')

type OfferLike = { id: string; kind?: string; offerStatus?: string | null }

/**
 * Paint each unconfirmed choice over a message the server still reports as `pending`.
 *
 * ⚠️ ONLY OVER `pending`. Any other server status is a decision that has already been made — the buyer
 * withdrew or countered, or this same user answered from another device — and it wins over a choice
 * that has not been sent. Painting ours over it would show a state the server will refuse.
 * Returns the SAME array when there is nothing to change, so a caller comparing references (React state)
 * does not re-render for a no-op.
 */
export function overlayOfferChoices<M extends OfferLike>(messages: M[], choices: ReadonlyMap<string, OfferChoice>): M[] {
  if (!choices.size) return messages
  let changed = false
  const next = messages.map((m) => {
    const choice = choices.get(m.id)
    if (!choice || m.kind !== 'offer' || m.offerStatus !== 'pending') return m
    changed = true
    return { ...m, offerStatus: choice }
  })
  return changed ? next : messages
}

/**
 * The ids, among `ids`, that the server now reports as ANSWERED (present, an offer, not `pending`).
 * A choice still inside its undo window for one of these can no longer be sent — the offer changed
 * under it — so the caller cancels that window instead of posting into a certain 409.
 * An id that is simply absent from the payload is NOT reported: the thread returns a bounded page of
 * messages, and "not in this page" is not "answered".
 */
export function answeredOnServer(messages: OfferLike[], ids: Iterable<string>): string[] {
  const byId = new Map(messages.map((m) => [m.id, m] as const))
  const out: string[] = []
  for (const id of ids) {
    const m = byId.get(id)
    if (m && m.kind === 'offer' && m.offerStatus !== 'pending') out.push(id)
  }
  return out
}

type Tr = (en: string, vi: string) => string

/**
 * What to say when the deferred POST is refused. The route's contract (unchanged):
 * 409 `listing_unavailable` — accept on a listing that is no longer active;
 * 409 `not_actionable` — the offer is no longer pending (withdrawn, countered, already answered);
 * anything else (429, 403, 5xx, a dropped connection) — worth trying again.
 * ⚠️ This lands up to ~5s after the tap, possibly after the user has left the thread, so it names the
 * action — "Could not accept the offer", never a bare "Something went wrong".
 */
export function offerActFailedCopy(action: OfferAction, code: string | undefined, tr: Tr): string {
  // Accept-only: the route refuses an ACCEPT on a listing that is no longer active and lets a decline
  // through (it must always be possible to clear a stale offer), so this reason never explains a decline.
  if (code === 'listing_unavailable' && action === 'accept') {
    return tr('The listing is no longer available, so the offer was not accepted.', 'Tin đăng không còn khả dụng nên đề nghị chưa được chấp nhận.')
  }
  if (code === 'not_actionable') {
    return action === 'accept'
      ? tr('That offer changed before your answer was sent, so it was not accepted.', 'Đề nghị đã thay đổi trước khi câu trả lời được gửi nên chưa được chấp nhận.')
      : tr('That offer changed before your answer was sent, so it was not declined.', 'Đề nghị đã thay đổi trước khi câu trả lời được gửi nên chưa bị từ chối.')
  }
  return action === 'accept'
    ? tr('Could not accept the offer — please try again.', 'Chưa chấp nhận được đề nghị — vui lòng thử lại.')
    : tr('Could not decline the offer — please try again.', 'Chưa từ chối được đề nghị — vui lòng thử lại.')
}
