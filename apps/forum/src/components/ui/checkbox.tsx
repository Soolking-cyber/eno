'use client'

import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

// Shared checkbox — Base UI's Checkbox (a role="checkbox" span + a hidden <input> beside it),
// ported from the marketplace app's src/components/ui/checkbox.tsx. It buys us the semantics a
// hand-drawn glyph inside a Button never had: Space activation, aria-checked (including "mixed"),
// a real indeterminate state, form/`name` integration, and disabled that actually blocks input.
//
// Base UI's Checkbox is HEADLESS — it paints nothing. WE own the box (Root) and the glyph
// (Indicator): a 16px border-2 box with brand fill and a Check at strokeWidth 3. Pass `children`
// to swap the glyph. Compose with a wrapping <label> for a clickable row — the label forwards
// clicks to the hidden input, so the whole row toggles.
//
// STATE STYLING. `data-checked` / `data-indeterminate` / `data-disabled` are BARE attributes
// (Base UI sets them to ''), so Tailwind's stock `data-checked:` shorthand compiles to
// `[data-checked]` and matches — no @custom-variant needed.
//
// ⚠️ INDETERMINATE IS NOT "CHECKED". When indeterminate, Base UI emits NEITHER data-checked NOR
// data-unchecked — only data-indeterminate. Style the fill off data-checked alone and a
// "select all" box renders EMPTY. Every fill/border rule below is therefore stated twice, once
// per attribute. Don't collapse them.
//
// ⚠️ THE BASE SIZE IS `h-4 w-4`, NOT `size-4`. Call sites override the box with e.g. `h-5 w-5`,
// and tailwind-merge does NOT treat `size-*` as conflicting with `h-*`/`w-*` — it would keep
// BOTH and let stylesheet order decide. `h-4 w-4` collides on the same groups, so cn() cleanly
// drops it.
export function Checkbox({
  checked,
  onChange,
  indeterminate,
  disabled,
  className,
  indicatorClassName,
  children,
  ...props
}: {
  checked?: boolean
  /** Optional so a read-only row can't fire an undefined handler. */
  onChange?: (next: boolean) => void
  /** Some-but-not-all selected — renders a dash and reports aria-checked="mixed". */
  indeterminate?: boolean
  disabled?: boolean
  className?: string
  /** Extra classes for the glyph wrapper. */
  indicatorClassName?: string
  /** The glyph, rendered INSIDE the Indicator. Defaults to a Check (or a dash when indeterminate). */
  children?: React.ReactNode
} & Omit<
  React.ComponentPropsWithoutRef<typeof BaseCheckbox.Root>,
  'checked' | 'onChange' | 'onCheckedChange' | 'indeterminate' | 'disabled' | 'className' | 'children'
>) {
  return (
    // ⚠️ THE PRIMITIVE CONTAINS ITS OWN SECOND CLICK. Base UI's CheckboxRoot re-dispatches a
    // BUBBLING click onto the hidden form <input> it renders BESIDE Root. That click starts
    // OUTSIDE Root, so an onClick+stopPropagation on <Checkbox> cannot catch it — it sails past
    // and fires the ancestor's handler (ticking a checkbox inside a clickable row would ALSO
    // activate the row). Containment belongs here, once, rather than at each call site where it
    // will be forgotten. `display: contents` keeps the wrapper out of layout entirely.
    <span className="contents" onClick={(e) => e.stopPropagation()}>
    <BaseCheckbox.Root
      checked={checked}
      onCheckedChange={(next) => onChange?.(next)}
      indeterminate={indeterminate}
      disabled={disabled}
      className={cn(
        'flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-line-strong bg-card outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'data-checked:border-brand data-checked:bg-primary data-checked:text-white',
        'data-indeterminate:border-brand data-indeterminate:bg-primary data-indeterminate:text-white',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator
        className={cn('flex h-full w-full items-center justify-center', indicatorClassName)}
      >
        {children ?? (
          indeterminate
            ? <Minus className="h-3/4 w-3/4" strokeWidth={3} />
            : <Check className="h-3/4 w-3/4" strokeWidth={3} />
        )}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
    </span>
  )
}
