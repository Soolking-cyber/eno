'use client'

import { useId, type MouseEvent } from 'react'
import Link from 'next/link'
import { chipVariants } from '@/components/ui/chip'
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
 * /c/jobs "Theo thành phố / By city" chips with their counts (rentals-11), shaped like rentals' "By area"
 * row: one swipe row on a phone, wrapping from sm, each chip a real `<a>` into the jobs explorer in the
 * reader's language (`/vi?category=jobs` on a Vietnamese page — localizedHref, A1-LANG).
 *
 * ⚠️ THE CITY RIDES IN sessionStorage, NOT IN THE URL: a plain click leaves the province for the explorer to
 * apply on mount; a modified click (new tab, new window) stores nothing — it would sit in THIS tab waiting
 * for its next explorer — and opens every job, which is still the right page. rel="nofollow" +
 * prefetch={false} like every explorer link on /c (it canonicalises to `/`).
 * ⚠️ NAVIGATING CHIPS ARE `chipVariants()` ON A <Link> (the canon's interactive chip; a link is not a
 * toggle — ui/chip.tsx), and the "Theo thành phố: / By city:" label names their group for a screen reader.
 */
export function JobCityChips({ cities }: { cities: JobCity[] }) {
  const { tr, lang } = useLanguage()
  const href = localizedHref('/?category=jobs', variantOfLanguage(lang))
  const handOff = (e: MouseEvent, city: JobCity) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    try { sessionStorage.setItem(PENDING_AREA_KEY, JSON.stringify({ province: city.geo, ward: null, nearby: null })) } catch { /* storage blocked: it opens every job */ }
  }
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} className="scrollbar-none mt-3 flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain py-1 sm:mt-6 sm:flex-wrap sm:overflow-visible sm:py-0">
      <span id={labelId} className="shrink-0 whitespace-nowrap text-xs font-semibold text-ink-4">{tr('By city:', 'Theo thành phố:')}</span>
      {cities.map((c) => (
        <Link
          key={c.geo.code}
          href={href}
          rel="nofollow"
          prefetch={false}
          onClick={(e) => handOff(e, c)}
          data-job-city={c.geo.code}
          className={chipVariants({ size: 'sm', tone: 'neutral' })}
        >
          {lang === 'vi' ? c.label.vi : c.label.en}
          <span className="font-normal tabular-nums text-muted-foreground">{c.count}</span>
        </Link>
      ))}
    </div>
  )
}
