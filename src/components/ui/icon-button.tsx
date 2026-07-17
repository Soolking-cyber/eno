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
//                        close/mute, video-feed rail). White ink + a baked drop-shadow so the
//                        glyph reads on ANY image, and NO hover fill (a hover chip over a photo
//                        looks like a bug). Fill-state (a filled heart) stays on the icon child:
//                        <Heart className={favorited ? 'fill-brand text-white' : 'fill-black/25'} />.
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
  overlay: 'text-white [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))]',
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
