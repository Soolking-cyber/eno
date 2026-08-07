import { Skeleton } from '@/components/ui/skeleton'

/** The ONE placeholder for <CompactListingRow> (the list/compact view's row).
 *
 *  ⚠️ It exists as its own module because it has two callers that must not disagree:
 *  next/dynamic's `loading:` for the row's lazy chunk, and the explorer's first-page
 *  loading state — and until 2026-08-07 those were two hand-rolled copies in one file
 *  that had already drifted apart (`p-2` around an unrounded `h-16 w-20` thumb plus a
 *  phantom right-hand block, against the real row's `p-1.5 pr-1` and `h-14 w-16
 *  rounded-lg`). It cannot live in compact-listing-row.tsx: importing it from there
 *  would pull the real row's chunk in eagerly and defeat the lazy split it stands in for.
 *
 *  Geometry, measured against a rendered row (68px tall at every breakpoint):
 *    p-1.5 (6+6) + a 56px thumbnail, which is what sets the height — the text column
 *    is shorter (19px title + mt-0.5 + a 24px text-base price line = 45px). The action
 *    cluster on the right is chrome, not content, and never affects the row box. */
export function CompactListingRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl p-1.5 pr-1">
      <Skeleton className="h-14 w-16 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        {/* title — truncate text-sm/leading-snug, one 19px line */}
        <Skeleton className="h-[19px] w-3/4" />
        {/* meta line — its tallest child is the text-base bold price (24px box) */}
        <Skeleton className="mt-0.5 h-6 w-2/5" />
      </div>
    </div>
  )
}

/** The compact view's own container — a single column on mobile, two on desktop, at
 *  the real `gap-y-1.5` rhythm. Kept beside the row so a loading state cannot reproduce
 *  the row correctly inside the wrong grid (the old one stacked six rows in a
 *  `space-y-2` single column, which was a whole extra screen of height on desktop). */
export const COMPACT_LIST_GRID = 'grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1.5'
