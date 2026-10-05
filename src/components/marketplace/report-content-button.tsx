'use client'

import { useState } from 'react'
import { Flag } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { ReportButton } from '@/components/marketplace/report-button'
import { useLanguage } from '@/context/language-context'
import { appReviewGate } from '@/lib/app-review-gates'
import { cn } from '@/lib/utils'
import type { ContentKind } from '@/lib/reported-content-pointer'

/**
 * "Report" on ONE piece of user content — a seller review, a help-centre comment, a member's help post
 * (App Store Guideline 1.2, plan R5). Renders NOTHING unless the `ugc-safety` review gate is on.
 *
 * It files into the same pipeline as every Report (POST /api/report → /admin/moderation), as a CONTENT
 * case: the server resolves the author and never makes them, or the reviewed shop, the report's target
 * (src/lib/reported-content.ts says why).
 *
 * ⚠️ THE DIALOG MOUNTS ONLY WHEN ASKED FOR. A storefront lists every review and a help thread every
 * reply; one <ReportButton> per row would be one Base UI dialog root per row for a control that is almost
 * never opened — the reason the chat thread keeps ONE controlled instance (report-button.tsx). Here each
 * row is a plain button, and the controlled dialog exists only between its tap and its close.
 *
 * Styled as the quiet per-item variant of Report: muted ink at rest, the destructive ink on hover, so a
 * list of reviews does not read as a column of red flags.
 */
export function ReportContentButton({ kind, id, className }: { kind: ContentKind; id: string; className?: string }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  if (!appReviewGate('ugc-safety')) return null
  const target = kind === 'review' ? { reviewId: id } : kind === 'help-comment' ? { commentId: id } : { postId: id }
  return (
    <>
      <Button
        type="button"
        variant="bare"
        size="none"
        onClick={() => setOpen(true)}
        className={cn(
          'relative tap-44 gap-1 rounded-full px-2 py-1 text-2xs font-semibold text-ink-4 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40',
          className,
        )}
      >
        <Flag className="size-3" aria-hidden /> {tr('Report', 'Báo cáo')}
      </Button>
      {open && <ReportButton {...target} open onOpenChange={setOpen} />}
    </>
  )
}
