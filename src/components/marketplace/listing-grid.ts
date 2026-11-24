/**
 * THE listing grid — the same columns and gaps as RAIL_CARD_W / RAIL_SCROLLER in shelf.tsx and the
 * home feed (memory eno-card-feed-standards): 2 / 3 / 4 columns.
 *
 * ⛔ FACEBOOK-MARKETPLACE SPACING ON A PHONE (owner, 2026-10-18: "spaced facebook marketplace style with
 * minimal wasted space around cards and a bit larger"). Below `sm` the grid BLEEDS 8px out of the page
 * frame's 12px gutter (`-mx-2` inside `px-3`), so photos sit 4px from the screen edge, 4px apart, with
 * 12px between rows (more than the 8px between a photo and its own price, so each price groups with its
 * photo): 189px cards at 390, 174 at 360, 150 at 320 (179 / 164 / 140 before). The card's text is inset
 * back onto the 12px gutter (listing-card.tsx body, `px-2 sm:px-0.5`). ⛔ A TEACHER card's text keeps that left inset and runs
 * to its photo's RIGHT edge on a phone (card-text.ts TEACHER_BODY, owner-approved 2026-11-15, build 7 — cook r07 teachers, which
 * set the text flush on both sides and moved the page onto the photos' 4px edge; the build keeps the 12px edge the blind
 * critics asked for, and gives the name the 8px). From `sm` the grid keeps the page
 * gutter (`sm:mx-0`), 8px apart and 16px between rows — 298px cards at ≥1280 (292 before).
 * ⚠️ THE BLEED ASSUMES THE `px-3` PAGE FRAME (`max-w-7xl px-3 sm:px-6 lg:px-8`), and every consumer sits
 * directly in one (checked 2026-10-18: the explorer, seller-listings, /saved + its loading skeleton, the SEO
 * landing and guide grids, school jobs). There is no page-level overflow guard, so a consumer inside a frame
 * narrower than 8px would scroll the page sideways — and any `overflow` clip at the content box (the explorer's
 * #listings section had one) cuts the outer cards' edges off; that clip now sits at the screen edge.
 * ⚠️ 2 / 3 / 4 ARE LOAD-BEARING: the first page is 12 cards (FIRST_PAGE_SIZE), the one count all three fill.
 * ⛔ EXCEPT RENTAL RESULTS ON A PHONE (owner-approved 2026-11-14, cook r06 rentals-a): /c/rentals and the rentals feed are ONE
 * column of bigger square cards below `sm` (LISTING_GRID_WIDE, below). Every other grid keeps this one, and from `sm` the two
 * are the same string.
 * ⛔ …AND THE GOODS GRIDS' ROWS ON A PHONE (owner-approved 2026-11-15 (build 8), cook r08 goods — StockX's strict grid; it reverses
 * the 12px above there): a goods card ends on its price (listing-card.tsx `look`), so its rows sit 40px apart and no figure reads
 * as the caption of the photo under it — `max-sm:gap-y-10` on this string at each goods grid (listings-explorer.tsx `goodsGrid`,
 * seller-listings.tsx `look`, shelf.tsx GOODS_PHONE_GRID). Columns, bleed and card size are this grid's, unchanged.
 *
 * ⚠️ A PLAIN MODULE, NOT 'use client'. Server components import it too (saved/loading.tsx,
 * seo-listing-rail.tsx); from a client module they would receive a client REFERENCE in place of
 * this string and render `class="[object Object]"`.
 *
 * ⚠️ ONE STRING, BECAUSE THE COPIES DRIFTED. Every grid carried its own literal, and the category,
 * storefront, saved and landing grids kept an older `gap-4` (16px on a phone) while the home feed
 * moved to `gap-2` — the same card sat 8px narrower on /c/* than on / (K-GRID-GAP, 2026-09-29).
 * listing-grid.test.ts pins RAIL_CARD_W to these columns and gaps.
 */
/* ⛔ EDGE TO EDGE ON A PHONE (owner, 2026-11-24, hub round 16 Q27 "edge to edge" + "the cards that swipe 4px corners the
   other cards edge to edge"; YouTube's grids): below `sm` the grid bleeds the WHOLE 12px gutter (`-mx-3`) with a 2px gutter,
   so photos meet the screen edge, square-cut — 194px cards at 390 (189 before, never smaller: the owner's 11-14 rule).
   `edge-grid` is the hook for globals.css, which takes the cards' corners off and puts their words back on the 12px gutter.
   …AND ON DESKTOP TOO (owner, 2026-11-24, "also desktop"): from `sm` the grid keeps the page frame but its cards sit 2px
   apart (8 before), square-cut, with their words on a 12px inset. Swipe rails (shelf.tsx RAIL_*) keep their own geometry
   (4 / 8px apart) and the 4px photo corner at every width — a rail card is no longer exactly one grid column. */
