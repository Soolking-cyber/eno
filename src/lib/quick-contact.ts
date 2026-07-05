import type { SerializedListingCard } from '@/lib/types'
import { COMPOSE_KEY } from '@/components/marketplace/contact-composer'

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
  try {
    sessionStorage.setItem(COMPOSE_KEY, JSON.stringify({
      listingId: l.id,
      body: opts.body?.trim() ?? '',
      offerAmount: opts.offerAmount ?? null,
      listingTitle: l.title,
      listingImage: l.images[0] ?? null,
      trackPrice: opts.offerAmount ?? (l.price || null),
      currency: l.currency,
    }))
    return true
  } catch {
    return false // storage blocked — caller falls back to the listing page
  }
}
