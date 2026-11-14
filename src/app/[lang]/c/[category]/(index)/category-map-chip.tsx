import Link from 'next/link'
import { Map as MapIcon } from '@/components/ui/icons'
import { Badge } from '@/components/ui/badge'
import { Bilingual } from '@/components/marketplace/bilingual'
import { categoryHasMap } from '@/components/marketplace/map-pin-rows'
import { localizedHref } from '@/lib/lang-pinned'
import { HOMES_ONLY_PARAM } from '@/lib/rental-homes'

/**
 * THE MAP, CHOSEN BY AREA (UI climb 2026-11-09, phone UX hunt). A district page has a Map link at its top
 * (district-filter-row.tsx) and /c had none: on a phone the map was reachable only from the search panel or the footer.
 * ⚠️ PHONES ONLY (`sm:hidden`): from sm the header's map button is on screen and already opens this category's map
 * (header.tsx `openMap`). Blind A/B with it everywhere (t50, 2026-11-09): a small phone win for both judges, a wash or a
 * small loss on desktop, where it only took a district's place.
 * ⚠️ NEUTRAL TEXT, ACCENT ICON: in blue it sat beside the selected blue "All" and blurred which chip is the applied one
 * (both judges); only "All" wears the applied look.
 * The wrapping sort strip has no room for it (15px spare at 360, 45 at 390, measured), so it rides the "By area" row, after
 * "All" ((index)/page.tsx) — ⚠️ EXCEPT ON /c/rentals (owner-approved 2026-11-14, UI climb batch 93, decision 5): there the
 * phone's strip is one swipe row, and the page renders this chip in it, after Filters, with the strip's chip look
 * (`className`, which REPLACES the row look below — the strip's chip wrapper is the one that is `sm:hidden` there).
 * Scoped like the district page's link: this category, `homes=1` with the homes-only grid, the `/vi`
 * twin on a Vietnamese page; rel="nofollow" + prefetch={false}, since the URL canonicalises to `/`.
 * ⛔ Never where the category has no map (teachers — map-pin-rows.ts `categoryHasMap`: it would open a map without a pin).
 * The map's pins come through the edition scope like the grid's (api/listings/buildings + feed-payload: scopedListingWhere),
 * so it shows nothing the page itself may not.
 * A server component: every prop is a plain value.
 */
/** The "By area" row's look: the row's district chips, phones only. */
const ROW_CHIP = 'shrink-0 gap-1.5 whitespace-nowrap px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground sm:hidden'

export function CategoryMapChip({ slug, homesOnly, lang, className = ROW_CHIP }: {
  slug: string
  homesOnly: boolean
  lang: 'en' | 'vi'
  /** Replaces the row look (ROW_CHIP) — /c/rentals' phone strip passes its own chip classes. */
  className?: string
}) {
  if (!categoryHasMap(slug)) return null
  // A flag, not a free-form query (commit review): nothing passed in can overwrite `category` or `view`.
  const homes: Record<string, string> = homesOnly ? { [HOMES_ONLY_PARAM.key]: HOMES_ONLY_PARAM.value } : {}
  const href = localizedHref(`/?${new URLSearchParams({ category: slug, ...homes, view: 'map' }).toString()}`, lang)
  return (
    <Badge
      size="md"
      interactive
      render={<Link href={href} rel="nofollow" prefetch={false} />}
      className={className}
    >
      <MapIcon className="size-4 text-accent-foreground" aria-hidden />
      <Bilingual en="Map" vi="Bản đồ" />
    </Badge>
  )
}
