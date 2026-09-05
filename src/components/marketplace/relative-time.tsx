'use client'
import { useMounted } from '@/hooks/use-mounted'
import { useLanguage } from '@/context/language-context'
import { timeAgo } from '@/lib/types'

/**
 * A relative "x ago" that CANNOT mismatch on hydration.
 *
 * ⛔ THE FIRST RENDER NEVER READS THE CLOCK. `timeAgo` is `Date.now() - posted`, so on a cached
 * page (listing detail is ISR for 30 days) the server baked "just now" at build time and the
 * browser computed "3d ago" at hydration — React #418 on every stale listing (2026-09-05 review,
 * R02). Server HTML and the first client render must be byte-identical, so until the component
 * has mounted it shows the CALENDAR DATE derived from the ISO string alone — no clock, no locale
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
  // Pre-mount: the ISO calendar day from the string alone — no clock, no zone. (Language would be
  // safe too: the provider seeds `lang` as 'en' on the server AND on the first client render and
  // switches after mount, which is what keeps every `tr()` on a cached page hydration-stable; the
  // ISO day is simply the one form that needs no language.) It is the UTC day, which in Hanoi is
  // yesterday for anything posted before 07:00; the relative form replaces it on the first
  // post-mount render. (`tabular-nums` evens the digits; the swap itself still
  // changes the text width — that is the price of no mismatch, and it was a #418 before.)
  const day = String(iso).slice(0, 10)
  const text = mounted ? timeAgo(iso, lang) : day
  return <time dateTime={iso} className={className ? `tabular-nums ${className}` : 'tabular-nums'}>{text}</time>
}
