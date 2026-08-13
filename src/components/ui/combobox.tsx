"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, XIcon } from "@/components/ui/icons"

import { cn } from "@/lib/utils"

const Combobox = ComboboxPrimitive.Root

function ComboboxInputGroup({ className, ...props }: ComboboxPrimitive.InputGroup.Props) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      className={cn(
        "flex h-11 w-full items-center rounded-xl border border-line-strong bg-card transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  )
}

function ComboboxClear({ className, children, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      className={cn(
        "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-body outline-none transition-[color,background-color,opacity,transform] duration-150 hover:bg-tint hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/40 data-starting-style:scale-75 data-starting-style:opacity-0 data-ending-style:scale-75 data-ending-style:opacity-0",
        className,
      )}
      {...props}
    >
      {children ?? <XIcon className="size-4" />}
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "group flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-body outline-none transition-[color,background-color,transform] duration-150 hover:bg-tint hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      {...props}
    >
      {children ?? <ChevronDownIcon className="size-4 transition-transform duration-200 group-data-popup-open:rotate-180" />}
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxContent({
  className,
  children,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  ...props
}: ComboboxPrimitive.Popup.Props & Pick<ComboboxPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <ComboboxPrimitive.Portal>
      {/* ⚠️ THE SCRIM IS PART OF THE FLOATING LAYER, NOT DECORATION ON THE MODAL ONES ONLY.
          Owner, 2026-08-13: dropdowns and popups must read the same as the dialogs. `.overlay-scrim`
          is the single definition all five overlay primitives share — see globals.css for why it is
          a class and not four copies, and why tooltips are excluded.
          ⚠️ pointer-events-none, AND THAT IS THE DIFFERENCE BETWEEN A SCRIM AND A MODAL. These
          three primitives had NO backdrop before, so adding a `fixed inset-0` element put a
          hit-testing surface over the whole page: measured with Playwright, clicking any other
          control while a menu was open TIMED OUT because the backdrop covered it — every dropdown
          would have started behaving like a modal, needing a dismiss tap before the page responded
          again. Base UI does outside-press dismissal with its own listeners rather than through
          this element, so making it pointer-transparent keeps the paint and drops the trap.
          (ui/popover is deliberately NOT given this: its backdrop pre-dates this change and its
          own comment records that absorbing the dismissing tap is its whole job.)
          z-40: under the Positioner's own z-50 popup, above the sticky facet bar (z-30). */}
      <ComboboxPrimitive.Backdrop className="overlay-scrim pointer-events-none fixed inset-0 z-40" />
      <ComboboxPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-50">
        {/* `shadow-pop` — the ELEVATION TOKEN, not one of Tailwind's stock t-shirt shadow
            utilities (what this carried until 2026-08-11). The combobox list is the same kind of
            floating layer as ui/select and ui/dropdown-menu, so it takes the same token: the
            tokens are what make those three read as one light source, and what deepens them in
            dark mode (0.08 → 0.45 alpha) where a stock light-mode rgba disappears.
            ⚠️ Do NOT name a stock shadow utility in this comment — Tailwind scans raw TEXT, so
            spelling one here re-emits it into the bundle (see the same warning in select.tsx). */}
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "relative z-50 max-h-(--available-height) w-(--anchor-width) min-w-64 origin-(--transform-origin) overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-pop ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return <ComboboxPrimitive.List data-slot="combobox-list" className={cn("max-h-72 overflow-y-auto p-1.5", className)} {...props} />
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" className={cn("scroll-my-1", className)} {...props} />
}

function ComboboxGroupLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return <ComboboxPrimitive.GroupLabel data-slot="combobox-group-label" className={cn("px-3 py-2 text-xs font-semibold text-muted-foreground", className)} {...props} />
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex min-h-11 cursor-pointer items-center rounded-xl py-2.5 pr-10 pl-3 text-sm leading-5 outline-none transition-colors duration-100 select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <ComboboxPrimitive.ItemIndicator className="absolute right-3 flex size-4 items-center justify-center data-starting-style:scale-50 data-starting-style:opacity-0">
        <CheckIcon className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return <ComboboxPrimitive.Empty data-slot="combobox-empty" className={cn("px-3 py-4 text-center text-sm text-body", className)} {...props} />
}

export {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
}
