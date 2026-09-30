'use client'

import { ChevronDown, MapPin } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'

/**
 * THE FACET ROW AS THE SERVER PAINTS IT — until the real <FacetBar> chunk arrives (E-TOOLBAR,
 * 2026-09-29).
 *
 * ⛔ WHY IT EXISTS. <FacetBar> is `dynamic(…, { ssr: false })` (listings-explorer.tsx), so the ISR HTML
 * carried only Next's bail-out template inside the toolbar's reservation (`min-h-12` then, `min-h-11` since 2026-09-30): a blank band
 * where the filters go, for as long as hydration takes — measured 4.0s on a phone cold load, 1.4s on
 * desktop. The row now reads "Any type · Price · Area · Any condition" from the first paint.
 *
 * ⚠️ IT DRAWS THE UNDIRECTED ('all') STATE, and only that: the four pills the home page renders, in
 * FacetBar's order (type → price → area → condition). A directed deep link swaps its pill set once the
 * real bar mounts — at the SAME height (every pill is `min-h-11` in one `flex-nowrap` row), so the swap
 * moves nothing vertically.
 * ⚠️ EACH PILL COPIES ITS REAL COUNTERPART'S BOX, class for class — CustomSelect's trigger for the two
 * selects (`indicator="down"`: label, then a 14px ⌄ at `ml-1.5`), PriceRangeFilter's trigger for Price
 * (`gap-1.5`), and FacetBar's Area button (MapPin group + ⌄). A pill that differs by a few pixels makes
 * the whole row twitch sideways when the chunk lands; change a trigger, change its twin here.
 * ⚠️ `aria-hidden` + `inert`: these are pictures of controls that do nothing yet. Exposing four inert
 * "buttons" to a screen reader, or a Tab stop that swallows a keypress, would be worse than the blank.
 */
export function FacetBarFallback() {
  const { tr } = useLanguage()
  // FacetBar's `wrap` + CustomSelect's sizing wrapper: content-sized pills, 7.5rem floor on desktop.
  const wrap = 'relative w-auto shrink-0 lg:min-w-[7.5rem]'
  // CustomSelect's trigger box at rest (triggerClassName, value 'all').
  const selectPill = 'flex min-h-11 w-full items-center justify-between gap-0 rounded-xl px-4 text-sm font-semibold text-body'
  // PriceRangeFilter's trigger / FacetBar's Area button at rest.
  const gapPill = 'flex min-h-11 w-full shrink-0 items-center justify-between gap-1.5 rounded-xl px-4 text-sm font-semibold text-body'
  const chevron = 'h-3.5 w-3.5 shrink-0 text-ink-4'
  return (
    <div aria-hidden="true" inert className="relative">
      {/* FacetBar's own row classes, minus the scroller: nothing here scrolls or takes input. */}
      <div className="-mx-3 flex flex-nowrap items-center gap-2 overflow-hidden px-3 lg:mx-0 lg:flex-wrap lg:px-0">
        <div className={wrap}>
          <span className={selectPill}>
            <span className="flex items-center gap-1.5 truncate"><span className="truncate">{tr('Any type', 'Mọi loại')}</span></span>
            <ChevronDown className={`ml-1.5 ${chevron}`} />
          </span>
        </div>
        <div className={wrap}>
          <span className={gapPill}>
            <span className="truncate">{tr('Price', 'Giá')}</span>
            <ChevronDown className={chevron} />
          </span>
        </div>
        <div className={wrap}>
          <span className={gapPill}>
            <span className="flex items-center gap-1.5 truncate">
              <MapPin className="h-3.5 w-3.5 text-ink-4" />
              <span className="truncate">{tr('Area', 'Khu vực')}</span>
            </span>
            <ChevronDown className={chevron} />
          </span>
        </div>
        <div className={wrap}>
          <span className={selectPill}>
            <span className="flex items-center gap-1.5 truncate"><span className="truncate">{tr('Any condition', 'Mọi tình trạng')}</span></span>
            <ChevronDown className={`ml-1.5 ${chevron}`} />
          </span>
        </div>
      </div>
    </div>
  )
}
