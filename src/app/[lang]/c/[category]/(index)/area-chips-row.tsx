'use client'

import type { ReactNode } from 'react'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'
import { cn } from '@/lib/utils'

/**
 * THE "By area" ROW: ONE LINE AT EVERY WIDTH (UI climb, 2026-11-05), the shape the phone already had (C1-FOLD, 2026-09-29). From `sm` 19
 * chips wrapped into two rows above the first listing. Past the edge is a swipe on touch and the home rails' own ← → arrows
 * on a desktop (use-scroll-arrows), so it needs no disclosure of its own. Every chip stays a server-rendered <a>, focusable where it is.
 * ⚠️ EXCEPT ON /c/rentals BELOW sm (owner-approved 2026-11-14, UI climb batch 93, decision 5): there its links ride the sort strip,
 * the one control row, and the page passes `className="max-sm:hidden"`. From sm, and on every other page, the row is as it was.
 */
export function AreaChipsRow({ children, className }: { children: ReactNode; className?: string }) {
  const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows<HTMLDivElement>()
  return (
    <div className={cn('relative mt-3 sm:mt-6', className)}>
      <div ref={scrollerRef} className="scrollbar-none flex flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain py-1">
        {children}
      </div>
      <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} tight />
    </div>
  )
}
