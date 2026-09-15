'use client'

import { Toggle as BaseToggle } from '@base-ui/react/toggle'
import { cn } from '@/lib/utils'
import { hapticSelection } from '@/lib/haptics'

/**
 * A two-state button — Base UI's Toggle (a real `<button aria-pressed>`), so Space/Enter, disabled and
 * the pressed state's accessibility come from the library rather than from a hand-rolled onClick.
 *
 * Pressed is styled off Base UI's `data-pressed`, a BARE attribute, so Tailwind's stock `data-pressed:`
 * variant matches it (same reasoning as ui/switch's `data-checked`). This primitive owns only the
 * behaviour and the focus ring; the call site owns the look, because a toggle in a filter strip and a
 * toggle in a toolbar do not share one.
 *
 * ⚠️ A TOGGLE IS NOT A TAB. Placed beside a tablist it must stay OUTSIDE the TabsList element: a
 * tablist may own only tabs, and a button inside it would join the roving arrow-key focus and be
 * announced as a stray child of the tab set.
 */
export function Toggle({
  pressed,
  onPressedChange,
  className,
  children,
  ...props
}: Omit<BaseToggle.Props, 'onPressedChange'> & {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
}) {
  return (
    <BaseToggle
      pressed={pressed}
      onPressedChange={(next) => {
        hapticSelection()
        onPressedChange(next)
      }}
      className={cn(
        'cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </BaseToggle>
  )
}
