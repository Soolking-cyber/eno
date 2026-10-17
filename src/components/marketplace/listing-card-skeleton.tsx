import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** How many card placeholders /saved reserves before the favourites set is known.
 *  ONE literal shared by the route-transition skeleton (saved/loading.tsx) and the
 *  page's own pre-hydration skeleton (saved/page.tsx) — they drew 8 and 2 from two
 *  hand-typed numbers, so a hard load flashed eight cards, collapsed to two, then
 *  grew to the real count. */
export const SAVED_SKELETON_COUNT = 8

/** The one loading placeholder for a listing card — photo + price/title/meta bars,
 *  exactly the real card's shape so nothing shifts when data lands (CLS invariant).
 *  Wrappers own width/snap classes; this owns the inner stack.
 *  Was hand-rolled in 6 places with drifting bar counts.
 *
 *  ⚠️ THE BODY IS THE REAL CARD'S BOX MODEL, CLASS FOR CLASS — `flex flex-col
 *  gap-0.5 px-2 pt-2 sm:px-0.5` (listing-card.tsx, the body div). It used to be `space-y-3` with
 *  mt-2/space-y-1.5 bars, which put every bar at a different offset from the text it
 *  stood in for and made the card the wrong TOTAL height at every breakpoint.
 *  Re-derived from the classes for the owner's Facebook-spaced grid (2026-10-18) — the card body is
 *  pt-2 (8) + price + gap-0.5 (2) + title + 2 + the info row's pt-1 (4) + its line:
 *      phone (<640)    8 + 20 + 2 + 19.25 + 2 + 4 + 16  = 71.25px   (under a 189px photo at 390)
 *      sm and up       8 + 22.5 + 2 + 19.25 + 2 + 4 + 15 = 72.75px  (under 192–298px photos)
 *  The bar heights below are those line boxes, so keep them tied to the type they stand in for
 *  rather than rounding them to spacing steps. (The 2026-08-07 table that sat here — 117 / 94 / 75px —
 *  measured the old two-title-line card.)
 *
 *  ⚠️ The photo box is aspect-SQUARE and must stay identical to ListingCard's
 *  (owner 2026-07-21: cards are square, no odd ratios), and it wears the same corner, `rounded-media`
 *  (owner 2026-10-18: "minimal squircle corners") — it was 12px under an 18px card photo, so the corner
 *  visibly changed shape as a card landed. Five places share the ratio and the corner and must move
 *  together: listing-card, this skeleton, the SEO tile (seo-listing-rail.tsx), the wizard Preview, and
 *  capacitor/www/index.html's .ph. */
export function ListingCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="aspect-square w-full rounded-media shimmer skeleton-photo" />
      {/* Mirrors the Facebook-Marketplace-shaped card body (2026-09-13): one price line, ONE title
          line, one info line, inset like the card's text on a phone. Heights are the real line boxes —
          re-derive them if any of the card's type sizes change. */}
      <div className="flex flex-col gap-0.5 px-2 pt-2 sm:px-0.5">
        {/* PRICE — text-base/leading-tight below sm (20px), text-lg/leading-tight above (22.5px): ONE line.
            ⚠️ THE "≈ $…" IS NOT GONE, whatever this note used to say — the owner asked for it back
            after the đồng price the day it was dropped (2026-09-13), and a goods price still fits one
            line with it (48 of 48 on /c/electronics at 390px, 2026-09-29).
            ⚠️ A PER-UNIT PRICE USED NOT TO: "9,000,000 đ / month ≈ $351" wrapped to two lines (40px) on
            every rental card at 390px (48 of 48 on /c/rentals). Since 2026-10-18 the card prints it in
            millions ("9M đ / month ≈ $351", vnd.ts RATE_COMPACT_VND), one line in English at 390; in
            Vietnamese only a whole single-digit rent fits ("9 triệu đ / tháng", 169px of 173) and
            "8,5 triệu đ / tháng" still wraps until the owner settles its wording. This bar reserves one
            line regardless — a two-line reserve would collide with the owner's "price 1 line" card spec
            (2026-09-13). */}
        <Skeleton className="h-5 w-1/2 sm:h-[22.5px]" />
        {/* TITLE — `truncate` text-sm/leading-snug: one 19.25px line. */}
        <Skeleton className="h-[19.25px] w-4/5" />
        {/* META — the unchanged info line under the real row's pt-1 (4px): text-xs on a phone (a 16px line —
            this bar was 15px, a pixel short, since D-TYPE raised the phone row to 12px), text-2xs from sm
            (14.85px, and the 15px trust chip sets the row). */}
        <Skeleton className="mt-1 h-4 w-1/2 sm:h-[15px]" />
      </div>
    </div>
  )
}
