'use client'

import * as React from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cn } from '@/lib/utils'

// Shared icon-button SHELL — the round, centered, 44px-tap-target box that's hand-rolled
// across the app (header, notifications, share, close ✕, overflow…). It bakes in ONLY the
// structural boilerplate every one of them repeats — `relative flex items-center justify-center
// rounded-full shrink-0 cursor-pointer tap-44` + the size box — and NOTHING else, so migrating
// is a faithful, zero-visual-change swap: each site keeps its own tone (text-*, hover:bg-*,
// transition, any active:scale) via className. `size` sets the box; the icon child sizes itself.
//
// Two opt-ins, both ADDITIVE (defaults reproduce the original shell byte-for-byte):
//
//   variant="overlay"  — for controls layered OVER MEDIA (favourite heart on a photo, gallery
//                        close/mute, video-feed rail). White ink with a dark OUTLINE on the glyph
//                        itself, so it reads as a dark icon on a light photo and a white icon on a
//                        dark one, with NO chip of any kind.
//                        ⛔ THIS DESCRIPTION HAS CHANGED TWICE ON 2026-08-18. It said "white ink +
//                        a baked drop-shadow", then "white ink on its own translucent dark scrim"
//                        — the chip shipped in the morning and the owner reversed it the same day
//                        ("no circles"). The surviving rule from all three versions is that a
//                        HOVER chip reads as a glitch; that is not an argument for a permanent one.
//                        See the note on the variant for the backgrounds each option was rendered
//                        against before this one was chosen.
//                        Fill-state stays on the icon child: <Heart className={favorited ?
//                        'fill-current text-destructive' : 'fill-none'} />.
//                        (saved is RED app-wide since 2026-08-13; the colour rides on text-*
//                        because these glyphs paint every path with fill="currentColor".)
//                        ⚠️ POSITIONING IS THE CALLER'S. The primitive owns no absolute/inset —
//                        pass `absolute right-2 top-2` (or fixed/z-*) in className. That works
//                        because className is the LAST arg to cn(): tailwind-merge resolves the
//                        position group in favour of the later class, so the caller's `absolute`
//                        beats the baked `relative`. Same escape hatch for the shadow itself: an
//                        `[filter:drop-shadow(...)]` in className replaces the baked one (twMerge
//                        dedupes by arbitrary-property name). Anything you put on a CHILD is
//                        concatenated, not merged — overrides belong on the button's className.
//
//   tapTarget={false}  — drop the `tap-44` ::before. READ BEFORE USING: `tap-44` grows an
//                        INVISIBLE 44×44 hit area that OVERFLOWS the visual box. That is a11y
//                        gold in isolation and a LANDMINE in a dense cluster: where two controls
//                        sit <44px apart their hit areas overlap, and a tap near the boundary
//                        fires the WRONG button. In compact-listing-row that means a tap meant
//                        for "chat" sends an OFFER — which is exactly why four controls there
//                        refused this primitive. Turning the tap target off puts the control
//                        UNDER the 44px minimum (Apple/Google, WCAG 2.5.5 AAA). It is acceptable
//                        ONLY in a tight cluster where the alternative is firing the wrong
//                        action; it is NEVER the fix for a lone button — grow that one's `size`
//                        instead. Default stays `true`.
//
// Still NOT for: badge/decorative spans, nav tabs, brand-filled FABs — those stay bespoke.
/**
 * ⚠️ THE CLOSE MARK IS SIZED TO ITS BUTTON, AND THE NUMBER IS NOT THE BUTTON'S SIZE. Owner,
 * 2026-08-26: *"make this icon fit its outline everywhere across the app"* — pointing at a ✕ that
 * was 20px inside a 40px button. The ✕ now fills every IconButton it owns, at 19 call sites.
 *
 * ⛔ A GLYPH DOES NOT PAINT ITS OWN BOX, so `h-10` in an `h-10` button leaves a visible ring, not a
 * flush mark. Measured off rendered pixels: Solar's ✕ inks 90.0% of its box (90px at box 100).
 * The rule is therefore `glyph = round((button - 2) / 0.9)`, which lands ~1px of INK inside the
 * button edge — the glyph box deliberately OVERFLOWS the button by a few px and paints nothing there:
 *   xs 28px → 29px    sm 32px → 33px    md 36px → 38px    lg 40px → 42px
 * ⚠️ 0.9 IS THIS GLYPH'S NUMBER AND DOES NOT TRANSFER. Measured the same week: question-square
 * needed box 50 for a 1px gap in a 44px plate, dialog-2 needed 46. Re-measure per icon; the
 * sprite's own bbox is not a shortcut (it predicted 42 where the page rendered 40).
 * ⚠️ A PERCENTAGE RULE WAS THE OBVIOUS SHAPE AND IS WRONG HERE — `review-prompt` gives its
 * IconButton `h-auto w-auto p-1`, so a `width: 104%` glyph sizes against a box that is sized by the
 * glyph. That one site is deliberately left alone: with no fixed box there is no outline to fit.
 */
