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
//                        close/mute, video-feed rail). White ink on its OWN translucent dark
//                        scrim, so the glyph is legible against a white photo, a black photo and a
//                        saturated graphic alike. ⛔ THIS DESCRIPTION CHANGED ON 2026-08-18 — it
//                        used to say "white ink + a baked drop-shadow … and NO hover fill (a hover
//                        chip over a photo looks like a bug)". The hover-chip warning still holds
//                        and is not what this is: an ALWAYS-present chip reads as a control, a chip
//                        that appears on hover reads as a glitch. The rest was measured wrong — see
//                        the note on the variant itself for the three treatments that were rendered
//                        on a live listing before this one was chosen.
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
   * OVER MEDIA — white ink on its OWN dark scrim, so the control is legible against anything.
   *
   * ⛔ IT USED TO BE INK + A DROP SHADOW, AND THAT FAILS ON REAL CONTENT. Owner, 2026-08-18, on the
   * PDP: "make them background agnostic dark on light background and light on dark background for
   * best visibility". Screenshotted on a live listing whose artwork puts a saturated purple badge
   * exactly under this cluster: a white glyph with a 1px shadow was close to invisible, and the
   * share icon sat on top of white label text.
   *
   * ⚠️ THREE TREATMENTS WERE RENDERED ON THAT REAL PAGE BEFORE CHOOSING, because this is a
   * question about pixels and no amount of reasoning settles it:
   *   A  mix-blend-mode: difference — literally what was asked, ink inverts against the backdrop.
   *      REJECTED on measurement: over the purple it inverted to a muddy yellow that read no
   *      better, it goes INVISIBLE on mid-grey (|128−255| ≈ 127, i.e. mid-grey on mid-grey), and
   *      it would invert the saved heart's red to cyan — a state colour, not decoration.
   *   C  white fill + a dark `paint-order: stroke` outline. Legible, closest to the old look, but
   *      still competing with busy artwork directly behind the glyph.
   *   B  this one. Clearest of the three on every background by a wide margin, and the only one
   *      that leaves coloured state alone.
   * The owner picked B from the rendered comparison.
   *
   * ⚠️ THE SCRIM IS THE BUTTON'S OWN BACKGROUND, NOT A HOVER FILL. The note this replaces warned
   * that "a hover chip over a photo looks like a bug", and that is still true — a chip that appears
   * only on hover reads as a glitch. A chip that is ALWAYS there reads as a control. It is also why
   * `rounded-full` lives here: the scrim needs a shape of its own, and the size classes already
   * make the box square.
   *
   * ⚠️ THE DROP SHADOW STAYS, WEAKER. The scrim itself needs to separate from a same-dark photo, and
   * a shadow is what does that; it is no longer carrying legibility on its own.
   *
   * ⚠️ COLOURED STATE STILL OVERRIDES, exactly as before: <Heart className="fill-current
   * text-destructive"> on the icon CHILD wins over `text-white` here, so a saved heart is still red
   * — now on a dark chip, which is where it reads best anyway.
   */
  overlay:
    'rounded-full bg-black/45 text-white backdrop-blur-[2px] [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.35))]',
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
