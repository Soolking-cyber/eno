'use client'

import { useId, useState } from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { ChevronsUpDown, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  /** REQUIRED accessible name — WHICH facet this is ("Transmission", "Sort by", …),
   *  bilingual via tr(). Without it the trigger's only name is its current value, so a
   *  screen-reader user hears "All, combobox" with no idea what it filters. It is NOT an
   *  aria-label: aria-label would REPLACE the trigger's text and swallow the current value.
   *  It is rendered as an sr-only span and referenced together WITH the trigger
   *  (aria-labelledby="label trigger" — the APG select-only-combobox pattern), so the
   *  announcement is "Transmission, All Transmissions, combobox, collapsed". */
  label: string
  placeholder?: string
  className?: string
  activeClassName?: string
  icon?: React.ReactNode
  wrapperClassName?: string
  labelClassName?: string
  /** Override the trigger text (e.g. a short code) while the menu keeps full labels. */
  triggerLabel?: string
}

/** The marketplace's facet/filter select: a detached popover card 6px under the trigger
 *  (same width, floored at 176px so a narrow pill's menu stays readable), portaled to
 *  <body> so a scrolling facet row can't clip it. Props-only; no app coupling.
 *
 *  ⚠️ This is BASE UI SELECT under the skin, not a hand-rolled menu — that is the whole
 *  point of the component and must not be unwound. The primitive is what supplies
 *  role="combobox" + aria-expanded/haspopup/controls on the trigger, role="listbox" on the
 *  list, role="option" + aria-selected per row, arrow/Home/End navigation, typeahead,
 *  Escape, and focus return to the trigger — none of which the previous hand-rolled version
 *  had. (The ✓ is a lucide icon and therefore aria-hidden; selection is announced by
 *  aria-selected, NOT by the check, so never lean on the check for semantics.)
 *
 *  Why NOT src/components/ui/select.tsx (the admin-skinned wrapper over the same primitive):
 *    · its SelectTrigger hard-renders a ChevronDown; this trigger's glyph is the stacked
 *      ChevronsUpDown (shadcn/macOS "value picker" convention), and the wrapper exposes no
 *      way to suppress its own icon;
 *    · its SelectContent hardcodes `isolate z-50` on the Positioner. AreaFilter portals its
 *      panel at z-[100] over a z-[99] scrim and facet-bar's advanced panel at z-[1100] over
 *      z-[1099] — a z-50 menu opened from inside either one renders UNDERNEATH the scrim
 *      that owns the click. Hence the explicit z-[1200]/z-[1201] below, which is exactly the
 *      stack the hand-rolled version used.
 *  Both are properties of the admin SKIN, not of the primitive. If ui/select ever grows a
 *  positioner className + an icon slot, collapse this into it.
 */
