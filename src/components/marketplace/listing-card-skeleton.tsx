import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** The one loading placeholder for a listing card — photo + title/price/location
 *  bars, exactly the real card's shape so nothing shifts when data lands (CLS
 *  invariant). Wrappers own width/snap classes; this owns the inner stack.
 *  Was hand-rolled in 6 places with drifting bar counts. */
export function ListingCardSkeleton({ className }: { className?: string }) {
  return (
    // Structural PARITY with ListingCard's meta stack (perf Phase 1): price line
    // (text-lg), two title lines (text-sm line-clamp-2), location line (text-2xs).
    // The old 3 thin bars ran ~40px short, so every rail GREW when data landed —
    // measured as the homepage's dominant CLS.
    // ⚠️ The photo box is aspect-SQUARE and must stay identical to ListingCard's
    // (owner 2026-07-21: cards are square, no odd ratios). Five places share this
    // ratio and must move together or CLS regresses: listing-card, this skeleton,
    // seo-landing, the wizard Preview, and capacitor/www/index.html's .ph.
    <div className={cn('space-y-3', className)}>
      <div className="aspect-square w-full rounded-xl shimmer skeleton-photo" />
      <div>
        <Skeleton className="h-[22px] w-1/2" />
        <div className="mt-2 space-y-1.5">
          <Skeleton className="h-[15px] w-full" />
          <Skeleton className="h-[15px] w-2/3" />
        </div>
        <Skeleton className="mt-2 h-3 w-1/3" />
      </div>
    </div>
  )
}
