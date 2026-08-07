'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'

// Horizontal "shelf" rail primitive — the section header (optional icon + bold title +
// optional "See all") and the snap scroller that ~8 rails hand-rolled identically.

/** Sparse-catalogue floor for a curated rail (wow pass, 2026-08-06). Below three items a
 *  horizontal rail is two cards and a void — it manufactures the look of a dead shop.
 *  Rails hide themselves under this floor; the feed grid below still shows every listing,
 *  so nothing becomes unreachable. One constant so every rail agrees on "sensible minimum". */
export const MIN_RAIL_ITEMS = 3

/** ONE header treatment for every home section/rail (wow pass, 2026-08-06): same size,
 *  weight and margin everywhere, See-all right-aligned. Shelf consumes these; the rails
 *  that cannot use <Shelf> (category-rails' button-title, the landing feed heading)
 *  import the same strings instead of re-typing them — that re-typing is how the
 *  headers drifted apart in the first place. mb-3, not mb-2.5: the 8pt rhythm steps. */
export const SECTION_HEADER_ROW = 'mb-3 flex items-center justify-between gap-2'
export const SECTION_TITLE = 'text-lg font-semibold text-foreground'
export const SECTION_SEE_ALL =
  'flex shrink-0 items-center gap-0.5 text-sm font-semibold text-accent-foreground hover:underline'

/* ⛔ CHIP_CATEGORY_ICON_STROKE (`[stroke-width:2]`) WAS DELETED 2026-08-07 — do not
   re-add it. It re-tiered a small category glyph by winning over the svg's own
   presentation attribute, which only worked while a category glyph WAS one svg. It is
   now two stacked layers (a tinted body under the ink line — category-icons.tsx), and a
   single inherited stroke-width would either miss both layers or flatten the tint into
   the line. The re-tier is a prop: <CategoryIcon stroke={STROKE_UI}>. */

/** Edge-fade for a hidden-scrollbar rail — a MASK, never a painted overlay (the flat canon
 *  bans new fills; a mask only lets the canvas through, in any theme). Clipping a tile
 *  mid-glyph at the container edge reads as a rendering bug; fading it reads as "more this
 *  way". Fades ONLY the side(s) that can still scroll — driven by useScrollArrows'
 *  canLeft/canRight — so the first tile is never dimmed at rest and the fade disappears
 *  entirely once a row fits. Spread onto the scroller's `style`. */
export function railEdgeMask(canLeft: boolean, canRight: boolean): CSSProperties | undefined {
  if (!canLeft && !canRight) return undefined
  const from = canLeft ? 'transparent, black 2.5rem' : 'black'
  const to = canRight ? 'black calc(100% - 2.5rem), transparent' : 'black'
  const maskImage = `linear-gradient(to right, ${from}, ${to})`
  return { WebkitMaskImage: maskImage, maskImage }
}

/** Card width — pixel-matches the feed grid (2 cols mobile / 3 sm / 4 lg), so a rail card
 *  equals exactly one feed column and the rail reads as one family with the grid below.
 *  Was a copy-pasted literal in every rail. */
export const RAIL_CARD_W =
  'w-[calc((100%-0.5rem)/2)] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]'

/** Horizontal snap scroller, gaps matched to the feed grid (gap-2 / sm:gap-4).
 *  `overscroll-x-contain` keeps a sideways overscroll INSIDE the rail: without it, flicking
 *  a rail that is already at either end CHAINS the scroll out to the nearest scrollable
 *  ancestor (and, in the iOS WebView, hands the gesture to the swipe-back navigation).
 *  ⚠️ Honest limit: this only stops CHAINING. It cannot suppress the platform's own
 *  edge-swipe — a drag that STARTS in the screen-edge gutter is claimed by the system
 *  before the page sees it, and `touch-action` can't refuse it either
 *  (w3c/pointerevents#358). Containment is a real improvement, not a guarantee. */
export const RAIL_SCROLLER = 'flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-none snap-x sm:gap-4'

export function Shelf({
  title,
  icon: Icon,
  seeAllHref,
  seeAllOnClick,
  sectionClassName,
  watch,
  children,
}: {
  title: React.ReactNode
  icon?: LucideIcon
  /** "See all" as a link (storefront/seller rails) … */
  seeAllHref?: string
  /** … or as an action (category rails that push a filter). */
  seeAllOnClick?: () => void
  sectionClassName?: string
  /** Pass the rail's item COUNT when items arrive/refresh after mount (async fetch,
   *  localStorage hydration). Only the scroller's children change then — its own
   *  border box doesn't — so the arrows' ResizeObserver never re-fires and a rail
   *  that filled up after mount stays arrow-less forever (the brand-rail bug,
   *  2026-07-23). Threading the count into useScrollArrows re-syncs on change;
   *  harmless for server-seeded rails whose count never moves. */
  watch?: unknown
  children: React.ReactNode
}) {
  const { tr } = useLanguage()
  const label = tr('See all', 'Xem tất cả')
  const seeAll = seeAllHref ? (
    <Link href={seeAllHref} className={SECTION_SEE_ALL}>
      {label} <ChevronRight className="h-4 w-4" />
    </Link>
  ) : seeAllOnClick ? (
    <Button variant="bare" size="none" className={SECTION_SEE_ALL} onClick={seeAllOnClick}>
      {label} <ChevronRight className="h-4 w-4" />
    </Button>
  ) : null

  // Desktop ← / → scroll arrows (see useScrollArrows): a mouse wheel scrolls only vertically and the
  // rail hides its scrollbar, so pointer users can't page it without a trackpad. Centre them on the
  // card PHOTO (data-rail-media), not the full card, so they sit level with the image.
  const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows({ centerSelector: '[data-rail-media]', watch })

  return (
    <section className={sectionClassName}>
      <div className={SECTION_HEADER_ROW}>
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-accent-foreground" />}
          {/* No truncate — original rail titles wrapped naturally (e.g. same-seller's
              "Tin khác từ {sellerName}" can be long); min-w-0 on the wrapper lets it. */}
          <h2 className={SECTION_TITLE}>{title}</h2>
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
