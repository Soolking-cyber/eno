'use client'

import { ShieldCheck, Clock, BadgeCheck, ShieldAlert } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { VERIFICATION_METHOD_LABELS } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = {
  verified: boolean
  method?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
  showLabel?: boolean
  categorySlug?: string
}

/**
 * Chợ Thật verification badge — blue brand badge for verified,
 * amber "In review" pill for pending listings.
 */
export function VerifiedBadge({ verified, method, size = 'sm', className, showLabel = true, categorySlug }: Props) {
  const { tr } = useLanguage()
  const sizes = {
    sm: { box: 'gap-1 px-2 py-0.5 text-[11px]', icon: 'h-3 w-3' },
    md: { box: 'gap-1.5 px-2.5 py-1 text-xs', icon: 'h-3.5 w-3.5' },
    lg: { box: 'gap-2 px-3 py-1.5 text-sm', icon: 'h-4 w-4' },
  }[size]

  if (!verified) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-xl font-semibold bg-amber-100 text-amber-700 ring-1 ring-amber-200',
          sizes.box,
          className,
        )}
        title={tr('Listing held for review — not shown to buyers until verified')}
      >
        <Clock className={sizes.icon} />
        {showLabel && tr('In review', 'Đang duyệt')}
      </span>
    )
  }

  // Categories where we use detailed physical/document verification: House Rentals and Motorbike Rentals
  const isHighValue = categorySlug === 'house-rentals' || categorySlug === 'motorbike-rentals'

  if (!isHighValue) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-xl font-semibold text-white shadow-sm',
          'bg-[#0a66c2] ring-1 ring-[#0a66c2]/20',
          sizes.box,
          className,
        )}
        title={tr('Availability Guaranteed by ENO')}
      >
        <ShieldCheck className={sizes.icon} />
        {showLabel && tr('Available', 'Sẵn hàng')}
      </span>
    )
  }

  const methodLabel = method ? VERIFICATION_METHOD_LABELS[method] : null

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-xl font-semibold text-white shadow-sm',
        'bg-[#0a66c2] ring-1 ring-[#0a66c2]/20',
        sizes.box,
        className,
      )}
      title={methodLabel ? `${tr('Verified', 'Đã xác thực')} · ${tr(methodLabel.label, methodLabel.vi)}` : tr('Verified by ENO', 'Đã xác minh bởi ENO')}
    >
      <ShieldCheck className={sizes.icon} />
      {showLabel && (
        methodLabel
          ? `${tr('Verified', 'Đã xác thực')} · ${tr(methodLabel.label, methodLabel.vi)}`
          : tr('Verified', 'Đã xác thực')
      )}
    </span>
  )
}

/** Compact verified check icon */
export function VerifiedCheck({ className }: { className?: string }) {
  return <BadgeCheck className={cn('h-4 w-4 text-[#0a66c2]', className)} />
}

/** Scam / fake warning indicator */
export function FakeWarning({ className }: { className?: string }) {
  return <ShieldAlert className={cn('h-4 w-4 text-red-500', className)} />
}
