/**
 * THE listing grid — the same columns and gaps as RAIL_CARD_W / RAIL_SCROLLER in shelf.tsx and the
 * home feed (memory eno-card-feed-standards): 2 / 3 / 4 columns.
 *
 * ⛔ FACEBOOK-MARKETPLACE SPACING ON A PHONE (owner, 2026-10-18: "spaced facebook marketplace style with
 * minimal wasted space around cards and a bit larger"). Below `sm` the grid BLEEDS 8px out of the page
 * frame's 12px gutter (`-mx-2` inside `px-3`), so photos sit 4px from the screen edge, 4px apart, with
 * 12px between rows (more than the 8px between a photo and its own price, so each price groups with its
 * photo): 189px cards at 390, 174 at 360, 150 at 320 (179 / 164 / 140 before). The card's text is inset
 * back onto the 12px gutter (listing-card.tsx body, `px-2 sm:px-0.5`). From `sm` the grid keeps the page
 * gutter (`sm:mx-0`), 8px apart and 16px between rows — 298px cards at ≥1280 (292 before).
 * ⚠️ THE BLEED ASSUMES THE `px-3` PAGE FRAME (`max-w-7xl px-3 sm:px-6 lg:px-8`), and every consumer sits
 * directly in one (checked 2026-10-18: the explorer, seller-listings, /saved + its loading skeleton, the SEO
 * landing and guide grids, school jobs). There is no page-level overflow guard, so a consumer inside a frame
 * narrower than 8px would scroll the page sideways — and any `overflow` clip at the content box (the explorer's
 * #listings section had one) cuts the outer cards' edges off; that clip now sits at the screen edge.
 * ⚠️ 2 / 3 / 4 ARE LOAD-BEARING: the first page is 12 cards (FIRST_PAGE_SIZE), the one count all three fill.
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
export const LISTING_GRID = '-mx-2 grid grid-cols-2 gap-x-1 gap-y-3 sm:mx-0 sm:grid-cols-3 sm:gap-x-2 sm:gap-y-4 lg:grid-cols-4'

/**
 * The `sizes` of a card photo in LISTING_GRID (and in a rail, whose card is one grid column) — derived from
 * the grid, so it moves with it: phone (390 − 8 edge − 4 gap) / 2 = 50vw − 6px; sm–md (px-6 frame, two 8px
 * gaps) (100vw − 64px) / 3; lg (px-8 frame, three gaps) (100vw − 88px) / 4; ≥1280 the frame caps at 1216px,
 * so (1216 − 24) / 4 = 298px. It replaces a `50vw / 33vw / 25vw` guess that told a 430px DPR3 phone its card
 * was 215px, so it fetched the 1080w file for a 209px tile (645 > 640). The widths themselves come from
 * next.config.ts (deviceSizes [360,420,640,1080] + imageSizes); at 390 a DPR2 phone now asks for 378px → the
 * 420w rung, a DPR3 one 567px → 640w.
 */
export const LISTING_CARD_SIZES = '(min-width: 1280px) 298px, (min-width: 1024px) calc(25vw - 22px), (min-width: 640px) calc(33.33vw - 21px), calc(50vw - 6px)'

/**
 * The explorer's MAP-mode list (listings-explorer.tsx): one full-width column below lg — no bleed there, so
 * the page gutter (24px on a phone, 48px from sm) is the whole margin; 5/12 of the frame at lg
 * ((100vw − 64px) · 5/12 − 9px of column gaps ≈ 41.67vw − 36px); two cards in half of the capped 1216px
 * frame from xl ((600 − 16) / 2 = 292px). It used to inherit the grid's half-width guess, so a phone's
 * full-width map card loaded a half-width photo.
 */
export const MAP_CARD_SIZES = '(min-width: 1280px) 292px, (min-width: 1024px) calc(41.67vw - 36px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 24px)'
