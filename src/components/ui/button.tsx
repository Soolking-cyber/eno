import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Press feedback: a subtle compositor-only scale (active:scale-[0.97] at 100ms,
  // transition-all already covers transform). Call sites that pass their own
  // active:scale-* via className win through cn()'s tailwind-merge — no
  // double-scale. Reduced motion: the global kill switch in globals.css makes the
  // transition instant (the pressed state itself remains, as it should).
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-100 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90",
        // Canonical brand CTA — matches the app's hand-rolled primary buttons
        // (solid brand blue, white text, bold, darken-on-hover). Use this for new
        // primary actions instead of re-coding bg-primary/hover:bg-brand-dark.
        cta:
          "bg-primary text-white font-bold hover:bg-brand-dark",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "border bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-xl gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-xl px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-7",
        "icon-xs": "size-6",
        // Impose no height/padding — the caller's className fully controls sizing.
        // Used when migrating hand-rolled buttons so their exact look is preserved.
        none: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  // Base UI has no Slot; `asChild` maps onto the primitive's render prop so the
  // 19 existing <Button asChild><Link/></Button> call sites keep working verbatim.
  if (asChild) {
    const { children, ...rest } = props as { children?: React.ReactNode }
    return (
      <ButtonPrimitive
        data-slot="button"
        render={children as React.ReactElement<Record<string, unknown>>}
        className={cn(buttonVariants({ variant, size, className }))}
        {...rest}
      />
    )
  }
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
