"use client"

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { ChevronDown } from "@/components/ui/icons"

import { cn } from "@/lib/utils"

// Base UI Accordion (CLAUDE.md: Base UI is the first choice for any new structural
// control). Added for the Help Center FAQ, which is the call site — docs/design-language.md
// had deleted `collapsible` for having none.
//
// The Root defaults to `hiddenUntilFound`, which is the whole reason this is an accordion
// and not a list of toggles: collapsed panels stay in the DOM as `hidden="until-found"`, so
// the browser's own Ctrl+F / "Find on page" locates an answer inside a closed section and
// expands it. On a help surface that is the difference between "we have that answer" and
// "the user never found it". It also keeps the copy in the SSR HTML, so the text is
// crawlable and the translation layer sees it on first paint.

function Accordion({ className, hiddenUntilFound = true, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      hiddenUntilFound={hiddenUntilFound}
      className={cn("w-full", className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b border-border last:border-b-0", className)}
      {...props}
    />
  )
}

function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header data-slot="accordion-header" className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/acc-trigger flex flex-1 items-start justify-between gap-4 py-4 text-left text-base font-bold text-foreground transition-colors",
          "hover:text-accent-foreground focus-visible:outline-1 focus-visible:outline-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
        {/* mt-0.5 optically centres the chevron against the first line of a title
            that may wrap to two or three lines on a phone. */}
        <ChevronDown
          aria-hidden
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-panel-open/acc-trigger:rotate-180"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionPanel({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-panel"
      // --accordion-panel-height is published by Base UI, so the open/close is a real
      // height transition rather than a jump. `hidden` panels must not animate in.
      className="h-[var(--accordion-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0"
      {...props}
    >
      <div className={cn("pb-4 text-sm leading-relaxed text-body", className)}>{children}</div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionPanel }
