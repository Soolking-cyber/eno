'use client'

import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group'
import { Radio as BaseRadio } from '@base-ui/react/radio'
import { cn } from '@/lib/utils'
import { hapticTap } from '@/lib/haptics'

// iOS/Material SEGMENTED CONTROL — a single-select control styled as connected segments with ONE
// sliding pill under the labels. Built on Base UI RadioGroup + Radio so it inherits real a11y for
// free: role="radiogroup", role="radio" + aria-checked per item, roving tabindex (the whole control
// is ONE tab stop), and ←→/↑↓ arrow-key selection. Use it where a small, FIXED set of mutually
// exclusive choices reads better as a native segmented control than as tabs or chips — e.g. a
// listing-status filter (active/sold/hidden) or an account-type choice.
//
// ⚠️ RE-SELECTING THE CURRENT SEGMENT IS A NO-OP (the radio contract — Base UI drives change off the
// hidden input's onChange, which doesn't fire for an already-checked radio), so onValueChange never
// re-fires for the value already shown. That is correct here (a filter shouldn't re-run on a stray
// tap of the active segment). If you need tap-to-clear, you want toggle buttons, not this.
//
// Native feel, deliberately restrained (dashboard native-feel review, codex+Gemini: haptics should
// be a deliberate signal, not universal): the pill slides on --ease-spring-snappy, motion-safe only;
// a SINGLE hapticTap fires per real change (a segmented selection is exactly the kind of discrete
// toggle iOS gives selection feedback for), guarded so re-selecting the current value stays silent.

export type SegmentedOption<T extends string> = {
  value: T
  label: React.ReactNode
}

export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  'aria-label': ariaLabel,
}: {
  value: T
  onValueChange: (value: T) => void
  options: SegmentedOption<T>[]
  className?: string
  /** Name the control — an unnamed radiogroup is announced with no context. */
  'aria-label': string
}) {
  const count = Math.max(1, options.length)
  const index = Math.max(0, options.findIndex((o) => o.value === value))

  return (
    <BaseRadioGroup
      value={value}
      onValueChange={(next) => {
        if (next !== value) {
          hapticTap()
          onValueChange(next as T)
        }
      }}
      aria-label={ariaLabel}
      className={cn('relative isolate grid w-full rounded-xl bg-tint p-1', className)}
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {/* The single sliding selected pill. One element, spring-eased, motion-safe (no slide when the
          viewer prefers reduced motion). Width = one segment of the inner track (the p-1 = 0.5rem of
          total horizontal padding); translateX by whole segment widths keeps it grid-aligned. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 -z-10 rounded-lg bg-card shadow-sm motion-safe:transition-transform"
        style={{
          width: `calc((100% - 0.5rem) / ${count})`,
          transform: `translateX(${index * 100}%)`,
          transitionTimingFunction: 'var(--ease-spring-snappy)',
          transitionDuration: '200ms',
        }}
      />
      {options.map((option) => (
        <BaseRadio.Root
          key={option.value}
          value={option.value}
          className={cn(
            'relative flex h-9 min-w-0 items-center justify-center rounded-lg px-2 text-sm font-semibold',
            'cursor-pointer whitespace-nowrap tap-44 outline-none transition-colors',
            'text-ink-4 data-[checked]:text-foreground',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          )}
        >
          <span className="truncate">{option.label}</span>
        </BaseRadio.Root>
      ))}
    </BaseRadioGroup>
  )
}
