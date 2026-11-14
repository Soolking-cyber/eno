'use client'

import { useEffect, useState } from 'react'
import { Tr, useLanguage } from '@/context/language-context'
import { fillTemplate } from '@/lib/i18n/placeholders'
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
 * ⛔ ONE CAPTION UNDER A LINKED JOB'S APPLY BUTTON (UI climb batch 95, owner-approved 2026-11-14, decision 3, "the job page
 * says it once"; mock variants13/d2c3): "careers.nordanglia.com · closes 17 Nov (5 days)" / "careers.nordanglia.com · hạn
 * 17/11 (còn 5 ngày)" — the site Apply opens, then the deadline. It replaces two lines: JobApplyBy's "Apply by 17 Nov 2026 ·
 * 5 days left" and the buy box's "Opens careers.nordanglia.com", which sat on ITS OWN line (2026-11-10) only because the
 * countdown, arriving after mount, wrapped the shared line one frame after load.
 *
 * ⚠️ THE DATE IS SERVER-SAFE, THE COUNTDOWN IS NOT, AND THEY ARE SPLIT ON EXACTLY THAT LINE. The page is ISR-cached for 30 days,
 * so the first render prints only what the cached HTML can know: the host, and the day itself, formatted with no clock and no
 * Intl (calendar-day.ts), identical on the server and in hydration. Its YEAR is the caller's, decided from data
 * (`year`: page.tsx prints it when the posting's day is in another year), never from the clock.
 * ⛔ AND THE COUNTDOWN CELL HAS ITS WIDTH FROM THE FIRST RENDER, which is what lets the two lines become one: an inline grid
 * whose cell holds, invisible and aria-hidden, the two widest things it can ever say — "(14 days)" (n is only 2..14, tabular
 * figures) and "(today)" — so the real text, '' until mount and then one of those shapes, never widens the line or wraps
 * it. The weight never changes either: the last three days turn the deadline warning-ink, colour only. Shown only in the
 * final fortnight, where it changes a decision; "(today)" on the last day.
 * Renders nothing with neither a host nor a well-formed date; a PAST date never reaches here, because JobApplyGuard has
 * already replaced the whole block with its closed notice.
 */
export function JobApplyLine({ applyBy, host, year = true, className }: { applyBy: string | null; host: string | null; year?: boolean; className?: string }) {
  const { tr, lang } = useLanguage()
  const mounted = useMounted()
  const date = applyBy && ISO_DAY.test(applyBy) ? applyBy : null
  if (!date && !host) return null
  // End of that day in Vietnam, where every one of these jobs is — the same instant JobApplyGuard uses.
  const days = date && mounted ? Math.ceil((Date.parse(`${date}T23:59:59+07:00`) - Date.now()) / 86_400_000) : null
  const counting = days != null && days >= 1 && days <= 14
  const urgent = counting && days <= 3
  // The literals stay inside tr(): scripts/gen-ui-strings.mjs harvests quoted arguments only.
  const daysLeft = (n: number) => fillTemplate(tr('({n} days)', '(còn {n} ngày)'), '({n} days)', { n: String(n) })
  const today = tr('(today)', '(hôm nay)')
  const count = !counting ? '' : days <= 1 ? today : daysLeft(days)
  // 14px from lg (2026-11-07 audit), with the other notes under a desktop's CTA; a phone keeps 12px. A long host breaks
  // anywhere rather than overflow (rmit.wd3.myworkdayjobs.com).
  return (
    <p className={cn('text-xs text-body lg:text-sm [overflow-wrap:anywhere]', className)}>
      {host}
      {host && date ? ' · ' : null}
      {date ? (
        <span className={urgent ? 'text-warning' : undefined}>
          {tr('closes', 'hạn')} <time dateTime={date}>{formatCalendarDay(date, lang, { year })}</time>{' '}
          <span data-job-countdown="" className="inline-grid tabular-nums">
            <span aria-hidden className="invisible [grid-area:1/1]">{daysLeft(14)}</span>
            <span aria-hidden className="invisible [grid-area:1/1]">{today}</span>
            <span className="[grid-area:1/1]">{count}</span>
          </span>
        </span>
      ) : null}
    </p>
  )
}
