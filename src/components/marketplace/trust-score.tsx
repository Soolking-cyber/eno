'use client'

import { useLanguage } from '@/context/language-context'
import { trustScoreColor } from '@/lib/trust-score'
import { cn } from '@/lib/utils'

type Props = {
  score: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

// Pixel size of the square shield badge per size.
const PX = { sm: 28, md: 38, lg: 48 } as const

/**
 * The single public trust signal: a color-coded SHIELD with the score INSIDE it —
 * a compact, square seal (not a long pill). Color encodes the hierarchy
 * (red→slate→green→gold→violet). `showLabel` adds the band word beside it.
 */
export function TrustScore({ score, size = 'sm', showLabel = false, className }: Props) {
  const { lang, tr } = useLanguage()
  const { hex, label, labelVi } = trustScoreColor(score)
  const n = Math.round(score)
  const px = PX[size]
  // Shrink the digits a touch for 3-digit scores so they sit cleanly in the shield.
  const fontSize = n >= 100 ? 7.6 : 9

  return (
    <span
      title={`${tr('Trust score', 'Điểm uy tín')}: ${n} · ${lang === 'vi' ? labelVi : label}`}
      className={cn('inline-flex items-center gap-1.5 align-middle', className)}
    >
      <svg width={px} height={px} viewBox="0 0 24 24" className="shrink-0" aria-hidden="true">
        <path
          d="M12 2 4 5v6.2c0 5.05 8 9 8 9s8-3.95 8-9V5l-8-3z"
          fill={hex}
          fillOpacity="0.12"
          stroke={hex}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <text x="12" y="10.4" textAnchor="middle" dominantBaseline="central" fill={hex} fontSize={fontSize} fontWeight="800" fontFamily="inherit">
          {n}
        </text>
      </svg>
      {showLabel && <span className="text-sm font-bold" style={{ color: hex }}>{lang === 'vi' ? labelVi : label}</span>}
    </span>
  )
}
