import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Press feedback: a subtle compositor-only scale (active:scale-[0.97] at 160ms on
  // --ease-spring-snappy).
  //
  // ⚠️ 160ms + THE SNAPPY SPRING IS THE CONTRACT, NOT A PREFERENCE. globals.css pairs each
  // curve with a duration band — snappy is "toggles/chips/press, pair 160–220ms" — and this
  // is THE canonical button, so it was the loudest place the app ignored its own rule. It
  // ran 100ms (below the band) on Tailwind's DEFAULT cubic-bezier(0.4,0,0.2,1), a symmetric
  // Material curve. Measured across src/: 134 `duration-*` declarations, only 23 lines that
  // also name an easing — so ~111 transitions were Material, in a system whose design
  // language says "spring". Fixing the button first is the highest-leverage single edit.
  //
  // ⚠️ THE PROPERTY LIST IS EXPLICIT, AND ALL FOUR TRANSFORM PROPERTIES ARE NAMED.
  // `transition-all` also animates LAYOUT properties, so any variant changing
  // padding/width/height animates geometry — jank, never intended. But narrowing is only
  // safe if the list is complete, and the first version of it was NOT: it listed
  // `transform` and stopped, on the assumption that `transform` covers translate/rotate.
  // It does not — Tailwind v4 emits `translate-*`, `scale-*` and `rotate-*` as STANDALONE
  // properties, which is the same fact stated about `scale` just below. Two review families
  // caught it; measured `transition-property` confirmed `translate` and `rotate` were absent,
  // so a future negative-translate press variant would have snapped. Tailwind's own
  // `transition-transform` shorthand expands to all four, so anything less is a regression
  // against the utility it replaces.
  //
  // ⚠️ THE LIST IS DERIVED FROM TAILWIND'S OWN `transition` DEFAULT, MINUS LAYOUT — do not
  // hand-curate it from imagination. Read the default at runtime and diff against it; that is
  // how the second omission was found (`outline-color`, `text-decoration-color`, `fill`,
  // `stroke` were all missing, so an animated focus outline, an underline colour, or an icon
  // with an explicit `fill-*`/`stroke-*` would have snapped). What is deliberately excluded
  // is only the layout/paint-order group: `display`, `content-visibility`, `overlay`,
  // `pointer-events`, and the gradient stops. If you add a variant that animates something
  // else, add it here.
  //
  // ⚠️ USE THE `ease-` UTILITY WITH AN ARBITRARY VALUE, NOT AN ARBITRARY-PROPERTY CLASS that
  // sets the timing-function longhand directly. The longhand form does not set `--tw-ease`,
  // so tailwind-merge does not group it with `ease-*`: a call site passing `ease-out` would
  // NOT win through cn(), both classes would ship, and stylesheet order would decide (the
  // concatenation trap in CLAUDE.md). The utility form sets the variable Tailwind's own
  // transition utility reads, so it survives both.
  //
  // ⚠️ AND DO NOT SPELL THAT LONGHAND CLASS OUT IN A COMMENT. Tailwind v4 scans source TEXT,
  // not parsed code, so a class-shaped string inside a comment is compiled like any other.
  // Writing the arbitrary-property form here — with an ellipsis standing in for the value —
  // emitted a real CSS rule whose value was that ellipsis, and broke the build outright:
  // "Parsing CSS source code failed / Unexpected token Ident". Describe such classes in
  // prose, or break the bracket, but never write a complete one in a comment.
  // Note Tailwind v4's scale-* utilities set the standalone
  // `scale` property, NOT `transform`; the two are independent and COMPOSE, which is
  // exactly how a second press-scale used to compound here (see the `.press` block in
  // globals.css). Call sites that pass their own active:scale-* via className win through
  // cn()'s tailwind-merge — no double-scale. `.press` no longer double-scales either: its
  // shrink is now the same `scale` property, emitted from @layer components, so this base
  // value beats it and a `<Button className="press">` presses exactly once, at 0.97.
  // Reduced motion: the global kill switch in globals.css makes the transition instant
  // (the pressed state itself remains, as it should).
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
  "cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,opacity,box-shadow,filter,backdrop-filter,transform,translate,scale,rotate] duration-[160ms] ease-[var(--ease-spring-snappy)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
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
      // MIN-height, never height, on every size that holds TEXT.
      //
      // The app now applies the OS text-size preference as
      // `-webkit-text-size-adjust: <85–150>%` on <body> (src/lib/native-text-zoom.ts).
      // That multiplier scales the used font-size, and Tailwind v4's type scale ships
      // UNITLESS line-height ratios (`--text-sm--line-height: calc(1.25 / 0.875)`), so the
      // LINE BOX scales with it: text-sm's 20px line becomes ~30px at 150%. A `h-9` button
      // is a 36px box holding 30px of line plus 16px of py — it overflows by 10px, and any
      // ancestor with overflow:hidden turns that into the mid-word clipping that got the
      // hand-built native apps shelved. `min-h-*` renders IDENTICALLY at 100% (the natural
      // content height is ≤ the minimum in every case: 20+16=36 for default, 20 for sm/lg)
      // and simply grows when the glyphs do.
      //
      // ⚠️ `default` is py-1.5, NOT py-2, and that 2px matters. Vertical padding is invisible
      // under a FIXED height (the box is pinned either way) but decides the natural height under
      // a MINIMUM one. `variant="outline"` adds a 1px border, so py-2 would have made the natural
      // height 1+8+20+8+1 = 38px — ABOVE min-h-9's 36px — and every outline button would have
      // grown 2px at the DEFAULT text size. py-1.5 keeps it at 34px, inside the 36px floor with
      // or without a border, so the rendered box stays exactly 36px until the glyphs really do
      // need more. (sm/lg carry no vertical padding: 20+2 = 22px, far under their 32/40px floors.)
      //
      // The ICON sizes deliberately keep `size-*`: they hold a glyph, not a line box, so
      // nothing reflows, and they must stay SQUARE (a min-h on a circle deforms it).
      size: {
        default: "min-h-9 px-4 py-1.5 has-[>svg]:px-3",
        sm: "min-h-8 rounded-xl gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "min-h-10 rounded-xl px-6 has-[>svg]:px-4",
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
  // asChild = a real Slot (Base UI ships none): merge the button STYLING onto the child element
  // itself rather than wrapping it in Base UI's Button.
  //
  // ⚠️ Why NOT the old `<ButtonPrimitive render={child} nativeButton={false}>`: every asChild call
  // site passes a NAVIGATING <Link>/<a>, and Base UI's useButton stamps `role="button"` UNCONDITION-
  // ALLY when nativeButton is false — so all 28 CTAs shipped as `<a href role="button">`, i.e. links
  // announced to assistive tech as buttons (verified live: `<a href="/post" role="button">`). And
  // `nativeButton` true instead only trades that for a dev console warning. Cloning keeps the child's
  // native role="link", applies the styling via className, and emits no warning.
  //
  // Safe as a plain clone: audited all 28 sites — each passes a SINGLE element and puts nothing but
  // styling on <Button> (no onClick/DOM props), so `rest` is empty and there is nothing to compose;
  // href/onClick/ref already living on the child are preserved by cloneElement. className is the one
  // thing that must be merged by hand (child's own classes win via tailwind-merge).
  //
  // ⚠️ CONTRACT for asChild: put BEHAVIORAL props (onClick, onKeyDown, ref, …) on the CHILD element,
  // not on <Button asChild>. Unlike the old Base-UI render path this does NOT compose handlers, so a
  // handler on <Button> would silently replace the child's. `...rest` is spread FIRST so it can never
  // clobber `data-slot`/`className`; if a call site ever legitimately needs a merged handler on the
  // wrapper, add composition here rather than moving the prop.
  if (asChild) {
    const { children, ...rest } = props as { children?: React.ReactNode }
    const child = React.Children.only(children) as React.ReactElement<Record<string, unknown>>
    return React.cloneElement(child, {
      ...rest,
      'data-slot': 'button',
      className: cn(buttonVariants({ variant, size, iconSize, className }), child.props.className as string | undefined),
    })
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
