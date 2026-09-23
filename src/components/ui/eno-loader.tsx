'use client'

import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * THE APP'S LOADING MARK: an acrylic tile flipping in 3D with the eno "e" punched through it.
 *
 * Owner, 2026-09-24 — "if we have a loading state use this one but semitransparent and personalized
 * to app where square has our logo inside on both sides like a semitransparent acrylic with e logo
 * punched through".
 *
 * ⛔ THIS IS FOR A WAIT THE READER NOTICES — a route or a panel that has nothing to show yet. It is
 * NOT for buttons: a 24px tile cannot carry a legible glyph, and a mutation already has its own
 * idiom (lucide `Loader2` inside the button, ~95 sites, deliberately left alone). Nor does it
 * replace a SKELETON: where the shape of what is coming is known, a skeleton says more than any
 * spinner can, which is why all seven `loading.tsx` files and the map placeholder use one.
 *
 * ⚠️ THE GLYPH IS A HOLE, not white ink — see `.eno-flip` in globals.css. That is what makes it work
 * on a photo, a dialog and a dark surface rather than only on white.
 *
 * ⚠️ IT CARRIES THE ACCESSIBLE NAME ITSELF. Every site this replaces paired a decorative spinner
 * with its own visible "Loading…" text; folding the label in as `sr-only` means a screen reader
 * still hears it while the screen shows the mark alone.
 */
const SIZES = {
  sm: 'h-8 w-8',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
} as const

export function EnoLoader({
  size = 'md',
  label,
  className,
}: {
  size?: keyof typeof SIZES
  /**
   * What is being waited for, for assistive tech. Falls back to a translated "Loading".
   *
   * ⚠️ THE FALLBACK GOES THROUGH `tr`, WHICH IS WHY THIS COMPONENT IS `'use client'`. A hard-coded
   * "Loading" would have announced English to a Vietnamese screen-reader user on all seven call
   * sites that pass no label — the exact string class the working agreement routes through
   * `tr(en, vi)`.
   */
  label?: string
  className?: string
}) {
  const { tr } = useLanguage()
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex flex-col items-center justify-center', className)}>
      <span aria-hidden="true" className={cn('eno-flip block', SIZES[size])} />
      <span className="sr-only">{label ?? tr('Loading', 'Đang tải')}</span>
    </span>
  )
}