export const LISTING_GRID = '-mx-3 grid grid-cols-2 gap-x-0.5 gap-y-3 sm:mx-0 sm:grid-cols-3 sm:gap-x-0.5 sm:gap-y-4 lg:grid-cols-4 edge-grid'

/**
 * The `sizes` of a card photo in LISTING_GRID (and in a rail, whose card is one grid column) — derived from
 * the grid, so it moves with it: phone (390 − 8 edge − 4 gap) / 2 = 50vw − 6px; sm–md (px-6 frame, two 8px
 * gaps) (100vw − 64px) / 3; lg (px-8 frame, three gaps) (100vw − 88px) / 4; the page frame (--container-7xl in globals.css) is then
 * 1280px up to a 1368 screen ((1216 − 24) / 4 = 298px), follows the screen to 1448 ((100vw − 88px − 64px − 24px) / 4 =
 * 25vw − 44px) and caps at 1360px ((1296 − 24) / 4 = 318px). It replaces a `50vw / 33vw / 25vw` guess that told a 430px DPR3 phone its card
 * was 215px, so it fetched the 1080w file for a 209px tile (645 > 640). The widths themselves come from
 * next.config.ts (deviceSizes [360,420,640,1080] + imageSizes); at 390 a DPR2 phone now asks for 378px → the
 * 420w rung, a DPR3 one 567px → 640w.
 */
export const LISTING_CARD_SIZES = '(min-width: 1448px) 322.5px, (min-width: 1368px) calc(25vw - 39.5px), (min-width: 1280px) 302.5px, (min-width: 1024px) calc(25vw - 17.5px), (min-width: 640px) calc(33.33vw - 17.33px), calc(50vw - 1px)'

/**
 * ⛔ RENTAL RESULTS ARE ONE COLUMN OF LARGE SQUARE CARDS ON A PHONE (owner-approved 2026-11-14, cook r06 rentals-a: "after this
 * cook round build all best options and deploy") — /c/rentals (SellerListings `phoneWide`) and the rentals feed
 * (/?category=rentals, listings-explorer.tsx `rentalsWide`). It reverses, for those two surfaces and below `sm` only, the
 * "FACEBOOK-MARKETPLACE SPACING ON A PHONE … 2 / 3 / 4 ARE LOAD-BEARING" note above: a rental is chosen by its photo, so the
 * phone shows one home at a time, Airbnb's results shape. The card keeps its SQUARE photo and gets BIGGER, never smaller
 * (owner, 2026-11-14: "dont change the product card ratio also dont make it smaller"): 366 × 366 at 390 against the two-up
 * 189 × 189. No bleed — the photo sits on the 12px page gutter, the text flush under it (listing-card.tsx `wide`) — and 24px
 * between cards. From `sm` it is LISTING_GRID exactly (listing-grid.test.ts pins both breakpoints), so 3 / 4 columns and
 * the 12-card first page are untouched there.
 */
export const LISTING_GRID_WIDE = '-mx-3 grid grid-cols-1 gap-y-6 sm:mx-0 sm:grid-cols-3 sm:gap-x-0.5 sm:gap-y-4 lg:grid-cols-4 edge-grid'

/** The photo `sizes` of a card in LISTING_GRID_WIDE: LISTING_CARD_SIZES from `sm` up, and the full content width below it
 *  (100vw − the 12px gutter on each side: 366px at 390). ⚠️ A DPR2/DPR3 phone then asks for the 1080w rung where the two-up
 *  card asked for 420w/640w — the cost of the bigger photo, measured as LCP (part plan "risks"), not hidden by a smaller hint. */
export const WIDE_CARD_SIZES = LISTING_CARD_SIZES.replace(/calc\(50vw - 1px\)$/, '100vw')

/**
 * The explorer's MAP-mode list (listings-explorer.tsx): one full-width column below lg — no bleed there, so
 * the page gutter (24px on a phone, 48px from sm) is the whole margin; 5/12 of the frame at lg
 * ((100vw − 64px) · 5/12 − 9px of column gaps ≈ 41.67vw − 36px); two cards in half of the frame from xl:
 * 292px while the frame is 1280, 25vw − 50px while it follows the screen, 312px at its 1360 cap. It used to inherit the grid's half-width guess, so a phone's
 * full-width map card loaded a half-width photo.
 */
export const MAP_CARD_SIZES = '(min-width: 1448px) 312px, (min-width: 1368px) calc(25vw - 50px), (min-width: 1280px) 292px, (min-width: 1024px) calc(41.67vw - 36px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 24px)'
