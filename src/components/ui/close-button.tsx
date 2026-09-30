'use client'

import * as React from 'react'
import { X } from '@/components/ui/icons'
import { IconButton } from '@/components/ui/icon-button'
import { useLanguage } from '@/context/language-context'
import { CLOSE_GLYPH } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'

/**
 * THE ✕ CLOSE / DISMISS / REMOVE CONTROL (D-CLOSE, 2026-09-29).
 *
 * ⚠️ THE SIZE SPREAD THIS REPLACES WAS MOSTLY THE OWNER'S RULE, NOT DRIFT. On 2026-08-26 (43dd9bcf,
 * "make this icon fit its outline everywhere") the Solar ✕ was sized to FILL its IconButton, which
 * made the glyph a function of the button: 29 in a 28, 33 in a 32, 38 in a 36, 42 in a 40. The rule
 * lived in a comment (ui/icon-button.tsx), so every call site hand-typed the pixel value — and the
 * ones that overrode the button box without re-deriving the glyph drew a 26px ring on a 20px plate
 * (appeal and reports) or a 29px mark in a 24px box (facet-bar). Here the glyph is looked up from the
 * button size, so the two cannot disagree: CLOSE_GLYPH in src/lib/icon-tokens.ts holds both rules.
 *
 * What it keeps from IconButton, unchanged: the 44px `tap-44` hit area (opt out with
 * `tapTarget={false}` only in a dense cluster), `relative`, and className-last precedence — so a
 * caller's `absolute right-2 top-2` positions it, and a caller's ink replaces the default one.
 *
 *   variant="ghost"   the default — a bare mark in the house close ink: `text-ink-4`, darkening to
 *                     `text-foreground` on hover. The mark fills the button.
 *   variant="overlay" over media — the IconButton plate (`.plate-host`); the plate is glyph + 6, so
 *                     the glyph is the button − 6 and the disc hugs the button exactly.
 *   size="2xs"        a 24px box (IconButton has no such size; this is the `xs` shell narrowed) —
 *                     the photo-tile remove: 24px plate, 18px mark (the post wizard's measured pair).
 *
 * ⛔ ONLY EVER THE ✕. The 0.9 fill factor is Solar's ✕ and no other glyph's; a different mark in this
 * shell would sit off its edge. The label defaults to "Close"/"Đóng" — pass `label` whenever the
 * action is something else ("Remove", "Dismiss", "Cancel"): a screen reader hears only this.
 *
 * Not for: the dialog/sheet primitives' own close (a bare size-6 glyph with no plate — its own
 * idiom), badge.tsx's in-chip removable ✕ (owner-sized, opacity-60), or the h-3 in-chip marks.
 */
export function CloseButton({
  size = 'md',
  variant = 'ghost',
  label,
  className,
  children: _children,
  ...props
}: {
  size?: keyof typeof CLOSE_GLYPH.ghost
  variant?: keyof typeof CLOSE_GLYPH
  /** The accessible name. Defaults to "Close" — say what the ✕ actually does when it is not that. */
  label?: string
} & Omit<React.ComponentProps<typeof IconButton>, 'size' | 'variant'>) {
  const { tr } = useLanguage()
  return (
    <IconButton
      size={size === '2xs' ? 'xs' : size}
      variant={variant}
      aria-label={label ?? tr('Close', 'Đóng')}
      // The tone goes BEFORE the caller's className, so a caller's own ink (`text-body`, `text-ink-3`)
      // replaces it through tailwind-merge. Overlay owns its ink (white on the plate), so no tone there.
      className={cn(size === '2xs' && 'h-6 w-6', variant === 'ghost' && 'text-ink-4 hover:text-foreground', className)}
      {...props}
    >
      <X aria-hidden className={cn(CLOSE_GLYPH[variant][size], 'shrink-0')} />
    </IconButton>
  )
}
