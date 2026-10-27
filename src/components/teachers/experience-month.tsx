'use client'

import { useLanguage } from '@/context/language-context'
import { formatYearMonth } from '@/lib/calendar-day'

/**
 * A teaching job's month in the READER's language, for the server-rendered profile (as CoverDayShort): the server renders
 * English or Vietnamese, a machine-translated reader's language arrives on the client after mount, so hydration agrees.
 */
export function ExperienceMonth({ v }: { v: string }) {
  const { lang } = useLanguage()
  return <>{formatYearMonth(v, lang)}</>
}
