// Display-currency support. Listing prices are STORED in VND; the viewer can pick
// a display currency (independent of UI language) and we convert with live rates
// from /api/fx. Conversion is DISPLAY-ONLY — offers and transactions stay in VND.

import { formatMoneyFull } from './vnd'

export type CurrencyCode =
  | 'VND' | 'USD' | 'EUR' | 'GBP' | 'CNY' | 'KRW' | 'JPY'
  | 'THB' | 'MYR' | 'SGD' | 'INR' | 'RUB' | 'AUD' | 'KHR'

// Curated to the nationalities eno.vn serves (mirrors the UI languages) + a few
// common ones. Flag makes the picker instantly recognizable across languages.
export const CURRENCIES: { code: CurrencyCode; symbol: string; label: string }[] = [
  { code: 'VND', symbol: '₫', label: 'VND' },
  { code: 'USD', symbol: '$', label: 'USD' },
  { code: 'EUR', symbol: '€', label: 'EUR' },
  { code: 'GBP', symbol: '£', label: 'GBP' },
  { code: 'CNY', symbol: '¥', label: 'CNY' },
  { code: 'KRW', symbol: '₩', label: 'KRW' },
  { code: 'JPY', symbol: '¥', label: 'JPY' },
  { code: 'THB', symbol: '฿', label: 'THB' },
  { code: 'MYR', symbol: 'RM', label: 'MYR' },
  { code: 'SGD', symbol: 'S$', label: 'SGD' },
  { code: 'INR', symbol: '₹', label: 'INR' },
  { code: 'RUB', symbol: '₽', label: 'RUB' },
  { code: 'AUD', symbol: 'A$', label: 'AUD' },
  { code: 'KHR', symbol: '៛', label: 'KHR' },
]

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code)

/**
 * Format a VND amount in the chosen display currency. `rates` are "currency per
 * 1 VND" (from /api/fx). VND keeps the app's "12,000,000 VND" suffix style; other
 * currencies use their native symbol via Intl (rounded to whole units — cleaner
 * for marketplace prices). Falls back to VND if the rate isn't loaded yet.
 */
export function formatMoney(amountVnd: number, currency: string, rates: Record<string, number>): string {
  if (currency === 'VND' || currency === '₫') return formatMoneyFull(amountVnd, '₫')
  const rate = rates[currency]
  if (!rate || !Number.isFinite(rate)) return formatMoneyFull(amountVnd, '₫')
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amountVnd * rate)
  } catch {
    return formatMoneyFull(amountVnd, '₫')
  }
}
