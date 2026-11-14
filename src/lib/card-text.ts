import { cn } from '@/lib/utils'

/**
 * ⛔ THE PRODUCT CARD'S TEXT BLOCK, WRITTEN ONCE (owner-approved 2026-11-14, cook r05 shell: "Text 10 below: price
 * --t-price ink + ≈$ --t-meta muted; title --t-card --c-ink-2, one line; meta --t-meta muted; 2 px between lines").
 * <ListingCard> (listing-card.tsx), the SEO tile (seo-listing-rail.tsx, a server component — so this is a plain module)
 * and the loading skeleton (listing-card-skeleton.tsx) read these strings, so the three can never drift apart: the
 * skeleton's bars are the line boxes below (CARD_LINE_PX), and card-text.test.ts ties them together.
 *
 *   body   pt 10, 2px between lines, inset onto the 12px page gutter on a phone (px-2; flush from sm, 2026-10-18)
 *   price  `text-t-price` 17/22 −0.015em 700, ink (`--price` = foreground since 2026-11-14) — ONE size at every width
 *          (it was 16, 18 from sm). 17 is the ceiling: 18 wraps "65,000,000 đ ≈ $2,535" in a 189px card (cook r04).
 *   ≈ $    `text-t-meta` 13/18 muted, 4px after the figure. From lg in body ink: the 2026-11-07 desk-distance legibility
 *          bump is kept (a colour only, never a hiding class — owner 2026-09-13).
 *   title  `text-t-card` 15/20, regular, ink-3 (#3d3d3d), ONE truncating line (it was 14, 16 from sm, in foreground).
 *   meta   `text-t-meta` 13/18 muted, 2px above (it was 12px ink-4, pt 4). From lg 14/20 in body ink (2026-11-07, kept).
 *   was    the struck "was" price, the meta role, regular, muted (it was 11px; nothing in the UI is under 13 since the
 *          redesign).
 *
 * ⛔ A TEACHER CARD KEEPS ITS NAME BOLD AND IN INK (owner, 2026-11-12, "go all" — kept): TEACHER_TITLE_LINE below. The shell
 * mock's `h3` rule flattened teacher names on the shelves by accident; that is a side effect, not the design. Its sizes are
 * the teachers part's (owner-approved 2026-11-14, cook r04 teachers): the name the h3 role on a phone, the rate 14/20 bold.
 *
 * ⚠️ tailwind-merge knows the `t-*` roles (lib/utils.ts `theme.text`), so `cn('… font-bold text-price', 'text-t-price')`
 * keeps the colour `text-price` (fab-clearance.ts selects `[data-card-root] .text-price`) and `cn(TITLE_LINE,
 * 'text-base')` drops `text-t-card` — utils.test.ts pins both.
 */
export const CARD_BODY = 'flex flex-1 flex-col gap-0.5 px-2 pt-2.5 sm:px-0.5'
/** The card price's size role, on <Price>'s own className (Price adds `tabular-nums font-bold text-price`). */
export const CARD_PRICE = 'text-t-price'
/** <Price approxClassName>: replaces the default `ml-1.5 … text-xs` (tailwind-merge resolves both groups). `tracking-normal`:
 *  the price role's −0.015em is set on the price span and INHERITED as a length (−0.255px at 17px), so the 13px ≈ would
 *  carry the figure's tracking; the shell sets it back to 0. */
