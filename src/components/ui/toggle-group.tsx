'use client'

import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group'
import { Toggle as BaseToggle } from '@base-ui/react/toggle'
import type { VariantProps } from 'class-variance-authority'
import { chipToggleClassName, type chipVariants } from '@/components/ui/chip'
import { TOGGLE_BASE } from '@/components/ui/toggle'
import { hapticSelection } from '@/lib/haptics'
import { cn } from '@/lib/utils'

/**
 * TOGGLE GROUP — a set of chip toggles that answer ONE question (Base UI ToggleGroup: `role="group"`, ONE tab stop
 * with roving focus — the arrow keys, Home and End move between the chips; every chip is a real `aria-pressed`
 * button). Two shapes:
 *   · `multiple` — several choices (subjects, ages, the work wanted);
 *   · single — ONE choice that can be CLEARED by tapping it again (a degree, a start month). A radio cannot do that:
 *     re-selecting the checked radio is a no-op by design (ui/radio-group), so "tap again to clear" wants this.
 *
 * ⚠️ NAME THE GROUP — inside a ui/fieldset its legend does not reach a `role="group"` (only a radio group reads
 * Base UI's fieldset context), so pass `aria-labelledby` (the legend's id) or `aria-label`: a group with no name
 * is announced with no context.
 * ⚠️ RE-ADDED WITH ITS FIRST CALL SITES (the teacher form, 2026-10-08) — design-language §5 deleted the unused shadcn
 * copy in 2026-07, and asks for a primitive to come back only with a real caller.
 * ⚠️ CONTROLLED ONLY: `value` + `onValueChange`. The chips take their pressed state from the group, never their own.
 */
export function ToggleGroup<V extends string>({
  value,
  onValueChange,
  className,
  ...props
}: Omit<BaseToggleGroup.Props<V>, 'value' | 'defaultValue' | 'onValueChange' | 'className'> & {
  value: readonly V[]
  onValueChange: (value: V[]) => void
  className?: string
}) {
  return (
    <BaseToggleGroup<V>
      value={value}
      onValueChange={(next) => {
        hapticSelection()
        onValueChange(next)
      }}
      // gap-y-3, not gap-2: each chip's tap-44 hit area reaches past its 36px box, and two rows 8px apart overlapped
      // (the cover grid's quick picks measured it, cover-fields.tsx).
      className={cn('flex flex-wrap gap-x-2 gap-y-3', className)}
      {...props}
    />
  )
}

/** One chip of a ToggleGroup — ui/chip's toggle look (`chipToggleClassName`), its pressed state the group's. */
export function ToggleGroupItem<V extends string>({
  value,
  size = 'md',
  tone = 'neutral',
  className,
  ...props
}: Omit<BaseToggle.Props<V>, 'pressed' | 'defaultPressed' | 'onPressedChange' | 'className' | 'value'> &
  VariantProps<typeof chipVariants> & { value: V; className?: string }) {
  return (
    <BaseToggle<V>
      value={value}
      // relative tap-44: the 36px chip, a 44px hit area (globals.css .tap-44 — it needs `relative`).
      className={cn(TOGGLE_BASE, chipToggleClassName({ size, tone }), 'relative tap-44', className)}
      {...props}
    />
  )
}
