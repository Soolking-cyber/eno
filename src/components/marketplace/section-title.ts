/**
 * THE SECTION HEADING — every home shelf, the home feed heading, category-rails, and since 2026-11-09 the listing page's own
 * sections (Description, Details, Location, a rental's Costs and Amenities, Buyer reviews).
 *
 * ⚠️ ALWAYS ONE STEP ABOVE THE CARD PRICE (D-TYPE, owner 2026-09-30): the card's <Price> is text-base → sm:text-lg, so a
 * text-lg title TIED it from sm up and the shelf read as a list of prices with a caption. text-xl → sm:text-2xl (2026-11-05)
 * keeps 20>16 and 24>18. No skeleton draws this heading (measured layout shift 0 on home and /c/*). Raise the price, raise this.
 * ⚠️ ONE SIZE ON THE LISTING PAGE TOO (UI climb 2026-11-09, closing docs/design-language.md's open follow-up): its sections
 * hand-typed text-lg → sm:text-xl, so from sm up they sat a step below "More like this" / "More from this seller" on the same
 * page, and Amenities never took the sm step at all.
 *
 * ⛔ A PLAIN MODULE, NOT 'use client' (listing-grid.ts has the same note). The listing page and rental-facts.tsx are server
 * components; from shelf.tsx ('use client') they would receive a client REFERENCE in place of this string and render
 * `class="[object Object]"`. shelf.tsx re-exports it for its client consumers.
 */
export const SECTION_TITLE = 'text-xl font-semibold text-foreground sm:text-2xl'
