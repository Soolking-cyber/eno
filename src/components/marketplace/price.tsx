'use client'

import { formatPriceParts } from '@/lib/types'
import { useTr } from '@/context/language-context'

type Props = { price: number; currency: string; priceUnit: string; className?: string }

/**
 * Renders a price with the numeric part verbatim and the unit suffix translated
 * into the active language (e.g. "₫15,000,000 / month" → "₫15,000,000 / tháng").
 * The currency symbol and digits are never translated.
 */
export function Price({ price, currency, priceUnit, className }: Props) {
  const parts = formatPriceParts(price, currency, priceUnit)
  const unit = useTr(parts.unit) // no-op when unit is null/English source
  return (
    <span className={className}>
      {parts.amount}
      {parts.unit ? ` / ${unit}` : ''}
    </span>
  )
}
