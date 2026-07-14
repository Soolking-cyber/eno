'use client'

import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'

// Shared toggle switch — Base UI's Switch (role="switch" + a hidden input beside it) so we get the
// real semantics for free: Space/Enter activation, form + Field integration, disabled that actually
// blocks interaction, and correct touch behaviour. We keep two hard-won details from the hand-rolled
// version:
//
//  1. The thumb is positioned with `left`, NOT translate-x. A transform-positioned thumb mispositions
//     inside CSS multi-column layouts (the Settings page). Do not "modernise" this to translate-x.
//  2. A keyboard focus ring.
//
// On/off is styled off Base UI's `data-checked`, which is a BARE attribute — so Tailwind's stock
// `data-checked:` shorthand compiles to `[data-checked]` and matches. (Contrast `data-orientation="vertical"`,
// a VALUED attribute, which is why the separator needed an explicit @custom-variant. No custom-variant
// is needed here.) Bonus: `.data-checked\:bg-primary[data-checked]` is class+attribute specificity, so it
// beats the plain `bg-input` base regardless of stylesheet order.
const SIZES = {
  sm: {
    track: 'h-5 w-9',
    thumb: 'h-4 w-4 left-0.5 data-checked:left-[18px]',
  },
  md: {
    track: 'h-6 w-11',
    thumb: 'h-5 w-5 left-0.5 data-checked:left-[22px]',
  },
} as const

export function Switch({
  checked,
  onChange,
  label,
  size = 'md',
  disabled,
  className,
  thumbClassName,
  children,
  ...props
}: {
  checked: boolean
  /** Optional so a locked/read-only row can't fire an undefined handler. */
  onChange?: (next: boolean) => void
  label?: string
  size?: keyof typeof SIZES
  disabled?: boolean
  className?: string
  /** Extra classes for the thumb — e.g. to tune a glyph's colour. */
  thumbClassName?: string
  /** Rendered INSIDE the thumb (a Sun/Moon glyph, a check, …). Centred; empty by default. */
  children?: React.ReactNode
} & Omit<
  React.ComponentPropsWithoutRef<typeof BaseSwitch.Root>,
  'checked' | 'onChange' | 'onCheckedChange' | 'disabled' | 'className' | 'children'
>) {
  const s = SIZES[size]
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={(next) => onChange?.(next)}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'inline-flex relative shrink-0 cursor-pointer rounded-full bg-input outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'data-checked:bg-primary',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        s.track,
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          'absolute top-0.5 flex items-center justify-center rounded-full bg-white shadow transition-[left]',
          s.thumb,
          thumbClassName,
        )}
      >
        {children}
      </BaseSwitch.Thumb>
    </BaseSwitch.Root>
  )
}
