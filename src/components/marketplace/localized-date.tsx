'use client'

import { useLanguage } from '@/context/language-context'
import { intlLocale } from '@/lib/i18n/langs'

/**
 * A date with words in it ("4 October 2026") in the READER's language — for a server page, which can only
 * format in the en or vi variant it rendered, so the nine machine-translated languages read English
 * month names.
 *
 * ⛔ en AND vi PRINT THE SERVER'S OWN STRINGS (`enText` / `viText`), NEVER A SECOND Intl CALL. The server
 * formats with Node's ICU and the browser with its own; their CLDR data can differ (a Vietnamese long
 * date is the classic case), and any difference is a hydration mismatch on an SEO page. Only the nine
 * other languages — which are never server-rendered — are formatted here, in a fixed zone.
 */
export function LocalizedDate({ iso, options, enText, viText }: { iso: string; options: Intl.DateTimeFormatOptions; enText: string; viText: string }) {
  const { lang } = useLanguage()
  if (lang === 'en') return <>{enText}</>
  if (lang === 'vi') return <>{viText}</>
  // Format first, render after: a string computed in the try, never JSX constructed inside it. A bad date
  // does not throw — toLocaleDateString answers "Invalid Date" — so it is checked, and keeps the English.
  let text = enText
  const d = new Date(iso)
  if (!Number.isNaN(d.getTime())) {
    try { text = d.toLocaleDateString(intlLocale(lang), { ...options, timeZone: 'Asia/Ho_Chi_Minh' }) } catch { /* keep the English */ }
  }
  return <>{text}</>
}
