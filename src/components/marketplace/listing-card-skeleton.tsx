import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { CARD_BODY, GOODS_BODY, WIDE_BODY } from '@/lib/card-text'

/** How many card placeholders /saved reserves before the favourites set is known.
 *  ONE literal shared by the route-transition skeleton (saved/loading.tsx) and the
 *  page's own pre-hydration skeleton (saved/page.tsx) — they drew 8 and 2 from two
 *  hand-typed numbers, so a hard load flashed eight cards, collapsed to two, then
 *  grew to the real count. */
export const SAVED_SKELETON_COUNT = 8

/** The one loading placeholder for a listing card — photo + price/title/meta bars (+ the proof bar for a
 *  teacher cell, `teacher`), exactly the real card's shape so nothing shifts when data lands (CLS invariant).
 *  Wrappers own width/snap classes; this owns the inner stack.
 *  Was hand-rolled in 6 places with drifting bar counts.
 *
 *  ⚠️ THE BODY IS THE REAL CARD'S BOX MODEL, CLASS FOR CLASS — `CARD_BODY` (src/lib/card-text.ts), the very string the
 *  card and the SEO tile render. It used to be `space-y-3` with mt-2/space-y-1.5 bars, which put every bar at a
 *  different offset from the text it stood in for and made the card the wrong TOTAL height at every breakpoint.
 *  ⛔ RE-DERIVED FOR THE 2026-11-14 CARD TEXT BLOCK (owner-approved, cook r05: price 17/22, title 15/20, meta 13/18,
 *  10px under the photo, 2px between lines — one set at every width). The body is pt-2.5 (10) + price + gap-0.5 (2) +
 *  title + 2 + the info row's pt-0.5 (2) + its line, the line boxes being card-text.ts CARD_LINE_PX:
 *      below lg   10 + 22 + 2 + 20 + 2 + 2 + 18 = 76px   (under a 189px photo at 390; it was 71.25)
 *      lg and up  10 + 22 + 2 + 20 + 2 + 2 + 20 = 78px   (the info line is 14/20 from lg — the 2026-11-07 bump, kept)
 *  A TEACHER card leads with the name (owner, 2026-11-12, "go all"; kept), so `teacher` draws its own bars. ⛔ RE-DERIVED
 *  FOR THE TEACHERS PART (owner-approved 2026-11-14, cook r04 teachers): name `text-t-h3` (24px; `sm:text-lg
 *  sm:leading-snug` 24.75 from sm) over its rate 14/20 (16/20 from sm), then ONE 14/20 line — the proof when the card has
 *  one, else the same line reserved at the card's END (listing-card.tsx `data-teacher-proof-reserve`) — and the info line
 *  with no top padding: 10 + 24 + 2 + 20 + 2 + 20 + 2 + 18 = 98px on a phone (it was 91.5). The proof bar stands in for
 *  either: it sits where the proof is, and the card that reserves at its end is the same height. Callers that KNOW their cells
 *  are teachers pass it (/c/teachers' sort placeholders — seller-listings.tsx; /?category=teachers' first page and
 *  Show-more cells — listings-explorer.tsx); a mixed surface (saved, for-you, rails, related) keeps the plain skeleton,
 *  and a teacher card landing there differs by those bars.
 *  The bar heights below are those line boxes, so keep them tied to the type they stand in for rather than rounding
 *  them to spacing steps (card-text.test.ts reads them).
 *
 *  ⚠️ The photo box is aspect-SQUARE and must stay identical to ListingCard's
 *  (owner 2026-07-21: cards are square, no odd ratios; owner 2026-11-14: "dont change the product card ratio also dont
 *  make it smaller"), and it wears the same corner, `rounded-media` (16px round / 20px squircle since 2026-11-14,
 *  owner-approved) — it was 12px under an 18px card photo once, so the corner visibly changed shape as a card landed.
 *  Five places share the ratio and the corner and must move together: listing-card, this skeleton, the SEO tile
 *  (seo-listing-rail.tsx), the wizard Preview, and capacitor/www/index.html's .ph.
 *
 *  ⛔ `wide` — THE WIDE PHONE CARD'S PLACEHOLDER (owner-approved 2026-11-14, cook r06 rentals-a; <ListingCard wide>, the one-column
 *  phone grid of /c/rentals and the rentals feed). Below `sm` its body is the card's WIDE_BODY grid, bar for bar: the price
 *  bar beside the 36px trust slot it reserves (`sm:hidden`, as the card's), then the 24px title and the 20px info line across
 *  both columns — 12 + 36 + 2 + 24 + 2 + 20 = 96px (card-text.ts WIDE_LINE_PX). From `sm` it is the plain skeleton.
 *
 *  ⛔ `look="goods"` — THE GOODS PHONE CARD'S PLACEHOLDER (owner-approved 2026-11-14, cook r06 goods; <ListingCard look="goods">).
 *  Below `sm` the body is the card's GOODS_BODY: 8px under the photo, no gap between lines, the price bar 22px inside the
 *  28px price row (3px above and below it), the 20px title, the info line under its 2px — 8 + 28 + 20 + 2 + 18 = 76px, the
 *  plain skeleton's total (card-text.ts GOODS_LINE_PX). From `sm` it is the plain skeleton. A teacher or wide cell ignores it. */
