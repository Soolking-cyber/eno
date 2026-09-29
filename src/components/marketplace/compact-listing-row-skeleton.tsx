import { Skeleton } from '@/components/ui/skeleton'

/** The ONE placeholder for <CompactListingRow> (the list/compact view's row).
 *
 *  ⚠️ It exists as its own module because it has two callers that must not disagree:
 *  next/dynamic's `loading:` for the row's lazy chunk, and the explorer's first-page
 *  loading state — and until 2026-08-07 those were two hand-rolled copies in one file
 *  that had already drifted apart (`p-2` around an unrounded `h-16 w-20` thumb plus a
 *  phantom right-hand block, against the real row's `p-1.5 pr-1` and `h-14 w-16
 *  rounded-lg` AS IT WAS THEN — see the ⚠️ below for what those two numbers are now).
 *  It cannot live in compact-listing-row.tsx: importing it from there
 *  would pull the real row's chunk in eagerly and defeat the lazy split it stands in for.
 *
 *  Geometry, measured against a rendered row (2026-09-29, list view, en and vi):
 *    p-1.5 (6+6) around the TEXT COLUMN, which now sets the height: a two-line title
 *    (line-clamp-2 text-sm/leading-snug = 2 × 19.25px) + mt-0.5 + a 24px text-base price
 *    line, and below sm a mt-0.5 + 16px place · time line → 94.5px on a phone, 76.5px from
 *    sm up; this placeholder measures the same 94.5 / 76.5 laid out beside a real row. The
 *    56px thumbnail is shorter than that column now. The action cluster on the right is
 *    chrome, not content, and never affects the row box.
 *  ⚠️ TWO TITLE LINES ARE RESERVED BECAUSE TWO IS WHAT MOST ROWS RENDER: 23 of 24 rows at
 *    390px, 57 of 84 at 1440px (a one-line title makes a 75px / 68px row). A one-line
 *    reserve would be wrong for the common row, which is the one a CLS budget sees.
 *
 *  ⚠️ THE THUMB IS SQUARE AND THAT IS THE THIRD TIME THESE TWO NUMBERS HAVE MOVED. It was
 *  `w-16` here and in the real row until 2026-08-12, when the owner asked for every product
 *  image to be square; the width came down to match the height so the row stayed 68px. The
 *  drift this file exists to prevent is CLS, so a width that disagrees with the real row is
 *  exactly the bug — copy the real row's two classes, do not re-derive them. */
export function CompactListingRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl p-1.5 pr-1">
      <Skeleton className="h-14 w-14 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        {/* title — line-clamp-2 text-sm/leading-snug, two 19.25px lines (38.5px) */}
        <div className="flex h-[38.5px] flex-col justify-between">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        {/* meta line — its tallest child is the text-base bold price (24px box) */}
        <Skeleton className="mt-0.5 h-6 w-2/5" />
        {/* phones only — the place · time line (text-xs, a 16px line box) */}
        <Skeleton className="mt-0.5 h-4 w-1/3 sm:hidden" />
      </div>
    </div>
  )
}

/** The compact view's own container — a single column on mobile, two on desktop, at
 *  the real `gap-y-1.5` rhythm. Kept beside the row so a loading state cannot reproduce
 *  the row correctly inside the wrong grid (the old one stacked six rows in a
 *  `space-y-2` single column, which was a whole extra screen of height on desktop). */
export const COMPACT_LIST_GRID = 'grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1.5'
