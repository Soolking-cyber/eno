"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      // The data-horizontal/data-vertical variants only exist because globals.css defines
      // them against Base UI's data-orientation attribute — without those two @custom-variant
      // lines Tailwind compiles them to `[data-vertical]`, which Base UI never emits, and the
      // separator renders at zero size: in the DOM, invisible on screen.
      //
      // No self-stretch here, deliberately: a vertical rule needs a height, and `stretch`
      // degrades to flex-start the moment the caller gives it one — which top-aligns the rule
      // inside a centered row. Callers pass their own height + alignment.
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