export function CustomSelect({
  value, onChange, options, label, placeholder, className, activeClassName, icon, wrapperClassName, labelClassName, triggerLabel,
}: CustomSelectProps) {
  const uid = useId()
  // `open` is held in React rather than read off the trigger's data-popup-open, because the
  // open-state classes below MUST stay inside the same cn() call as `className`: the caller's
  // radius (area-filter's FIELD) has to keep beating the open-state `rounded-none`, and
  // `text-foreground` has to keep beating the caller's colour. A data-popup-open:* variant
  // would carry an attribute selector — (0,2,0) — and silently win BOTH fights, inverting the
  // precedence that tailwind-merge gives us here.
  const [open, setOpen] = useState(false)

  const selectedOption = options.find((o) => o.value === value)

  return (
    // ⚠️ THE SIZING WRAPPER MUST STAY *OUTSIDE* Select.Root. Do not move it back in.
    //
    // Select.Root is NOT DOM-free: SelectRoot.js:422 renders `[children, <input/>, hiddenInputs]` —
    // a hidden form/autofill input emitted as a SIBLING of its children. With the wrapper inside the
    // Root, that input lands in the CALLER's parent, so the wrapper stops being :last-child. Tailwind
    // v4 compiles `space-y-*` to `> :not(:last-child)`, which means every caller that ends a
    // `space-y-*` column with a select suddenly gains a margin it never had — +6px under all 9 filters
    // in explorer-filters and both pickers in area-filter, silently.
    //
    // Root renders no element of its own, so nesting it inside the wrapper is free and costs nothing.
    // The hidden input then sits inside this `relative` div, where it is position:fixed and nothing
    // selects on :last-child. The bug is invisible in review because the offending node is emitted by
    // the primitive, not by the JSX.
    <div className={cn('relative', wrapperClassName ?? 'w-full')}>
      <SelectPrimitive.Root
        value={value}
        onValueChange={(v) => { if (typeof v === 'string') onChange(v) }}
        open={open}
        onOpenChange={setOpen}
      >
        {/* aria-hidden, yet still the label: an aria-labelledby reference is resolved even when
            the referenced node is hidden (AccName §Step2B), so the name still computes — but the
            text no longer shows up a SECOND time as loose prose when a screen-reader user browses
            the page. Most call sites already render a VISIBLE <label> with this same wording, and
            without aria-hidden the facet is read three times ("Transmission" / "Transmission" /
            "Transmission All Transmissions, combobox"). Verified with a real AX-tree snapshot. */}
        <span id={`${uid}-label`} className="sr-only" aria-hidden="true">{label}</span>
        <SelectPrimitive.Trigger
          id={`${uid}-trigger`}
          aria-labelledby={`${uid}-label ${uid}-trigger`}
          // ui/button (variant="bare" size="none") owns nothing but focus ring + icon rule
          // here; the box, colours and radius stay exactly as hand-rolled. It is passed via
          // `render` (Base UI's composition prop — never asChild), so the trigger's
          // role/aria/handlers merge ONTO the button. Three base classes are deliberately
          // neutralised in the className below:
          //   · gap-2      → gap-0   (the children carry their own margins: the label
          //                           group has gap-1.5, the chevron has ml-1.5)
          //   · font-medium→ font-semibold, justify-center → justify-between, inline-flex
          //                  → flex, transition-all → transition-colors (all via cn/twMerge)
          //   · active:scale-[0.97] → active:scale-100. This trigger is the POPOVER ANCHOR:
          //                  floating-ui measures its rect to place the menu, and a transform
          //                  scales that rect — a pressed trigger would anchor the menu off by
          //                  ~3%. It also never had a press-scale before. Do not let it back in.
          render={
            <Button
              type="button"
              variant="bare"
              size="none"
              className={cn(
                'flex w-full items-center justify-between gap-0 px-3.5 py-2 text-sm font-semibold outline-none transition-colors duration-150 cursor-pointer active:scale-100',
                // Closed: consistent rounded-xl (no more pills). Caller className may restyle.
                !open && 'rounded-xl',
                // Open: flatten. The base carries rounded-xl unconditionally, so the open
                // state must say rounded-none out loud — and it stays BEFORE `className` so a
                // caller that hard-sets its own radius (area-filter's FIELD) still wins.
                open && 'rounded-none',
                !open && (value !== 'all' && value !== 'newest'
                  ? (activeClassName ?? 'bg-accent text-accent-foreground')
                  : 'text-body hover:bg-muted'), // flush at rest, color on hover (one-canvas)
                className,
                // Open: just emphasize the text; the menu is a detached card below
                // (consistent with every other dropdown — no morph).
                open && 'text-foreground',
              )}
            />
          }
        >
          <span className="flex items-center gap-1.5 truncate">
            {icon}
            <span className={cn('truncate', labelClassName)}>{triggerLabel ?? (selectedOption ? selectedOption.label : placeholder)}</span>
          </span>
          {/* Select-trigger convention (shadcn/macOS): stacked chevrons = value picker. */}
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 ml-1.5 text-ink-4" />
        </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        {/* Transparent backdrop: it's the tap target, so an outside tap CLOSES the menu and is
            absorbed here — never passing through to a card/button below, and never reaching the
            scrim of a panel this select is nested in (AreaFilter, the advanced-filter sheet),
            which would otherwise tear the whole panel down on the same tap. */}
        <SelectPrimitive.Backdrop className="fixed inset-0 z-[1200]" />
        <SelectPrimitive.Positioner
          // The menu is a detached card BELOW the trigger, not a native-select overlay that
          // morphs out of it — hence alignItemWithTrigger={false}. (The primitive defaults to
          // true; leaving it on would park the selected row on top of the trigger and move the
          // card up by a variable amount. This is the geometry the hand-rolled version had:
          // top = trigger.bottom + 6, left-aligned, 8px viewport gutter.)
          alignItemWithTrigger={false}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-[1201]"
        >
          <SelectPrimitive.Popup
            // w-(--anchor-width) + min-w-44 == the old Math.max(triggerRect.width, 176):
            // track the trigger, but never let a narrow pill's menu render as a sliver.
            //
            // Enter-only animation, matching the old `animate-in fade-in duration-150`. There is
            // deliberately NO data-closed:animate-out — the hand-rolled menu vanished instantly.
            // If you ever add one, add BOTH halves: Base UI waits for a declared exit
            // animation/transition to finish before it tears the popup down.
            //
            // ⚠️ Do NOT "fix" the popup still being in the DOM after close. Base UI force-mounts
            // the list so typing on a CLOSED trigger can jump the value (native-<select> parity).
            // It is safe: the positioner carries the native `hidden` attribute when closed, so the
            // subtree is 0×0 AND out of the accessibility tree — an AX snapshot after Escape shows
            // no listbox and no options. It is NOT a leak (the node count stays at one across
            // repeated open/close) and NOT a visible orphan.
            className="max-h-60 w-(--anchor-width) min-w-44 overflow-y-auto overflow-x-hidden rounded-2xl bg-popover p-1.5 shadow-pop scroll-thin duration-150 data-open:animate-in data-open:fade-in-0"
          >
            <SelectPrimitive.List>
              {options.map((opt) => {
                const isActive = opt.value === value
                return (
                  // ui/button (variant="bare" size="none") = focus ring + icon rule only; the
                  // row's box/colours stay hand-rolled. Base classes neutralised below:
                  //   · justify-center → justify-between, text-center → text-left, inline-flex → flex
                  //   · gap-2 → gap-6 · rounded-xl → rounded-lg · transition-all → transition-colors
                  //   · active:scale-[0.97] → active:scale-100. These are PORTAL MENU ROWS: they
                  //     live in a fixed-position card anchored to the trigger and never had a
                  //     press-scale. Do not let the base scale back in.
                  // data-highlighted is the KEYBOARD cursor (ArrowDown/Up, Home/End, typeahead).
                  // It must paint the same as :hover, or arrow-key navigation moves an invisible
                  // cursor. Base UI also highlights on hover, so the two always agree.
                  <SelectPrimitive.Item
                    key={opt.value}
                    value={opt.value}
                    // Feeds the primitive's typeahead (it matches on this string, not on DOM text).
                    label={opt.label}
                    // Select.Item renders a <div> by default, so it assumes nativeButton={false}
                    // and layers its own Enter/Space emulation on top. We render it as ui/button —
                    // a REAL <button> — so it must be told: otherwise Base UI warns and
                    // double-handles activation keys on an element that already has them natively.
                    nativeButton
                    render={
                      <Button
                        type="button"
                        variant="bare"
                        size="none"
                        className={cn(
                          'flex w-full items-center justify-between gap-6 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer active:scale-100 hover:bg-muted hover:text-accent-foreground data-highlighted:bg-muted data-highlighted:text-accent-foreground',
                          isActive ? 'font-semibold text-accent-foreground' : 'font-medium text-body',
                        )}
                      />
                    }
                  >
                    <span className="truncate">{opt.label}</span>
                    {/* Decorative only — lucide stamps aria-hidden on it. The row's selected state
                        is announced by the primitive's aria-selected, not by this ✓. */}
                    {isActive && <Check className="h-4 w-4 shrink-0" />}
                  </SelectPrimitive.Item>
                )
              })}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  )
}
