'use client'

import { type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'

/** THE dual-thumb range slider primitive — sibling of `<Slider>` (single handle).
 *  Don't re-roll the two-stacked-`<input type="range">` pattern; import this.
 *
 *  Lifted verbatim from the two hand-rolled copies (price-range-filter,
 *  range-facet-control), whose contract is subtler than it looks:
 *
 *  1. The two inputs are absolutely stacked over the SAME track and carry
 *     `.eno-range` (globals.css), which sets `pointer-events: none` on the input
 *     and `pointer-events: auto` on the ::-webkit-slider-thumb / ::-moz-range-thumb.
 *     That is what lets BOTH thumbs be grabbable despite overlapping: a press lands
 *     on whichever thumb is under the finger, and passes through the dead input
 *     body otherwise. Remove it and the top input swallows every drag.
 *  2. Because the inputs are pointer-transparent, a bare click on the track would
 *     do nothing — so the track itself handles `onPointerDown` and jumps the NEAREST
 *     thumb. The `tagName === 'INPUT'` guard is load-bearing: without it a press that
 *     started on a THUMB would also be treated as a track click and yank the other
 *     thumb to the cursor.
 *  3. The values may not cross: lo is clamped to <= hi, hi to >= lo, on every path.
 *
 *  `onChange` fires live during the drag (cheap: local state). `onCommit` fires when
 *  the interaction settles — pointer-up, key-up, or a track jump — and is where the
 *  expensive work belongs (URL writes, refetches), matching what both call sites do
 *  today. Styling mirrors `ui/slider.tsx` so the two read as one family.
 */
export function RangeSlider({
  value, min, max, step = 1, onChange, onCommit, className, 'aria-label': ariaLabel,
}: {
  value: [number, number]
  min: number
  max: number
  step?: number
  onChange: (value: [number, number]) => void
  /** Settle callback: pointer-up / key-up / track jump. */
  onCommit?: (value: [number, number]) => void
  className?: string
  /** [minLabel, maxLabel] — one per thumb. */
  'aria-label'?: [string, string]
}) {
  const [lo, hi] = value
  // Snap a raw track position the way the call sites do: to a tenth when the step is
  // fractional (year/engine facets use step 0.1), to a whole number otherwise.
  const round = (n: number) => (step < 1 ? Math.round(n * 10) / 10 : Math.round(n))
  const span = Math.max(step, max - min)
  const pct = (v: number) => ((v - min) / span) * 100

  const settle = (next: [number, number]) => { onChange(next); onCommit?.(next) }

  // Click anywhere on the track → jump the NEAREST thumb to that point. See (2) above:
  // the tagName guard hands a press that landed on a thumb back to the native drag.
  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width) return
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const v = round(min + f * (max - min))
    if (v <= lo) settle([v, hi])
    else if (v >= hi) settle([lo, v])
    else if (v - lo <= hi - v) settle([v, hi])
    else settle([lo, v])
  }

  return (
    <div className={cn('relative h-5 cursor-pointer', className)} onPointerDown={onTrackDown}>
      <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-muted" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
        style={{ left: `${pct(lo)}%`, width: `${Math.max(0, pct(hi) - pct(lo))}%` }}
      />
      <input
        type="range" className="eno-range" aria-label={ariaLabel?.[0]}
        min={min} max={max} step={step} value={lo}
        onChange={(e) => onChange([Math.min(round(Number(e.target.value)), hi), hi])}
        onPointerUp={() => onCommit?.([lo, hi])} onKeyUp={() => onCommit?.([lo, hi])}
      />
      <input
        type="range" className="eno-range" aria-label={ariaLabel?.[1]}
        min={min} max={max} step={step} value={hi}
        onChange={(e) => onChange([lo, Math.max(round(Number(e.target.value)), lo)])}
        onPointerUp={() => onCommit?.([lo, hi])} onKeyUp={() => onCommit?.([lo, hi])}
      />
    </div>
  )
}
