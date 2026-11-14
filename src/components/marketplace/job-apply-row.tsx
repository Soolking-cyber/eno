import type { ReactNode } from 'react'
import { JOB_APPLY_CELL, JOB_APPLY_ROW } from '@/lib/job-sheet'

/**
 * A linked job's Apply with Save beside it, below md (owner-approved 2026-11-14, cook r06 jobs; src/lib/job-sheet.ts): the apply
 * block (JobApplyGuard → AffiliateBooking: the button and its one caption) takes the row's width less Save's 48px, Save is
 * top-aligned beside the button, and both wrappers are `md:contents`, so from md `#contact` holds exactly what it holds today.
 * ⚠️ SAVE IS A SIBLING OF THE GUARD, NEVER INSIDE IT: JobApplyGuard swaps its children for the closed notice after mount, and
 * Save must stay beside that notice. Any other page passes `job={false}` and gets its children untouched — no wrapper at all.
 * A server component (no state): it only places what it is handed.
 */
export function JobApplyRow({ job, save, children }: { job: boolean; save: ReactNode; children: ReactNode }) {
  if (!job) return <>{children}</>
  return (
    <div className={JOB_APPLY_ROW}>
      <div className={JOB_APPLY_CELL}>{children}</div>
      {save}
    </div>
  )
}
