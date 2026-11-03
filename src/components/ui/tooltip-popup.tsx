"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/**
 * The tooltip's floating half, in its own chunk: ui/tooltip.tsx fetches it on the first hover or keyboard focus, so a visit that never hovers
 * (every phone) never loads or runs it. No Trigger: the control stays where it was rendered and this anchors to its element.
 */
export function TooltipPopup({
  anchor,
  open,
  instant,
  side,
  sideOffset,
  align,
  className,
  children,
  onDismiss,
  onClosed,
  onPointerEnter,
  onPointerLeave,
}: {
  anchor: Element
  open: boolean
  /** Reached with no wait (a neighbour was just open, or keyboard focus): no motion either. */
  instant: boolean
  side?: TooltipPrimitive.Positioner.Props["side"]
  sideOffset?: number
  align?: TooltipPrimitive.Positioner.Props["align"]
  className?: string
  children: React.ReactNode
  onDismiss: () => void
  onClosed: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}) {
  return (
    <TooltipPrimitive.Root
      open={open}
      onOpenChange={(next) => { if (!next) onDismiss() }}
      onOpenChangeComplete={(next) => { if (!next) onClosed() }}
    >
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner anchor={anchor} side={side} sideOffset={sideOffset} align={align} className="z-tooltip">
          <TooltipPrimitive.Popup
            data-instant={instant ? "" : undefined}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            className={cn(
              "origin-(--transform-origin) rounded-lg bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md select-none",
              // Anchored motion mirroring ui/popover, at tooltip scale: a quick fade + subtle zoom
              // and a 1px slide FROM the anchor on open, reversed TO the anchor on close.
              "duration-100 ease-out-strong data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
              "data-closed:duration-75 data-closed:ease-out-strong data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1",
              "data-[side=bottom]:data-closed:slide-out-to-top-1 data-[side=top]:data-closed:slide-out-to-bottom-1 data-[side=left]:data-closed:slide-out-to-right-1 data-[side=right]:data-closed:slide-out-to-left-1",
              // `!`: stylesheet order, not class order, decides between this and `data-closed:` (equal specificity), and both can be set at once.
              // It zeroes the duration because `animate-in` reads `var(--tw-animation-duration, var(--tw-duration, .15s))`.
              "data-instant:duration-0!",
              className,
            )}
          >
            {children}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
