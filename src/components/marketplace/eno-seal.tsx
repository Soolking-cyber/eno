import { STROKE_UI } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'

/**
 * The eno seal — the ONE proprietary glyph in the icon system
 * (docs/icon-language.md §0b). Everything else we draw is lucide; this mark is
 * ours, and it is built entirely from brand geometry so it could belong to no
 * other app:
 *
 *   - the FLAT TOP with 2.2-radius corners is the app icon's rounded square,
 *   - the sides fall into a shield KEEL (the mascots' silhouette family),
 *   - the CHECK inside it is what the mark MEANS: verified.
 *   - the CHIEF (the band under the flat top) carries the tier tint.
 *
 * ⚠️ THE INTERIOR WAS A BARE HORIZONTAL BAR UNTIL 2026-08-07, and it had to go.
 * The bar was meant to quote the crossbar of the wordmark's lowercase "e", but
 * with no letterform around it a viewer sees a MINUS SIGN inside a shield —
 * rendered at 6x it reads "no entry", the opposite of trust. The owner's
 * verdict was blunt ("the new trust icons are not good"), and they were right.
 * A check is unambiguous in every market and every size; the ownable part was
 * never the bar, it is the SILHOUETTE — a flat 2.2-radius top falling into a
 * keel, which no stock shield has. Do not reintroduce the bar.
 *
 * It survives every scale: at 10px the keel + check still read; at 48px all
 * three moves are visible. That is what makes it echoable — the same mark
 * appears as the trust chip on cards, inline beside fee/price lines, and as
 * the TrustScore badge (which imports these paths and adds tier fills — and
 * deliberately draws NO check, because there the numeral owns the centre).
 *
 * NEVER redraw the seal locally — a seal that drifts is a counterfeit. Import
 * the paths, or render <EnoSeal>. Meaning is reserved too: the seal marks
 * first-party trust (trust score, protections, fee safety, verification) and
 * replaces lucide Shield* in those moments. It is not generic decoration.
 */

/** Silhouette: app-icon top (flat, 2.2-radius corners) into a shield keel. */
export const SEAL_OUTLINE =
  'M6.7 3.5h10.6a2.2 2.2 0 0 1 2.2 2.2V10c0 4.8-3.9 8.5-7.5 10.6-3.6-2.1-7.5-5.8-7.5-10.6V5.7a2.2 2.2 0 0 1 2.2-2.2Z'

/**
 * The check. Drawn to the shield's optical centre, not its geometric one: the
 * keel pulls visual weight downward, so the mark sits slightly high (apex at
 * y≈8.6, vertex at y≈14.2) or it looks like it is sliding out of the shield.
 * Short arms and a wide angle are deliberate — a long elegant check is the
 * first thing to disintegrate at the 12px chip step.
 */
export const SEAL_CHECK = 'M8.5 11.6l2.6 2.6 4.6-5.2'

/* ⛔ `SEAL_BAR` IS GONE (deleted 2026-08-11) AND MUST NOT COME BACK. It was a
 * one-release deprecation alias pointing at SEAL_CHECK so an in-flight import
 * could not crash a build; its last importer (safety-strip.tsx) moved to
 * SEAL_CHECK, so the alias has no callers. Do not re-add it as a convenience —
 * an alias named "bar" is what kept five comments describing a minus sign that
 * the code has not drawn since 2026-08-07.
 *
 * ⚠️ A HAND-ROLLED COPY OF THE CHECK NEEDS `strokeLinejoin="round"`, NOT JUST
 * `strokeLinecap`. The bar was a single straight segment with no interior
 * vertex, so a missing linejoin was invisible; the check HAS a vertex, and
 * without the join SVG falls back to a MITER — a sharp spike where the icon
 * language (§3) requires a round join. That drift shipped in safety-strip.tsx
 * for four days. Prefer <EnoSeal>, which cannot get this wrong. */

/**
 * The chief — the band under the flat top; the tier badges tint it.
 *
 * ⚠️ THE BAND IS 3.3 TALL (y 3.5 → 6.8), AND THE `v` NUMBER IS NOT THAT HEIGHT.
 * Shortened 30% from 4.7 on 2026-08-11 (owner). The subtlety, because the obvious edit is
 * wrong: only the STRAIGHT segment is `v`. Above it sits the fixed 2.2 corner arc that carries
 * the band from y=3.5 down to y=5.7, and that arc cannot scale without breaking the flat
 * app-icon top the silhouette is built on. So the band's height is 2.2 (arc) + v, and taking
 * 30% off the BAND means 4.7 → 3.3, i.e. v goes 2.5 → 1.1 — a 56% cut to the number itself.
 * Scaling `v` by 0.7 instead would have removed only 16% of what anyone can see.
 *
 * Both the vertical line and the `V5.7` return must stay in step: the left edge comes back up
 * to the arc's start, so it is the `v` and the closing `V` that define the two corners.
 */
export const SEAL_CHIEF =
  'M6.7 3.5h10.6a2.2 2.2 0 0 1 2.2 2.2v1.1h-15V5.7a2.2 2.2 0 0 1 2.2-2.2Z'

type EnoSealProps = {
  /**
   * 'wash' (default) — line + brand-tinted chief: artwork and inline moments
   * (beside prices/fees, list leads, chips on neutral surfaces).
   * 'line' — pure line: chrome contexts where §6 bans the wash, and colored
   * surfaces (brand pills) where the ink already carries the meaning.
   */
  variant?: 'line' | 'wash'
  /** Stroke tier constant from `@/lib/icon-tokens` (§2). Defaults to STROKE_UI. */
  strokeWidth?: number
  /** Size via the §4 ladder classes — put the h- and w- classes here. */
  className?: string
}

export function EnoSeal({ variant = 'wash', strokeWidth = STROKE_UI, className }: EnoSealProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('shrink-0', className)}>
      {variant === 'wash' && <path d={SEAL_CHIEF} className="fill-brand-100" />}
      <path
        d={SEAL_OUTLINE}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d={SEAL_CHECK} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
