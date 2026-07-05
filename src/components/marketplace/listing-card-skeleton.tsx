import { cn } from '@/lib/utils'

/** The one loading placeholder for a listing card — photo + title/price/location
 *  bars, exactly the real card's shape so nothing shifts when data lands (CLS
 *  invariant). Wrappers own width/snap classes; this owns the inner stack.
 *  Was hand-rolled in 6 places with drifting bar counts. */
export function ListingCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="aspect-[4/3] w-full rounded-xl shimmer skeleton-photo" />
      <div className="h-4 w-2/3 rounded shimmer" />
      <div className="h-3 w-1/2 rounded shimmer" />
      <div className="h-3 w-1/3 rounded shimmer" />
    </div>
  )
}