const SIZES = {
  xs: 'h-7 w-7',
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-10 w-10',
} as const

const VARIANTS = {
  // `ghost` MUST stay the empty string — it is the original shell, and every pre-existing
  // call site relies on the class list being exactly the base + size + its own className.
  ghost: '',
  /**
   * OVER MEDIA — white ink with a dark OUTLINE, and no chip of any kind.
   *
   * ⛔ THE DARK CIRCLE SHIPPED THIS MORNING AND THE OWNER REVERSED IT THE SAME DAY: "remove the
   * circles around icons on product pages and cards make the icons bolder at least or background
   * color agnostic no circles". The chip WAS the most legible option and it was chosen from a
   * rendered comparison — but legibility was never the only requirement, and two solid discs on
   * every card is a heavier mark than this UI wants. Do not restore it as a fix for contrast.
   *
   * ⚠️ AN OUTLINED GLYPH IS THE ONLY TREATMENT THAT ACTUALLY DELIVERS THE ORIGINAL BRIEF — "dark on
   * light background and light on dark background". Rendered on the real PDP against three
   * backgrounds before choosing:
   *   · white  → the dark stroke carries it; it reads as a dark icon.   ✓
   *   · black  → the white fill carries it; it reads as a white icon.   ✓
   *   · mid blue → both halves visible, which is exactly where
   *     `mix-blend-mode: difference` collapses to invisibility.          ✓
   * A drop-shadow halo was tested in the same pass and rejected: on pure white it washes out to a
   * grey smudge, because a white glyph on white has nothing but the halo doing the work.
   *
   * ⚠️ `paint-order: stroke fill` IS THE LOAD-BEARING PROPERTY. Without it the stroke is painted
   * OVER the fill and eats the glyph from the inside — a 2px stroke on a 1.5px line leaves a black
   * blob. Painting the stroke first and the fill on top makes it an outline around the mark, which
   * is also what makes the glyph read as BOLDER, the other half of what the owner asked for.
   *
   * ⚠️ IT IS APPLIED TO THE `svg` CHILD, NOT THE BUTTON, because these glyphs are `<use>` references
   * into an external sprite: stroke on the button inherits nowhere useful, and a `filter` on the
   * button would blur the whole box rather than trace the path.
   *
   * ⚠️ COLOURED STATE STILL OVERRIDES: <Heart className="fill-current text-destructive"> on the icon
   * CHILD wins over `text-white` here, so a saved heart is still red — now a red heart with a dark
   * outline, which is more legible on a bright photo than the bare red was.
   */
  overlay:
    'text-white [&_svg]:[paint-order:stroke_fill] [&_svg]:[stroke:rgba(0,0,0,0.78)] [&_svg]:[stroke-width:2px] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-linecap:round]',
} as const

export function IconButton({
  size = 'md',
  variant = 'ghost',
  tapTarget = true,
  className,
  children,
  type = 'button',
  ...props
}: {
  size?: keyof typeof SIZES
  variant?: keyof typeof VARIANTS
  /** false = no 44px ::before. Under the a11y minimum — dense clusters only. See header. */
  tapTarget?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // Base UI's Button primitive (was a raw <button>): same rendered <button>, but consistent
  // focus-visible / disabled / keyboard-activation semantics with the rest of the ui/* controls.
  // The class list is byte-for-byte the original shell, so appearance + `className`-last precedence
  // (caller overrides `relative`→`absolute`, `rounded-full`, the shadow, etc.) are unchanged. No
  // press-scale is baked in on purpose: many IconButtons are floating-ui anchors (bell, overflow),
  // and scaling a popup's anchor would shift the open popup (see custom-select). Callers still opt
  // into their own `active:scale-*` via className exactly as before.
  return (
    <ButtonPrimitive
      type={type}
      data-slot="icon-button"
      className={cn(
        'relative flex shrink-0 cursor-pointer items-center justify-center rounded-full',
        tapTarget && 'tap-44',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  )
}
