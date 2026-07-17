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
 *   const { scrollerRef, canLeft, canRight, page } = useScrollArrows()
 *   <div className="relative">
 *     <div ref={scrollerRef} className="… overflow-x-auto …">{items}</div>
 *     <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} />
 *   </div>
 *
 * The chevrons are bare + bold, sit just OUTSIDE the row in the gutter (centred to it), are `pc:`-only
 * (wide + pointer:fine = a real desktop; touch keeps swiping), and each shows solely when there's room
 * to scroll THAT way (tracked via a scroll listener + ResizeObserver).
 */
export function useScrollArrows<T extends HTMLElement = HTMLDivElement>() {
  const scrollerRef = useRef<T>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const sync = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

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

  return { scrollerRef, canLeft, canRight, page }
}

/** The bare bold ← / → chevrons themselves — a sibling of the scroller inside a `relative` wrapper. */
export function ScrollArrows({
  canLeft,
  canRight,
  page,
}: {
  canLeft: boolean
  canRight: boolean
  page: (dir: 1 | -1) => void
}) {
  const { tr } = useLanguage()
  // Bare BOLD chevron (no circle/outline), sitting OUTSIDE the row in the gutter, centred to it —
  // quiet ink → brand on hover, a subtle drop-shadow so it stays legible next to a card.
  const arrowCls =
    'absolute top-1/2 z-10 hidden -translate-y-1/2 text-ink-4 transition-transform duration-150 hover:scale-110 hover:text-accent-foreground active:scale-90 pc:block'
  const arrowIcon = 'size-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.25))]'
  return (
    <>
      {canLeft && (
        <Button variant="bare" size="none" onClick={() => page(-1)} aria-label={tr('Scroll left', 'Cuộn trái')} className={cn(arrowCls, '-left-7')}>
          <ChevronLeft className={arrowIcon} strokeWidth={2.75} />
        </Button>
      )}
      {canRight && (
        <Button variant="bare" size="none" onClick={() => page(1)} aria-label={tr('Scroll right', 'Cuộn phải')} className={cn(arrowCls, '-right-7')}>
          <ChevronRight className={arrowIcon} strokeWidth={2.75} />
        </Button>
      )}
    </>
  )
}
