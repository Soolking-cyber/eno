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
 *
 * `markFresh` (the job card row, owner-approved 2026-11-14, cook r06 jobs: "a posting under a day old says so in ink"): the
 * <time> carries `data-fresh` while the posting is under 24 hours old, and the caller styles it (`data-fresh:font-bold …`).
 * ⚠️ THE ATTRIBUTE FOLLOWS THE TEXT'S RULE: in the server HTML only `inHtml` (a feed's hours-old cache); by default (a 30-day
 * ISR page) never, so a stale page cannot claim freshness. Either way the effect re-judges it against the DOM after mount —
 * React does not patch an attribute at hydration (`suppressHydrationWarning` covers this element's attributes too), so the
 * effect is what corrects a page cached across the 24-hour line. Without `markFresh` the element is exactly as before.
 */
const FRESH_MS = 24 * 60 * 60 * 1000
const isFresh = (iso: string) => {
  const age = Date.now() - Date.parse(iso)
  return Number.isFinite(age) && age >= 0 && age < FRESH_MS
}
export function RelativeTime({ iso, className, inHtml = false, markFresh = false }: { iso: string; className?: string; inHtml?: boolean; markFresh?: boolean }) {
  const { lang } = useLanguage()
  const relative = timeAgo(iso, lang)
  const first = inHtml ? relative : formatCalendarDay(String(iso), lang, { year: false })
  const el = useRef<HTMLTimeElement>(null)
  useEffect(() => {
    const node = el.current
    if (!node) return
    if (node.textContent !== relative) node.textContent = relative
    if (markFresh) {
      const fresh = isFresh(iso)
      if (fresh !== node.hasAttribute('data-fresh')) {
        if (fresh) node.setAttribute('data-fresh', '')
        else node.removeAttribute('data-fresh')
      }
      // A tab left open across the 24-hour line drops the mark then, not at the next render (commit review).
      if (fresh) {
        const t = setTimeout(() => node.removeAttribute('data-fresh'), FRESH_MS - (Date.now() - Date.parse(iso)) + 1000)
        return () => clearTimeout(t)
      }
    }
  }, [relative, first, markFresh, iso])
  return <time ref={el} dateTime={iso} data-fresh={markFresh && inHtml && isFresh(iso) ? '' : undefined} suppressHydrationWarning={inHtml} className={className ? `tabular-nums ${className}` : 'tabular-nums'}>{first}</time>
}
