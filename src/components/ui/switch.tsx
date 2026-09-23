'use client'

import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'
import { hapticTap } from '@/lib/haptics'

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
  /**
   * ⛔ THE THUMB TRAVELS BY `transform`, NOT BY `left`. Animating `left` is a LAYOUT property: every
   * frame of a toggle — the most-pressed control in any settings screen — went through layout and
   * paint instead of staying on the compositor. The travel is identical and the arithmetic is
   * exact, so nothing moved: the track is 36px with a 16px thumb resting at `left-0.5` (2px), so
   * checked sits at 36 − 16 − 2 = 18px, i.e. 16px of travel = `translate-x-4`. The md track is 44px
   * with a 20px thumb: 44 − 20 − 2 = 22px, i.e. 20px = `translate-x-5`.
   */
  sm: {
    track: 'h-5 w-9',
    thumb: 'h-4 w-4 left-0.5 data-checked:translate-x-4',
  },
  md: {
    track: 'h-6 w-11',
    thumb: 'h-5 w-5 left-0.5 data-checked:translate-x-5',
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
  // Selection tick on the CHANGE, not on touch — a physical switch clicks when it flips,
  // not when your finger lands. Base UI fires onCheckedChange only for real user
  // interaction (pointer / Space / Enter), never for a controlled `checked` update pushed
  // down by the parent, so a programmatic flip stays silent. No handler = a locked /
  // read-only row where nothing actually changes → no tick there either.
  const handleCheckedChange = (next: boolean) => {
    if (!onChange) return
    hapticTap(10)
    onChange(next)
  }
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={handleCheckedChange}
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
          // ⚠️ A spring, not a linear ramp: a toggle is a physical object and the house `--ease-spring`
          // token is the app's critically-damped curve (Apple's damping 1.0 / response ~0.3).
          'absolute top-0.5 flex items-center justify-center rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-spring)]',
          s.thumb,
          thumbClassName,
        )}
      >
        {children}
      </BaseSwitch.Thumb>
    </BaseSwitch.Root>
  )
}
