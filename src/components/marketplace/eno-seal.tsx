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
 *   - the BAR quotes the crossbar of the wordmark's lowercase "e",
 *   - the CHIEF (the closed region above the bar) takes the §0 brand wash.
 *
 * It survives every scale: at 10px the keel + bar still read; at 48px all
 * three moves are visible. That is what makes it echoable — the same mark
 * appears as the trust chip on cards, inline beside fee/price lines, and as
 * the TrustScore badge (which imports these paths and adds tier fills).
 *
 * NEVER redraw the seal locally — a seal that drifts is a counterfeit. Import
 * the paths, or render <EnoSeal>. Meaning is reserved too: the seal marks
 * first-party trust (trust score, protections, fee safety, verification) and
 * replaces lucide Shield* in those moments. It is not generic decoration.
 */

/** Silhouette: app-icon top (flat, 2.2-radius corners) into a shield keel. */
export const SEAL_OUTLINE =
  'M6.7 3.5h10.6a2.2 2.2 0 0 1 2.2 2.2V10c0 4.8-3.9 8.5-7.5 10.6-3.6-2.1-7.5-5.8-7.5-10.6V5.7a2.2 2.2 0 0 1 2.2-2.2Z'

/** The e-bar — the wordmark's crossbar, floated under the chief. */
export const SEAL_BAR = 'M8.2 8.2h7.6'

/** The chief — the one closed wash region (§0/§6): everything above the bar. */
export const SEAL_CHIEF =
  'M6.7 3.5h10.6a2.2 2.2 0 0 1 2.2 2.2v2.5h-15V5.7a2.2 2.2 0 0 1 2.2-2.2Z'

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
      <path d={SEAL_BAR} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}
