'use client'

import { useLanguage } from '@/context/language-context'
import { formatCalendarDay } from '@/lib/calendar-day'

/**
 * A stored date ('2026-10-08') as the reader writes it: '8 Oct 2026' / '8/10/2026'.
 *
 * Hydration-safe on the 30-day ISR listing page: `lang` is seeded from the [lang] route on the server
 * AND on the first client render (language-context.tsx), and formatCalendarDay reads no clock and no
 * Intl, so both passes print the same characters. A client leaf only because the server page has no
 * language of its own to format with.
 */
export function CalendarDay({ value, year = true }: { value: string; year?: boolean }) {
  const { lang } = useLanguage()
  return <time dateTime={value}>{formatCalendarDay(value, lang, { year })}</time>
}
