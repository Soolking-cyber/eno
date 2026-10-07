'use client'

import { useLanguage } from '@/context/language-context'
import { coverDayShort, type CoverDay } from '@/lib/teachers/cover'

/**
 * A weekday's short name in the READER's language, for the server-rendered profile table. The server renders English
 * or Vietnamese; a machine-translated reader's language arrives on the client (the language context starts at the
 * server's and switches after mount, so hydration agrees), and the name comes from Intl, never MT (coverDayShort).
 */
export function CoverDayShort({ day }: { day: CoverDay }) {
  const { lang } = useLanguage()
  return <>{coverDayShort(day, lang)}</>
}
