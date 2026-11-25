/** The two final "never charged" reasons on a ListingAd row: book.ts reconcileAd writes them, answer.ts tells the buyer. */
export const UNPAID_EXPIRED = 'authorization_expired_unpaid'
export const UNPAID_CANCELLED = 'authorization_cancelled'
/** A creative ad paid for after eno removed its creative (book.ts activate): never shown; the row goes to `review` for a
 *  manual pro-rata refund, as the advertising policy says. */
export const CREATIVE_REMOVED_PAID = 'creative_removed_after_payment'
