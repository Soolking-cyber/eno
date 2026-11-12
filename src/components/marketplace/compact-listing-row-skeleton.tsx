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
 *  exactly the bug — copy the real row's two classes, do not re-derive them.
 *
 *  ⛔ `job`: A JOB ROW HAS NO THUMBNAIL (batch 78, owner 2026-11-12: "continue the ui ux improvement towards 10/10"; the
 *  note on `job` in compact-listing-row.tsx), so its placeholder has none either, and it carries the job row's own numbers:
 *    `items-start` with py-3 (12+12; no side padding below sm, `sm:pl-1.5 sm:pr-1` from sm) around the text column: ONE
 *    title line (text-base/leading-snug = 22px) + mt-0.5 + the employer line (text-sm, its own 20px leading-5 box), and
 *    below sm a mt-0.5 + 16px place · time · type line → 86px on a phone, 68px from sm up (summed from the classes of
 *    both, not yet measured in a browser). The hairline under it is the list's (`JOB_ROWS_RULED`), as under the real row.
 *    The real row's 36px action buttons rise 6px into its top padding and stay inside the text column's height, so they
 *    set nothing and the placeholder draws none.
 *  ⚠️ ONE TITLE LINE HERE, NOT TWO AS ABOVE, BECAUSE ONE IS WHAT THE COMMON JOB ROW RENDERS: at 16px the role has the whole
 *    width (no 56px tile, no 12px gap beside it), and the usual role ("English Teachers (Kindergarten)", "Primary PE Teacher")
 *    fits it on a 390pt phone. A two-line role makes a 108px row; a linked job with neither pay nor employer, whose slot line
 *    is left out, a 64px one. Use it wherever EVERY row is a job (the Jobs page's phone list, a job page's rails). */
export function CompactListingRowSkeleton({ job = false }: { job?: boolean } = {}) {
  if (job) {
    return (
      <div className="flex items-start gap-2 py-3 sm:pl-1.5 sm:pr-1">
        <div className="min-w-0 flex-1">
          {/* the role — text-base/leading-snug, one 22px line */}
          <div className="flex h-5.5 items-center"><Skeleton className="h-4 w-4/5" /></div>
          {/* the employer (or the salary) — text-sm in a 20px box */}
          <div className="mt-0.5 flex h-5 items-center"><Skeleton className="h-3.5 w-2/5" /></div>
          {/* phones only — the place · time · type line (text-xs, a 16px line box) */}
          <Skeleton className="mt-0.5 h-4 w-1/2 sm:hidden" />
        </div>
      </div>
    )
  }
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

/** Added to COMPACT_LIST_GRID (`cn(COMPACT_LIST_GRID, JOB_ROWS_RULED)`, so the gap-y-0 wins) where EVERY row is a job:
 *  the Jobs page's phone list (seller-listings.tsx `phoneRow`), the explorer's list while jobs are on screen, a job page's
 *  rails (job-rail-rows.tsx). Batch 78 (owner 2026-11-12, "continue the ui ux improvement towards 10/10"; A/B codex
 *  7.07 → 7.46, Opus 6.60 → 7.15): jobs are separated by the canon's hairline, not by a gap (docs/design-language.md §3b,
 *  owner 2026-07-24: "lines between elements … almost no boxes"), with the row's own 12px above and below the text.
 *  · A LINE UNDER EVERY ITEM, the last one included, and drawn on the GRID ITEM (`*:`), not on the row: a grid item is
 *    stretched to its grid row, so in the explorer's two desktop columns the two lines of one grid row meet at one height
 *    even when one role wraps and the other does not. The rows' placeholders sit in the same items and get the same line.
 *  · `[&>.border-t]:border-t-0`: a full-width band that draws its own top hairline (the guest sign-up row, capture-card.tsx
 *    `border-t … not-last:border-b`) would put it under the line of the job above it, a 2px line. The item above already
 *    draws that line. No `:has()`: design-lint's non-subject `:has()` rule, and this list grows on every page.
 *  ⛔ Not on a list that mixes kinds: a job row there draws no line of its own (the note on `job` in compact-listing-row.tsx). */
export const JOB_ROWS_RULED = 'gap-y-0 *:border-b *:border-border [&>.border-t]:border-t-0'
