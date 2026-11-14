import { Skeleton } from '@/components/ui/skeleton'

/**
 * THE JOB CARD'S PLACEHOLDER AND ITS LIST (owner-approved 2026-11-14, cook r06 jobs — job-card-row.tsx has the card). A PLAIN
 * MODULE, like compact-listing-row-skeleton.tsx and for the same reason: it is next/dynamic's `loading:` for the card's split
 * chunk on a job page's rails (job-rail-rows.tsx), and importing it from the card's own file would pull that chunk in eagerly.
 *
 * Geometry, from the card's classes (change both or neither): a 1px line-strong border, 16px corners, py-4 (16 + 16) around
 *   · the role, text-t-h3 on a 24px line: TWO lines reserved (48px) — at 17px in a ~290px column most roles wrap once
 *     ("Associate Lecturer/Lecturer, Computing Technologies (hourly)"); the common card is the one a CLS budget sees;
 *   · the slot line, mt-1: a pay tag's 28px box (py-1 around a 20px line), the tallest thing it holds;
 *   · the meta line, mt-1.5: text-t-meta on an 18px line.
 * → 16 + 48 + 4 + 28 + 6 + 18 + 16 + 2 (border) = 138px. The action column (44px boxes pulled into the lines' height) sets nothing.
 */
export function JobCardRowSkeleton() {
  return (
    <div className="rounded-2xl border border-line-strong py-4 pl-4 pr-1">
      <div className="pr-12">
        {/* the role — two 24px lines */}
        <div className="flex h-6 items-center"><Skeleton className="h-4 w-11/12" /></div>
        <div className="flex h-6 items-center"><Skeleton className="h-4 w-3/5" /></div>
      </div>
      {/* the slot line — a 28px tag */}
      <Skeleton className="mt-1 h-7 w-2/5" />
      {/* the meta line — 18px */}
      <div className="mt-1.5 flex h-4.5 items-center"><Skeleton className="h-3 w-1/2" /></div>
    </div>
  )
}

/** The cards' list: one column, 8px between cards (no hairlines — the card is the boundary). */
export const JOB_CARD_LIST = 'grid grid-cols-1 gap-y-2'