export const CARD_APPROX = 'ml-1 text-t-meta tracking-normal lg:text-body'
/**
 * The card's one-line title (the h3). `font-normal` (owner, 2026-10-18 — "look like top marketplace"): a regular title
 * under the bold price. `truncate`, never `line-clamp-1`: one line is the spec (listing-card.tsx `titleBlock`).
 * ⚠️ `-mt-px pt-px` IS THE VIETNAMESE STACKED-MARK ROOM, AND IT MOVES NOTHING. `truncate` is `overflow: hidden`, which clips
 * at the padding box, and on a 15/20 line Open Runde's tallest stacked marks rise past the line box: measured 2026-11-14 in
 * Chromium with the shipped woff2 ("ẨỖẤẶ Ỷ Ừ"), the ink reaches 16.31px above the baseline against 15.50px of line box —
 * 0.81px of the hook cut off (the old 14/19.25 phone line cut 0.09px, the old 16/22 sm line 0.40px; the system fallback
 * stack has room). 21px would still cut 0.31px and 22px would change the body the skeleton reserves, so the box grows 1px
 * of PADDING upward and a −1px margin gives it back: the text, the line box and the card's height stay exactly where the
 * 20px line put them, and the clip edge sits 1px higher. Lowercase titles ("Cho thuê căn hộ …", 12.66px of ink) never
 * reached it. A teacher's name line (TEACHER_TITLE_LINE) inherits the same room.
 */
export const TITLE_LINE = 'truncate -mt-px pt-px text-t-card font-normal text-ink-3 group-hover:underline decoration-1 underline-offset-2'
/**
 * The teacher card's name line (owner, 2026-11-12, "go all"): TITLE_LINE a step up, bold and in ink, so truncation and the
 * hover underline stay one string. ⛔ ON A PHONE THE SHELL'S h3 ROLE, `text-t-h3` 17/24 (owner-approved 2026-11-14, cook r04
 * teachers — it reverses the 2026-11-12 16/22: "people cards may set the NAME in --t-h3 ink"); 18/24.75 from sm, as before.
 * Its rate sits under it at 14/20 bold (`TEACHER_RATE`). ⚠️ `sm:leading-snug` IS RESTATED ON PURPOSE: tailwind-merge 3 lets a
 * later font size drop an earlier `leading-*`, and `sm:text-lg` alone would take text-lg's own 28px line.
 */
export const TEACHER_TITLE_LINE = cn(TITLE_LINE, 'text-t-h3 font-bold sm:text-lg sm:leading-snug text-foreground')
/**
 * The teacher card's rate (<Price className>): 14/20 bold on a phone, 16/20 from sm (owner-approved 2026-11-14, cook r04
 * teachers). `font-bold` also carries "Rate on request" — <Price> sets a no-figure line `font-semibold`, and every rate line
 * on the card weighs the same; that one stays muted.
 */
export const TEACHER_RATE = 'text-sm leading-5 font-bold sm:text-base'
/** A teacher card's proof line (owner, 2026-11-12, "build 2"): 14/20 in ink-2 since 2026-11-14 (cook r04; it was 12px ink). */
export const TEACHER_PROOF = 'truncate text-sm text-body'
/** The info line's type and spacing (the row's layout classes are the card's own: listing-card.tsx). */
export const CARD_META = 'pt-0.5 text-t-meta text-muted-foreground lg:text-sm lg:text-body'
/** The struck "was" price (<Price className>) and its ≈ (approxClassName) — `whitespace-nowrap`: half a number reads as the whole number. */
export const CARD_WAS = 'whitespace-nowrap text-t-meta font-normal text-muted-foreground line-through'
export const CARD_WAS_APPROX = 'text-t-meta'

/**
 * The line boxes the skeleton reserves, in px — the roles above (globals.css `@theme { --text-t-* }`), below lg:
 * price 22 (t-price) · title 20 (t-card) · meta 18 (t-meta). A phone body is 10 + 22 + 2 + 20 + 2 + 2 + 18 = 76px.
 */
export const CARD_LINE_PX = { price: 22, title: 20, meta: 18 } as const

