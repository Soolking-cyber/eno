'use client'

import { useEffect, useState } from 'react'
import { Tr, useLanguage } from '@/context/language-context'
import { useMounted } from '@/hooks/use-mounted'
import { formatCalendarDay } from '@/lib/calendar-day'
import { cn } from '@/lib/utils'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A job reference listing's Apply button, CLOSED ON THE CLIENT once the posting's apply-by date has
 * passed.
 *
 * ⛔ CLIENT-SIDE ON PURPOSE. The PDP is ISR-cached for 30 days and the jobs importer is a script,
 * which cannot revalidate it (no Next runtime). A server-side date check would be frozen into the
 * cached HTML and keep a live "Apply" link on a closed job for up to a month. The date travels in the
 * cached markup; the comparison runs at view time. The importer also hides expired rows, which takes
 * them out of feeds and search (those read live) — this covers the cached page in between.
 *
 * ⚠️ Starts OPEN and closes in an effect, so server and client render the same first frame (no
 * hydration mismatch); a closed job flips within a frame of hydrating.
 */
export function JobApplyGuard({ applyBy, children, closed: closedView }: {
  applyBy: string | null
  children: React.ReactNode
  /** What a closed job shows instead. Default: the closed notice. The PDP's in-flow CTA repeat passes
   *  null — the buy box already says the job has closed, once is enough. */
  closed?: React.ReactNode
}) {
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    if (!applyBy || !ISO_DAY.test(applyBy)) return
    // End of that day in Vietnam, where every one of these jobs is.
    const end = Date.parse(`${applyBy}T23:59:59+07:00`)
    if (Number.isFinite(end) && Date.now() > end) setClosed(true)
  }, [applyBy])
  if (closed) {
    if (closedView !== undefined) return <>{closedView}</>
    return (
      <p className="text-sm font-medium text-body">
        <Tr text="This job has closed — the posting is no longer taking applications." />
      </p>
    )
  }
  return <>{children}</>
}

/**
 * 'Apply by 8 Oct 2026 · 9 days left' — the deadline, right under the Apply button, instead of only as
 * a raw 'Apply By: 2026-10-08' row at the bottom of Details.
 *
 * ⚠️ THE DATE IS SERVER-SAFE, THE COUNTDOWN IS NOT, AND THEY ARE SPLIT ON EXACTLY THAT LINE. The page is
 * ISR-cached for 30 days, so the first render prints only what the cached HTML can know: the day
 * itself, formatted with no clock and no Intl (calendar-day.ts), identical on the server and in
 * hydration. The 'N days left' suffix reads `Date.now()` and appears only after mount — the same
 * two-pass shape as JobApplyGuard above and RelativeTime. It shows only in the final fortnight, where
 * it changes a decision, and turns warning-ink in the last three days.
 * Renders nothing for a missing or malformed date; a PAST date never reaches here, because
 * JobApplyGuard has already replaced the whole block with its closed notice.
 */
export function JobApplyBy({ applyBy, className }: { applyBy: string; className?: string }) {
  const { tr, lang } = useLanguage()
  const mounted = useMounted()
  if (!ISO_DAY.test(applyBy)) return null
  // End of that day in Vietnam, where every one of these jobs is — the same instant JobApplyGuard uses.
  const days = mounted ? Math.ceil((Date.parse(`${applyBy}T23:59:59+07:00`) - Date.now()) / 86_400_000) : null
  const counting = days != null && days >= 1 && days <= 14
  const left = counting
    ? ` · ${days <= 1 ? tr('Last day', 'Hôm nay là hạn cuối') : tr('{n} days left', 'còn {n} ngày').replace('{n}', String(days))}`
    : ''
  const urgent = counting && days <= 3
  return (
    <p className={cn('text-xs text-body', urgent && 'font-semibold text-warning', className)}>
      {tr('Apply by', 'Hạn nộp:')} <time dateTime={applyBy}>{formatCalendarDay(applyBy, lang)}</time>{left}
    </p>
  )
}
