import 'server-only'
import type { AdRow, BookResult } from './book'
import { UNPAID_CANCELLED, UNPAID_EXPIRED } from './reasons'

/** One ad as every answer states it (HTTP and MCP). */
export type AdView = {
  id: string; listing_id: string; status: string; starts_at: string | null; ends_at: string | null
  tx_hash: string | null; network: string; amount_atomic: string
}

export function adView(ad: AdRow): AdView {
  return {
    id: ad.id,
    listing_id: ad.listingId,
    status: ad.status,
    starts_at: ad.startsAt?.toISOString() ?? null,
    ends_at: ad.endsAt?.toISOString() ?? null,
    tx_hash: ad.txHash,
    network: ad.network,
    amount_atomic: ad.amount,
  }
}

export const PENDING_MESSAGE =
  'The payment\'s outcome is not known yet. First repeat this request with the SAME payment (one payment is never charged ' +
  'twice): if it reached the network, the ad starts as soon as it is found there; if it did not, it expires unused within ' +
  'minutes, and only once that repeat answers that it expired should you sign a new payment.'

/** Reasons that are FINAL on the row (book.ts reconcileAd writes them): the authorization can no longer move money. */
const FINAL_UNPAID = new Set<string>([UNPAID_EXPIRED, UNPAID_CANCELLED])

/** The human sentence for a refused payment: an invalid one never moved money; a refused settlement is final on the row
 *  only once its authorization expired unused or was cancelled — until then it may still land (book.ts). */
export function bookFailureMessage(r: Extract<BookResult, { kind: 'payment_invalid' | 'payment_failed' }>): string {
  if (r.kind === 'payment_invalid') return `The payment was not accepted (${r.reason}); nothing was charged. Sign a new payment for the offer in accepts[0].`
  if (FINAL_UNPAID.has(r.reason)) return `That payment expired or was cancelled without being charged (${r.reason}). Sign a new payment for the offer in accepts[0].`
  return `The payment did not go through (${r.reason}). If it still reaches the network before it expires, the ad starts then; one payment is never charged twice.`
}
