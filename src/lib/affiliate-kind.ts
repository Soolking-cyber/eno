/**
 * Booking vs purchase for an affiliate listing.
 *
 * ⛔ ITS OWN FILE, AND NOT IN affiliate-qr.ts, BECAUSE THAT MODULE IS `server-only`. This predicate
 * is needed by listing-card.tsx, which is a Client Component — importing it from there failed the
 * production build with "'server-only' cannot be imported from a Client Component module". The
 * function is pure and depends on nothing, so a pure module is where it belongs; the same split
 * this repo already uses for image-hash-url.ts beside image-hash.ts.
 */
/**
 * Is this affiliate listing a BOOKING (a ticket, a date, a reservation) or a PURCHASE (a boxed
 * thing you buy)? The two need different words and a different price.
 *
 * ⛔ A TICKET'S PRICE IS A FLOOR; A PHONE'S PRICE IS THE PRICE. VinWonders quotes the lowest adult
 * ticket and the real amount is set at the partner's checkout by date, which is why those pages say
 * "from". CellphoneS quotes what the phone costs today — prefixing THAT with "from" would state
 * something untrue about a fixed retail price. Same reason the CTA differs: you book a park, you
 * buy a laptop (owner, 2026-08-24: "no need from price only price and action button is buy on").
 *
 * ⚠️ CATEGORY-DERIVED ON PURPOSE, so it needs no column and no backfill: an affiliate listing in
 * tickets-travel is a booking, anything else is a purchase.
 */
export function isBookingCategory(categorySlug: string | null | undefined): boolean {
  return categorySlug === 'tickets-travel'
}
