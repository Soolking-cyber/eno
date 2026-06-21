'use client'

import { useTr } from '@/context/language-context'
import { formatMoneyFull, formatMoneyCompact } from '@/lib/vnd'

type Props = { price: number; currency: string; priceUnit: string; compact?: boolean; className?: string }

/**
 * Renders a price. The amount uses VN-style grouping ("12.000.000 ₫"); pass
 * `compact` for the shorthand used on dense card grids ("12 tr", "1,2 tỷ"). The
 * unit suffix (e.g. "month", "visit") is translated into the active language; the
 * currency + digits are never translated.
 */
export function Price({ price, currency, priceUnit, compact = false, className }: Props) {
  // Unit suffix is translatable; bare "VND"/empty has none.
  const unitRaw = !priceUnit || priceUnit === 'VND' ? null : priceUnit.replace(/^VND\/?/, '').trim() || null
  const unit = useTr(unitRaw ?? '') // hook called unconditionally (no-op when empty)
  const amount = compact ? formatMoneyCompact(price, currency) : formatMoneyFull(price, currency)
  return (
    <span className={className}>
      {amount}
      {unitRaw ? ` / ${unit}` : ''}
    </span>
  )
}
