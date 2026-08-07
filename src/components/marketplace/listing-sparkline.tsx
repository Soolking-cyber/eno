'use client'

import { useLanguage } from '@/context/language-context'
import { STROKE_DISPLAY } from '@/lib/icon-tokens'

const DAY_MS = 86_400_000
const WINDOW_DAYS = 14
// Fixed drawing box (scaled by w-20 h-6). 2px inset keeps the stroke + lead
// dots from clipping at the edges.
const W = 80
const H = 24
const PAD = 2

export type SparkPoint = { day: string; views: number; leads: number }

/** Tiny inline-SVG 14-day trend for one listing: views as a line (currentColor,
 *  colored by the wrapper's text token), leads as brand-filled dots on the days
 *  they happened. The series is SPARSE (only days the cron wrote a row) — it's
 *  re-projected onto a fixed 14-day window ending today, missing days = 0, so
 *  every sparkline in the list is shape-comparable. Pure SVG, no deps, flat
 *  (no background) per one-canvas. Decorative: aria-hidden, with a plain title
 *  tooltip for the curious hover. */
export function ListingSparkline({ series, className }: { series: SparkPoint[]; className?: string }) {
  const { tr } = useLanguage()

  // Fixed 14-day window ending today (UTC days — matches the cron's CURRENT_DATE).
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const byDay = new Map(series.map((p) => [p.day, p]))
  const points: SparkPoint[] = []
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const day = new Date(today.getTime() - i * DAY_MS).toISOString().slice(0, 10)
    points.push(byDay.get(day) ?? { day, views: 0, leads: 0 })
  }

  const max = Math.max(1, ...points.map((p) => p.views))
  const x = (i: number) => PAD + (i / (WINDOW_DAYS - 1)) * (W - PAD * 2)
  // All-zeros still draws a flat baseline along the bottom (y(0) = H - PAD).
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2)
  const line = points.map((p, i) => `${x(i)},${y(p.views)}`).join(' ')

  return (
    <span title={tr('Views, last 14 days', 'Lượt xem 14 ngày qua')} className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-6 w-20 text-ink-4" aria-hidden="true" focusable="false">
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.6"
          strokeWidth={STROKE_DISPLAY} // §2 data tier — a chart line is never chrome-weight
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((p, i) =>
          p.leads > 0 ? <circle key={p.day} cx={x(i)} cy={y(p.views)} r="2" className="fill-brand" /> : null,
        )}
      </svg>
    </span>
  )
}
