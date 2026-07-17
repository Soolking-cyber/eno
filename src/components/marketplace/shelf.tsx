'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'

// Horizontal "shelf" rail primitive — the section header (optional icon + bold title +
// optional "See all") and the snap scroller that ~8 rails hand-rolled identically.

/** Card width — pixel-matches the feed grid (2 cols mobile / 3 sm / 4 lg), so a rail card
 *  equals exactly one feed column and the rail reads as one family with the grid below.
 *  Was a copy-pasted literal in every rail. */
export const RAIL_CARD_W =
  'w-[calc((100%-0.5rem)/2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]'

/** Horizontal snap scroller, gaps matched to the feed grid (gap-2 / sm:gap-4). */
export const RAIL_SCROLLER = 'flex gap-2 overflow-x-auto scrollbar-none snap-x sm:gap-4'

export function Shelf({
  title,
  icon: Icon,
  seeAllHref,
  seeAllOnClick,
  sectionClassName,
  children,
}: {
  title: React.ReactNode
  icon?: LucideIcon
  /** "See all" as a link (storefront/seller rails) … */
  seeAllHref?: string
  /** … or as an action (category rails that push a filter). */
  seeAllOnClick?: () => void
  sectionClassName?: string
  children: React.ReactNode
}) {
  const { tr } = useLanguage()
  const label = tr('See all', 'Xem tất cả')
  const seeAllClass =
    'flex shrink-0 items-center gap-0.5 text-sm font-semibold text-accent-foreground hover:underline'
  const seeAll = seeAllHref ? (
    <Link href={seeAllHref} className={seeAllClass}>
      {label} <ChevronRight className="h-4 w-4" />
    </Link>
  ) : seeAllOnClick ? (
    <Button variant="bare" size="none" className={`${seeAllClass} cursor-pointer`} onClick={seeAllOnClick}>
      {label} <ChevronRight className="h-4 w-4" />
    </Button>
  ) : null

  // DESKTOP scroll arrows. A mouse wheel scrolls only VERTICALLY, and the rail hides its scrollbar,
  // so pointer users can't page a horizontal rail without a trackpad. These give them ← / → buttons
  // (touch keeps swiping; the arrows are `pc:` — pointer-fine — only). Each shows solely when there's
  // room to scroll THAT way, tracked from the scroller's position.
  const scrollerRef = useRef<HTMLDivElement>(null)
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
    const ro = new ResizeObserver(sync) // content/width changes (lazy cards, viewport resize)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', sync); ro.disconnect() }
  }, [sync])
  const page = (dir: 1 | -1) => {
    const el = scrollerRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }
  const arrowCls =
    'absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 rounded-full bg-card text-foreground shadow-md transition-colors hover:bg-muted pc:flex'

  return (
    <section className={sectionClassName}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-accent-foreground" />}
          {/* No truncate — original rail titles wrapped naturally (e.g. same-seller's
              "Tin khác từ {sellerName}" can be long); min-w-0 on the wrapper lets it. */}
          <h2 className="text-base font-bold text-foreground">{title}</h2>
        </div>
        {seeAll}
      </div>
      <div className="relative">
        <div ref={scrollerRef} className={RAIL_SCROLLER}>{children}</div>
        {canLeft && (
          <IconButton size="md" onClick={() => page(-1)} aria-label={tr('Scroll left', 'Cuộn trái')} className={cn(arrowCls, '-left-3')}>
            <ChevronLeft className="size-5" />
          </IconButton>
        )}
        {canRight && (
          <IconButton size="md" onClick={() => page(1)} aria-label={tr('Scroll right', 'Cuộn phải')} className={cn(arrowCls, '-right-3')}>
            <ChevronRight className="size-5" />
          </IconButton>
        )}
      </div>
    </section>
  )
}