/**
 * ⛔ THE WIDE PHONE CARD'S TEXT BLOCK (owner-approved 2026-11-14, cook r06 rentals-a: "after this cook round build all best
 * options and deploy") — <ListingCard wide> in a one-column phone grid (listing-grid.ts LISTING_GRID_WIDE: /c/rentals and the
 * rentals feed) and its skeleton (listing-card-skeleton.tsx `wide`). Every class is `max-sm:`, so from `sm` the card is the
 * grid card above. Merged onto CARD_BODY / TITLE_LINE / CARD_META with cn().
 *   body   a two-column grid, `minmax(0,1fr) auto`: row 1 is the price and the trust slot (the price is the one that wraps),
 *          the title and the info line span both. Flush with the photo (it sits on the 12px gutter), 12px under it, 12px
 *          between the price and the slot, the body's 2px between rows. `content-start`: never spreads its rows in a taller
 *          cell.
 *   row 1  36px at least (the slot's `min-h-9`, the chip's height), so every wide card's price line is one height.
 *   title  the body role, 16/24, in ink (it was 15/20 ink-3) — one truncating line; TITLE_LINE's 1px of stacked-mark room
 *          rides along.
 *   meta   14/20 (`text-sm`), muted, flush under the title.
 */
export const WIDE_BODY = 'max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:content-start max-sm:items-center max-sm:gap-x-3 max-sm:px-0 max-sm:pt-3'
export const WIDE_TITLE = 'max-sm:col-span-2 max-sm:text-base max-sm:leading-6 max-sm:text-foreground'
export const WIDE_META = 'max-sm:col-span-2 max-sm:pt-0 max-sm:text-sm'
/** The wide phone card's line boxes, in px: a one-line body is 12 + 36 + 2 + 24 + 2 + 20 = 96px. */
export const WIDE_LINE_PX = { top: 12, row: 36, title: 24, meta: 20, gap: 2 } as const

/**
 * ⛔ THE GOODS PHONE CARD'S TEXT BLOCK (owner-approved 2026-11-14, cook r06 goods: "after this cook round build all best
 * options and deploy") — <ListingCard look="goods"> on a goods surface (src/lib/goods-surface.ts: a search over every category,
 * /c/electronics and every goods category), and its skeleton (listing-card-skeleton.tsx `look`). PRICE-LED: the compact sale
 * price (batch 94, "12.8M đ ≈ $499") is a short token, so it takes the heading cut — one loud object per card, the photo above
 * it and two quiet lines under it. Every class is `max-sm:`, so from `sm` the card is the shell card above. Merged onto
 * CARD_BODY / CARD_PRICE with cn().
 *   body   8px under the photo, no gap between lines: the price row's own 28px box carries the air (the meta keeps its 2px).
 *   price  a SALE price at the section-heading role, `text-t-h2` 22/28 −0.02em bold ink. ⛔ It equals the section heading on a
 *          goods phone (it reverses section-title.ts D-TYPE there, owner 2026-09-30: "always one step above the card price").
 *          A per-unit, salary or word price keeps `text-t-price` 17/22 inside the same 28px row (GOODS_PRICE_ROW), so a mixed
 *          row stays level. The ≈ $ (13 muted, 4px after the figure) and the struck was-price are the shell's.
 *   title  the shell's 15/20 ink-3 line; meta the shell's 13/18 muted, 2px above.
 * One-line body: 8 + 28 + 20 + 2 + 18 = 76px — the shell card's 76 (10 + 22 + 2 + 20 + 2 + 2 + 18), so a goods card is the
 * shell card's height (265 at 390) and the skeleton reserves the same total. A drop card whose struck price wraps grows, as it
 * does on the shell card.
 */
export const GOODS_BODY = 'max-sm:gap-0 max-sm:pt-2'
/** The price row: 28px tall at the least below sm, whatever size the figure takes (a sale price's 28px line, a rent's 22). */
export const GOODS_PRICE_ROW = 'max-sm:min-h-7'
/** A goods card's SALE price below sm (the note above): <Price className> on top of CARD_PRICE. */
export const GOODS_SALE_PRICE = 'max-sm:text-t-h2'
/** The goods phone card's line boxes, in px: a one-line body is 8 + 28 + 20 + 2 + 18 = 76px. */
export const GOODS_LINE_PX = { top: 8, price: 28, title: 20, metaTop: 2, meta: 18 } as const
