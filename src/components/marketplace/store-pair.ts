/**
 * ⛔ A STOREFRONT'S ROW UNDER ITS IDENTITY IS [Chat now][Share][⋯] (owner, 2026-11-16 — hub Q21; UI climb r12, cook store-r12c S2,
 * the storefront batch +0.90 / +0.50 over live, blind): Chat and Share an EQUAL PAIR, 44px, sharing the row's width, then the
 * 44px ⋯ that holds Report and Block (storefront-more-menu.tsx). One class for every member's box, so the pair cannot drift:
 * SellerCard's Chat, the shop host's "Chat on …" link (storefront-seller-card.tsx), the path storefront's Chat
 * (storefront-chat-button.tsx) and ShareButton `shape="pair"`. Each brings its own fill; the label is the button role's 14px bold.
 * ⛔ `px-3` IS A FLOOR, NOT A SUGGESTION (review, 2026-11-16): a label too long for its half WRAPS inside the 12px sides
 * (`whitespace-normal` over the Button's `nowrap`, centred) — it never runs into the edge. Measured (Open Runde 700, 14px,
 * Chromium): the shop host's "Chat trên eno.vn" needs 160px with its glyph and sides, a 320px phone gives each half 144, so
 * below ~350px it takes two lines; every other label of the rows fits one line at 320 in English and Vietnamese.
 */
export const STORE_PAIR = 'min-h-11 min-w-0 flex-1 justify-center whitespace-normal rounded-xl px-3 text-center'

/**
 * ⛔ A MEMBER DRAWN ALONE KEEPS ITS CONTENT WIDTH (review, 2026-11-16): no Share on a handle-less path storefront, no Chat for
 * an affiliate-only partner or the visa desk (owner, 2026-08-24). Stretched across the row, a lone Chat is the button the owner
 * called "too long" (2026-07-23, seller-card.tsx), and a lone Share is the same bar in grey. The same 44px box, at its words'
 * width with the 32px sides the lone Chat had. Only BOTH drawn make the pair (`storeMember`).
 */
export const STORE_LONE = 'min-h-11 justify-center rounded-xl px-8'

/** The box for a member of the row: the pair's share of the width when its partner is drawn too, else its own width. */
export const storeMember = (paired: boolean) => (paired ? STORE_PAIR : STORE_LONE)

/** The field-grey member (Share) and the ⋯: the field grey at rest, a step deeper pressed, hovered or open. */
export const STORE_QUIET = 'bg-tint text-foreground hover:bg-secondary active:bg-secondary data-popup-open:bg-secondary'
