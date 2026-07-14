'use client'

import { RadioGroup as BaseRadioGroup, type RadioGroupProps } from '@base-ui/react/radio-group'
import { Radio as BaseRadio, type RadioRootProps } from '@base-ui/react/radio'
import { cn } from '@/lib/utils'

// Shared radio group — Base UI's RadioGroup + Radio (a role="radiogroup" div wrapping role="radio"
// spans, each with a hidden <input type="radio"> beside it).
//
// ## Why this exists
// The app had THREE hand-rolled radio groups made of mutually-exclusive <Button>s whose ONLY
// selected cue was paint: the report-reason list (a hand-drawn circle that LOOKS like a radio but
// reported nothing), the post-wizard category chips, and its sale/rent toggle. A screen reader saw
// a pile of unrelated buttons — no group, no "3 of 7", no selected state, no arrow keys. Base UI
// buys all of it: role="radiogroup", role="radio" + aria-checked per item, roving tabindex (the
// group is ONE tab stop) and arrow-key navigation.
//
// ⚠️ ARROW KEYS, BOTH AXES. RadioGroup does not pass an `orientation`, so Base UI's composite
// defaults to `'both'` (useCompositeRoot.js:21) — ←→ AND ↑↓ move the selection. That is why the
// same primitive serves a vertical list (report reasons) and a horizontal chip row (categories)
// with no per-call-site configuration.
//
// ⚠️ RE-SELECTING THE CHECKED RADIO IS A NO-OP, BY DESIGN. Base UI drives the change off the hidden
// input's `onChange`, and a browser fires no change event when you click an already-checked radio.
// So `onValueChange` does NOT re-fire for the current value — unlike the <Button onClick> it
// replaces, which re-ran its handler on every click. That is the correct radio contract and both
// call sites want it: post-wizard's `chooseCategory()` wipes subcategory/brand/attrs, and re-firing
// it on a stray click of the ALREADY-selected chip silently destroyed the user's work.
// If you need "click the selected one to clear it", you do NOT want a radio — you want a toggle
// button with aria-pressed (see facet-bar's segmented chips).
//
// ⚠️ NO ICON AUTO-SIZE RULE HERE, deliberately. ui/button's base carries an `svg { size-4 }` rule;
// this primitive carries none, so a call site's `h-4 w-4` / `h-3.5 w-3.5` icon renders at exactly
// the size it asks for. Size your icons explicitly — nothing will do it for you.

/** The group. Renders a `<div role="radiogroup">` — it REPLACES the wrapper you were using for
 *  layout, so give it that wrapper's className rather than nesting one inside. Name it: pass
 *  `aria-label` (or `aria-labelledby`), or an unnamed radiogroup is announced with no context. */
export function RadioGroup({
  value,
  onValueChange,
  className,
  children,
  ...props
}: {
  value?: string
  onValueChange?: (value: string) => void
  className?: string
  children?: React.ReactNode
} & Omit<RadioGroupProps<string>, 'value' | 'onValueChange' | 'className' | 'children'>) {
  return (
    <BaseRadioGroup
      value={value}
      // Base UI hands back (value, eventDetails); call sites only ever want the value.
      onValueChange={(next) => onValueChange?.(next)}
      className={className}
      {...props}
    >
      {children}
    </BaseRadioGroup>
  )
}

/** One radio. Renders a `<span role="radio">` — NOT a <button>, so it can safely contain the
 *  circle, an icon and the label. The whole thing is the control: children become its accessible
 *  name. The caller owns the box (padding/border/fill); the base below is only what is not
 *  decoration — the pointer, the focus ring, the press feedback and the disabled state. */
export function Radio({
  value,
  className,
  disabled,
  children,
  ...props
}: {
  value: string
  className?: string
  disabled?: boolean
  children?: React.ReactNode
} & Omit<RadioRootProps<string>, 'value' | 'className' | 'disabled' | 'children'>) {
  return (
    <BaseRadio.Root
      value={value}
      disabled={disabled}
      // Every class here shares a tailwind-merge group with what the call sites override
      // (display / justify / gap / whitespace), so cn() DELETES the base instead of racing it:
      // report-button's `flex w-full justify-start gap-2.5 whitespace-normal` cleanly beats
      // `inline-flex justify-center gap-2 whitespace-nowrap`. Keep it that way — a base class with
      // no counterpart in the caller's group is a class the caller cannot remove.
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap outline-none',
        'transition-all duration-100 active:scale-[0.97]',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </BaseRadio.Root>
  )
}

/** The circle — an always-visible ring with the dot appearing inside it when selected. Drop it in
 *  as the first child of a <Radio> when the group wants the classic radio look.
 *
 *  Both halves are Base UI Indicators reading the same RadioRootContext:
 *    · the RING is `keepMounted` (it must be there when unselected) and takes its border colour
 *      from `state.checked` — a className FUNCTION, i.e. plain JS. No `group-data-checked/*`
 *      variant, which would be an unverifiable guess: a Tailwind class that does not parse is
 *      SILENTLY ABSENT, not an error, and this file's correctness must not hinge on that.
 *    · the DOT is a plain Indicator, so Base UI unmounts it when unchecked. That IS the selected
 *      cue — there is no `hidden` class to get out of sync with the accessibility tree. */
export function RadioDot({ className }: { className?: string }) {
  return (
    <BaseRadio.Indicator
      keepMounted
      className={(state) =>
        cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
          state.checked ? 'border-brand' : 'border-line-strong',
          className,
        )
      }
    >
      <BaseRadio.Indicator className="h-2 w-2 rounded-full bg-primary" />
    </BaseRadio.Indicator>
  )
}
