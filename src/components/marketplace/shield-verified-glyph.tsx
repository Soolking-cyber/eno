import type { CSSProperties } from 'react'
import { ICON_SPRITE_CORE } from '@/components/ui/icons'

/**
 * Solar `shield-check` (Outline/rest), the trust chip's and the partner badge's shield, as ONE `<use>` into the core sprite —
 * not its ~2 KB of path data inlined into every card (2026-11-17 page weight: 46 partner cards put ~176 KB of the same paths into
 * /c/rentals). Identical ink: the sprite's `ShieldCheck-r` symbol is the same paths and fill rules as SHIELD_VERIFIED.rest
 * (shield-verified-glyph.test.ts holds them equal), filled with currentColor, so colour still comes from the host. The core
 * sprite is already on every page with a card. The trust SCORE badge (gradient + numeral) still inlines its art: that cannot
 * ride a `<use>` (scripts/gen-icons.mjs, SHIELDS).
 */
export function ShieldVerifiedGlyph({ size, className, style }: { size: number; className?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style} aria-hidden="true">
      <use href={`${ICON_SPRITE_CORE}#ShieldCheck-r`} />
    </svg>
  )
}
