"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

/**
 * ⚠️ RENDERS THE RAW VALUE unless the Select ROOT gets `items` (a value→label record or
 * `{value,label}[]`) or this element gets a children function. A call site whose labels
 * differ from its values MUST pass `items` — skipping it shipped "credit_card" to an
 * applicant where "Credit card" belonged (owner report, 2026-07-23).
 */
function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        // Press feedback is a BACKGROUND tint, never a transform: this trigger is the popup's
        // floating anchor, and scaling it would shift the open popup (see custom-select / task 5).
        // Chevron flips via Base UI's `data-popup-open` on the trigger (transform-only, no reflow).
        //
        // HEIGHT: `min-h-8` / `data-[size=sm]:min-h-7`, never `h-*`. With OS text scaling live
        // (`-webkit-text-size-adjust`, src/lib/native-text-zoom.ts) and Tailwind v4's UNITLESS
        // line-height ratios, text-sm's 20px line box becomes ~30px at 150% — which a fixed 32px
        // box cannot hold once padding and borders are counted.
        // ⚠️ The vertical padding was RE-CUT with it, and that is not cosmetic. The old pairing was
        // `py-2` + `h-8`: 1+8+20+8+1 = 38px of content in a box pinned to 32px, i.e. the trigger
        // was ALREADY overflowing (invisibly — flex `items-center` spills it symmetrically into the
        // padding and nothing clips). A naive h-8→min-h-8 swap would therefore have grown every
        // trigger 32px→38px at the DEFAULT text size. `py-1` (1+4+20+4+1 = 30 ≤ 32) and
        // `data-[size=sm]:py-0.5` (26 ≤ 28) keep the natural height just inside the old fixed one,
        // so both sizes render byte-identically at 100% and grow only when the glyphs do.
        // ⚠️ The DEFAULT values are unmodified (`min-h-8 py-1`), NOT `data-[size=default]:*`, so a
        // caller's own `min-h-11` / `py-2` still wins through cn()'s tailwind-merge. Behind a
        // `data-[size=default]:` prefix they would NOT: different modifiers are never deduped, and
        // the attribute selector's higher specificity would silently beat the call site
        // (dashboard/visa's `min-h-11` trigger would have collapsed 44px→32px).
        "flex w-fit min-h-8 items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-1 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none active:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=sm]:min-h-7 data-[size=sm]:py-0.5 data-[size=sm]:rounded-[min(var(--radius-md),10px)] [&[data-popup-open]_[data-slot=select-chevron]]:rotate-180 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:active:bg-input/60 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon data-slot="select-chevron" className="pointer-events-none size-4 text-muted-foreground transition-transform duration-150 ease-out" />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        {/* Item-alignment mode must not animate: the popup opens ALREADY overlapping the
            trigger, so a zoom/slide reads as a glitch. The old gate was `data-align-trigger`,
            a mirror of the REQUESTED prop — but Base UI falls back to normal side-anchoring
            on touch, or when the list can't fit (SelectPopup calls setControlledAlignItemWithTrigger(false)),
            and the mirrored attribute kept claiming "true" through the fallback. The real
            signal is the Positioner's own `data-side="none"` (renderedSide === 'none' iff
            alignItemWithTriggerActive), which the Popup re-emits from its state.
            The old override also RACED: an animate-none keyed on the align-trigger attribute
            shared no modifier with the open/animate-in rule, so cn() kept both at equal
            specificity and stylesheet order picked the winner. Gating the animate-in and
            animate-out utilities themselves leaves exactly one animation rule on the popup,
            so there is nothing left to race. The fade, zoom and slide utilities only set the
            keyframes' custom properties, so they are inert with no animation running.
            (Don't spell a full utility candidate in this comment: Tailwind scans raw TEXT,
            so a class name written here is emitted into the bundle even if nothing uses it.) */}
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn("relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-2xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 ease-out data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:data-closed:slide-out-to-top-2 data-[side=inline-end]:data-closed:slide-out-to-left-2 data-[side=inline-start]:data-closed:slide-out-to-right-2 data-[side=left]:data-closed:slide-out-to-right-2 data-[side=right]:data-closed:slide-out-to-left-2 data-[side=top]:data-closed:slide-out-to-bottom-2 not-data-[side=none]:data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 not-data-[side=none]:data-closed:animate-out data-closed:ease-in data-closed:fade-out-0 data-closed:zoom-out-95", className )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // Short color transition so the highlight fades as you arrow/hover instead of snapping
        // (colour only — no geometry). Reduced-motion collapses it to instant via the global guard.
        "relative flex w-full cursor-default items-center gap-1.5 rounded-lg py-1 pr-8 pl-1.5 text-sm outline-hidden select-none transition-colors duration-75 focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        {/* One-shot pop when the check appears on the selected item (compositor transform+opacity). */}
        <CheckIcon className="pointer-events-none animate-in zoom-in-50 fade-in-0 duration-150 ease-out" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
