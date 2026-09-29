'use client'
import { useMounted } from '@/hooks/use-mounted'
import { useLanguage } from '@/context/language-context'
import { timeAgo } from '@/lib/types'
import { formatCalendarDay } from '@/lib/calendar-day'

/**
 * A relative "x ago" that CANNOT mismatch on hydration.
 *
 * ⛔ THE FIRST RENDER NEVER READS THE CLOCK. `timeAgo` is `Date.now() - posted`, so on a cached
 * page (listing detail is ISR for 30 days) the server baked "just now" at build time and the
 * browser computed "3d ago" at hydration — React #418 on every stale listing (2026-09-05 review,
 * R02). Server HTML and the first client render must be byte-identical, so until the component
 * has mounted it shows the CALENDAR DATE derived from the ISO string alone — no clock, no Intl
 * (`toLocaleDateString` would differ between the Node build and the visitor's browser). The
 * relative form takes over on the first post-mount render, which is the same moment `useMounted`
 * lets the presence bucket appear.
 *
 * ⚠️ NOT `suppressHydrationWarning`. That hides the warning, keeps the mismatch, and still costs
 * React a client re-render of the subtree; this removes the mismatch.
 */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const { lang } = useLanguage()
  const mounted = useMounted()
  // Pre-mount: the VIETNAM calendar day, in the reader's language ('24 Sep' / '24/9') — from the
  // string alone, with no clock and no Intl (src/lib/calendar-day.ts). Language is hydration-safe here:
  // the provider seeds `lang` from the [lang] route on the server AND on the first client render. This
  // printed the raw ISO slice ('2026-09-24') until 2026-09-29, which was both unreadable and the UTC
  // day — yesterday in Hanoi for anything posted before 07:00. The relative form replaces it on the
  // first post-mount render. (`tabular-nums` evens the digits; the swap itself still changes the text
  // width — that is the price of no mismatch, and it was a #418 before.)
  const day = formatCalendarDay(String(iso), lang, { year: false })
  const text = mounted ? timeAgo(iso, lang) : day
  return <time dateTime={iso} className={className ? `tabular-nums ${className}` : 'tabular-nums'}>{text}</time>
}
