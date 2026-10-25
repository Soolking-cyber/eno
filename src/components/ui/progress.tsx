'use client'

import { Progress as BaseProgress } from '@base-ui/react/progress'
import { cn } from '@/lib/utils'

/**
 * A thin progress bar on Base UI Progress (role="progressbar", aria-valuenow/min/max, the label wired) — design-language
 * §5's order: Base UI first. ADDED WITH ITS FIRST CALL SITE (eno Classroom's session countdown, 2026-10-25), as §5 asks.
 * Copy-free like the rest of ui/*: the caller names it (`aria-label`) and says what the value means (`valueText`).
 * `tone="onDark"` for a dark full-screen surface (the session screen), where the track must read on brand-deeper.
 */
export function Progress({
  value,
  max = 100,
  valueText,
  tone = 'default',
  className,
  'aria-label': ariaLabel,
}: {
  value: number
  max?: number
  /** What a screen reader announces instead of a bare percentage ("3 minutes left"). */
  valueText?: string
  tone?: 'default' | 'onDark'
  className?: string
  'aria-label': string
}) {
  return (
    <BaseProgress.Root value={value} max={max} aria-label={ariaLabel} getAriaValueText={valueText ? () => valueText : undefined} className={cn('w-full', className)}>
      <BaseProgress.Track className={cn('h-1 w-full overflow-hidden rounded-full', tone === 'onDark' ? 'bg-primary-foreground/20' : 'bg-tint')}>
        <BaseProgress.Indicator
          className={cn(
            'block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none',
            tone === 'onDark' ? 'bg-primary-foreground' : 'bg-brand',
          )}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  )
}
