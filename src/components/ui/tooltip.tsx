"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/** THE tooltip primitive (Base UI Tooltip). Reintroduced 2026-07-15 to replace the native
 *  `title=` attribute on icon-only controls — `title=` has no keyboard-focus reveal, no touch
 *  reveal, and inconsistent screen-reader exposure.
 *
 *  ## Usage — wrap the control, pass the hint:
 *      <Tooltip content={tr('Chat with seller', 'Nhắn người bán')}>
 *        <IconButton aria-label={tr('Chat with seller','Nhắn người bán')}>…</IconButton>
 *      </Tooltip>
 *
 *  The child is the trigger (composed via Base UI's `render`, not asChild). ALWAYS keep the
 *  control's own `aria-label` — the tooltip is the VISIBLE hint, not the accessible name, and Base
 *  UI Tooltip deliberately does not open on touch, so a touch user must still get the name from
 *  aria-label. For touch-ESSENTIAL explanations use ui/popover (a real dismissible surface), not this.
 *
 *  Mount <TooltipProvider> once high in the tree so hovers share one open-delay group (moving
 *  between adjacent tooltips then feels instant); it is optional — a bare <Tooltip> still works.
 */
export function TooltipProvider({
  delay = 600,
  closeDelay = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delay={delay} closeDelay={closeDelay} {...props} />
}

export function Tooltip({
  content,
  children,
  side = "top",
  sideOffset = 6,
  align = "center",
  className,
}: {
  /** The hint text (or node). If falsy, the child renders WITHOUT a tooltip wrapper. */
  content: React.ReactNode
  children: React.ReactElement
  side?: TooltipPrimitive.Positioner.Props["side"]
  sideOffset?: number
  align?: TooltipPrimitive.Positioner.Props["align"]
  className?: string
}) {
  // No content → don't pay for a tooltip; render the control as-is.
  if (!content) return children

  // Open/close delay is grouped by <TooltipProvider> (delay=600ms). Base UI's Tooltip.Root
  // takes no per-instance delay in this version — the Provider owns it.
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="z-[70]">
          <TooltipPrimitive.Popup
            className={cn(
              "origin-(--transform-origin) rounded-lg bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md select-none",
              // Anchored motion mirroring ui/popover, at tooltip scale: a quick fade + subtle zoom
              // and a 1px slide FROM the anchor on open, reversed TO the anchor on close.
              "duration-100 ease-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
              "data-closed:duration-75 data-closed:ease-in data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1",
              "data-[side=bottom]:data-closed:slide-out-to-top-1 data-[side=top]:data-closed:slide-out-to-bottom-1 data-[side=left]:data-closed:slide-out-to-right-1 data-[side=right]:data-closed:slide-out-to-left-1",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
