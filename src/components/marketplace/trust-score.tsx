'use client'

import Link from 'next/link'
import { Tooltip } from '@/components/ui/tooltip'
import { useLanguage } from '@/context/language-context'
import { trustScoreColor, trustFillClass } from '@/lib/trust-score'
import { SEAL_OUTLINE, SEAL_CHECK, SEAL_CHIEF } from '@/components/marketplace/eno-seal'
import { cn } from '@/lib/utils'

type Props = {
  score: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  // 'shield' = the seal (profile/detail); 'number' = just a color-coded number
  // (cards — low-key, since ranking already surfaces trust); 'mini' = a tiny
  // rounded-full chip (shield glyph + number) for card meta rows.
  variant?: 'shield' | 'number' | 'mini'
  // When set, the badge itself is the "How trust works" link (standalone surfaces
  // only — never inside another link/card, nested anchors are invalid HTML).
  href?: string
  className?: string
}

// Pixel size of the square shield badge per size.
const PX = { sm: 28, md: 38, lg: 48 } as const

// Gradient stops + in-badge text color per EARNED tier (mirrors the .trust-fill-*
// classes in globals.css — SVG needs its own <linearGradient>, CSS classes can't
// paint SVG fills). Text colors hold ≥4.5:1 against the lightest stop.
const SHIELD_GRADIENT: Record<string, { from: string; mid: string; to: string; text: string }> = {
  trusted: { from: '#3b82f6', mid: '#2563eb', to: '#1d4ed8', text: '#ffffff' },
  exceptional: { from: '#fde047', mid: '#facc15', to: '#f59e0b', text: '#713f12' },
  elite: { from: '#7c3aed', mid: '#6d28d9', to: '#5b21b6', text: '#ffffff' },
}

/**
 * The single public trust signal, color-coded by tier (red→slate→blue→gold→violet).
 * `variant='shield'` is the seal; `variant='number'` is just a subtle bold number;
 * `variant='mini'` is the tiny card chip. The EARNED tiers (Trusted blue /
 * Exceptional gold / Elite violet) render as vivid glossy gradient badges; building
 * and restricted stay quiet (tinted text) — shine is earned.
 */
export function TrustScore({ score, size = 'sm', showLabel = false, variant = 'shield', href, className }: Props) {
  const { lang, tr } = useLanguage()
  const { color, label, labelVi, band } = trustScoreColor(score)
  const fill = trustFillClass(band)
  const n = Math.round(score)
  const title = `${tr('Trust score', 'Điểm uy tín')}: ${n} · ${lang === 'vi' ? labelVi : label}`
  // The inner span carries a NATIVE title only when there is NO href — that is the unwrapped case
  // where it's the sole hint. When href is set the badge is wrapped in a Base UI <Tooltip> below,
  // which owns the hint; leaving the native title on too would fire BOTH bubbles (same text twice)
  // on every card's mini badge.
  const nativeTitle = href ? undefined : title
  // Badge-as-link: tapping any trust badge explains the system.
  const wrap = (node: React.ReactNode) => href
    // prefetch={false}: a trust badge renders on EVERY card in the feed, so auto-prefetch would
    // warm the same /trust explainer once per visible card. It is a rarely-followed footnote link.
    ? <Tooltip content={title} side="top"><Link href={href} prefetch={false} aria-label={tr('How trust works', 'Điểm uy tín hoạt động thế nào')} className="inline-flex cursor-pointer transition-transform hover:scale-105 active:scale-[0.96]">{node}</Link></Tooltip>
    : <>{node}</>

  if (variant === 'mini') {
    // Card-facing chip: shield + score ONLY (user decision 2026-07-13 — a tier
    // word made cards too verbose; the `title` tooltip and every tap-through
    // surface still name the tier). Earned tiers get the glossy gradient fill;
    // building/restricted keep the quiet 10%-tint treatment.
    return wrap(
      <span
        title={nativeTitle}
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-bold leading-none tabular-nums',
          fill,
          className,
        )}
        style={fill ? undefined : { color, background: 'color-mix(in srgb, currentColor 10%, transparent)' }}
      >
        {/* The eno seal at micro scale (docs/icon-language.md §0b) — tinted
            chief + line silhouette + e-bar. Same paths as every other seal in
            the app; only the tint opacity adapts to the pill's ink. */}
        <svg width={11} height={11} viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
          <path d={SEAL_CHIEF} fill="currentColor" fillOpacity={fill ? 0.55 : 0.3} />
          <path
            d={SEAL_OUTLINE}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d={SEAL_CHECK} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {n}
      </span>,
    )
  }

  if (variant === 'number') {
    const txt = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' }[size]
    return wrap(
      <span title={nativeTitle} className={cn('font-extrabold tabular-nums', txt, className)} style={{ color }}>
        {n}
      </span>,
    )
  }

  const px = PX[size]
  // The number lives in the seal's belly (below the e-bar), so the digits are
  // sized to that region: shrink for 3-digit scores, and keep the block clear
  // of the tapering keel.
  const fontSize = n >= 100 ? 7 : 8.6
  const grad = SHIELD_GRADIENT[band]
  const gradId = grad ? `trust-grad-${band}` : undefined

  return wrap(
    <span
      title={nativeTitle}
      className={cn('inline-flex items-center gap-1.5 align-middle', className)}
    >
      <svg width={px} height={px} viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
        {grad && (
          <defs>
            {/* Fixed per-tier id: duplicate defs across shields on one page resolve
                to identical gradients, so collisions are harmless. */}
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={grad.from} />
              <stop offset="55%" stopColor={grad.mid} />
              <stop offset="100%" stopColor={grad.to} />
            </linearGradient>
          </defs>
        )}
        {grad ? (
          <>
            {/* Vivid gradient badge on the eno seal (§0b): the chief becomes the
                glassy highlight (static — shine without motion; reduced-motion
                safe by construction) and the e-bar renders in the tier's text
                ink, so the signature reads even on gold/violet. */}
            <path
              d={SEAL_OUTLINE}
              fill={`url(#${gradId})`}
              strokeWidth="1"
              strokeLinejoin="round"
              style={{ stroke: grad.to }}
            />
            <path d={SEAL_CHIEF} fill="#ffffff" fillOpacity="0.25" />
            {/* ⚠️ NO CHECK IN A BADGE THAT CARRIES THE SCORE. The seal's check and the
                numeral both want the shield's optical centre, and drawn together they
                overlap into an unreadable smudge (owner, 2026-08-07: "maybe not tickmark
                here"). The NUMBER is this variant's content; the silhouette + chief carry
                the identity. The check belongs to the seal wherever it stands alone. */}
            <text x="12" y="13.1" textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight="800" fontFamily="inherit" fill={grad.text}>
              {n}
            </text>
          </>
        ) : (
          <>
            {/* Quiet tiers: line seal with a tinted chief (fill/stroke via style
                so the CSS var resolves — SVG attrs don't take var()). */}
            <path d={SEAL_CHIEF} fillOpacity="0.16" style={{ fill: color }} />
            <path
              d={SEAL_OUTLINE}
              fill="none"
              strokeWidth="1.5"
              strokeLinejoin="round"
              style={{ stroke: color }}
            />
            {/* No check here either — see the note above: the numeral owns the centre. */}
            <text x="12" y="13.1" textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight="800" fontFamily="inherit" style={{ fill: color }}>
              {n}
            </text>
          </>
        )}
      </svg>
      {showLabel && <span className="text-sm font-bold" style={{ color }}>{tr(label, labelVi)}</span>}
    </span>,
  )
}
