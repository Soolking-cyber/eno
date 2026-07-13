'use client'

import { useLanguage, useTr } from '@/context/language-context'
import { useCurrency } from '@/context/currency-context'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { formatMoney } from '@/lib/currencies'
import { cn } from '@/lib/utils'

type Props = {
  price: number
  currency: string
  priceUnit: string
  compact?: boolean
  /** Dual-currency approximation (user decision 2026-07-13): true = always show,
   *  'sm' = only at sm+ (one-line rows that fight for phone width), false = off. */
  dual?: boolean | 'sm'
  className?: string
}

/**
 * Renders a price in the viewer's chosen DISPLAY currency (live-converted from the
 * stored VND amount; defaults to VND), plus a QUIET dual-currency approximation for
 * every viewer in every language: "≈ $x" beside any non-USD display, and "≈ x đ"
 * beside a USD display — small and muted so it never overshadows the main price.
 * The unit suffix (e.g. "month") is translated; separators follow the language
 * ("12.000.000 đ" for vi). Locale-swap stays hydration-safe the tr() way. A rare
 * non-VND stored listing shows as-is, with no approximation (no reliable rate).
 */
export function Price({ price, currency, priceUnit, compact = false, dual = true, className }: Props) {
  void compact // amounts are always shown in full now
  const { lang } = useLanguage()
  const { currency: displayCur, rates, format } = useCurrency()
  const locale = moneyLocale(lang)
  // Unit suffix is translatable; bare "VND"/empty has none.
  const unitRaw = !priceUnit || priceUnit === 'VND' ? null : priceUnit.replace(/^VND\/?/, '').trim() || null
  const unit = useTr(unitRaw ?? '') // hook called unconditionally (no-op when empty)
  // VND-stored listings convert to the display currency; the rare non-VND listing
  // is shown in its own currency, unconverted.
  const amount = currency === '₫' ? format(price, locale) : formatMoneyFull(price, currency, locale)

  // Approximation: USD unless the display already IS USD (then VND). Rendered only
  // once rates exist (prefetched + cached 12h by the provider) and for real prices.
  let approx: string | null = null
  if (dual !== false && currency === '₫' && price > 0) {
    if (displayCur === 'USD') approx = formatMoneyFull(price, '₫', locale)
    else if (rates.USD) approx = formatMoney(price, 'USD', rates, locale)
  }

  return (
    // tabular-nums: fixed-width digits so price columns align across card grids.
    <span className={cn('tabular-nums', className)}>
      {amount}
      {unitRaw ? ` / ${unit}` : ''}
      {approx && (
        <span className={cn('ml-1.5 text-[0.8em] font-medium text-muted-foreground', dual === 'sm' && 'hidden sm:inline')}>
          {`≈ ${approx}`}
        </span>
      )}
    </span>
  )
}
