// Relative specifier, matching support-thread.ts: this file is imported by edition-scope.ts and
// messages.ts, and it must stay IMPORT-FREE apart from the edition flag so neither of those can
// pick up a cycle through it.
import { IS_SERVICES } from '../edition'

/**
 * THE RENTAL DESK — the counterpart of every availability-check thread.
 *
 * ⛔ ONE ROW PER EDITION, FOR THE SAME REASON THE SUPPORT DESK HAS TWO (src/lib/support-thread.ts).
 * eno.vn and eno.forum share ONE database, and the partial unique index `Conversation_support_thread_key`
 * is keyed `(buyerProfileId, sellerId) WHERE listingId IS NULL` — so a desk per edition gives each
 * requester one thread PER EDITION, and a thread begun on eno.forum can never surface in the licensed
 * marketplace's inbox (edition-scope.ts hides the forum desk on eno.vn).
 *
 * ⛔ WHY NOT THE "Eno" STOREFRONT (owned by support@eno.forum), which is who answers these:
 *   · Eno is in HIDDEN_DESK_OWNER_EMAILS, so eno.vn's inbox, unread badge and thread-open all hide
 *     it — a requester on eno.vn could never see their own thread without punching a hole in the
 *     licensing hide-list for the visa/trip desk seller.
 *   · POST /api/conversations looks up the buyer's existing threads with a listing's SELLER and
 *     retargets one onto the new listing. It only considers threads that already HAVE a listing
 *     (`listingId: { not: null }`), and every conversation it creates has one — listing-less threads
 *     are made only by support-thread.ts, for the desks — but keeping Eno out of this at all means
 *     no future edit to that lookup can pull a rental thread under a listing. A desk with no
 *     listings can never be a `listing.sellerId`.
 *   · `Seller.ownerId` is @unique, so Eno cannot be split per edition.
 * support@eno.forum still gets every request in its OWN inbox: it is the thread's `sellerProfileId`
 * (see desk.ts), which is what the inbox, the unread badge and the send route key on.
 *
 * ⚠️ UNOWNED, like the support desks: `ownerId` stays NULL, so the row never counts as a storefront
 * and never appears in browse — it has no listings.
 */
export const RENTAL_DESK_SELLER_IDS = ['eno-rental-desk', 'eno-rental-desk-forum'] as const

/** This build's desk. */
export const RENTAL_DESK_SELLER_ID: (typeof RENTAL_DESK_SELLER_IDS)[number] = IS_SERVICES ? 'eno-rental-desk-forum' : 'eno-rental-desk'

/** The OTHER edition's desk — what eno.vn hides (see edition-scope.ts). */
export const FOREIGN_RENTAL_DESK_SELLER_ID: (typeof RENTAL_DESK_SELLER_IDS)[number] = IS_SERVICES ? 'eno-rental-desk' : 'eno-rental-desk-forum'
