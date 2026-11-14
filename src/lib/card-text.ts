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
 * ⛔ A TEACHER CARD KEEPS ITS NAME BOLD AND IN INK (owner, 2026-11-12, "go all" — kept): TEACHER_TITLE_LINE below, and its
 * rate keeps `text-sm leading-tight sm:text-base`. The shell mock's `h3` rule flattened teacher names on the shelves by
 * accident; that is a side effect, not the design.
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
 * The teacher card's name line (owner, 2026-11-12, "go all"): TITLE_LINE a step up, bold and in ink — 16/22 on a phone,
 * 18/24.75 from sm — so truncation and the hover underline stay one string. Its rate drops a step to match (`text-sm
 * leading-tight sm:text-base` on <Price>). ⚠️ `leading-snug` IS RESTATED ON PURPOSE: tailwind-merge 3 lets a later font
 * size drop an earlier `leading-*`.
 */
export const TEACHER_TITLE_LINE = cn(TITLE_LINE, 'text-base font-bold leading-snug sm:text-lg text-foreground')
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
