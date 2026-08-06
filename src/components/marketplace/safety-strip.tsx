'use client'

import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

// Above-the-fold scam inoculation on the listing page — deposit-link fraud is the
// #1 marketplace scam, so the warning must be read BEFORE the buyer contacts the
// seller, not buried in the footer note. Copy is category-aware: vehicles get the
// papers/chassis check, property & rentals get the visit-before-deposit rule.
export function SafetyStrip({ categorySlug, action, className }: { categorySlug: string; action?: React.ReactNode; className?: string }) {
  const { tr } = useLanguage()

  const line =
    categorySlug === 'vehicles'
      ? tr(
          'Check the papers match the chassis before paying — and never pay a deposit through a link.',
          'Kiểm tra giấy tờ trùng số khung, số máy trước khi trả tiền — và đừng bao giờ đặt cọc qua đường link.',
        )
      : categorySlug === 'property' || categorySlug === 'rentals'
        ? tr(
            'Visit in person before paying any deposit — never wire money to hold a place.',
            'Đến xem tận nơi trước khi đặt cọc — đừng bao giờ chuyển khoản để giữ chỗ.',
          )
        : tr(
            'Never send a deposit through a link — eno.vn never asks for one. Meet, inspect, then pay.',
            'Đừng bao giờ chuyển tiền cọc qua đường link — eno.vn không bao giờ yêu cầu đặt cọc. Gặp trực tiếp, kiểm tra hàng rồi mới trả tiền.',
          )

  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl bg-warning/10 px-3 py-2.5 text-xs leading-relaxed', className)}>
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium text-foreground">{line}</p>
        {/* Guide link left, Report right (user-picked 2026-07-14) — the old
            standalone tips|report footer was a duplicate of this same link. */}
        <div className="flex items-center justify-between gap-3">
          <Link href="/safety" className="inline-block font-semibold text-accent-foreground hover:underline">
            {tr('Safe trading guide', 'Cẩm nang giao dịch an toàn')}
          </Link>
          {action}
        </div>
      </div>
    </div>
  )
}
