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
 *  gap-0.5 px-0.5 pt-2` (listing-card.tsx, the body div). It used to be `space-y-3` with
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
      {/* Mirrors the Facebook-Marketplace-shaped card body (2026-09-13): one price line, ONE title
          line, one info line. Heights are the real line boxes — re-measure against the card if
          any of its type sizes change. */}
      <div className="flex flex-col gap-0.5 px-0.5 pt-2">
        {/* PRICE — text-base/leading-tight below sm (20px), text-lg above (22.5px). No second
            line reserved any more: the "≈ $…" slot that used to wrap is gone from cards. */}
        <Skeleton className="h-[20px] w-1/2 sm:h-[23px]" />
        {/* TITLE — `truncate` text-sm/leading-snug, one 19px line. */}
        <Skeleton className="h-[19px] w-4/5" />
        {/* META — the unchanged info line: one text-2xs line under the real row's pt-1 (4px). */}
        <Skeleton className="mt-1 h-[15px] w-1/2" />
      </div>
    </div>
  )
}
