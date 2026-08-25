'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { STROKE_FLOAT_MAX } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'
import { scrollBehavior } from '@/lib/reduced-motion'

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
    // ⚠️ THE SCROLLER'S OWN START PADDING IS NOT "SCROLLED", AND IGNORING THAT SHOWED A FADE
    // OVER CONTENT NOBODY HAD SCROLLED PAST. Rails written as `-mx-3 px-3` (a full-bleed row
    // that keeps its gutter) begin life at `scrollLeft === paddingLeft`, because the first
    // snap point sits after the padding. The old test — `scrollLeft > 4` — read that resting
    // 12px as "the user has scrolled", so `canLeft` was true on FIRST PAINT and
    // `railEdgeMask` drew a 40px left fade before anyone touched anything.
    // Measured on `/` at 390px: the why-eno value-prop row AND the category grid both rest at
    // scrollLeft 12 with padding-left 12, and both were masked — on why-eno that faded 40px of
    // a 96px tile, i.e. 42% of "Free to post", the first claim the product makes.
    // Padding is read per sync rather than cached: `sync` already runs on scroll/resize where
    // a style read is cheap next to the layout the browser has just done, and caching it would
    // go stale across the breakpoint that changes the gutter.
    const startPad = parseFloat(getComputedStyle(el).paddingInlineStart) || 0
    setCanLeft(el.scrollLeft > startPad + 4)
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
  }, [sync, watch])

  const page = useCallback((dir: 1 | -1) => {
    const el = scrollerRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: scrollBehavior() })
  }, [])

  return { scrollerRef, canLeft, canRight, page, arrowTop }
}

/** The bare bold ← / → chevrons themselves — a sibling of the scroller inside a `relative` wrapper. */
export function ScrollArrows({
  canLeft,
  canRight,
  page,
  arrowTop,
  tight,
}: {
  canLeft: boolean
  canRight: boolean
  page: (dir: 1 | -1) => void
  /** Measured media centre (px from the wrapper top); falls back to `top-1/2` when undefined. */
  arrowTop?: number
  /** Half the gutter gap. The homepage rails are tuned to -8/-14; the explorer's
   *  category + brand rails sit closer to their icons (owner, 2026-07-23). Default keeps
   *  the homepage exactly as-is. */
  tight?: boolean
}) {
  const { tr } = useLanguage()
  // Bare BOLD chevron (no circle/outline), clear of the cards in the gutter — quiet ink → brand on
  // hover, a subtle drop-shadow so it stays legible next to a card. `top-1/2` centres on the full
  // row; an inline `top` (arrowTop) overrides that to centre on the media.
  // Offset is RESPONSIVE: at ≤1359px the content fills the viewport (only the 32px page padding to
  // work with), so -8 keeps the arrow fully visible with no h-scroll; once the viewport gutter opens
  // up (≥1360px) we push out to -14 for a full arrow-width gap. This never overflows at any width.
  const arrowCls =
    'absolute z-10 hidden -translate-y-1/2 text-ink-4 transition-transform duration-150 hover:scale-110 hover:text-accent-foreground active:scale-[0.96] pc:block'
  const arrowIcon = 'size-7 [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.25))]'
  // 50% less space when tight: -8→-4 (32→16px), -14→-7 (56→28px).
  const leftInset = tight ? '-left-4 min-[1360px]:-left-7' : '-left-8 min-[1360px]:-left-14'
  const rightInset = tight ? '-right-4 min-[1360px]:-right-7' : '-right-8 min-[1360px]:-right-14'
  const style = arrowTop != null ? { top: `${arrowTop}px` } : undefined
  return (
    <>
      {canLeft && (
        <Button variant="bare" size="none" onClick={() => page(-1)} aria-label={tr('Scroll left', 'Cuộn trái')} style={style} className={cn(arrowCls, arrowTop == null && 'top-1/2', leftInset)}>
          {/* Floating-chevron tier (icon-language §2): rail scroll arrows ride the max. */}
          <ChevronLeft className={arrowIcon} strokeWidth={STROKE_FLOAT_MAX} />
        </Button>
      )}
      {canRight && (
        <Button variant="bare" size="none" onClick={() => page(1)} aria-label={tr('Scroll right', 'Cuộn phải')} style={style} className={cn(arrowCls, arrowTop == null && 'top-1/2', rightInset)}>
          <ChevronRight className={arrowIcon} strokeWidth={STROKE_FLOAT_MAX} />
        </Button>
      )}
    </>
  )
}
