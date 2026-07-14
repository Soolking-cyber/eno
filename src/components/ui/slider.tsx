'use client'

import { Slider as BaseSlider } from '@base-ui/react/slider'

import { cn } from '@/lib/utils'

/** THE slider primitive — the single slider in the app. Don't re-roll a raw
 *  <input type="range">; import this instead (exported as both `Slider` and
 *  the legacy name `EnoSlider`).
 *
 *  Single-handle slider with the app's shared look (white thumb + brand-blue ring
 *  on a blue fill) — same style as the price-range histogram slider. Used for the
 *  search-radius and make-an-offer sliders so every slider matches.
 *
 *  Built on Base UI's Slider (Root › Control › Track › Indicator › Thumb), which
 *  brings the real thing the raw <input type="range"> only half-had: arrow/Home/End/
 *  PageUp/PageDown keys, pointer-capture touch dragging, and full ARIA on a nested
 *  range input. The look is a verbatim port of the old `.eno-slider` CSS:
 *    Track     = the grey rail   (was the absolutely-positioned bg-muted div)
 *    Indicator = the blue fill   (was the bg-primary div sized by an inline width %)
 *    Thumb     = the white handle (was ::-webkit-slider-thumb / ::-moz-range-thumb)
 *
 *  ⚠️ `touch-none` on the Control is load-bearing, not decoration: Base UI drags via
 *  pointer capture, so without it a touch-drag is stolen by the page's scroll gesture
 *  and the slider simply doesn't move on mobile. The native input handled that itself.
 *
 *  ⚠️ `thumbAlignment="edge"` keeps the handle inset inside the rail at min/max — the
 *  native input's behaviour. The default (`center`) would hang half the thumb outside
 *  the track at both ends, which is not what the six call sites render today. */
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
  return (
    <BaseSlider.Root
      value={value}
      onValueChange={(v: number) => onChange(v)}
      min={min}
      max={max}
      step={step}
      thumbAlignment="edge"
      className={cn('relative h-5', className)}
    >
      {/* The whole 20px-tall band is the hit area — same as the old input, which was
          absolutely stretched to 100% × 100% of the wrapper. */}
      <BaseSlider.Control className="flex h-full w-full touch-none items-center select-none">
        <BaseSlider.Track className="relative h-1 w-full rounded-full bg-muted">
          {/* Base UI sizes this itself (width: var(--start-position); height: inherit),
              so it needs no positioning class — only the paint. */}
          <BaseSlider.Indicator className="rounded-full bg-primary" />
          <BaseSlider.Thumb
            aria-label={ariaLabel}
            className="eno-thumb"
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}

export { Slider as EnoSlider }
