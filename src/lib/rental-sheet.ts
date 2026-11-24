import { rentalCheckApplies } from '@/lib/rental-check/shared'

/**
 * ⛔ THE RENTAL SHEET — A HOME TO RENT, ON A PHONE (owner-approved 2026-11-14, cook r05 "rental-c": "after this cook round
 * build all best options and deploy"; reworked owner-approved 2026-11-15 (build 7), cook r07 "rental": "build 7"). The
 * photo fills its square and a white sheet rides over its bottom edge; on it the title (`text-t-h2` 22/28) over the PRICE,
 * the page's one display element (`text-t-figure` 32/40), a quiet line under it and the listing's key facts as a row of
 * figures; the HOST ROW; then Costs, Location, Details, Description and Amenities, each opening the same way (a hairline,
 * 32, the heading, 16, the content); the quiet safety well; the shelves. Where the page's action is Chat now alone it is ONE
 * pinned bottom tier from the first paint — the price beside Chat now, its note under both — with the tab bar retracted
 * until the first scroll up, as the goods page does (pinsRentalAction).
 * (Build 7 reverses here, owner-approved 2026-11-15 (build 7): the 26/32 title as "the page's one display element" and the 22
 * price; the raised host card and "Costs opens on its edge"; table rows 12px apart; the order "Costs, Details, Amenities and
 * Location"; the three-to-a-row amenity glyphs; the 240px map with "Open map" top-right.)
 *
 * ⚠️ BELOW md ONLY. Every class here is `max-md:`, sits on an element that is display:none from md (the phone host slot, the
 * phone gallery mount, the head's phone facts), or is an `md:` class that puts back exactly what the page paints there today
 * (the H1's and the price's md sizes, `md:order-first`, `md:-order-1`, the map's `md:order-11`). From md the page paints as
 * before; only the DOM order of the head, of Details and of Location moved (the notes at their call sites).
 *
 * ⚠️ DECIDED ON THE SERVER FROM THE LISTING ALONE (isRentalSheet, pinsRentalAction), so the server HTML and the first client
 * render agree. A PLAIN MODULE (no 'use client'): page.tsx, rental-facts.tsx (a server component) and the client components
 * import the same strings, and the tests read these constants rather than regexes over page.tsx.
 */

/**
 * Every rentals listing that is a PLACE — apartment, house, room, office, homestay, hotel or short stay, and a row with no
 * mapped type — the availability check's own gate (rentalCheckApplies: the rentals category minus vehicle hire), never a job
 * (a job filed in rentals), and only with a gallery (the sheet rides over the photo).
 */
export function isRentalSheet({ noGallery, categorySlug, subcategorySlug, listingType }: {
  noGallery: boolean
  categorySlug: string | null | undefined
  subcategorySlug: string | null | undefined
  listingType: string | null | undefined
}): boolean {
  return !noGallery && listingType !== 'job' && rentalCheckApplies(categorySlug, subcategorySlug)
}

/**
 * ⛔ THE RENTAL SHEET'S ACTION, PINNED FROM THE FIRST PAINT (owner-approved 2026-11-15 (build 7), cook r07 "rental"; it extends
 * to these pages the goods sheet's one bottom tier — src/lib/goods-sheet.ts pinsAction, globals.css the bottom-tier block —
 * and with it reverses here the tab-nav-stays-on-the-PDP rulings, as that block records). Only where `#contact` is Chat now
 * and its one line, so the tier can hold the price beside it: a seller's own listing (never a partner link: its source line
 * is a second control) with no offer panel (a fixed or unpriced price), no availability check (RentalCheckToggle: a second
 * control and its line), not an e-visa page, not iOS-hidden, not the trip desk. Every other rental keeps the in-flow block
 * and the mirror bar (pdp-action-bar.tsx). Pure and tested (rental-sheet.test.ts).
 */
export function pinsRentalAction(p: {
  rentalSheet: boolean
  affiliate: boolean
  price: number
  negotiable: boolean
  visa: boolean
  iosHide: boolean
  tripDesk: boolean
  rentalCheck: boolean
}): boolean {
  if (!p.rentalSheet || p.affiliate || p.visa || p.iosHide || p.tripDesk || p.rentalCheck) return false
  return !(p.price > 0 && p.negotiable)
}

/** Batch 79's phone section line: one hairline over a section and 24px to its heading (every listing page but the sheet). */
export const SECTION_LINE = 'max-md:border-t max-md:border-border max-md:pt-6'
/** The sheet's: the same hairline and 32px to the heading — Costs included since build 7 (it no longer opens on a card). */
export const SHEET_SECTION_LINE = 'max-md:border-t max-md:border-border max-md:pt-8'
export const sectionLine = (sheet: boolean) => (sheet ? SHEET_SECTION_LINE : SECTION_LINE)
/** Heading to content on the sheet: 16px (today's sections: 8 or 12). */
export const SHEET_HEAD_GAP = 'max-md:space-y-4'
/** The page's grid on the sheet: 32px block to block (today's: 24). */
export const SHEET_GRID_GAP = 'max-md:gap-8'

