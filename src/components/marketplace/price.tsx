'use client'

import { useTr } from '@/context/language-context'
import { useCurrency } from '@/context/currency-context'
import { formatMoneyFull } from '@/lib/vnd'
import { cn } from '@/lib/utils'

type Props = { price: number; currency: string; priceUnit: string; compact?: boolean; className?: string }

/**
 * Renders a price in the viewer's chosen DISPLAY currency (live-converted from the
 * stored VND amount; defaults to VND). The unit suffix (e.g. "month", "visit") is
 * translated into the active language. A rare non-VND stored listing shows as-is.
 */
export function Price({ price, currency, priceUnit, compact = false, className }: Props) {
  void compact // amounts are always shown in full now
  const { format } = useCurrency()
  // Unit suffix is translatable; bare "VND"/empty has none.
  const unitRaw = !priceUnit || priceUnit === 'VND' ? null : priceUnit.replace(/^VND\/?/, '').trim() || null
  const unit = useTr(unitRaw ?? '') // hook called unconditionally (no-op when empty)
  // VND-stored listings convert to the display currency; the rare non-VND listing
  // is shown in its own currency, unconverted.
  const amount = currency === '₫' ? format(price) : formatMoneyFull(price, currency)
  return (
    // tabular-nums: fixed-width digits so price columns align across card grids.
    <span className={cn('tabular-nums', className)}>
      {amount}
      {unitRaw ? ` / ${unit}` : ''}
    </span>
  )
}
