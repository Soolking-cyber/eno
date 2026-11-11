'use client'

import { Meter as BaseMeter } from '@base-ui/react/meter'
import { cn } from '@/lib/utils'

/**
 * A thin MEASURE bar on Base UI Meter (role="meter", aria-valuenow/min/max) — a score on a known scale, not a task's
 * progress (that is ui/progress). ADDED WITH ITS FIRST CALL SITE (eno Classroom's report, 2026-11-11: "78 /100" with a bar),
 * as design-language §5 asks. Copy-free like the rest of ui/*: the caller names it (`aria-label`) and may say what the
 * value means (`valueText`).
 */
export function Meter({
  value,
  min = 0,
  max = 100,
  valueText,
  className,
  'aria-label': ariaLabel,
}: {
  value: number
  min?: number
  max?: number
  /** What a screen reader announces instead of a bare percentage ("78 out of 100"). */
  valueText?: string
  className?: string
  'aria-label': string
}) {
  return (
    <BaseMeter.Root value={value} min={min} max={max} aria-label={ariaLabel} getAriaValueText={valueText ? () => valueText : undefined} className={cn('w-full', className)}>
      <BaseMeter.Track className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
        <BaseMeter.Indicator className="block h-full rounded-full bg-brand" />
      </BaseMeter.Track>
    </BaseMeter.Root>
  )
}