/**
 * The photo's slot on the sheet: it gives back 24px of the 32px gap, and its bottom 16px is the sheet's rounded white edge
 * (16px radius, a soft lift) — so the title starts 24px under that edge. Above the slides (z 6), under the photo counter
 * (z-10) and the controls; no pointer events. ⛔ The photo itself stays square-cornered (owner 2026-07-24, kept): only the
 * sheet over it is rounded.
 */
// ⛔ NO ROUNDED LIP (owner, 2026-11-24, hub round 16 Q29 "yes"): the photo meets the page on a straight line, as YouTube's
// player meets its page; the 16px white band with rounded top corners (`after:`) is gone, and with it the 24px overlap
// it existed to cover (commit gate, opus: kept alone, the photo painted over the sheet's top and the price lost its gap).
export const SHEET_PHOTO = ""

/** The H1 on every other listing page (P-HIER, owner 2026-09-30: 18px/700, 24 from sm). */
export const PAGE_TITLE = 'text-xl font-bold leading-snug sm:text-2xl sm:leading-tight text-foreground [overflow-wrap:anywhere]'
/**
 * The sheet's H1 below md: the section role (`text-t-h2`, 22/28 700 −0.02em, owner-approved 2026-11-15 (build 7) — the price
 * is the display element now), on a 312px measure (`max-w-78`) with pretty wrapping, so a place title breaks between its
 * names ("Studio · Nha Be Commune, / Nha Be District"). From md exactly PAGE_TITLE's md paint (24px, leading-tight, no
 * tracking, the column's width).
 */
export const SHEET_TITLE = 'text-t-h2 font-bold text-foreground max-md:max-w-78 max-md:text-pretty [overflow-wrap:anywhere] md:text-2xl md:leading-tight md:tracking-normal'
/** The price row's wrapper on the sheet: 16px under the title below md, first again from md. */
export const SHEET_PRICE_ROW = 'max-md:mt-2 md:order-first'
/** The head price on the sheet: the page's ONE display element below md (`text-t-figure` 32/40 −0.03em 700, the goods sheet's
 *  figure — owner-approved 2026-11-15 (build 7)); today's 30px from md. */
export const SHEET_PRICE = 'text-t-figure md:text-3xl md:tracking-tight'
export const SHEET_PRICE_APPROX = 'text-base max-md:ml-2 max-md:font-normal'
/** "/ month" beside the head price: body size and ink, regular (it stays in its own nowrap run). */
export const SHEET_PRICE_UNIT = 'max-md:text-base max-md:font-normal max-md:text-body'

/**
 * ⛔ THE HEAD'S FACTS BELOW md (owner-approved 2026-11-15 (build 7), cook r07 "rental"; it reverses there batch 89's one facts
 * line): the SAME facts, split three ways — never one more, never one less (page.tsx `sheetStats` / `sheetQuiet`):
 *   · SHEET_FACTS — one quiet line, 4px under the price (14/20 muted): "Fixed price · Posted 15d ago" and every fact the
 *     two below do not take. It wraps, it is never cut (batch 89's ⛔ holds: no nowrap, no truncate).
 *   · SHEET_STATS — the decision facts that read as a number, as a row of figures between hairlines (2 or 3 cells, a hairline
 *     between them): the bedroom count, a numbered floor, a deposit in whole months. Only when at least two are known; else
 *     they stay in the quiet line. Each figure is 20/26 700 ink over its label (the meta role, muted); a screen reader hears
 *     the facts line's own words ("1 bedroom", "Floor 2", "Deposit 1 month"), the figure and label being their picture.
 *   · the place goes to the Location line over the map (SHEET_PLACE) — where there is a map.
 * The md+ facts line is the same line as before, hidden below md on the sheet; these are display:none from md.
 */
export const SHEET_FACTS = 'md:hidden -mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]'
export const SHEET_STATS = 'md:hidden mt-3 grid border-y border-border py-4'
export const SHEET_STAT = 'flex min-w-0 flex-col items-center gap-0.5 border-l border-border px-2 text-center first:border-l-0'
export const SHEET_STAT_VALUE = 'max-w-full text-xl leading-6.5 font-bold tracking-[-0.015em] text-foreground tabular-nums [overflow-wrap:anywhere]'
export const SHEET_STAT_LABEL = 'max-w-full text-t-meta text-muted-foreground'
/** The stat row's columns, by how many facts it holds (2 or 3). */
export const sheetStatCols = (n: number) => (n >= 3 ? 'grid-cols-3' : 'grid-cols-2')
/** The place under the Location heading, over the map: body 16/24, 12 under the heading (the section's 16 less 4) and 8 over
 *  the map (it names the picture under it). Display:none from md, where the facts line keeps the place. */
