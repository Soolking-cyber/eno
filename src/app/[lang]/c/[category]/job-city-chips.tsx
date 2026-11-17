'use client'

import { useId, type MouseEvent } from 'react'
import Link from 'next/link'
import { chipVariants } from '@/components/ui/chip'
import { PILL_BOX, PILL_ON, PILL_REST } from '@/components/ui/chip-style'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/context/language-context'
import { localizedHref } from '@/lib/lang-pinned'
import { variantOfLanguage } from '@/lib/lang-variant'
import type { JobCity } from './job-cities'

/**
 * The explorer's consume-once area hand-off (header.tsx's area picker writes it, listings-explorer.tsx
 * applies it on mount). The explorer has no `province` URL param, so a chip cannot carry the city in its
 * href; it leaves the province here and opens the jobs explorer, which arrives already filtered to it.
 */
const PENDING_AREA_KEY = 'eno:pending-area'

/**
 * /c/jobs "Theo tỉnh/thành / By city" chips with their counts (rentals-11), shaped like rentals' "By area"
 * row: one swipe row on a phone, wrapping from sm, each chip a real `<a>` into the jobs explorer in the
 * reader's language (`/vi?category=jobs` on a Vietnamese page — localizedHref, A1-LANG).
 *
 * ⚠️ THE CITY RIDES IN sessionStorage, NOT IN THE URL: a plain click leaves the province for the explorer to
 * apply on mount; a modified click (new tab, new window) stores nothing — it would sit in THIS tab waiting
 * for its next explorer — and opens every job, which is still the right page. rel="nofollow" +
 * prefetch={false} like every explorer link on /c (it canonicalises to `/`).
 * ⚠️ NAVIGATING CHIPS ARE `chipVariants()` ON A <Link> (the canon's interactive chip; a link is not a
 * toggle — ui/chip.tsx), and the "Theo tỉnh/thành: / By city:" label names their group for a screen reader.
 */
export function JobCityChips({ cities, total, variant = 'row', className }: {
  cities: JobCity[]
  /**
   * The page's whole count (2026-11-06 audit). With it the row opens on "All N" (this page, in the applied look; not a link,
   * so `aria-current`): the row listed only the cities to go to, so nothing on it said the grid is every city, and HCMC's
   * "48" beside "Showing 48 of 71" read as the grid's own filter. Left out, the row is the cities alone.
   */
  total?: number
  /**
   * ⛔ 'phone' — /c/jobs' phone copy, under the heading line (owner-approved 2026-11-14, cook r06 jobs; SellerListings
   * `phoneHead.subhead`, rendered `sm:hidden` there while the page's 'row' copy is `max-sm:hidden`, so one row per width):
   * the browse chips (PILL_BOX / PILL_REST, "All N" in PILL_ON — the selected grey since 2026-11-17 —, the counts regular) in ONE row
   * of whole chips that bleeds to the screen edges, so the rest swipe in from under the edge. It reverses there the visible
   * "By city:" label (rentals-11, the 2026-11-06 audit): the label stays the group's name for a screen reader (`sr-only`), as
   * the judged mock has it. No edge fade, never touch-action on the scroller.
   */
  variant?: 'row' | 'phone'
  /** Merged last (the page's `max-sm:hidden` on the row copy). */
  className?: string
}) {
  const { tr, lang } = useLanguage()
  const href = localizedHref('/?category=jobs', variantOfLanguage(lang))
  const handOff = (e: MouseEvent, city: JobCity) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    try { sessionStorage.setItem(PENDING_AREA_KEY, JSON.stringify({ province: city.geo, ward: null, nearby: null })) } catch { /* storage blocked: it opens every job */ }
  }
  const labelId = useId()
  const phone = variant === 'phone'
  // The phone copy's chips: the browse chip (one chip style, ui/chip-style), 36px with its 44px hit area inside the row's py-1.
  const chip = phone ? cn(PILL_BOX, PILL_REST, 'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap') : chipVariants({ size: 'sm', tone: 'neutral' })
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn(
        phone
          ? 'scrollbar-none -mx-3 mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain scroll-px-3 px-3 py-1'
          : 'scrollbar-none mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain py-1 sm:mt-6 sm:flex-wrap sm:overflow-visible sm:py-0',
        className,
      )}
    >
      <span id={labelId} className={phone ? 'sr-only' : 'shrink-0 whitespace-nowrap text-xs font-semibold text-ink-4'}>{tr('By city:', 'Theo tỉnh/thành:')}</span>
      {total != null && (
        <span aria-current="page" className={cn(chip, 'cursor-default', PILL_ON)}>
          {tr('All', 'Tất cả')}
          <span className="font-normal tabular-nums">{total}</span>
        </span>
      )}
      {cities.map((c) => (
        <Link
          key={c.geo.code}
          href={href}
          rel="nofollow"
          prefetch={false}
          onClick={(e) => handOff(e, c)}
          data-job-city={c.geo.code}
          className={chip}
        >
          {/* i18n-invariant: a city name — never machine-translated (PlaceName's rule). */}
          {lang === 'vi' ? c.label.vi : c.label.en}
          <span className="font-normal tabular-nums text-muted-foreground">{c.count}</span>
        </Link>
      ))}
    </div>
  )
}