export function ListingCardSkeleton({ className, teacher = false, wide = false, look }: { className?: string; teacher?: boolean; wide?: boolean; look?: 'goods' }) {
  const goods = look === 'goods' && !teacher && !wide
  return (
    <div className={cn('flex flex-col', className)} data-look={goods ? 'goods' : undefined}>
      <div className="aspect-square w-full rounded-media shimmer skeleton-photo" />
      {/* Mirrors the card body (CARD_BODY): one price line, ONE title line, one info line, inset like the card's text on
          a phone (a teacher card swaps the first two for name + rate, and adds its proof line — `teacher`, the note
          above). Heights are the real line boxes — re-derive them if any of the card's type roles change. */}
      <div className={wide ? cn(CARD_BODY, WIDE_BODY) : goods ? cn(CARD_BODY, GOODS_BODY) : CARD_BODY}>
        {teacher ? (
          <>
            {/* NAME — `text-t-h3` (24px), `sm:text-lg sm:leading-snug` (24.75px): TEACHER_TITLE_LINE. */}
            <Skeleton className="h-6 w-4/5 sm:h-[24.75px]" />
            {/* RATE — TEACHER_RATE, a 20px line at every width. */}
            <Skeleton className="h-5 w-1/2" />
          </>
        ) : (
          <>
            {/* PRICE — `text-t-price` (17/22) at every width: ONE line.
                ⚠️ THE "≈ $…" IS NOT GONE, whatever this note used to say — the owner asked for it back
                after the đồng price the day it was dropped (2026-09-13). Since 2026-11-14 a whole-thousand
                sale price of a million or more reads in millions ("12.8M đ ≈ $499", owner-approved 2026-11-14,
                vnd.ts cardCompactAbove) and a per-unit price of a million or more has since 2026-10-18
                ("9M đ / month ≈ $351", vnd.ts RATE_COMPACT_VND; Vietnamese with no "đ" after "triệu"), so a
                goods price and most rents fit one line. What still wraps — a long rent with its "≈ $", a struck
                "was" price beside a long figure (vnd.ts has the sweep) — takes two lines. This bar reserves one line
                regardless — a two-line reserve would collide with the owner's "price 1 line" card spec (2026-09-13). */}
            {/* The goods card's price row is 28px below sm (GOODS_PRICE_ROW): the 22px bar centred in it. */}
            {goods ? <Skeleton className="h-[22px] w-1/2 max-sm:my-0.75" /> : <Skeleton className="h-[22px] w-1/2" />}
            {/* The wide card's trust slot: its 36px row, phones only (the card's `data-trust-slot`). */}
            {wide && <div aria-hidden className="min-h-9 sm:hidden" />}
            {/* TITLE — `truncate` `text-t-card`: one 20px line (the wide card's 24px body line below `sm`). */}
            <Skeleton className={wide ? 'h-5 w-4/5 max-sm:col-span-2 max-sm:h-6' : 'h-5 w-4/5'} />
          </>
        )}
        {/* PROOF — a teacher cell only: the card's one 14/20 line (TEACHER_PROOF, or its reserve at the card's end). */}
        {teacher && <Skeleton data-skeleton-proof="" className="h-5 w-2/5" />}
        {/* META — the info line under the real row's pt-0.5 (2px; none on a teacher card): `text-t-meta` (an 18px line)
            below lg, `lg:text-sm` (20px) from lg. */}
        <Skeleton className={teacher ? 'h-[18px] w-1/2 lg:h-5' : wide ? 'mt-0.5 h-[18px] w-1/2 lg:h-5 max-sm:col-span-2 max-sm:mt-0 max-sm:h-5' : 'mt-0.5 h-[18px] w-1/2 lg:h-5'} />
      </div>
    </div>
  )
}
