'use client'

import { useLanguage } from '@/context/language-context'
import { formatRating, moneyLocale } from '@/lib/vnd'

/**
 * Locale-aware average rating: "4.8" for everyone, "4,8" (comma decimal — the
 * Vietnamese convention) for vi. A client leaf so it follows the viewer's
 * language even inside server-rendered pages — same SSR-en-then-swap mechanism
 * as <Tr>, so hydration stays consistent.
 */
export function RatingValue({ value }: { value: number }) {
  const { lang } = useLanguage()
  return <>{formatRating(value, moneyLocale(lang))}</>
}

/**
 * Locale-aware grouped whole number, e.g. a "2,430 views" proof count. Full
 * grouping (not abbreviated) with the viewer's thousands separator: "2,430" for
 * en, "2.430" for vi — the same reverse-of-money convention. Client leaf so it
 * follows the language inside server-rendered pages (SSR-en-then-swap, like <Tr>).
 */
export function CountValue({ value }: { value: number }) {
  const { lang } = useLanguage()
  return <>{new Intl.NumberFormat(moneyLocale(lang) === 'vi' ? 'vi-VN' : 'en-US').format(value)}</>
}
