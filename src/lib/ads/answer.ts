import 'server-only'
import type { AdRow, BookResult } from './book'

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
  'The payment was sent but its confirmation has not arrived yet; the ad starts once it is found on chain. ' +
  'Repeat the same request with the same payment to get the result — you will not be charged twice.'

/** The human sentence for a failed or refused purchase (nothing was charged in any of these). */
export function bookFailureMessage(r: Extract<BookResult, { kind: 'payment_invalid' | 'payment_failed' }>): string {
  return r.kind === 'payment_invalid'
    ? `The payment was not accepted (${r.reason}); nothing was charged. Sign a new payment for the offer in accepts[0].`
    : `The payment did not go through (${r.reason}); nothing was charged.`
}
