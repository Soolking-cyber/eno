import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * ⚠️ THE Z LADDER'S NAMES MUST BE TAUGHT TO tailwind-merge, OR AN OVERRIDE SILENTLY LOSES. The ladder
 * in globals.css (`@theme { --z-index-* }`, D-Z 2026-09-29) mints `z-overlay`, `z-fab` … — and
 * tailwind-merge's stock `z` group accepts only integers, `auto` and arbitrary values, so it would
 * keep BOTH of `cn('z-overlay', 'z-[70]')` and leave stylesheet order to pick one (the concatenation
 * trap CLAUDE.md warns about). Tailwind sorts `z-[70]` before `z-overlay`, so the caller would lose.
 * Keep this list equal to the `--z-index-*` names in globals.css.
 *
 * ⚠️ THE FOUR HOUSE CURVES NEED THE SAME TREATMENT, FOR THE SAME REASON (D-LINT, 2026-09-29). Once they
 * became theme tokens (`@theme static { --ease-* }` in globals.css) the primitives spell the NAMED
 * utility (`ease-spring-snappy`) where they used the arbitrary var() form. tailwind-merge put the
 * arbitrary form in its `ease` group, but its stock theme knows only `in`, `out` and `in-out`, so a
 * named curve is an unknown class: `cn('ease-spring-snappy', 'ease-out')` kept BOTH, and Tailwind
 * emits the named curves after `ease-out`, so the primitive beat every caller (rental-check-pill's
 * 200ms `ease-out` entrance on <Button>, the theme Switch thumb in preferences-inline). `theme.ease`
 * is the key tailwind-merge's `ease` group reads, i.e. the same namespace as Tailwind's `--ease-*`.
 * Keep this list equal to the `--ease-*` names in that block; utils.test.ts reads both.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      ease: ['out-strong', 'spring', 'spring-snappy', 'bounce'],
    },
    classGroups: {
      z: [{ z: ['raised', 'sticky', 'nav', 'fab', 'overlay', 'tooltip', 'splash', 'consent', 'map-overlay', 'nested-popover'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** The single brand blue (`--primary` in globals.css). Use for inline styles that can't
 *  reach the Tailwind token — e.g. the fallback background of an initials avatar. */
export const BRAND_BLUE = '#0a66c2'

/** "Nguyen Van A" → "NA" — the app-wide avatar-initials rule (first letters of the
 *  first two words, uppercased). Was copy-pasted in five components. */
export function getInitials(name: string | null | undefined): string {
  return (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

/** Privacy-safe stand-in for a missing display name: first 2 chars of the email
 *  local part + '***' ("mi***"). Distinguishable to a counterparty, but never the
 *  address itself — raw emails must not reach chat payloads or public reviews
 *  (PII sweep 2026-07-06). */
export function maskEmailHandle(email: string | null | undefined): string | null {
  const local = (email || '').split('@')[0]
  if (!local) return null
  return `${local.slice(0, 2)}***`
}
