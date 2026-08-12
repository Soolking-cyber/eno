'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from '@/components/ui/icons'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'
import { ListingCard } from './listing-card'
import { CategoryIcon } from './category-icons'
import { RAIL_CARD_W, RAIL_SCROLLER, MIN_RAIL_ITEMS, RAIL_SKELETON_COUNT, SECTION_HEADER_ROW, SECTION_TITLE, SECTION_SEE_ALL } from './shelf'
import { STROKE_UI } from '@/lib/icon-tokens'
import { useLanguage, Tr } from '@/context/language-context'
import { useScrollArrows, ScrollArrows } from '@/hooks/use-scroll-arrows'
import { ListingCardSkeleton } from './listing-card-skeleton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const FILTER_KEYS = ['category', 'q', 'brand', 'subcategory', 'type', 'district', 'province', 'ward', 'condition', 'priceMin', 'priceMax']

type Rail = { slug: string; listings: SerializedListingCard[] }

/** One category rail. The cards (and therefore their images) only mount once the rail
 *  scrolls near the viewport — with up to ~10 rails on the home page, mounting every
 *  card up front flooded the page with images. A same-height skeleton holds the space
 *  so there's no layout shift. */
function CategoryRail({ cat, listings, onCategory }: { cat: SerializedCategory; listings: SerializedListingCard[]; onCategory: (slug: string) => void }) {
  const { lang, tr } = useLanguage()
  const router = useRouter()
  // The scroller ref is shared: the hook drives the ← / → arrows AND the lazy-mount IntersectionObserver.
  const { scrollerRef, canLeft, canRight, page, arrowTop } = useScrollArrows({ centerSelector: '[data-rail-media]' })
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || show) return
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) { setShow(true); io.disconnect() } },
      { rootMargin: '400px 0px' }, // mount just before it scrolls in
    )
    io.observe(el)
    return () => io.disconnect()
  }, [show])

  return (
    <section>
      {/* The header is the SHARED treatment (SECTION_* from shelf.tsx) so this rail cannot
          drift from the <Shelf> rails around it — it hand-rolled the same row before and had
          already drifted. The h2 WRAPS the button (heading > button is valid phrasing
          content); the reverse — a heading inside a <button> — is invalid HTML → React #418,
          which is why the title text itself stays a span. */}
      <div className={SECTION_HEADER_ROW}>
        <h2 className="min-w-0">
          <Button variant="bare" size="none" onClick={() => onCategory(cat.slug)} className="group flex items-center gap-2">
            {/* Header size = the 16px UI tier, so the baked display stroke (1.5, tuned for
                h-11 tiles) reads wispy beside the stroke-2 Clock/Award/History headers of
                the sibling rails — re-tier the ink line to the UI weight (icon-language §2). */}
            {/* ⛔ NO `selected` HERE, DELIBERATELY. Fill means "you are here" (owner,
                2026-08-07: "use icons filling only when selected, not as default"), and these
                rails all render at once on the UNFILTERED home view — nothing is chosen, so
                nothing may fill. The header is a shortcut INTO the category, exactly like the
                home grid tile; the filled state belongs to the browse rail you land on. If a
                later pass wants a fill here it needs a real boolean to hang it on, and this
                component has none. */}
            <CategoryIcon name={cat.icon} stroke={STROKE_UI} className="h-4 w-4 text-accent-foreground" />
            <span className={cn(SECTION_TITLE, 'transition-colors group-hover:text-accent-foreground')}>
              <Tr text={lang === 'vi' ? cat.nameVi : cat.name} />
            </span>
          </Button>
        </h2>
        <Button variant="bare" size="none" onClick={() => onCategory(cat.slug)} className={SECTION_SEE_ALL}>
          {tr('See all', 'Xem tất cả')}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {/* Cards pixel-match the feed grid (gap-2 / sm:gap-4; one card == one grid column) + snap. */}
      <div className="relative">
        <div ref={scrollerRef} className={RAIL_SCROLLER}>
          {show
            ? listings.map((l) => (
                <div key={l.id} className={RAIL_CARD_W}>
                  <ListingCard
                    listing={l}
                    onOpen={(x) => router.push(`/listings/${x.id}`)}
                    onLocate={() => window.dispatchEvent(new CustomEvent('eno:locate', { detail: { id: l.id, listing: l } }))}
                  />
                </div>
              ))
            : // Same-size skeletons hold the row height until it mounts (no images, no shift).
              Array.from({ length: Math.min(listings.length, RAIL_SKELETON_COUNT) }).map((_, i) => (
                <ListingCardSkeleton key={i} className={RAIL_CARD_W} />
              ))}
        </div>
        <ScrollArrows canLeft={canLeft} canRight={canRight} page={page} arrowTop={arrowTop} />
      </div>
    </section>
  )
}

/** "Browse by category" — one horizontal rail per category, ordered by live demand so
 *  the most-used category leads (mirrors the category-icon hierarchy). Sits below the
 *  For You + Outstanding businesses rails on the home landing view; hides the moment a
 *  filter/search is active.
 *  `excludeIds`: listings the rails ABOVE already showed (For You / Outstanding seeds) —
 *  on a 13-listing catalogue the same card in three adjacent rails reads as padding, not
 *  supply. Each rail dedups against it and hides below the shared sparse floor. */
export function CategoryRails({ categories, onCategory, excludeIds }: { categories: SerializedCategory[]; onCategory: (slug: string) => void; excludeIds?: string[] }) {
  const [rails, setRails] = useState<Rail[] | null>(null)
  const [active, setActive] = useState(true) // default (unfiltered) home view?

  const bySlug = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories])
  const exclude = useMemo(() => new Set(excludeIds ?? []), [excludeIds])

  useEffect(() => {
    let off = false
    fetch('/api/category-rails')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!off && d) setRails(d.rails || []) })
      .catch(() => { if (!off) setRails([]) })
    return () => { off = true }
  }, [])

  // Hide when the feed is filtered/searched (same signal the For You rail uses).
  useEffect(() => {
    const check = () => {
      const p = new URLSearchParams(window.location.search)
      const filtered = FILTER_KEYS.some((k) => p.has(k)) || Array.from(p.keys()).some((k) => k.startsWith('attr_') || k.startsWith('range_'))
      setActive(!filtered)
    }
    check()
    window.addEventListener('eno:query', check)
    window.addEventListener('popstate', check)
    return () => { window.removeEventListener('eno:query', check); window.removeEventListener('popstate', check) }
  }, [])

  if (!active) return null
  if (rails === null) return null // wait for data; the feed below already fills the page

  // Dedup + sparse floor BEFORE render: drop cards the rails above already showed, then hide
  // any rail that falls below MIN_RAIL_ITEMS — a category heading over one or two cards is
  // manufactured density, and every listing still appears in the feed grid below. Computed
  // first so that when NOTHING survives we return null instead of an empty in-flow div —
  // inside the landing's space-y container even a zero-height div earns a full 32-48px
  // spacing unit (the exact phantom-band failure the deferred wrapper above defends against).
  const visible = rails
    .map((rail) => {
      const cat = bySlug.get(rail.slug)
      if (!cat) return null
      const items = rail.listings.filter((l) => !exclude.has(l.id))
      if (items.length < MIN_RAIL_ITEMS) return null
      return { cat, items, slug: rail.slug }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
  if (visible.length === 0) return null

  return (
    <div className="space-y-7">
      {visible.map(({ cat, items, slug }) => (
        <CategoryRail key={slug} cat={cat} listings={items} onCategory={onCategory} />
      ))}
    </div>
  )
}
