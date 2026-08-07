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
 *  gap-0.5 px-0.5 pt-2.5` (listing-card.tsx:503). It used to be `space-y-3` with
 *  mt-2/space-y-1.5 bars, which put every bar at a different offset from the text it
 *  stood in for and made the card the wrong TOTAL height at every breakpoint.
 *  Measured against the live feed (2026-08-07, body height of the dominant card):
 *      viewport   real body   old skeleton   this
 *      390px        117px        98px        117px
 *      1024px        94px        98px         95px
 *      1280px        75px        98px         75px
 *  The bar heights below are the real line boxes, so keep them tied to the type they
 *  stand in for rather than rounding them to spacing steps.
 *
 *  ⚠️ The photo box is aspect-SQUARE and must stay identical to ListingCard's
 *  (owner 2026-07-21: cards are square, no odd ratios). Five places share this
 *  ratio and must move together or CLS regresses: listing-card, this skeleton,
 *  seo-landing, the wizard Preview, and capacitor/www/index.html's .ph. */
export function ListingCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="aspect-square w-full rounded-xl shimmer skeleton-photo" />
      <div className="flex flex-col gap-0.5 px-0.5 pt-2.5">
        {/* PRICE — text-lg/leading-tight, a 23px line box. The dual-currency "≈ $…"
            wraps onto a SECOND line on a narrow card (measured at 390px: 17 of 25
            feed cards run two lines), so it is reserved below sm and dropped above,
            where the card is wide enough to keep the amount on one line.
            gap-px, not the parent's gap-0.5: two line boxes of one wrapped element
            are contiguous, so 23 + 1 + 21 = the 45px the real price measures. */}
        <div className="flex flex-col gap-px">
          <Skeleton className="h-[23px] w-1/2" />
          <Skeleton className="h-[21px] w-1/3 sm:hidden" />
        </div>
        {/* TITLE — line-clamp-2 text-sm/leading-snug, 19px per line. Two lines
            everywhere but the widest card: a grid ROW is as tall as its tallest
            card, and below xl most rows contain a wrapped title. */}
        <div className="flex flex-col gap-px">
          <Skeleton className="h-[19px] w-full" />
          <Skeleton className="h-[19px] w-3/5 xl:hidden" />
        </div>
        {/* META — one text-2xs line under the real row's pt-1 (4px). */}
        <Skeleton className="mt-1 h-[15px] w-1/2" />
      </div>
    </div>
  )
}
