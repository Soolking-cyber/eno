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
 *          ⛔ EXCEPT THE WIDE RENTAL CARD'S FIGURE ON A PHONE (owner-approved 2026-11-15 (build 7), cook r07 rentals — it reverses
 *          "ONE size at every width" there): 22/28 in a 366px card (WIDE_PRICE below; the goods sale price's cut, GOODS_SALE_PRICE),
 *          its unit and ≈ $ quieter. The ceiling above is the 189px card's; the wide card has twice the width.
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
 * Its rate sits under it (`TEACHER_RATE`). ⚠️ `sm:leading-snug` IS RESTATED ON PURPOSE: tailwind-merge 3 lets a
 * later font size drop an earlier `leading-*`, and `sm:text-lg` alone would take text-lg's own 28px line.
 * ⚠️ 17, NOT THE COOK r07 MOCK'S 18 (build 7, 2026-11-15): the blind critics marked the mock's names truncated ("Maksym
 * Vovkovy…") — measured in Open Runde Bold, "Maksym Vovkovych" + the 16px tick + 4px is 191px at 18/−0.015em against a 181px
 * text column, 179px at 17 with `max-sm:tracking-tight` (−0.025em). The name keeps the closed scale's h3 role; the lockup
 * gets louder through the rate (16, below). A name longer than the column ("Catherine Caranto Felisilda", 218px) still
 * truncates — never rewritten (text surgery is banned), and the full name is the h3's `title` and the link's name.
 */
export const TEACHER_TITLE_LINE = cn(TITLE_LINE, 'text-t-h3 font-bold max-sm:tracking-tight sm:text-lg sm:leading-snug text-foreground')
/**
 * ⛔ THE NAME + RATE LOCKUP (owner-approved 2026-11-15, build 7 — cook r07 teachers; it reverses the 2026-11-14 cook r04 "rate
 * 14/20 bold, 'Rate on request' the same weight, muted"). On a phone the rate FIGURE is 16/22 bold ink right under the name, its
 * unit ("/hr", "/ giờ") a 13 muted regular label (`TEACHER_RATE_UNIT`) beside the ≈ $ the shell already sets 13 muted. From sm
 * it is 16/20 bold, the unit in the figure's ink, as before. <Price className>.
 */
export const TEACHER_RATE = 'text-base leading-5.5 font-bold sm:leading-5'
/**
 * "Rate on request" (<Price className> when the teacher states no figure): on a phone 14 muted REGULAR in the figure's 22px slot
 * — never louder than a real rate (owner-approved 2026-11-15, build 7); from sm 16/20 bold muted, as before. <Price> adds
 * `text-muted-foreground` for a teacher with no figure; `font-normal` replaces its `font-semibold` (tailwind-merge, caller wins).
 */
export const TEACHER_NO_RATE = 'text-sm leading-5.5 font-normal sm:text-base sm:leading-5 sm:font-bold'
/** The rate's unit on a phone (<Price unitClassName>: the short English "/hr" run, or the Vietnamese " / giờ" span) — a label,
 *  13/18 muted regular beside the bold figure (build 7). From sm it inherits the figure, as before. */
export const TEACHER_RATE_UNIT = 'max-sm:text-t-meta max-sm:font-normal max-sm:text-muted-foreground'
/**
 * The teacher card's text block on a phone (build 7, owner-approved 2026-11-15 — cook r07 teachers): it keeps the 8px LEFT
 * inset onto the 12px page gutter (listing-grid.ts, the header, the title and the controls share that edge) and runs to its
 * photo's RIGHT edge, so the name gets 181px of a 189px card instead of 173 (the mock set the text flush on both sides and moved
 * the page to a 4px edge; the critics read that edge as cramped, so the build keeps the 12px one).
 */
export const TEACHER_BODY = 'max-sm:pr-0'
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
 *   body   ⛔ ONE COLUMN, THREE LINES, ONE ORDER ON EVERY CARD (owner-approved 2026-11-15 (build 8), cook r08 rentals — it
 *          reverses the r06/r07 two-column grid whose row 1 shared the price with the trust slot): price, title, place · age.
 *          The availability check left the text block for the photo's top-right corner (and the card itself on 2026-11-25), so
 *          the block is CARD_BODY's own flex column: flush with the photo (it sits on the 12px gutter), 12px under it, the
 *          body's 2px between lines.
 *   row 1  28px at least (WIDE_PRICE_ROW — the figure's own line box), so a word price's 22px line sits in the same row as a
 *          figure's and every wide card's text block is one height. It was 36 while the chip shared it (r06/r07).
 *   price  ⛔ the FIGURE at the section-heading role, `text-t-h2` 22/28 −0.02em bold ink (owner-approved 2026-11-15 (build 7),
 *          cook r07 rentals: "the price is the card's one loud object" — the goods sale price's cut, GOODS_SALE_PRICE; it
 *          reverses the shell's "ONE size at every width" on this card, the header note above). Only for a figure: a word
 *          price ("Contact for price") keeps 17/22, centred in the 28px row (WIDE_PRICE_ROW's `content-center`). With the whole
 *          366px to itself the longest Vietnamese rent ("150 triệu / tháng ≈ $5,850", 177.9px) stays one line.
 *   unit   "/mo", "/ tháng": the body role, 16 regular ink-3, no tracking (WIDE_UNIT) — quiet after the figure; the ≈ $
 *          14/20 regular muted (CARD_APPROX + `max-sm:text-sm`, listing-card.tsx).
 *   title  the body role, 16/24, in ink (it was 15/20 ink-3) — one truncating line; TITLE_LINE's 1px of stacked-mark room
 *          rides along.
 *   meta   14/20 (`text-sm`), muted, flush under the title.
 */
export const WIDE_BODY = 'max-sm:px-0 max-sm:pt-3'
export const WIDE_TITLE = 'max-sm:text-base max-sm:leading-6 max-sm:text-foreground'
export const WIDE_META = 'max-sm:pt-0 max-sm:text-sm'
/** The wide card's price row below sm (the note above): the figure's 28px line box on every card, a word price centred in it. */
export const WIDE_PRICE_ROW = 'max-sm:min-h-7 max-sm:content-center'
/** The wide card's FIGURE below sm (the note above): <Price className> on top of CARD_PRICE, for a price above zero only. */
export const WIDE_PRICE = 'max-sm:text-t-h2'
/** The wide card's unit below sm (<Price unitClassName>: the glued English "/mo" run, or the Vietnamese " / tháng" span). */
export const WIDE_UNIT = 'max-sm:text-base max-sm:font-normal max-sm:tracking-normal max-sm:text-ink-3'
/** The wide phone card's line boxes, in px: a one-line body is 12 + 28 + 2 + 24 + 2 + 20 = 88px (96 while row 1 was 36, build 7). */
export const WIDE_LINE_PX = { top: 12, row: 28, title: 24, meta: 20, gap: 2 } as const

/**
 * ⛔ THE GOODS PHONE CARD'S TEXT BLOCK (owner-approved 2026-11-14, cook r06 goods: "after this cook round build all best
 * options and deploy") — <ListingCard look="goods"> on a goods surface (src/lib/goods-surface.ts: a search over every category,
 * /c/electronics and every goods category), and its skeleton (listing-card-skeleton.tsx `look`). Every class is `max-sm:` (or
 * sits on the phone's own copy of the price row, which is `sm:hidden`), so from `sm` the card is the shell card above. Merged
 * onto CARD_BODY / TITLE_LINE / CARD_META / CARD_PRICE with cn().
 * ⛔ ONE FIXED ORDER THAT ENDS ON THE PRICE (owner-approved 2026-11-15 (build 8), cook r08 goods — StockX's card; it reverses
 * r06's "PRICE-LED … a sale price at the heading cut … in a 28px row 8px under the photo" and, on this card, the 09-13
 * "PRICE → ONE-LINE TITLE → the info line", listing-card.tsx): the photo, then the title, the info line, and the price LAST,
 * large and bold — every card in a row ends on its number. In the DOM in that order on a phone (listing-card.tsx renders the
 * price row twice, a class picking one per width), so a screen reader hears what the eye reads.
 *   body   10px under the photo (the shell's pt-2.5), no gap between lines.
 *   title  the shell's 15/20 line, regular, in INK (`GOODS_CARD_TITLE`; it was ink-3) — the line a reader scans first now.
 *   meta   the shell's 13/18 muted line, 2px above (CARD_META's own `pt-0.5`), right under the title (`GOODS_CARD_META`: not pushed
 *          to the foot — the price row is).
 *   price  ⛔ a SALE price at the section-heading role, `text-t-h2` 22/28 −0.02em bold ink (r06's cut, kept — it equals the
 *          section heading on a goods phone, reversing section-title.ts D-TYPE there, owner 2026-09-30: "always one step above
 *          the card price"), in a row 6px under the info line whose own box is 28px (GOODS_PRICE_ROW: `min-h-8.5` holds
 *          6 + 28), pushed to the card's foot (`mt-auto`). A per-unit, salary or word price keeps `text-t-price` 17/22 in the
 *          same row, so a mixed row stays level. The ≈ $ (13 muted, 4px after the figure) and the struck was-price are the
 *          shell's.
 * One-line body: 10 + 20 + 2 + 18 + 6 + 28 = 84px (76 until build 8): the card grows 8px, never shrinks (owner, 2026-11-14:
 * "dont make it smaller"), the photo's square and size untouched. The skeleton reserves the same total. A drop card whose struck
 * price wraps grows, as it does on the shell card.
 */
export const GOODS_BODY = 'max-sm:gap-0'
/**
 * A NON-goods card in a goods grid (a no-category search: `look="goods"` reaches every card, the goods body only goods ones):
 * its body reserves the goods body's 84px below sm. The grid's placeholders are goods skeletons, so a row of two rental or job
 * cards would otherwise land 8px shorter than its placeholder and move everything under it when the answer paints (review).
 */
export const GOODS_CELL_FLOOR = 'max-sm:min-h-21'
/** The goods card's title below sm: the shell's line in ink (the note above). */
export const GOODS_CARD_TITLE = 'max-sm:text-foreground'
/** The goods card's info line below sm: right under the title — the price row takes the free space instead (`mt-auto`). */
export const GOODS_CARD_META = 'max-sm:mt-0'
/** The phone's copy of the price row (`sm:hidden` on the card): at the foot, 6px under the info line, its own box 28px at least. */
export const GOODS_PRICE_ROW = 'mt-auto min-h-8.5 pt-1.5'
/** A goods card's SALE price below sm (the note above): <Price className> on top of CARD_PRICE. */
export const GOODS_SALE_PRICE = 'max-sm:text-t-h2'
/** The goods phone card's line boxes, in px, in their order: a one-line body is 10 + 20 + 2 + 18 + 6 + 28 = 84px. */
export const GOODS_LINE_PX = { top: 10, title: 20, metaTop: 2, meta: 18, priceTop: 6, price: 28 } as const

/**
 * ⛔ A HOME LANE CARD'S TEXT BLOCK ON A PHONE (owner-approved 2026-11-15 (build 7), cook r07 home: "one tight text rhythm on
 * every lane — price 4 title 4 meta") — <ListingCard lane>, never a teacher card (its own block, above). Every class is
 * `max-sm:`, merged onto CARD_BODY / CARD_META with cn(); from `sm` a lane is a rail and its card the shell card.
 *   body   flush with the photo (the lane already puts the photo on the 12px edge), 8px under it, 4px between lines.
 *   meta   the shell's 13/18 muted line, its own 2px dropped: the body's 4px is the space above it.
 * 8 + 22 + 4 + 20 + 4 + 18 = 76px — the shell body's total (CARD_LINE_PX), so a deferred lane's placeholders
 * (ListingCardSkeleton) still hold its cards exactly.
 */
export const LANE_BODY = 'max-sm:gap-1 max-sm:px-0 max-sm:pt-2'
export const LANE_META = 'max-sm:pt-0'
