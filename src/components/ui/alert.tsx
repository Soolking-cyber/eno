import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/* Alert — the tinted callout.
 *
 * Ten hand-rolled callouts existed before this primitive had a single importer, so
 * the API is shaped to THOSE, not to a generic shadcn card:
 *   tone       what the box MEANS (colour, from tokens only — never a palette class,
 *              which would not flip in dark mode)
 *   appearance whether it is a bordered card or a flat tint (most of the real ones
 *              are flat: bg-warning/10, no border)
 *   size       the four paddings that actually occur (chat note → xs, panels → lg)
 *   icon/title/action  the three optional slots the real ones use
 *
 * `variant` is the LEGACY axis and is untouched: default + destructive still emit
 * exactly the classes they always did, and tone/appearance/size all default to a
 * no-op, so an <Alert> written against the old API renders byte-identically.
 *
 * Alert is a plain <div>, not a Base UI render-child, so its OWN className goes
 * through cn()/tailwind-merge. That means a caller CAN safely override a base class
 * from the outside (className="rounded-xl" beats the base rounded-2xl). Do not
 * convert this to a `render` prop without revisiting that — on a render child the
 * class would be concatenated, not merged, and stylesheet order would decide.
 */
const alertVariants = cva(
  // NO svg auto-size rule here, deliberately. ui/button's `[&_svg:not([class*='size-'])]:size-4`
  // out-specificities a plain h-3.5 on an icon and silently inflates it to 16px — that footgun
  // has already refuted several swaps in this repo. The obvious guard (adding :not([class*='h-']))
  // is worse: it's a substring test that also swallows min-h-*/max-h-*, and a multi-:not()
  // arbitrary variant does not even survive Tailwind's parser — it compiles to nothing, so the
  // rule you think you wrote isn't there. Callers size their own icon: icon={<TriangleAlert className="h-4 w-4" />}.
  // The icon spans two rows ONLY when there is a title to sit beside — otherwise the
  // row-span invents an empty second row, and the row-gap makes a title-less callout
  // (which most of the real ones are) 2-4px taller than the div it replaced.
  "group/alert relative grid w-full gap-0.5 rounded-2xl border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 has-data-[slot=alert-title]:*:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
      },
      tone: {
        default: "",
        info: "border-brand/40 bg-brand-50 text-accent-foreground *:data-[slot=alert-description]:text-accent-foreground/90",
        warning:
          "border-warning/30 bg-warning/10 text-warning *:data-[slot=alert-description]:text-warning/90",
        success:
          "border-success/30 bg-success/10 text-success *:data-[slot=alert-description]:text-success/90",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive *:data-[slot=alert-description]:text-destructive/90",
      },
      appearance: {
        card: "",
        // Transparent, not removed: the 1px border stays in the box model, so a flat
        // alert and a card alert are the same height to the pixel.
        flat: "border-transparent",
      },
      size: {
        sm: "",
        xs: "gap-0.5 px-3 py-2 text-xs leading-relaxed",
        md: "gap-1 px-3.5 py-2.5",
        lg: "gap-1 p-4 sm:p-5",
      },
    },
    compoundVariants: [
      // A flat, un-toned callout is the neutral tint surface (bg-tint), not a card.
      { tone: "default", appearance: "flat", class: "bg-tint" },
    ],
    defaultVariants: {
      variant: "default",
      tone: "default",
      appearance: "card",
      size: "sm",
    },
  }
)

type AlertProps = Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof alertVariants> & {
    /** Leading icon. Rendered as a DIRECT grid child so the base grid/auto-size
     *  rules apply — pass the bare lucide element, e.g. icon={<TriangleAlert />}. */
    icon?: React.ReactNode
    /** Optional heading. When present, children are auto-wrapped in AlertDescription. */
    title?: React.ReactNode
    /** Optional trailing slot, absolutely positioned top-right (reserves pr-18). */
    action?: React.ReactNode
  }

function Alert({
  className,
  variant,
  tone,
  appearance,
  size,
  icon,
  title,
  action,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant, tone, appearance, size }), className)}
      {...props}
    >
      {icon}
      {title != null && <AlertTitle>{title}</AlertTitle>}
      {/* No title ⇒ children pass through untouched (the old composed API).
          With a title ⇒ they are the body, so they get description styling. */}
      {title != null ? <AlertDescription>{children}</AlertDescription> : children}
      {action != null && <AlertAction>{action}</AlertAction>}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction, alertVariants }
