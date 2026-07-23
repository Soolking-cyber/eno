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
  { centerSelector, watch }: {
    centerSelector?: string
    /** Re-measure when this changes. ⚠️ REQUIRED for rails whose items load ASYNC. The
     *  ResizeObserver watches the scroller's OWN box, which is unchanged when children
     *  arrive and overflow it — only scrollWidth grows — so a rail that mounts empty
     *  (brand-rail fetches its brands) computes "no overflow" once and never corrects.
     *  Pass the item count. A rail whose data is present at mount (server-seeded
     *  categories) does not need it. */
    watch?: unknown
  } = {},
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
    const ro = new ResizeObserver(sync) // viewport / width changes
    ro.observe(el)
    return () => { el.removeEventListener('scroll', sync); ro.disconnect() }
    // `watch` in deps re-runs sync (and re-attaches the listeners) once async items exist.
    // ⚠️ A MutationObserver here was TRIED and REJECTED (Gemini proposed it, 2026-07-23):
    // its callback fires as a microtask BEFORE the browser lays out the new children, so
    // sync reads a stale scrollWidth and the arrows never appear — MEASURED, 30 brands
    // stayed arrowless. The React effect runs after commit, where reading scrollWidth forces
    // correct layout. codex's own probe used double-requestAnimationFrame for the same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, watch])

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
  // ⚠️ POSITIONED AT THE INNER EDGE, overlaying the content — NOT in the gutter outside.
  // The old `-left-8 / -right-8` put the arrows OUTSIDE the rail, where the explorer's
  // `overflow-x: hidden` wrapper (there to stop the page wobbling sideways) CLIPPED the
  // right one away on wide screens: measured 2026-07-23, right arrow at x=1596 past a wrap
  // edge of 1568 = invisible, even though it was within the viewport. Sitting them just
  // inside each edge with a soft backdrop keeps them clear of the clip and legible over a
  // card. Verified across 1280/1920/2560.
  const arrowCls =
    'absolute z-10 hidden -translate-y-1/2 grid place-items-center h-9 w-9 rounded-full bg-background/80 backdrop-blur-sm shadow-pop ring-1 ring-border/60 text-ink-4 transition-transform duration-150 hover:scale-110 hover:text-accent-foreground active:scale-90 pc:grid'
  const arrowIcon = 'size-5'
  const style = arrowTop != null ? { top: `${arrowTop}px` } : undefined
  return (
    <>
      {canLeft && (
        <Button variant="bare" size="none" onClick={() => page(-1)} aria-label={tr('Scroll left', 'Cuộn trái')} style={style} className={cn(arrowCls, arrowTop == null && 'top-1/2', 'left-1')}>
          <ChevronLeft className={arrowIcon} strokeWidth={2.75} />
        </Button>
      )}
      {canRight && (
        <Button variant="bare" size="none" onClick={() => page(1)} aria-label={tr('Scroll right', 'Cuộn phải')} style={style} className={cn(arrowCls, arrowTop == null && 'top-1/2', 'right-1')}>
          <ChevronRight className={arrowIcon} strokeWidth={2.75} />
        </Button>
      )}
    </>
  )
}
