/**
 * ⛔ THE GOODS SHEET — A GOODS OR VEHICLE LISTING, ON A PHONE (owner-approved 2026-11-14, cook r06 "item": "after this cook
 * round build all best options and deploy"; target stills cook/compare/r06/item__pdp_product.jpg and item__pdp_bike.jpg).
 * Every listing page that is not a home to rent (the rental sheet, src/lib/rental-sheet.ts), a job or a teacher: goods,
 * vehicles and vehicle hire, services, tickets. Wallapop's listing page in eno's own system: the photo whole, with a 16px
 * sheet edge over it; the PRICE as the page's one display element (`text-t-figure`, 32/40) over the title (17px) and a 14px
 * facts line; the page's own action pinned as ONE bottom tier with the tab bar retracted (pinsAction); Details as label/value
 * rows right under the head; the seller as one compact band; the listing's sections under 17px headings with no rules between
 * them, 32px apart; Seller information and the safety advice as one counsel section; the shelves as two-column grids at the
 * feed's card size.
 *
 * ⛔ BUILD 7 (owner-approved 2026-11-15 (build 7), cook r07 "item": "simplicity first"; target stills
 * cook/compare/r07/item__pdp_product.jpg and item__pdp_bike.jpg). It reverses, on these pages, five r06 rulings:
 *   · the PHOTO's plain white ground → the field grey (`bg-tint`, #f3f3f3) with the photo multiplied onto it in light mode, so a
 *     white packshot sits on the field and the white sheet edge shows (ListingGallery `plain`); the frame's ratio and size
 *     are unchanged. (The mock's zoom-to-the-object is not built: the note at ListingGallery `plain`.)
 *   · "the box is the button and its one line" → the pinned tier is THE BUTTON ALONE; its line is said once in the page: in
 *     Seller information in place of its "Source" row (a linked shop), or as the seller band's last line (page.tsx `tierLine`).
 *   · "Seller information and the safety advice as ONE quiet tint panel on the media edge" → no box: ordinary sections on the
 *     12px text edge (COUNSEL_* below; SafetyStrip `flow`), "Reports & disputes" an accent link like the guide.
 *   · "a seller with exactly two other items closes the page" → the seller's own row comes before "More like this" again.
 *   · Details' 16px rows → 10px (44 tall); the shelves' cards on the field tile with no ring and "Ad" as a plain label
 *     (ListingCard `look="tile"`); a short table in the description (the bike's price by rental length) as a 2-column grid
 *     of label over value (listing-content.tsx GOODS_TABLE_GRID).
 *
 * ⚠️ BELOW md ONLY. Every class here is `max-md:` (or `max-sm:` on the shelves, which are rails from sm), sits on an element
 * that is display:none from md, or is an `md:` class that puts back exactly what the page paints there today.
 *
 * ⚠️ DECIDED ON THE SERVER FROM THE LISTING ALONE, so the server HTML and the first client render agree. A PLAIN MODULE (no
 * 'use client'): page.tsx (a server component) and the client components import the same strings.
 */

/**
 * The goods sheet's pages: a listing with a gallery that is not a job (page.tsx `factsLine`, the same test batch 95 keys the
 * job page on) and not a home to rent (`rentalSheet`). A teacher's profile never reaches it (page.tsx returns early).
 */
export function isGoodsSheet({ noGallery, rentalSheet, factsLine }: { noGallery: boolean; rentalSheet: boolean; factsLine: boolean }): boolean {
  return !noGallery && !rentalSheet && factsLine
}

