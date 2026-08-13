"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  backdrop = false,
  backdropClassName,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    /**
     * Render a transparent full-screen Backdrop that ABSORBS the outside tap which dismisses the
     * popover, so that tap does NOT fall through and activate whatever sits beneath it. Base UI's
     * Popover is non-modal by default — an outside press both closes the popover AND clicks the
     * element under the pointer. In the facet bar that means dismissing the price panel by tapping a
     * listing card ALSO navigates to that card's PDP. Opt-in, because a menu opened off a toolbar
     * usually WANTS the click-through; a filter dropdown floating over a grid does not. (The sibling
     * area-filter and every ui/select keep exactly such a backdrop for the same reason.)
     */
    backdrop?: boolean
    backdropClassName?: string
  }) {
  return (
    <PopoverPrimitive.Portal>
      {backdrop && (
        // z-40: above the sticky facet bar (z-30) and the grid, below the Positioner's popup (z-50).
        <PopoverPrimitive.Backdrop className={cn("overlay-scrim fixed inset-0 z-40", backdropClassName)} />
      )}
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        {/* `shadow-pop` — the ELEVATION TOKEN, not one of Tailwind's stock t-shirt shadow
            utilities, which is what this was until 2026-08-11. The scale is tokenised in
            globals.css (--shadow-pop / --shadow-card / --shadow-overlay) precisely so every
            floating layer shares one light source AND deepens in dark mode (0.08 → 0.45 alpha).
            A stock shadow does neither: it is a fixed light-mode rgba, so this popover rendered
            flatter than the menu beside it on the dark canvas.

            ⚠️ THE OVERRIDE CONTRACT CHANGED WITH IT, AND IT COST SOMETHING. `cn()` is a bare
            twMerge (src/lib/utils.ts), and the elevation tokens are hand-written classes in
            globals.css, NOT theme keys — so twMerge does not file them in its `shadow` group and
            cannot dedupe one against a stock utility. Measured: token + stock both survive the
            merge, and the token then WINS anyway because globals.css emits it unlayered while
            Tailwind's utilities sit in `@layer utilities`. Practical consequence: a call site can
            no longer switch this shadow off by passing the stock "no shadow" utility — it merges
            to nothing. Token-vs-token DOES still dedupe (measured: the two land in the same
            twMerge group and the last one wins), so overriding this with `shadow-overlay` works.
            Swept before shipping: across the whole app, ZERO call sites of PopoverContent,
            SheetContent, SelectContent, ComboboxContent or DropdownMenuContent pass any shadow
            class at all, and no `shadow-<color>` class exists anywhere — so nothing regressed
            today. The real fix is an `extendTailwindMerge` classGroup in src/lib/utils.ts, which
            would also cover sheet, select, combobox and dropdown-menu in one place.

            ⚠️ Do NOT name a stock shadow utility in this comment — Tailwind scans raw TEXT, so
            spelling one here re-emits it into the bundle (see the same warning in select.tsx). */}
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-2xl bg-popover p-2.5 text-sm text-popover-foreground shadow-pop ring-1 ring-foreground/10 outline-hidden duration-100 ease-out data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:data-closed:slide-out-to-top-2 data-[side=inline-end]:data-closed:slide-out-to-left-2 data-[side=inline-start]:data-closed:slide-out-to-right-2 data-[side=left]:data-closed:slide-out-to-right-2 data-[side=right]:data-closed:slide-out-to-left-2 data-[side=top]:data-closed:slide-out-to-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:ease-in data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
