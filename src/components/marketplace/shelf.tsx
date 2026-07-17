'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'

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

  // Desktop ← / → scroll arrows (see useScrollArrows): a mouse wheel scrolls only vertically and the
  // rail hides its scrollbar, so pointer users can't page it without a trackpad. Centre them on the
  // card PHOTO (data-rail-media), not the full card, so they sit level with the image.
  const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows({ centerSelector: '[data-rail-media]' })

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
        <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} />
      </div>
    </section>
  )
}
