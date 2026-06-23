'use client'

import { ShieldCheck } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { trustScoreColor } from '@/lib/trust-score'
import { cn } from '@/lib/utils'

type Props = {
  score: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

/**
 * The single public trust signal: a color-coded trust score (replaces stars +
 * badges). Color encodes the hierarchy (red→slate→green→gold) so good businesses
 * are identifiable at a glance. `showLabel` adds the band word (profile/detail).
 */
export function TrustScore({ score, size = 'sm', showLabel = false, className }: Props) {
  const { lang, tr } = useLanguage()
  const { hex, label, labelVi } = trustScoreColor(score)
  const txt = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' }[size]
  const ico = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-[18px] w-[18px]' }[size]
  return (
    <span
      title={`${tr('Trust score', 'Điểm uy tín')}: ${Math.round(score)} · ${lang === 'vi' ? labelVi : label}`}
      className={cn('inline-flex items-center gap-1 font-bold tabular-nums', txt, className)}
      style={{ color: hex }}
    >
      <ShieldCheck className={cn(ico, 'shrink-0')} />
      {Math.round(score)}
      {showLabel && <span className="font-semibold">· {lang === 'vi' ? labelVi : label}</span>}
    </span>
  )
}
