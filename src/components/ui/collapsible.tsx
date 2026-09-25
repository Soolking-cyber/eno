"use client"

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

import { cn } from "@/lib/utils"

// Base UI Collapsible — a disclosure: one trigger (a real <button> carrying aria-expanded and
// aria-controls, wired by the library) that shows or hides one panel. CLAUDE.md: Base UI first for
// any new structural control; a hand-rolled `aria-expanded` button + conditional region is the
// hand-roll this replaces. docs/design-language.md deleted an earlier `collapsible` for having no
// call site — the first one is the phone feed's collapsed category ladder (ladder-compact-row.tsx).
//
// ⚠️ THE PANEL UNMOUNTS WHEN CLOSED (Base UI's default, `keepMounted` false). That is deliberate
// for the first caller: what it hides fetches on mount, and a closed ladder should cost nothing.
// Pass `keepMounted` (or `hiddenUntilFound`, for find-in-page) where closed content must stay.

function Collapsible(props: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger(props: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
}

function CollapsiblePanel({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel data-slot="collapsible-panel" className={cn(className)} {...props} />
}

export { Collapsible, CollapsibleTrigger, CollapsiblePanel }
