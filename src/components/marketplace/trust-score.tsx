'use client'

import { useLanguage } from '@/context/language-context'
import { trustScoreColor } from '@/lib/trust-score'
import { cn } from '@/lib/utils'

type Props = {
  score: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  // 'shield' = the seal (profile/detail); 'number' = just a color-coded number
  // (cards — low-key, since ranking already surfaces trust).
  variant?: 'shield' | 'number'
  className?: string
}

// Pixel size of the square shield badge per size.
const PX = { sm: 28, md: 38, lg: 48 } as const

/**
 * The single public trust signal, color-coded by tier (red→slate→green→gold→violet).
 * `variant='shield'` is the seal; `variant='number'` is just a subtle bold number.
 */
export function TrustScore({ score, size = 'sm', showLabel = false, variant = 'shield', className }: Props) {
  const { lang, tr } = useLanguage()
  const { color, label, labelVi } = trustScoreColor(score)
  const n = Math.round(score)
  const title = `${tr('Trust score', 'Điểm uy tín')}: ${n} · ${lang === 'vi' ? labelVi : label}`

  if (variant === 'number') {
    const txt = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' }[size]
    return (
      <span title={title} className={cn('font-extrabold tabular-nums', txt, className)} style={{ color }}>
        {n}
      </span>
    )
  }

  const px = PX[size]
  // Shrink the digits a touch for 3-digit scores so they sit cleanly in the shield.
  const fontSize = n >= 100 ? 7.6 : 9

  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1.5 align-middle', className)}
    >
      <svg width={px} height={px} viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
        {/* fill/stroke via style so the CSS var resolves (SVG attrs don't take var()). */}
        <path
          d="M12 2 4 5v6.2c0 5.05 8 9 8 9s8-3.95 8-9V5l-8-3z"
          fillOpacity="0.12"
          strokeWidth="1.5"
          strokeLinejoin="round"
          style={{ fill: color, stroke: color }}
        />
        <text x="12" y="10.4" textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight="800" fontFamily="inherit" style={{ fill: color }}>
          {n}
        </text>
      </svg>
      {showLabel && <span className="text-sm font-bold" style={{ color }}>{lang === 'vi' ? labelVi : label}</span>}
    </span>
  )
}
