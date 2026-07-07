'use client'

import { useLanguage, useTr } from '@/context/language-context'
import { useCurrency } from '@/context/currency-context'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'

type Props = { price: number; currency: string; priceUnit: string; compact?: boolean; className?: string }

/**
 * Renders a price in the viewer's chosen DISPLAY currency (live-converted from the
 * stored VND amount; defaults to VND). The unit suffix (e.g. "month", "visit") is
 * translated into the active language, and the separators follow it too ("12.000.000 đ"
 * for vi). Locale-swap is hydration-safe the same way tr() is: lang is 'en' at SSR
 * and on the first client render, then flips after the mount effect reads storage.
 * A rare non-VND stored listing shows as-is.
 */
export function Price({ price, currency, priceUnit, compact = false, className }: Props) {
  void compact // amounts are always shown in full now
  const { lang } = useLanguage()
  const { format } = useCurrency()
  const locale = moneyLocale(lang)
  // Unit suffix is translatable; bare "VND"/empty has none.
  const unitRaw = !priceUnit || priceUnit === 'VND' ? null : priceUnit.replace(/^VND\/?/, '').trim() || null
  const unit = useTr(unitRaw ?? '') // hook called unconditionally (no-op when empty)
  // VND-stored listings convert to the display currency; the rare non-VND listing
  // is shown in its own currency, unconverted.
  const amount = currency === '₫' ? format(price, locale) : formatMoneyFull(price, currency, locale)
  return (
    // tabular-nums: fixed-width digits so price columns align across card grids.
    <span className={cn('tabular-nums', className)}>
      {amount}
      {unitRaw ? ` / ${unit}` : ''}
    </span>
  )
}
