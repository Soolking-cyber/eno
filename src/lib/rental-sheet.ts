import { rentalCheckApplies } from '@/lib/rental-check/shared'

/**
 * ⛔ THE RENTAL SHEET — A HOME TO RENT, ON A PHONE (owner-approved 2026-11-14, cook r05 "rental-c": "after this cook round
 * build all best options and deploy"). An editorial page with a host card: the photo fills its square, a white sheet rides
 * over its bottom edge, and on it the TITLE (the page's one display element, `text-t-title` 26/32) over the facts line and
 * the price (22, one line); Chat now and its note; the HOST CARD; then Costs, Details, Amenities and Location, each opening
 * the same way (a hairline, 32, the heading, 16, the content); the quiet safety well; the shelves.
 *
 * ⚠️ BELOW md ONLY. Every class here is `max-md:`, sits on an element that is display:none from md (the phone host-card
 * slot, the phone gallery mount), or is an `md:` class that puts back exactly what the page paints there today (the H1's
 * and the price's md sizes, `md:order-first`, `md:-order-1`). From md the page paints as before; only the DOM order of the
 * head and of Details moved (nothing focusable crosses — the notes at their call sites).
 *
 * ⚠️ DECIDED ON THE SERVER FROM THE LISTING ALONE (isRentalSheet), so the server HTML and the first client render agree.
 * A PLAIN MODULE (no 'use client'): page.tsx, rental-facts.tsx (a server component) and the client components import the
 * same strings, and the tests read these constants rather than regexes over page.tsx.
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

/** Batch 79's phone section line: one hairline over a section and 24px to its heading (every listing page but the sheet). */
export const SECTION_LINE = 'max-md:border-t max-md:border-border max-md:pt-6'
/** The sheet's: the same hairline and 32px to the heading. */
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
export const SHEET_PHOTO = "-mb-6 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-[6] after:h-4 after:rounded-t-2xl after:bg-background after:shadow-sheet after:content-['']"

/** The H1 on every other listing page (P-HIER, owner 2026-09-30: 18px/700, 24 from sm). */
export const PAGE_TITLE = 'text-xl font-bold leading-snug sm:text-2xl sm:leading-tight text-foreground [overflow-wrap:anywhere]'
/** The sheet's H1: the display role below md; from md exactly PAGE_TITLE's md paint (24px, leading-tight, no tracking). */
export const SHEET_TITLE = 'text-t-title font-bold text-foreground max-md:text-pretty [overflow-wrap:anywhere] md:text-2xl md:leading-tight md:tracking-normal'
/** The price row's wrapper on the sheet: after the facts line below md (16px under it), first again from md. */
export const SHEET_PRICE_ROW = 'max-md:mt-2 md:order-first'
/** The head price on the sheet: the h2 role (22/28) below md, today's 30px from md. */
export const SHEET_PRICE = 'text-t-h2 md:text-3xl md:tracking-tight'
export const SHEET_PRICE_APPROX = 'text-base max-md:ml-2 max-md:font-normal'
/** "/ month" beside the head price: body size and ink, regular (it stays in its own nowrap run). */
export const SHEET_PRICE_UNIT = 'max-md:text-base max-md:font-normal max-md:text-body'
/** Chat now sits 16px under the price (the grid's 32 less 16). */
export const SHEET_CONTACT = 'max-md:-mt-4'

/** The pinned bar's price on the sheet (PdpActionBar `titleCaption="md"` hides the title under it below md): the figure on one
 *  line, its unit regular in body ink, and "≈ $" on the line under it in the meta role. From md: `text-lg leading-6` and the
 *  inline ≈ as before (`dual` true and 'sm' print the same from 640). */
export const SHEET_BAR_PRICE = 'text-lg leading-6 max-md:block'
export const SHEET_BAR_UNIT = 'max-md:font-normal max-md:text-body'
export const SHEET_BAR_APPROX = 'max-md:ml-0 max-md:block max-md:font-normal max-md:text-t-meta'

/** The phone "Hosted by" band (batch 79): one hairline over the row and 16px to it. */
export const HOST_BAND = 'order-7 md:hidden max-md:border-t max-md:border-border max-md:pt-4'
/** The sheet's host card slot: no line — the card is the object, and Costs opens on its edge. */
export const HOST_CARD_SLOT = 'order-7 md:hidden'

/**
 * A table's rows on the sheet (Costs, Details, Seller information): no rules (the section's hairline is the only line), 12px
 * apart, 16/24, the label in body ink, the value in ink at 400 (a figure and its muted unit read as one value). Flex, so a
 * row hidden below md takes no gap.
 */
export const SHEET_ROWS = 'max-md:flex max-md:flex-col max-md:gap-3 max-md:divide-y-0 max-md:text-base max-md:[&>div]:py-0 max-md:[&_dt]:text-body max-md:[&_dd]:font-normal'

/** The map's box on the sheet: 240px, the panel radius (12). */
export const SHEET_MAP_BOX = 'max-md:h-60 max-md:rounded-xl'

/** Batch 70's phone safety well (every other listing page). */
export const PAGE_WELL = 'max-md:rounded-2xl max-md:border-t-0 max-md:bg-tint max-md:px-3.5 max-md:pb-2.5 max-md:pt-3.5'
/** The sheet's: the panel recipe — field grey, 12 radius, 16 padding (4 under the actions row, whose 44px carries it). */
export const SHEET_WELL = 'max-md:rounded-xl max-md:border-t-0 max-md:bg-tint max-md:p-4 max-md:pb-1'
/** Report and Block on the sheet's well: quiet labels in body ink, 700 14, 16px glyphs, 44px tall. ⛔ Report is NOT red here
 *  (owner-approved 2026-11-14, cook r05); everywhere else it keeps its red (owner 2026-07-08). */
export const SHEET_REPORT = 'max-md:min-h-11 max-md:gap-1 max-md:px-2 max-md:text-sm max-md:font-bold max-md:text-body max-md:[&_svg]:size-4 lg:text-sm'
export const SHEET_BLOCK = `${SHEET_REPORT} max-md:pr-0`
