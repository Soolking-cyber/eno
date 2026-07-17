'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * Desktop horizontal-scroll arrows for any hidden-scrollbar rail. A mouse wheel scrolls only
 * vertically and the rails hide their scrollbar, so pointer users can't page a horizontal rail
 * without a trackpad. Attach `scrollerRef` to the overflow-x element and render `<ScrollArrows>`
 * as a sibling inside a `relative` wrapper:
 *
 *   const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows({ centerSelector })
 *   <div className="relative">
 *     <div ref={scrollerRef} className="… overflow-x-auto …">{items}</div>
 *     <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} />
 *   </div>
 *
 * The chevrons are bare + bold, sit WELL outside the row in the gutter (a full arrow-width clear of
 * the cards), are `pc:`-only (wide + pointer:fine = a real desktop; touch keeps swiping), and each
 * shows solely when there's room to scroll THAT way (tracked via a scroll listener + ResizeObserver).
 * On the narrowest desktops the outer sliver is clipped by the `body`'s overflow-x guard (no scroll).
 *
 * `centerSelector` (optional): a CSS selector for the item's MEDIA element (e.g. the card image box).
 * When given, the arrows centre on that media's height instead of the full item height — so on a
 * listing rail they sit level with the photo, not dragged down by the title/price rows beneath it.
 */
export function useScrollArrows<T extends HTMLElement = HTMLDivElement>(
  { centerSelector }: { centerSelector?: string } = {},
) {
  const scrollerRef = useRef<T>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const [arrowTop, setArrowTop] = useState<number | undefined>(undefined)

  const sync = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
    if (centerSelector) {
      // First item's media box — its vertical offset is stable across horizontal scroll, and the
      // aspect-ratio box has height from CSS immediately (before the image loads), so this is
      // correct on first paint; the ResizeObserver re-measures on width/viewport changes.
      const media = el.querySelector<HTMLElement>(centerSelector)
      if (media) {
        const er = el.getBoundingClientRect()
        const mr = media.getBoundingClientRect()
        if (mr.height > 0) setArrowTop(mr.top - er.top + mr.height / 2)
      }
    }
  }, [centerSelector])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const ro = new ResizeObserver(sync) // content/width changes (lazy items, viewport resize)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', sync); ro.disconnect() }
  }, [sync])

  const page = useCallback((dir: 1 | -1) => {
    const el = scrollerRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }, [])

  return { scrollerRef, canLeft, canRight, page, arrowTop }
}

/** The bare bold ← / → chevrons themselves — a sibling of the scroller inside a `relative` wrapper. */
export function ScrollArrows({
  canLeft,
  canRight,
  page,
  arrowTop,
}: {
  canLeft: boolean
  canRight: boolean
  page: (dir: 1 | -1) => void
  /** Measured media centre (px from the wrapper top); falls back to `top-1/2` when undefined. */
  arrowTop?: number
}) {
  const { tr } = useLanguage()
  // Bare BOLD chevron (no circle/outline), clear of the cards in the gutter — quiet ink → brand on
  // hover, a subtle drop-shadow so it stays legible next to a card. `top-1/2` centres on the full
  // row; an inline `top` (arrowTop) overrides that to centre on the media.
  // Offset is RESPONSIVE: at ≤1359px the content fills the viewport (only the 32px page padding to
  // work with), so -8 keeps the arrow fully visible with no h-scroll; once the viewport gutter opens
  // up (≥1360px) we push out to -14 for a full arrow-width gap. This never overflows at any width.
  const arrowCls =
    'absolute z-10 hidden -translate-y-1/2 text-ink-4 transition-transform duration-150 hover:scale-110 hover:text-accent-foreground active:scale-90 pc:block'
  const arrowIcon = 'size-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.25))]'
  const style = arrowTop != null ? { top: `${arrowTop}px` } : undefined
  return (
    <>
      {canLeft && (
        <Button variant="bare" size="none" onClick={() => page(-1)} aria-label={tr('Scroll left', 'Cuộn trái')} style={style} className={cn(arrowCls, arrowTop == null && 'top-1/2', '-left-8 min-[1360px]:-left-14')}>
          <ChevronLeft className={arrowIcon} strokeWidth={2.75} />
        </Button>
      )}
      {canRight && (
        <Button variant="bare" size="none" onClick={() => page(1)} aria-label={tr('Scroll right', 'Cuộn phải')} style={style} className={cn(arrowCls, arrowTop == null && 'top-1/2', '-right-8 min-[1360px]:-right-14')}>
          <ChevronRight className={arrowIcon} strokeWidth={2.75} />
        </Button>
      )}
    </>
  )
}
