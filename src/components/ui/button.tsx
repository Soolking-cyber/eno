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
  // NOTE: the icon auto-size rule deliberately does NOT live here — see the
  // `iconSize` variant below. It must stay reachable from `buttonVariants()`
  // (pagination.tsx styles a bare <a> with it), which is why it is a variant
  // with a `true` default rather than something the component adds.
  // cursor-pointer is BAKED IN, deliberately. Tailwind v4's preflight sets
  // `button { cursor: default }`, so a primitive that omits the cursor forces every single
  // call site to remember `cursor-pointer` — and across this sweep it was forgotten ELEVEN
  // times, each one an interactive control that silently reads as dead on desktop. A rule
  // that must be re-stated at every call site is a defect in the primitive, not in the
  // callers. (`disabled:pointer-events-none` below already suppresses hover on a disabled
  // button, so this needs no disabled: counterpart.)
  "cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-100 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
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
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "border bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        // Like `ghost`, minus the hover text-colour change. `ghost`/`outline` both
        // force hover:text-accent-foreground, so a button whose label is text-body
        // or text-muted-foreground had to hand-neutralise it with hover:text-body —
        // easy to forget, and it silently recolours the label on hover when it is.
        // `soft` gives the muted hover BACKGROUND only and leaves the label colour
        // entirely to the caller (no hover:text-* at all, so nothing to fight).
        // Transparent at rest, no border.
        soft:
          "hover:bg-muted",
        link: "text-primary underline-offset-4 hover:underline",
        // The empty variant. Every other variant paints *something* on hover
        // (ghost/soft/outline set a hover background, link underlines), so a
        // button that must stay visually inert had to hand-write
        // `hover:bg-transparent` to undo it. `bare` paints nothing at rest and
        // nothing on hover: no background, no border, no underline, and no
        // colour — the label colour is entirely the caller's.
        //
        // It is intentionally the empty string. What `bare` still inherits from
        // the base is exactly what is NOT decoration: the focus-visible ring
        // (accessibility) and the active:scale press feedback. Do not add a
        // hover:* here — that is the whole point of the variant. Pair with
        // size="none" when the caller also owns the box.
        bare: "",
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
      // THE ICON RULE.
      //
      // Old: `[&_svg:not([class*='size-'])]:size-4` → `.btn svg:not(...)`, which
      // is specificity (0,2,1). An icon's own `h-3 w-3` is a single class (0,1,0)
      // and therefore LOST: a 12px glyph rendered at 16px, and an h-11 (44px) one
      // was *shrunk* to 16px. The caller could not win — even `[&_svg]:size-3`
      // on the button lost, because it ties at (0,2,1) and then stylesheet order,
      // not authoring order, decides. That single rule is why ~62 of the app's raw
      // controls could not adopt ui/button.
      //
      // New: `[:where(&)_svg]:size-4` compiles to `:where(.btn) svg`. :where()
      // contributes ZERO specificity, so the rule lands at (0,0,1) — weaker than
      // ANY single class the icon declares. Consequences:
      //   * icon with h-3/w-3, h-3.5, size-3, h-11 … → (0,1,0) beats (0,0,1). Caller wins.
      //   * icon with no sizing at all → nothing competes; (0,0,1) still beats
      //     lucide's width/height *attributes* (presentational attrs = specificity 0),
      //     so it renders at 16px exactly as before.
      // This drops the substring-sniffing :not() entirely: it matches h-*, w-*,
      // size-*, min-h-*, arbitrary sizes and anything else, for free.
      //
      // VERIFY IN THE BUILT CSS — do not take this on trust. A silently-empty
      // selector is invisible, and the failure mode here is severe (no rule at all
      // ⇒ every unsized icon jumps to lucide's native 24px):
      //   grep -o ':where([^)]*) svg{[^}]*}' .next/static/chunks/*.css
      // must print a rule setting width/height to calc(var(--spacing) * 4), and
      //   grep -c 'svg:not(\[class\*=size-\])' .next/static/chunks/*.css
      // must no longer report button's copy of the old rule. (Confirmed compiling
      // under tailwindcss 4.3.1; :where() in an arbitrary variant is supported.)
      iconSize: {
        true: "[:where(&)_svg]:size-4",
        // Escape hatch: emit no icon rule whatsoever, for a caller whose icons are
        // sized by an ancestor, by attributes, or not at all.
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      // Default true ⇒ `buttonVariants({ variant, size })` (pagination.tsx) keeps
      // emitting the icon rule with no change at its call site.
      iconSize: true,
    },
  }
)

function Button({
  className,
  variant,
  size,
  // Destructured (not spread) on purpose: `iconSize` is a styling prop, and
  // letting it fall into ...props would put an unknown `iconsize` attribute on
  // the DOM node and trip a React warning.
  iconSize,
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
        // asChild renders a NON-native-button element (every call site passes a <Link>/anchor), so
        // tell Base UI so — otherwise it expects a real <button> and logs a dev console error.
        nativeButton={false}
        render={children as React.ReactElement<Record<string, unknown>>}
        className={cn(buttonVariants({ variant, size, iconSize, className }))}
        {...rest}
      />
    )
  }
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, iconSize, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
