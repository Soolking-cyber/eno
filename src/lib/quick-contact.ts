import type { SerializedListingCard } from '@/lib/types'

/** sessionStorage handoff → /messages/pending. Defined HERE, the one writer module
 *  (audit Phase 1: the composer carried a second inline writer of the same key). */
export const COMPOSE_KEY = 'eno-compose'

/**
 * Shared handoff for the card/row quick actions (grid hover bar + compact rows):
 * stash a structured compose payload and let /messages/pending do what it already
 * does for the PDP composer — create the conversation, post the first message or
 * offer card, swap to the real thread. One flow, no duplicate send logic.
 * Caller must be AUTHED (guests get openSignIn instead) and must router.push
 * '/messages/pending' after this returns true.
 */
export function stashQuickCompose(
  l: Pick<SerializedListingCard, 'id' | 'title' | 'images' | 'price' | 'currency'>,
  opts: { body?: string; offerAmount?: number | null },
): boolean {
  return stashCompose({
    listingId: l.id,
    body: opts.body,
    offerAmount: opts.offerAmount ?? null,
    listingTitle: l.title,
    listingImage: l.images[0] ?? null,
    price: l.price || null,
    currency: l.currency,
  })
}

/** The ONE writer of the COMPOSE_KEY payload — the PDP composer and the card quick
 *  actions both come through here, so /messages/pending reads one field contract. */
export function stashCompose(payload: {
  listingId: string
  body?: string | null
  offerAmount?: number | null
  listingTitle?: string | null
  listingImage?: string | null
  price?: number | null
  currency: string
  /**
   * "Open the trip planner", not "send this text".
   *
   * ⚠️ THE ONE PAYLOAD THAT CARRIES NO MESSAGE. Every other compose is a thing to say; this one is
   * an intent to start a form, so /messages/pending accepts it with an empty body and lands on
   * `/messages/<id>?plan=1` instead of posting anything. It exists because the trip desk's CTA
   * promised a form and delivered a line of chat — see the note on it in contact-composer.
   */
  plan?: boolean
}): boolean {
  const offerAmount = payload.offerAmount ?? null
  try {
    sessionStorage.setItem(COMPOSE_KEY, JSON.stringify({
      listingId: payload.listingId,
      body: (payload.body ?? '').trim(),
      offerAmount,
      listingTitle: payload.listingTitle ?? '',
      listingImage: payload.listingImage ?? null,
      trackPrice: offerAmount ?? (payload.price ?? null),
      currency: payload.currency,
      plan: payload.plan === true,
    }))
    return true
  } catch {
    return false // storage blocked — caller decides the fallback
  }
}
