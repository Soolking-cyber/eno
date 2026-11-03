'use client'
import { useEffect, useRef } from 'react'
import { useLanguage } from '@/context/language-context'
import { timeAgo } from '@/lib/types'
import { formatCalendarDay } from '@/lib/calendar-day'

/**
 * A relative "x ago" that cannot mismatch on hydration and costs no re-render: the effect writes the text itself, only when it differs, with no state.
 * ⛔ THIS WAS A `useMounted` SWAP: every card on a page re-rendered at hydration, in the longest task of the load (speed audit, 2026-11-03).
 *
 * What the HTML says first depends on how long that HTML lives:
 *  · By default, the CALENDAR DAY in Vietnam, from the string alone, with no clock and no Intl: a listing page is ISR for 30 days, and a baked "3h ago" would be a false claim to
 *    a crawler for a month and to a phone until it hydrates.
 *  · `inHtml` (a feed's cards, ISR for hours): the relative label itself, so it is in the first paint and "30 Oct" does not flip to "4d ago" on every card. `suppressHydrationWarning`
 *    on an element with ONE TEXT CHILD is exactly the case React leaves alone: it neither throws nor recovers (`hydrateInstance`, react-dom-client: `instance.textContent === "" + children ||
 *    props.suppressHydrationWarning === true || ...`), and it does not patch the text, which is what the effect is for. ⚠️ Only this shape: it covers no element appearing or disappearing.
 * clock-badges.hydration.test.tsx holds both on a stale page.
 */
export function RelativeTime({ iso, className, inHtml = false }: { iso: string; className?: string; inHtml?: boolean }) {
  const { lang } = useLanguage()
  const relative = timeAgo(iso, lang)
  const first = inHtml ? relative : formatCalendarDay(String(iso), lang, { year: false })
  const el = useRef<HTMLTimeElement>(null)
  useEffect(() => {
    if (el.current && el.current.textContent !== relative) el.current.textContent = relative
  }, [relative, first])
  return <time ref={el} dateTime={iso} suppressHydrationWarning={inHtml} className={className ? `tabular-nums ${className}` : 'tabular-nums'}>{first}</time>
}
