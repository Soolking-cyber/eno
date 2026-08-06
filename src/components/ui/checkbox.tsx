'use client'

import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STROKE_MARK } from '@/lib/icon-tokens'

// Shared checkbox — Base UI's Checkbox (a role="checkbox" span + a hidden <input> beside it), which
// buys us the semantics the hand-rolled native input never wired up on its own: Space activation,
// aria-checked (including aria-checked="mixed"), a real indeterminate state instead of a ref poke at
// `el.indeterminate`, form/`name` integration, and disabled that actually blocks interaction.
//
// Base UI's Checkbox is HEADLESS — it paints nothing. That is deliberate: WE own the box (Root) and
// the glyph (Indicator), so this primitive now paints the same 20px-style box the rest of the app
// already drew by hand (border-2 + brand fill + Check, strokeWidth 3). Pass `children` to swap the
// glyph for your own.
//
// STATE STYLING. `data-checked` / `data-indeterminate` / `data-disabled` are BARE attributes (Base UI
// sets them to ''), so Tailwind's stock `data-checked:` shorthand compiles to `[data-checked]` and
// matches. (Contrast `data-orientation="vertical"`, a VALUED attribute — that mismatch is why the
// separator needed an explicit @custom-variant and silently rendered nothing until it got one. NO
// @custom-variant is needed here.) Bonus: `.data-checked\:bg-primary[data-checked]` is
// class+attribute specificity, so it beats the plain `bg-card` base regardless of stylesheet order.
//
// ⚠️ INDETERMINATE IS NOT "CHECKED". When indeterminate, Base UI emits NEITHER data-checked NOR
// data-unchecked — only data-indeterminate. Style the fill off data-checked alone and the admin
// "select all" box renders EMPTY. Every fill/border rule below is therefore stated twice, once per
// attribute. Don't collapse them.
//
// ⚠️ THE BASE SIZE IS `h-4 w-4`, NOT `size-4`. Call sites override the box with `h-3.5 w-3.5`, and
// tailwind-merge does NOT treat `size-*` as conflicting with `h-*`/`w-*` — it would keep BOTH and let
// stylesheet order decide. `h-4 w-4` collides on the same groups, so cn() cleanly drops it.
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
    // BUBBLING click onto the hidden form <input> it renders BESIDE Root (CheckboxRoot.js:322).
    // That click starts OUTSIDE Root, so an onClick+stopPropagation on <Checkbox> cannot catch
    // it — it sails past and fires the ancestor's handler. In this app that means ticking a
    // row's checkbox ALSO opens/selects the row. Every checkbox lives inside a clickable row,
    // so containment belongs here, once, rather than at each call site where it will be
    // forgotten. `display: contents` keeps the wrapper out of layout entirely.
    <span className="contents" onClick={(e) => e.stopPropagation()}> {/* design-lint-allow */}
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
            ? <Minus className="h-3/4 w-3/4" strokeWidth={STROKE_MARK} />
            : <Check className="h-3/4 w-3/4" strokeWidth={STROKE_MARK} />
        )}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
    </span>
  )
}
