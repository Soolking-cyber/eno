'use client'

import { useId } from 'react'
import Link from 'next/link'
import { Map as MapIcon } from '@/components/ui/icons'
import { chipVariants } from '@/components/ui/chip'
import { Bilingual } from '@/components/marketplace/bilingual'
import { localizedHref } from '@/lib/lang-pinned'
import { HOMES_ONLY_PARAM } from '@/lib/rental-homes'
import { CategoryFiltersLink } from '../category-filters-link'

/**
 * THE DISTRICT HUB'S WAY INTO THE EXPLORER, AT THE TOP (rentals-03). A district hub is where an expat
 * searching "apartment for rent District 2" lands, and its only filter entry was the "Refine in full
 * search" button under the grid — y=8189 at 390px on /c/rentals/d2. This row puts the three things a
 * renter reaches for first above the rent block and the grid: the explorer's filters, the map, and the
 * bedroom count.
 *
 * ⚠️ EVERY LINK CARRIES THE PAGE'S SCOPE: the category, the district, and `homes=1` while the grid lists
 * homes only — and goes to the `/vi` twin on a Vietnamese page (localizedHref, A1-LANG). The explorer
 * honours the district; `homes` it ignores until B1 gives it that axis (category-filters-link.tsx).
 * ⚠️ THE BEDROOM CHIPS ARE APARTMENTS, AND SAY SO. The explorer applies `attr_bedrooms` only with a
 * subcategory that has the facet (explorer-url.ts parseFilterParams: without one the chip filtered
 * nothing), so they open `apartment-rental` — the bulk of the homes — under an "Apartments:" label rather
 * than claiming every kind of home. `3+` is the facet's own ≥3 spelling (attr-match.ts).
 * ⚠️ rel="nofollow" + prefetch={false}, as the Filters link beside them: these URLs canonicalise to `/`.
 * Sort tabs are untouched (O-11).
 * ⚠️ THE BEDROOM CHIPS NAVIGATE, SO THEY ARE `chipVariants()` ON A <Link> (the canon's interactive chip —
 * a link is not a toggle, ui/chip.tsx), and their "Căn hộ: / Apartments:" label NAMES THEIR GROUP for a
 * screen reader (role="group" + aria-labelledby): "1 PN" alone does not say it means apartments.
 * A CLIENT component for that reason: chipVariants lives in a client module, and a server component
 * cannot call a client export. Every prop is a plain string or boolean, and the server variant and the
 * first client render agree, so the hrefs hydrate as rendered.
 */
const BEDROOMS = [
  { value: '1', en: '1 BR', vi: '1 PN' },
  { value: '2', en: '2 BR', vi: '2 PN' },
  { value: '3+', en: '3+ BR', vi: '3+ PN' },
] as const

export function DistrictFilterRow({
  categorySlug,
  district,
  homesOnly,
  lang,
}: {
  categorySlug: string
  district: string
  homesOnly: boolean
  lang: 'en' | 'vi'
}) {
  const scope: Record<string, string> = { district, ...(homesOnly ? { [HOMES_ONLY_PARAM.key]: HOMES_ONLY_PARAM.value } : {}) }
  const explorer = (extra: Record<string, string>) =>
    localizedHref(`/?${new URLSearchParams({ category: categorySlug, ...extra }).toString()}`, lang)
  const rentals = categorySlug === 'rentals'
  const bedsLabel = useId()
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <CategoryFiltersLink slug={categorySlug} query={scope} />
      <Link
        href={explorer({ ...scope, view: 'map' })}
        rel="nofollow"
        prefetch={false}
        className="relative tap-44 inline-flex items-center gap-1.5 whitespace-nowrap py-2.5 text-sm font-semibold text-accent-foreground hover:underline"
      >
        <MapIcon className="h-4 w-4" aria-hidden />
        <Bilingual en="Map" vi="Bản đồ" />
      </Link>
      {rentals && homesOnly && (
        <div role="group" aria-labelledby={bedsLabel} className="flex flex-wrap items-center gap-2">
          <span id={bedsLabel} className="text-xs font-semibold text-ink-4"><Bilingual en="Apartments:" vi="Căn hộ:" /></span>
          {BEDROOMS.map((b) => (
            <Link
              key={b.value}
              href={explorer({ district, subcategory: 'apartment-rental', attr_bedrooms: b.value })}
              rel="nofollow"
              prefetch={false}
              className={chipVariants({ size: 'sm', tone: 'neutral' })}
            >
              <Bilingual en={b.en} vi={b.vi} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
