'use client'

import { cn } from '@/lib/utils'

/** THE slider primitive — the single slider in the app. Don't re-roll a raw
 *  <input type="range">; import this instead (exported as both `Slider` and
 *  the legacy name `EnoSlider`).
 *
 *  Single-handle slider with the app's shared look (white thumb + brand-blue ring
 *  on a blue fill) — same style as the price-range histogram slider. Used for the
 *  search-radius and make-an-offer sliders so every slider matches. */
export function Slider({
  value, min, max, step = 1, onChange, className, 'aria-label': ariaLabel,
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  className?: string
  'aria-label'?: string
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <div className={cn('relative h-5', className)}>
      <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-muted" />
      <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      <input
        type="range"
        className="eno-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
      />
    </div>
  )
}

export { Slider as EnoSlider }