/**
 * ⛔ PINNED ONLY WHEN THE ACTION IS ONE CONTROL AND ONE LINE. The tier holds the page's whole `#contact` block, so a block
 * that is anything more stays in flow with today's mirror bar (pdp-action-bar.tsx). ⛔ Since build 7 the tier DRAWS only the
 * control below md (owner-approved 2026-11-15 (build 7), cook r07 "item"; it reverses r06's "the button and its one line"
 * there): the one line is still what qualifies the block, and the page says it once, in place (page.tsx `tierLine`).
 *   · (a) a partner LINK that is a purchase or a rental (not a booking: its "Lowest adult ticket" line; not a job), with no
 *     commission (its disclosure must stay under the button — owner 2026-10-01), no discount code (a panel) and no product
 *     step (AffiliateProductStep, a second control); or
 *   · (b) Chat now on a fixed-price or unpriced listing (ContactComposer without the offer panel), when the page is not an
 *     e-visa product or slot (its action follows its disclaimer, `data-no-pin`), not iOS-hidden, not the trip desk, and has
 *     no availability check (RentalCheckToggle).
 * Pure and tested (goods-sheet.test.ts); the one predicate to switch off to unpin every GOODS page. ⛔ It still answers
 * false on a home to rent (not the goods sheet): since owner-approved 2026-11-15 (build 7), cook r07 "rental", the rental sheet
 * pins too — its own predicate, src/lib/rental-sheet.ts pinsRentalAction (Chat now alone, the price beside it), ORed with this
 * one in page.tsx — so this no longer means "no rental is ever pinned".
 */
export function pinsAction(p: {
  goodsSheet: boolean
  affiliate: boolean
  job: boolean
  booking: boolean
  commission: boolean
  discountCode: boolean
  productStep: boolean
  price: number
  negotiable: boolean
  visa: boolean
  iosHide: boolean
  tripDesk: boolean
  rentalCheck: boolean
}): boolean {
  if (!p.goodsSheet || p.job || p.visa || p.iosHide || p.rentalCheck) return false
  if (p.affiliate) return !p.booking && !p.commission && !p.discountCode && !p.productStep
  const canOffer = p.price > 0 && p.negotiable
  return !canOffer && !p.tripDesk
}

/**
 * The pinned `#contact` (PinnedRegion): below md, outside the store apps, ONE fixed tier at the screen's bottom edge — white,
 * a top hairline and the bars' lift, 8px over the action and 8px plus the home indicator under its note. It rides above the
 * tab bar while the bar shows (globals.css, the goods tier block), by `translate` only. From md: the in-flow block as before.
 */
export const PIN_TIER = '[html:not(.native)_&]:max-md:fixed [html:not(.native)_&]:max-md:inset-x-0 [html:not(.native)_&]:max-md:bottom-0 [html:not(.native)_&]:max-md:z-30 [html:not(.native)_&]:max-md:border-t [html:not(.native)_&]:max-md:border-border [html:not(.native)_&]:max-md:bg-background [html:not(.native)_&]:max-md:shadow-(--shadow-bar) [html:not(.native)_&]:max-md:px-3 [html:not(.native)_&]:max-md:pt-2 [html:not(.native)_&]:max-md:pb-[calc(0.5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] max-md:transition-[translate] max-md:duration-[250ms] max-md:ease-out motion-reduce:transition-none'

/** The photo's slot: a 16px white sheet edge over the photo's bottom (the rental sheet's, src/lib/rental-sheet.ts SHEET_PHOTO,
 *  minus its lift), and 24px given back so the price stands 16px under that edge. */
// ⛔ NO ROUNDED LIP (owner, 2026-11-24, hub round 16 Q29 "yes"): the photo meets the page on a straight line, as YouTube's
// player meets its page; the 16px white band with rounded top corners (`after:`) is gone, and with it the 24px overlap
// it existed to cover (commit gate, opus: kept alone, the photo painted over the sheet's top and the price lost its gap).
export const GOODS_PHOTO = ""
/** Share and Save over the photo: 12px apart (8 elsewhere). */
export const GOODS_PLATES_GAP = 'max-md:gap-3'

/** The head block (price, title, facts, the translation note): 4px between lines below md (8 elsewhere). */
export const GOODS_HEAD = 'max-md:gap-1'
/** The price row: the figure, then its unit and "≈ $" at body size. */
export const GOODS_PRICE_ROW = 'max-md:gap-1'
/** The page's one display element below md (32/40, −0.03em, 700); today's 30px from md. */
export const GOODS_PRICE = 'text-t-figure md:text-3xl md:tracking-tight'
/** The H1 below md: the sub-section role (17/24, 700); from md exactly PAGE_TITLE's md paint (24px, leading-tight). */
export const GOODS_TITLE = 'text-t-h3 font-bold text-foreground [overflow-wrap:anywhere] max-md:text-pretty md:text-2xl md:leading-tight'
/** The facts line below md: 14px (16 elsewhere). */
export const GOODS_FACTS = 'max-md:text-sm'
/** One fact and its dot: one box below md, so a line breaks BETWEEN facts, never inside a short one ("Ho Chi / Minh"). An
 *  atomic inline wider than the line still wraps inside itself (the line's `[overflow-wrap:anywhere]`): nothing overflows,
 *  nothing is cut (batch 89's ⛔ against truncation and nowrap holds). */