export const SHEET_PLACE = 'md:hidden max-md:-mt-1 max-md:mb-2 text-base text-body'

/** Chat now 16px under the head (the grid's 32 less 16) — the in-flow block only; a pinned tier is out of the flow. */
export const SHEET_CONTACT = 'max-md:-mt-4'

/**
 * The pinned tier's price, beside Chat now below md (owner-approved 2026-11-15 (build 7); ContactComposer `barPrice`): the head
 * price's full figure in the price role (17/22 700 ink), its unit regular in body ink at 16, and "≈ $" on the line under it in
 * the meta role. Every digit, as the head prints it (`rateCompactAbove` is the mirror bar's, not this). Display:none from md.
 */
export const SHEET_TIER_PRICE = 'text-t-price'
export const SHEET_TIER_UNIT = 'text-base font-normal text-body'
export const SHEET_TIER_APPROX = 'ml-0 block text-t-meta font-normal'

/** The mirror bar's price on a rental that does NOT pin its action (PdpActionBar `titleCaption="md"` hides the title under it
 *  below md): the figure on one line, its unit regular in body ink, and "≈ $" on the line under it in the meta role. From md:
 *  `text-lg leading-6` and the inline ≈ as before (`dual` true and 'sm' print the same from 640). */
export const SHEET_BAR_PRICE = 'text-lg leading-6 max-md:block'
export const SHEET_BAR_UNIT = 'max-md:font-normal max-md:text-body'
export const SHEET_BAR_APPROX = 'max-md:ml-0 max-md:block max-md:font-normal max-md:text-t-meta'

/** The phone "Hosted by" band (batch 79): one hairline over the row and 16px to it. */
export const HOST_BAND = 'order-7 md:hidden max-md:border-t max-md:border-border max-md:pt-4'
/** The sheet's host slot: no line — the host row (PdpShopLink `variant="card"`, a flat row since build 7) stands 32px under the
 *  head's stat row, whose hairline closes the head; Costs opens on its own hairline under it. */
export const HOST_CARD_SLOT = 'order-7 md:hidden'

/**
 * A table's rows on the sheet (Costs, Details, Seller information): no rules (the section's hairline is the only line), each
 * row 44px at the least with its label and value centred on it (owner-approved 2026-11-15 (build 7); 12px apart before), 16/24,
 * the label in body ink, the value in ink at 400 (a figure and its muted unit read as one value). Flex, so a row hidden below
 * md takes no room; a value that wraps grows its row.
 */
export const SHEET_ROWS = 'max-md:flex max-md:flex-col max-md:divide-y-0 max-md:text-base max-md:[&>div]:min-h-11 max-md:[&>div]:items-center max-md:[&>div]:py-0 max-md:[&_dt]:text-body max-md:[&_dd]:font-normal'

// (SHEET_MAP_BOX, the rental sheet's own 384px map card, was removed 2026-11-24: owner, "make it consistent all across the
// app our style" — the rental page draws the same map as every other listing.)

/**
 * Amenities on the sheet: two columns of a glyph beside its name (RentalAmenities `sheet`). A name longer than this many
 * characters, in either language, takes the whole row: at 390 a column leaves 139px for the name at 16px, which holds about
 * 16 characters ("Air conditioning"); "Shared washing machine" or "No live-in landlord" would wrap in a column.
 * Decided on the server from the words themselves (both languages, so the grid is the same whichever one paints) — never
 * measured in the browser. A name that still does not fit (a machine-translated language, a 320px phone) wraps; it is never
 * cut. In the taxonomy's order: a short name before a long one keeps its row, with the second column left empty.
 */
export const SHEET_AMENITY_CHARS = 16
export const amenityTakesRow = (a: { label: string; labelVi: string }) => Math.max(a.label.length, a.labelVi.length) > SHEET_AMENITY_CHARS

/** Batch 70's phone safety well (every other listing page). */
export const PAGE_WELL = 'max-md:rounded-2xl max-md:border-t-0 max-md:bg-tint max-md:px-3.5 max-md:pb-2.5 max-md:pt-3.5'
/** The sheet's: the panel recipe — field grey, 12 radius, 16 padding (4 under the actions row, whose 44px carries it). */
export const SHEET_WELL = 'max-md:rounded-xl max-md:border-t-0 max-md:bg-tint max-md:p-4 max-md:pb-1'
/** Report and Block on the sheet's well: quiet labels in body ink, 700 14, 16px glyphs, 44px tall. ⛔ Report is NOT red here
 *  (owner-approved 2026-11-14, cook r05); everywhere else it keeps its red (owner 2026-07-08). */
export const SHEET_REPORT = 'max-md:min-h-11 max-md:gap-1 max-md:px-2 max-md:text-sm max-md:font-bold max-md:text-body max-md:[&_svg]:size-4 lg:text-sm'
export const SHEET_BLOCK = `${SHEET_REPORT} max-md:pr-0`
