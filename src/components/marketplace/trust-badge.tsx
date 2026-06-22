'use client'

import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

type Props = {
  tier?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
  showLabel?: boolean
}

/**
 * Earned trust badge (replaces the manual "Verified by eno.vn" verification).
 * Blue for Trusted (score ≥85 + track record), gold for Exceptional (≥110).
 * Standard / Restricted render NOTHING — the badge is a positive signal only.
 * The reflective sheen is a subtle animated highlight (`.trust-sheen` in
 * globals.css), auto-disabled under prefers-reduced-motion.
 */
export function TrustBadge({ tier, size = 'sm', className, showLabel = true }: Props) {
  const { tr } = useLanguage()
  if (tier !== 'trusted' && tier !== 'exceptional') return null

  const sizes = {
    sm: { box: 'gap-1 px-2 py-0.5 text-[11px]', icon: 'h-3 w-3' },
    md: { box: 'gap-1.5 px-2.5 py-1 text-xs', icon: 'h-3.5 w-3.5' },
    lg: { box: 'gap-2 px-3 py-1.5 text-sm', icon: 'h-4 w-4' },
  }[size]

  const exceptional = tier === 'exceptional'
  const Icon = exceptional ? BadgeCheck : ShieldCheck
  const label = exceptional ? tr('Exceptional', 'Xuất sắc') : tr('Trusted', 'Đáng tin cậy')

  return (
    <span
      title={exceptional ? tr('Exceptional seller on eno.vn', 'Người bán xuất sắc trên eno.vn') : tr('Trusted seller on eno.vn', 'Người bán đáng tin cậy trên eno.vn')}
      className={cn(
        'trust-badge relative inline-flex items-center overflow-hidden rounded-xl font-semibold text-white shadow-sm ring-1',
        exceptional
          ? 'bg-gradient-to-br from-amber-400 to-amber-600 ring-amber-300/50'
          : 'bg-gradient-to-br from-[#0a66c2] to-[#004182] ring-[#0a66c2]/30',
        sizes.box,
        className,
      )}
    >
      <Icon className={cn('relative z-10', sizes.icon)} />
      {showLabel && <span className="relative z-10">{label}</span>}
      <span aria-hidden className="trust-sheen pointer-events-none absolute inset-0" />
    </span>
  )
}