export const GOODS_FACT = 'max-md:inline-block'

/**
 * Details below md, under the head (the phone twin, in the seller band's slot): label left in muted, value right in ink and
 * bold, 16/24, a hairline over the table and between its rows. Its heading is screen-reader only (the rows name themselves).
 * The left-column Details is `max-md:hidden` on the goods sheet, so one table is ever displayed.
 * ⛔ 10px ROWS, 44 TALL (owner-approved 2026-11-15 (build 7), cook r07 "item"; it reverses r06's 16px rows, 56 tall): the tap
 * floor's height, the head's facts one compact table.
 */
export const GOODS_DETAILS_TWIN = 'md:hidden'
export const GOODS_DETAILS_ROWS = 'divide-y divide-border border-y border-border text-base [&>div]:py-2.5 [&_dd]:font-bold'

/** The seller band's slot: one hairline over the row and 16px to it (batch 79's band); with Details over it, Details' own
 *  bottom hairline is that line. */
export const GOODS_BAND = 'order-7 md:hidden'

/** A section below md: no hairline, 32px from the one before (the column's 24 + 8). */
export const GOODS_SECTION = 'max-md:mt-2'
/** A section's heading: the sub-section role below md (17/24, 700); SECTION_TITLE's own paint from md. */
export const GOODS_SECTION_TITLE = 'text-t-h3 text-foreground md:text-2xl md:font-semibold'
/** Description (inside the slot-8 wrapper, which carries the 32px): the heading and "Translated · See original" share one line
 *  below md; the text and See more take full rows (ListingDescription `goods`). */
export const GOODS_DESC_SECTION = 'max-md:flex max-md:flex-wrap max-md:items-baseline max-md:justify-between max-md:gap-x-3 max-md:gap-y-3 max-md:space-y-0'

/** Map: on the media edge (4px from the screen, as the cards under it) with the photos' radius. */
export const GOODS_MAP_BOX = 'max-md:-mx-2 max-md:rounded-media'

/**
 * THE COUNSEL: Seller information, then the safety advice, every word of both, Report and Block as quiet muted labels (they
 * reverse there "Report kept red", batch 70; owner-approved 2026-11-14, cook r06 "item").
 * ⛔ WITHOUT THE BOX (owner-approved 2026-11-15 (build 7), cook r07 "item"; it reverses r06's "Seller information and the safety
 * advice as ONE quiet tint panel on the media edge" and batch 70's tint well there): two ordinary sections on the 12px text
 * edge, the page's one text edge — the grey panel on the 4px media edge was the page's one misaligned surface. Seller
 * information stands 32px under the section before it (`mt-2` over the column's 24); the safety advice 16 under Seller
 * information (`-mt-2`, coupled to the column's `gap-6`, goods-sheet.test.ts) or 32 under whatever precedes it alone. The
 * strip draws no line and no padding of its own there (COUNSEL_STRIP; its internals are SafetyStrip `flow`).
 */
export const COUNSEL_INFO = 'max-md:mt-2'
export const COUNSEL_WELL_JOINED = 'max-md:-mt-2'
export const COUNSEL_WELL_ALONE = 'max-md:mt-2'
export const COUNSEL_STRIP = 'max-md:border-t-0 max-md:pt-0'
export const COUNSEL_REPORT = 'max-md:min-h-11 max-md:gap-1 max-md:px-2 max-md:text-sm max-md:font-normal max-md:text-muted-foreground max-md:[&_svg]:size-4 lg:text-sm'
export const COUNSEL_BLOCK = `${COUNSEL_REPORT} max-md:pr-0`

/** The bottom safety note below md: the meta role (13/18). */
export const GOODS_NOTE = 'max-md:text-t-meta'

/** The shelves under the listing: 32px over each below md (48 from md). */
export const GOODS_SHELF_GAP = 'mt-8 md:mt-12'
