"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    // `orientation` must reach the Root, not just the stylesheet: Base UI derives the
    // arrow-key axis (Left/Right vs Up/Down) and aria-orientation from it. Painting a
    // manual data-orientation instead left a "vertical" strip LOOKING vertical while
    // Base UI still thought it was horizontal. The Root emits data-orientation from its
    // own state, which is what the data-horizontal/data-vertical variants read.
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * ⛔ A TAB PRESSES, AND A TAB CHANGE NEVER ANIMATES.
 * The base was `transition-all` with no press: every colour, background, shadow and underline change
 * faded — including the ones Base UI makes on ARROW KEYS, which must never animate — and layout
 * properties were in the list too. Callers that wanted a press added `transition-colors` +
 * `active:scale-[0.97]`, and tailwind-merge let that `transition-colors` REPLACE the base list, so
 * the scale had nothing to tween and snapped (the home feed's sort strip, tapped constantly).
 * Now the base transitions `scale` only, on the house press timing (160ms snappy spring back, 60ms
 * down — the same numbers as ui/button), so the state switches instantly and the press eases. A
 * caller's `transition-colors`/`-opacity`/`-shadow` is dropped for the same reason ui/button drops
 * it: it would delete the press and bring the keyboard fade back.
 */
const SUBSET_TRANSITIONS = new Set(['transition-colors', 'transition-opacity', 'transition-shadow'])
const keepPressTransition = <T,>(value: T): T =>
  (typeof value === 'string' ? value.split(/\s+/).filter((c) => !SUBSET_TRANSITIONS.has(c)).join(' ') : value) as T

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-lg border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-[scale] duration-[160ms] ease-[var(--ease-spring-snappy)] active:scale-[0.97] active:duration-[60ms] group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        // The line variant's underline switches with the tab — no fade (see the note above).
        "after:absolute after:bg-foreground after:opacity-0 group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        keepPressTransition(className)
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
