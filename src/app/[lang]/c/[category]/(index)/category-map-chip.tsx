import Link from 'next/link'
import { Map as MapIcon } from '@/components/ui/icons'
import { Badge } from '@/components/ui/badge'
import { Bilingual } from '@/components/marketplace/bilingual'
import { categoryHasMap } from '@/components/marketplace/map-pin-rows'
import { localizedHref } from '@/lib/lang-pinned'
import { HOMES_ONLY_PARAM } from '@/lib/rental-homes'
import { cn } from '@/lib/utils'

/**
 * THE MAP, CHOSEN BY AREA (UI climb 2026-11-09, phone UX hunt). A district page has a Map link at its top
 * (district-filter-row.tsx) and /c had none: on a phone the map was reachable only from the search panel or the footer.
 * ⚠️ PHONES ONLY (`sm:hidden`): from sm the header's map button is on screen and already opens this category's map
 * (header.tsx `openMap`). Blind A/B with it everywhere (t50, 2026-11-09): a small phone win for both judges, a wash or a
 * small loss on desktop, where it only took a district's place.
 * ⚠️ NEUTRAL TEXT, ACCENT ICON: in blue it sat beside the selected blue "All" and blurred which chip is the applied one
 * (both judges); only "All" wears the applied look.
 * ⛔ …AND THE ICON IS INK NOW (owner-approved 2026-11-14, cook r06 rentals-a and the shell's "one accent — never an icon"): the
 * whole chip is the browse chip's ink, as every other chip on the row. `glyphClassName` sizes the glyph — /c/rentals' phone
 * strip passes the 18px of its other glyphs (the sort arrows, Filters' sliders). ⛔ EXCEPT ONCE FLOATED (owner-approved
 * 2026-11-15 (build 8), cook r08 rentals): then the chip is the ink FILL and its glyph and word the page colour (below).
 * The wrapping sort strip has no room for it (15px spare at 360, 45 at 390, measured), so it rides the "By area" row, after
 * "All" ((index)/page.tsx) — ⚠️ EXCEPT ON /c/rentals (owner-approved 2026-11-14, UI climb batch 93, decision 5): there the
 * phone's strip is one swipe row, and the page renders this chip in it, after Filters, with the strip's chip look
 * (`className`, which REPLACES the row look below — the strip's chip wrapper is the one that is `sm:hidden` there).
 * ⛔ …ONLY WHILE THE HEAD IS ON SCREEN (owner-approved 2026-11-15 (build 8), cook r08 rentals — src/components/marketplace/
 * map-float.ts): past the list header the same link leaves the row and floats as ONE ink pill, bottom centre, 16px over the
 * tab bar, its 20px glyph and its word in the page colour, riding the bar (gone while it is). The page passes MAP_FLOAT in
 * `className`; the strip (seller-listings.tsx PinnedStrip `mapFloatAfter`) says when. Same href, same words, same element.
 * Scoped like the district page's link: this category, `homes=1` with the homes-only grid, the `/vi`
 * twin on a Vietnamese page; rel="nofollow" + prefetch={false}, since the URL canonicalises to `/`.
 * ⛔ Never where the category has no map (teachers — map-pin-rows.ts `categoryHasMap`: it would open a map without a pin).
 * The map's pins come through the edition scope like the grid's (api/listings/buildings + feed-payload: scopedListingWhere),
 * so it shows nothing the page itself may not.
 * A server component: every prop is a plain value.
 */
/** The "By area" row's look: the row's district chips, phones only. */
const ROW_CHIP = 'shrink-0 gap-1.5 whitespace-nowrap px-3.5 py-1.5 font-semibold text-body hover:bg-accent hover:text-accent-foreground sm:hidden'

export function CategoryMapChip({ slug, homesOnly, lang, className = ROW_CHIP, glyphClassName = 'size-4' }: {
  slug: string
  homesOnly: boolean
  lang: 'en' | 'vi'
  /** Replaces the row look (ROW_CHIP) — /c/rentals' phone strip passes its own chip classes. */
  className?: string
  /** The glyph's size (16px by default; the rentals strip's 18px). Its ink is the chip's own. */
  glyphClassName?: string
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
      <MapIcon className={cn('shrink-0', glyphClassName)} aria-hidden />
      <Bilingual en="Map" vi="Bản đồ" />
    </Badge>
  )
}
