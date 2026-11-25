"use client"

import { createContext, useContext, type KeyboardEvent } from "react"
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

/**
 * ⛔ `plain`: THE LIST AND ITS TABS WITHOUT BASE UI'S LIST, FOR A TAB STRIP THAT HYDRATES WITH THE PAGE (SortStrip's sort tabs,
 * in every home's HTML, `max-sm:hidden` on a phone). Hand-rolled on purpose (CLAUDE.md: Base UI first, hand-rolled last with
 * the reason), and only the LIST: the Tabs root stays Base UI. Measured on the phone home, 2026-11-25, with a React commit
 * probe that read `root.pendingUpdatersLaneMap` right after the hydration commit's layout effects (main b3a89597e): Base
 * UI's TabsList registers its tabs through CompositeList with a setState in a layout effect. That is a SYNC update inside the
 * hydration commit, and React then flushes every passive effect of the page in the same task, which made the phone's longest
 * task. Only two components scheduled Sync there: these tabs and the footer's accordion (now ui/disclosure.tsx).
 * Mounting Base UI's list later, at idle, was tried and dropped in the commit gate: replacing the buttons under the reader
 * lost a click or a Space press that straddled the swap, restored focus by guesswork, and closed an open Tooltip.
 * With `plain`, the list and its TabsTriggers render the SAME markup Base UI's server HTML has: classes, `role`,
 * `aria-selected`, `data-active`, `data-orientation`, `data-activation-direction`, `data-composite-item-active`, `data-slot`
 * (tabs.test.tsx compares the two). The keyboard follows the APG tabs pattern with manual activation, as Base UI's defaults
 * do: the active tab is the one Tab stop, ← / → / Home / End move focus (looping), and Enter / Space commit. A click calls
 * `onValueChange` exactly as Base UI's would: only for a tab that is not already active, after the tab's own onClick.
 */
type TabsPlain = { value: unknown; onValueChange: (value: unknown) => void }
const PlainContext = createContext<TabsPlain | null>(null)

function moveTabFocus(e: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return
  const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([aria-disabled="true"])')]
  const at = tabs.indexOf(document.activeElement as HTMLButtonElement)
  if (at < 0) return
  e.preventDefault()
  const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
  tabs[next].focus()
}

function TabsList({
  className,
  variant = "default",
  plain,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants> & { plain?: TabsPlain }) {
  if (plain) {
    // Every DOM prop the caller passes (aria-label, id, ref, style, handlers) lands on the plain list's div too; only Base UI's
    // own list options (render, activateOnFocus, loopFocus) have nothing to do here.
    const { children, onKeyDown, render: _render, activateOnFocus: _activate, loopFocus: _loop, ...rest } = props
    return (
      <PlainContext.Provider value={plain}>
        <div
          data-orientation="horizontal"
          data-activation-direction="none"
          role="tablist"
          data-slot="tabs-list"
          data-variant={variant ?? undefined}
          {...(rest as React.HTMLAttributes<HTMLDivElement>)}
          className={cn(tabsListVariants({ variant }), typeof className === "string" ? className : undefined)}
          onKeyDown={(e) => {
            onKeyDown?.(e as never)
            if (!e.defaultPrevented) moveTabFocus(e)
          }}
        >
          {children as React.ReactNode}
        </div>
      </PlainContext.Provider>
    )
  }
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
  const plain = useContext(PlainContext)
  const classes = cn(
    "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-lg border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-[scale] duration-[160ms] ease-spring-snappy active:scale-[0.97] active:duration-[60ms] group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
    "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
    // The line variant's underline switches with the tab — no fade (see the note above).
    "after:absolute after:bg-foreground after:opacity-0 group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
    keepPressTransition(className)
  )
  if (plain) {
    // A plain tab (TabsList `plain`): Base UI's server markup, a click that changes the value only when it is not already
    // active, and every other prop (a Tooltip's trigger handlers, aria-label, ref) passed through to the button.
    const { value, onClick, render: _render, nativeButton: _native, disabled, ...rest } = props
    const active = Object.is(plain.value, value)
    return (
      <button
        type="button"
        data-active={active ? "" : undefined}
        data-orientation="horizontal"
        data-activation-direction="none"
        aria-disabled={disabled ? "true" : "false"}
        tabIndex={active ? 0 : -1}
        role="tab"
        aria-selected={active}
        data-composite-item-active={active ? "" : undefined}
        data-slot="tabs-trigger"
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        className={classes}
        onClick={(e) => {
          onClick?.(e as never)
          if (!active && !disabled && !e.defaultPrevented) plain.onValueChange(value)
        }}
      />
    )
  }
  return <TabsPrimitive.Tab data-slot="tabs-trigger" className={classes} {...props} />
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
