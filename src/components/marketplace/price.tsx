'use client'

import { useLanguage, useTr } from '@/context/language-context'
import { useCurrency, vndPerUsd } from '@/context/currency-context'
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
  /** Unit suffix (" / service", " / month"): true = always, 'sm' = only at sm+,
   *  false = never. Same three-way contract as `dual`, for the same reason — on a
   *  phone the suffix is the widest, least informative part of a one-line row
   *  (every visa row reads "/ service"), and it is what pushed the price into the
   *  action icons. Hiding it is preferred over shrinking the amount: a truncated
   *  price is a wrong price. */
  unit?: boolean | 'sm'
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
export function Price({ price, currency, priceUnit, compact = false, dual = true, unit: showUnit = true, className }: Props) {
  void compact // amounts are always shown in full now
  const { lang, tr } = useLanguage()
  const { currency: displayCur, rates, format } = useCurrency()
  const locale = moneyLocale(lang)
  // A zero price is FREE, not "0 VND". Rendering the number was actively misleading on the one
  // surface that has one — the trip-planning service, where planning genuinely costs nothing and
  // the fee is quoted later in chat — because "0 VND" in 3xl bold reads as a broken card rather
  // than a deliberate offer. The unit suffix is dropped with it: "Free / service" is nonsense.
  // Guarded on price > 0 rather than truthiness so a negative never slips through as free.
  // Unit suffix is translatable; bare "VND"/empty has none.
  const unitRaw = !priceUnit || priceUnit === 'VND' ? null : priceUnit.replace(/^VND\/?/, '').trim() || null
  const unit = useTr(unitRaw ?? '') // hook called unconditionally (no-op when empty)
  // VND-stored listings convert to the display currency; the rare non-VND listing
  // is shown in its own currency, unconverted.
  const isFree = price === 0
  const amount = isFree
    ? tr('Free', 'Miễn phí')
    : currency === '₫' ? format(price, locale) : formatMoneyFull(price, currency, locale)
  const suffix = !isFree && unitRaw && showUnit !== false ? ` / ${unit}` : null

  // Approximation: USD unless the display already IS USD (then VND). Rendered only
  // once rates exist (prefetched + cached 12h by the provider) and for real prices.
  //
  // ⚠️ THE RATE IS PLAUSIBILITY-BANDED VIA vndPerUsd, not merely truthy. `rates.USD` arrives from
  // an upstream that publishes "currency per 1 VND"; a negative, infinite or wrongly-scaled value
  // is positive-but-absurd and would print a confidently wrong dollar figure beside a real price.
  // Shared with useDualMoney so the marketplace and the trip planner cannot disagree about when an
  // approximation is safe to show — a reviewer correctly pointed out that two copies of this rule
  // are only equal until one of them changes.
  let approx: string | null = null
  if (dual !== false && currency === '₫' && price > 0) {
    if (displayCur === 'USD') approx = formatMoneyFull(price, '₫', locale)
    else if (vndPerUsd(rates)) approx = formatMoney(price, 'USD', rates, locale)
  }

  return (
    // tabular-nums: fixed-width digits so price columns align across card grids.
    <span className={cn('tabular-nums', className)}>
      {amount}
      {/* The bare text node is kept for the default (always-on) case so the other
          call sites' DOM is byte-identical to before; only the 'sm' variant needs a
          wrapper element to hang the breakpoint class on. */}
      {suffix && (showUnit === 'sm'
        ? <span className="hidden sm:inline">{suffix}</span>
        : suffix)}
      {approx && (
        /**
         * ⚠️ THE WHOLE APPROXIMATION IS `aria-hidden`, NOT JUST THE OPERATOR.
         * A screen reader was announcing "eighty-one thousand VND ALMOST EQUAL TO three dollars"
         * — on every card in the feed, every rail, and every PDP. The `≈` is spoken, and the
         * conversion doubles the length of the single most-repeated string in the product.
         * It is a CONVENIENCE for sighted scanning, not information: the price is the amount
         * above it, and the converted figure is an estimate from a live FX rate that the copy
         * elsewhere is careful never to present as a price. Hiding the whole span leaves the
         * real amount announced once, cleanly.
         * ⚠️ Do NOT "fix" this by aria-hiding only the `≈` glyph — that leaves "eighty-one
         * thousand VND three dollars", two prices run together with nothing between them, which
         * is worse than the operator.
         */
        <span aria-hidden className={cn('ml-1.5 text-[0.8em] font-medium text-muted-foreground', dual === 'sm' && 'hidden sm:inline')}>
          {'≈'} {approx}
        </span>
      )}
    </span>
  )
}
